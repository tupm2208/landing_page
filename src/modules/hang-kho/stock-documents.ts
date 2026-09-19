/**
 * @file STOCK DOCUMENTS (phiếu kho) — goods in, goods out, transfer, adjustment. OMI "Hàng hóa & Kho"
 * v1, 18/09/2026; the wire is `omi/docs/HOP-DONG-API-HANG-KHO-V1.md` §3.
 *
 * The stock book (`stock-ledger.ts`) already writes every change of `ton` with a movement row. A
 * document sits ON TOP of it: a header (who, when, which warehouses, supplier, costs), lines, and a
 * log of what was done to it. Three rules:
 *
 * 1. ONLY POSTING MOVES STOCK. A document can be a draft (`nhap`) or wait for approval (`cho-duyet`)
 *    for as long as the shop likes; the shelf does not know it exists. Posting (`hoan-thanh`) runs
 *    every line through `StockLedger.adjustIn` in ONE transaction, reference = the document code.
 *    One line short of stock and the WHOLE document is refused — the header, the lines and every
 *    earlier line of the same document roll back with it. A half-posted document is the one state
 *    that must never exist.
 * 2. A POSTED DOCUMENT IS NEVER EDITED BACK. Only its paperwork (date, supplier, reference, owner,
 *    note, costs) may change afterwards. A wrong posting is REVERSED: a new adjustment document,
 *    posted at once, undoes exactly what the original did; the original becomes `da-hoan-tac` and
 *    points at it. Both stay readable — the book never loses a line.
 * 3. OLD BOOK LINES STAY READABLE AS DOCUMENTS. Goods-in slips (`PN-…`) and transfers (`chuyen_…`)
 *    written before this table existed are rebuilt READ-ONLY from the book (`cu: true`).
 *
 * Column and wire names are Vietnamese (on-disk / OMI contract); everything else is English.
 */

import type { DataStore, Row } from "../../contract";
import { isoFromMysql, toMysqlDateTime } from "../../shared/mysql-time";
import { SOURCE, type Source } from "./catalog-repository";
import { LedgerRefused, MOVEMENT_KINDS, StockLedger, clampLimit, movementOf, refusalText, type AdjustOutcome, type LedgerRefusal, type Movement, type Tx } from "./stock-ledger";
import { TABLES } from "./schema";

/** Document kinds. VALUES are wire and on disk. */
export const DOCUMENT_KINDS = ["nhap", "xuat", "chuyen", "dieu-chinh"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** Document states. VALUES are wire and on disk. */
export const DOCUMENT_STATES = {
  draft: "nhap",
  waiting: "cho-duyet",
  posted: "hoan-thanh",
  cancelled: "da-huy",
  reversed: "da-hoan-tac"
} as const;

/** Log entries (`viec`). VALUES are wire. */
export const DOCUMENT_LOG = { create: "tao", edit: "sua", post: "ghi-so", cancel: "huy", reverse: "dao", duplicate: "nhan-ban", attach: "dinh-kem" } as const;

const CODE_PREFIX: Record<DocumentKind, string> = { nhap: "NK", xuat: "XK", chuyen: "CK", "dieu-chinh": "DC" };

/** The shop's calendar is Hanoi's (+07:00): a document made at 06:00 belongs to today, not to yesterday in UTC. */
const LOCAL_OFFSET_MS = 7 * 60 * 60 * 1000;
const MAX_LINES = 1000;
/** One line moves at most this many pairs — a typo of six zeros must not reach the shelf. */
export const MAX_LINE_QUANTITY = 1_000_000;
/** The largest amount DECIMAL(14,2) holds. */
export const MAX_MONEY = 99_999_999_999;
/** How many times a document write is retried after a code collision or a MySQL deadlock. */
const WRITE_ATTEMPTS = 4;

const text = (v: unknown): string => String(v ?? "").trim();
const money = (v: unknown): number => Math.max(0, Math.round((Number(v) || 0) * 100) / 100);

/** `YYYY-MM-DD` of a moment on the shop's calendar. */
export function localDay(at: Date): string {
  return new Date(at.getTime() + LOCAL_OFFSET_MS).toISOString().slice(0, 10);
}

/** The code prefix of a day: `NK-260918-`. The running number (`nnn`, 3 digits) counts per kind per local day. */
export function documentCodePrefix(kind: DocumentKind, at: Date): string {
  return `${CODE_PREFIX[kind]}-${localDay(at).slice(2).replace(/-/g, "")}-`;
}

/** The next code after the codes already used today (any of them, any order). */
export function nextDocumentCode(kind: DocumentKind, at: Date, usedToday: string[]): string {
  const prefix = documentCodePrefix(kind, at);
  const highest = usedToday
    .filter((c) => c.startsWith(prefix))
    .map((c) => Number(c.slice(prefix.length)))
    .filter((n) => Number.isInteger(n) && n > 0)
    .reduce((max, n) => Math.max(max, n), 0);
  return `${prefix}${String(highest + 1).padStart(3, "0")}`;
}

/** One line as the caller sends it (wire `{ ma, size, soLuong, donGia, tinhTrang, ghiChu, maKho? }`). */
export interface DocumentLine {
  code: string;
  size: string;
  /** The line's own warehouse (adjustments over several warehouses); "" = the document's. */
  warehouseId: string;
  quantity: number;
  unitPrice: number;
  condition: string;
  note: string;
  /** Reversal lines only (never stored): the exact row the original touched. */
  variantId?: string;
}

/** A document header as the caller sends it; `undefined` = not sent (keep what is there). */
export interface DocumentInput {
  kind?: unknown;
  state?: unknown;
  from?: unknown;
  to?: unknown;
  date?: unknown;
  partner?: unknown;
  reference?: unknown;
  owner?: unknown;
  note?: unknown;
  shippingFee?: unknown;
  otherCost?: unknown;
  lines?: unknown;
}

/** Reads the Vietnamese wire body of POST / PUT `/api/hang-kho/phieu`. Absent fields stay `undefined`. */
export function documentInputOf(body: Record<string, unknown>): DocumentInput {
  const pick = (key: string) => (body[key] === undefined ? undefined : body[key]);
  return {
    kind: pick("loai"), state: pick("trangThai"), from: pick("khoNguon"), to: pick("khoDich"), date: pick("ngayChungTu"),
    partner: pick("doiTac"), reference: pick("maThamChieu"), owner: pick("nguoiPhuTrach"), note: pick("ghiChu"),
    shippingFee: pick("phiVanChuyen"), otherCost: pick("chiPhiKhac"), lines: pick("dong")
  };
}

/** A refusal answered as `{ ok:false, error, message }` with its HTTP status (and the failing line, 1-based). */
export interface DocumentRefusal { ok: false; status: number; error: string; message: string; dong?: number }

const refuse = (status: number, error: string, message: string, line?: number): DocumentRefusal =>
  ({ ok: false, status, error, message, ...(line ? { dong: line } : {}) });

/** A header row as written. */
interface HeaderRow {
  ma: string; loai: DocumentKind; trang_thai: string; kho_nguon: string; kho_dich: string; ngay_chung_tu: string;
  doi_tac: string; ma_tham_chieu: string; nguoi_phu_trach: string; ghi_chu: string; phi_van_chuyen: number; chi_phi_khac: number;
  dinh_kem_json: string | null; ma_phieu_goc: string; ma_phieu_dao: string; boi: string; tao_luc: string; sua_luc: string; ghi_so_luc: string | null;
}

/** The warehouse kind the shop declared (`ready` / `order`), or undefined when not declared. */
export type WarehouseKindOf = (warehouseId: string) => "ready" | "order" | undefined;

function linesOf(raw: unknown, kind: DocumentKind): DocumentLine[] | DocumentRefusal {
  if (!Array.isArray(raw) || raw.length === 0) return refuse(400, "thieu_dong", "Phiếu cần ít nhất một dòng sản phẩm.");
  if (raw.length > MAX_LINES) return refuse(400, "qua_nhieu_dong", `Một phiếu tối đa ${MAX_LINES} dòng.`);
  const out: DocumentLine[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const r = (raw[i] && typeof raw[i] === "object" ? raw[i] : {}) as Record<string, unknown>;
    const code = text(r["ma"]);
    const size = text(r["size"]);
    const quantity = Number(r["soLuong"]);
    if (!code || !size) return refuse(400, "dong_khong_hop_le", `Dòng ${i + 1}: thiếu mã sản phẩm hoặc size.`, i + 1);
    if (!Number.isInteger(quantity) || quantity === 0) return refuse(400, "dong_khong_hop_le", `Dòng ${i + 1}: số lượng phải là số nguyên khác 0.`, i + 1);
    if (kind !== "dieu-chinh" && quantity < 0) return refuse(400, "dong_khong_hop_le", `Dòng ${i + 1}: số lượng phải lớn hơn 0 (chỉ phiếu điều chỉnh mới được số âm).`, i + 1);
    if (Math.abs(quantity) > MAX_LINE_QUANTITY) return refuse(400, "dong_khong_hop_le", `Dòng ${i + 1}: số lượng tối đa ${MAX_LINE_QUANTITY.toLocaleString("vi-VN")}.`, i + 1);
    if (!moneyFits(r["donGia"])) return refuse(400, "dong_khong_hop_le", `Dòng ${i + 1}: đơn giá không hợp lệ hoặc quá lớn.`, i + 1);
    out.push({
      code: code.slice(0, 128), size: size.slice(0, 64), warehouseId: text(r["maKho"]).slice(0, 128), quantity,
      unitPrice: money(r["donGia"]), condition: (text(r["tinhTrang"]) || "dat").slice(0, 32), note: text(r["ghiChu"]).slice(0, 255)
    });
  }
  return out;
}

const isRefusal = (x: unknown): x is DocumentRefusal => Boolean(x && typeof x === "object" && (x as { ok?: unknown }).ok === false);

/** The warehouses a kind needs: goods in → destination; out / adjust → source; transfer → both, different. */
function checkWarehouses(kind: DocumentKind, from: string, to: string): DocumentRefusal | null {
  if (kind === "nhap" && !to) return refuse(400, "thieu_kho", "Phiếu nhập cần kho nhập (khoDich).");
  if ((kind === "xuat" || kind === "dieu-chinh") && !from) return refuse(400, "thieu_kho", "Phiếu xuất / điều chỉnh cần kho (khoNguon).");
  if (kind === "chuyen") {
    if (!from || !to) return refuse(400, "thieu_kho", "Phiếu chuyển cần cả kho đi và kho đến.");
    if (from === to) return refuse(400, "cung_kho", "Kho đi và kho đến phải khác nhau.");
  }
  return null;
}

/**
 * A goods-in / goods-out / transfer document works on ITS warehouse(s): a line naming another warehouse
 * would post somewhere the header does not say. Only an adjustment may spread over several warehouses.
 */
function checkLineWarehouses(kind: DocumentKind, from: string, to: string, lines: DocumentLine[]): DocumentRefusal | null {
  if (kind === "dieu-chinh") return null;
  const own = kind === "nhap" ? to : from;
  const i = lines.findIndex((l) => l.warehouseId !== "" && l.warehouseId !== own);
  return i < 0 ? null : refuse(400, "dong_khong_hop_le", `Dòng ${i + 1}: kho của dòng (${lines[i]!.warehouseId}) khác kho của phiếu (${own}).`, i + 1);
}

/** An amount given on the wire that fits the money columns (absent / empty = 0, which fits). */
function moneyFits(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return true;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= MAX_MONEY;
}

function feeRefusal(input: DocumentInput): DocumentRefusal | null {
  return moneyFits(input.shippingFee) && moneyFits(input.otherCost) ? null : refuse(400, "so_tien_sai", "Phí vận chuyển / chi phí khác không hợp lệ hoặc quá lớn.");
}

/** A write worth trying again: two documents took the same number, or MySQL chose this one as a deadlock victim. */
export function isRetryableWrite(e: unknown): boolean {
  const err = e as { code?: unknown; errno?: unknown; message?: unknown } | null;
  const message = String(err?.message ?? e ?? "");
  return err?.code === "ER_DUP_ENTRY" || err?.code === "ER_LOCK_DEADLOCK" || err?.errno === 1213
    || /duplicate entry/i.test(message) || /deadlock found/i.test(message);
}

/** Lines compared as the paperwork rule sees them (rule 2): what, how many, at what price, which warehouse. */
function sameLines(a: DocumentLine[], b: DocumentLine[]): boolean {
  const key = (l: DocumentLine) => [l.code.toLowerCase(), l.size.toLowerCase(), l.warehouseId, l.quantity, l.unitPrice, l.condition, l.note].join("\u0000");
  return a.length === b.length && a.every((l, i) => key(l) === key(b[i]!));
}

export class StockDocuments {
  private readonly ledger: StockLedger;

  constructor(private readonly store: DataStore, private readonly now: () => Date, private readonly warehouseKind: WarehouseKindOf = () => undefined) {
    this.ledger = new StockLedger(store, now);
  }

  private stamp(): string {
    return toMysqlDateTime(this.now(), { ms: true });
  }

  // ---- writing -------------------------------------------------------------------------------

  /** A NEW document; posted at once when `trangThai: "hoan-thanh"` (all or nothing). */
  async create(input: DocumentInput, actor: string): Promise<{ ok: true; code: string } | DocumentRefusal> {
    const kind = text(input.kind) as DocumentKind;
    if (!(DOCUMENT_KINDS as readonly string[]).includes(kind)) return refuse(400, "loai_phieu_sai", "Loại phiếu phải là nhập, xuất, chuyển hoặc điều chỉnh.");
    const state = text(input.state) || DOCUMENT_STATES.draft;
    if (![DOCUMENT_STATES.draft, DOCUMENT_STATES.waiting, DOCUMENT_STATES.posted].includes(state as "nhap")) {
      return refuse(400, "trang_thai_sai", "Phiếu mới chỉ ở trạng thái nháp, chờ duyệt hoặc hoàn thành.");
    }
    const from = text(input.from).slice(0, 128);
    const to = text(input.to).slice(0, 128);
    const badWarehouse = checkWarehouses(kind, from, to);
    if (badWarehouse) return badWarehouse;
    const lines = linesOf(input.lines, kind);
    if (isRefusal(lines)) return lines;
    const badLine = checkLineWarehouses(kind, from, to, lines) ?? feeRefusal(input);
    if (badLine) return badLine;

    return this.retrying(() => this.store.transaction(async (tx) => {
          const at = this.now();
          const used = await tx.rows(`SELECT ma FROM ${TABLES.documents} WHERE ma LIKE ?`, [`${documentCodePrefix(kind, at)}%`]);
          const code = nextDocumentCode(kind, at, used.map((r) => text(r["ma"])));
          const stamp = this.stamp();
          const header: HeaderRow = {
            ma: code, loai: kind, trang_thai: DOCUMENT_STATES.draft, kho_nguon: kind === "nhap" ? "" : from, kho_dich: kind === "nhap" || kind === "chuyen" ? to : "",
            ngay_chung_tu: dayOr(input.date, localDay(at)), doi_tac: text(input.partner).slice(0, 190), ma_tham_chieu: text(input.reference).slice(0, 128),
            nguoi_phu_trach: text(input.owner).slice(0, 190), ghi_chu: text(input.note).slice(0, 5000),
            phi_van_chuyen: money(input.shippingFee), chi_phi_khac: money(input.otherCost), dinh_kem_json: null,
            ma_phieu_goc: "", ma_phieu_dao: "", boi: actor.slice(0, 190), tao_luc: stamp, sua_luc: stamp, ghi_so_luc: null
          };
          if (kind === "dieu-chinh" && to) header.kho_dich = to;
          await tx.table(TABLES.documents).insert(header as unknown as Row);
          await this.writeLines(tx, code, lines);
          await this.log(tx, code, DOCUMENT_LOG.create, `Tạo phiếu ${lines.length} dòng`, actor);
          if (state === DOCUMENT_STATES.posted) await this.post(tx, header, lines, actor);
          else if (state === DOCUMENT_STATES.waiting) await tx.table(TABLES.documents).update({ ma: code }, { trang_thai: DOCUMENT_STATES.waiting });
          return { ok: true as const, code };
    }));
  }

  /**
   * Runs one document write; a stock refusal becomes the answer, a code collision or a deadlock is
   * tried again (the whole transaction rolled back first, so nothing is written twice).
   */
  private async retrying(work: () => Promise<{ ok: true; code: string } | DocumentRefusal>): Promise<{ ok: true; code: string } | DocumentRefusal> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await work();
      } catch (e) {
        if (e instanceof LedgerRefused) return stockRefusal(e);
        if (attempt < WRITE_ATTEMPTS && isRetryableWrite(e)) continue;
        throw e;
      }
    }
  }

  /**
   * EDIT a document. Not posted yet: everything may change, and `trangThai` may post or cancel it.
   * Posted / cancelled / reversed: only the paperwork (rule 2) — any other field that DIFFERS from
   * what is stored is refused with `da_ghi_so`; sending it back unchanged is fine.
   */
  async update(code: string, input: DocumentInput, actor: string): Promise<{ ok: true; code: string } | DocumentRefusal> {
    const badFee = feeRefusal(input);
    if (badFee) return badFee;
    return this.retrying(() => this.store.transaction(async (tx) => {
        const current = await this.header(tx, code, true);
        if (!current) return refuse(404, "khong_thay", "Không tìm thấy phiếu này.");
        const currentLines = await this.lines(tx, code);
        const open = current.trang_thai === DOCUMENT_STATES.draft || current.trang_thai === DOCUMENT_STATES.waiting;
        const paperwork: Partial<HeaderRow> = {
          ...(input.date === undefined ? {} : { ngay_chung_tu: dayOr(input.date, current.ngay_chung_tu) }),
          ...(input.partner === undefined ? {} : { doi_tac: text(input.partner).slice(0, 190) }),
          ...(input.reference === undefined ? {} : { ma_tham_chieu: text(input.reference).slice(0, 128) }),
          ...(input.owner === undefined ? {} : { nguoi_phu_trach: text(input.owner).slice(0, 190) }),
          ...(input.note === undefined ? {} : { ghi_chu: text(input.note).slice(0, 5000) }),
          ...(input.shippingFee === undefined ? {} : { phi_van_chuyen: money(input.shippingFee) }),
          ...(input.otherCost === undefined ? {} : { chi_phi_khac: money(input.otherCost) })
        };

        if (!open) {
          const kindChanged = input.kind !== undefined && text(input.kind) !== current.loai;
          const fromChanged = input.from !== undefined && text(input.from) !== current.kho_nguon;
          const toChanged = input.to !== undefined && text(input.to) !== current.kho_dich;
          const stateChanged = input.state !== undefined && text(input.state) !== "" && text(input.state) !== current.trang_thai;
          let linesChanged = false;
          if (input.lines !== undefined) {
            const sent = linesOf(input.lines, current.loai);
            linesChanged = isRefusal(sent) || !sameLines(sent, currentLines);
          }
          if (kindChanged || fromChanged || toChanged || stateChanged || linesChanged) {
            return refuse(409, "da_ghi_so", "Phiếu đã ghi sổ, đã huỷ hoặc đã hoàn tác: chỉ sửa được ngày chứng từ, đối tác, mã tham chiếu, người phụ trách, ghi chú và chi phí. Muốn đổi hàng hoặc số lượng thì đảo phiếu rồi lập phiếu mới.");
          }
          if (Object.keys(paperwork).length === 0) return { ok: true as const, code };
          await tx.table(TABLES.documents).update({ ma: code }, { ...paperwork, sua_luc: this.stamp() } as Row);
          await this.log(tx, code, DOCUMENT_LOG.edit, `Sửa thông tin chung: ${Object.keys(paperwork).join(", ")}`, actor);
          return { ok: true as const, code };
        }

        const kind = (input.kind === undefined ? current.loai : text(input.kind)) as DocumentKind;
        if (!(DOCUMENT_KINDS as readonly string[]).includes(kind)) return refuse(400, "loai_phieu_sai", "Loại phiếu phải là nhập, xuất, chuyển hoặc điều chỉnh.");
        const state = input.state === undefined || text(input.state) === "" ? current.trang_thai : text(input.state);
        if (![DOCUMENT_STATES.draft, DOCUMENT_STATES.waiting, DOCUMENT_STATES.posted, DOCUMENT_STATES.cancelled].includes(state as "nhap")) {
          return refuse(400, "trang_thai_sai", "Trạng thái phải là nháp, chờ duyệt, hoàn thành hoặc đã huỷ.");
        }
        const from = input.from === undefined ? current.kho_nguon : text(input.from).slice(0, 128);
        const to = input.to === undefined ? current.kho_dich : text(input.to).slice(0, 128);
        const badWarehouse = checkWarehouses(kind, from, to);
        if (badWarehouse) return badWarehouse;
        let lines = currentLines;
        if (input.lines !== undefined) {
          const sent = linesOf(input.lines, kind);
          if (isRefusal(sent)) return sent;
          lines = sent;
        }
        const badLine = checkLineWarehouses(kind, from, to, lines);
        if (badLine) return badLine;
        if (input.lines === undefined && kind !== current.loai) {
          const again = linesOf(currentLines.map((l) => ({ ma: l.code, size: l.size, soLuong: l.quantity })), kind);
          if (isRefusal(again)) return again;
        }
        const next: HeaderRow = { ...current, ...paperwork, loai: kind, kho_nguon: kind === "nhap" ? "" : from, kho_dich: kind === "xuat" ? "" : to, sua_luc: this.stamp() };
        await tx.table(TABLES.documents).update({ ma: code }, {
          loai: next.loai, kho_nguon: next.kho_nguon, kho_dich: next.kho_dich, ngay_chung_tu: next.ngay_chung_tu, doi_tac: next.doi_tac,
          ma_tham_chieu: next.ma_tham_chieu, nguoi_phu_trach: next.nguoi_phu_trach, ghi_chu: next.ghi_chu,
          phi_van_chuyen: next.phi_van_chuyen, chi_phi_khac: next.chi_phi_khac, sua_luc: next.sua_luc
        });
        if (input.lines !== undefined) {
          await tx.table(TABLES.documentLines).delete({ ma_phieu: code });
          await this.writeLines(tx, code, lines);
        }
        await this.log(tx, code, DOCUMENT_LOG.edit, input.lines !== undefined ? `Sửa phiếu, ${lines.length} dòng` : "Sửa thông tin phiếu", actor);
        if (state === DOCUMENT_STATES.posted) await this.post(tx, next, lines, actor);
        else if (state === DOCUMENT_STATES.cancelled) {
          await tx.table(TABLES.documents).update({ ma: code }, { trang_thai: DOCUMENT_STATES.cancelled });
          await this.log(tx, code, DOCUMENT_LOG.cancel, "Huỷ phiếu", actor);
        } else if (state !== current.trang_thai) {
          await tx.table(TABLES.documents).update({ ma: code }, { trang_thai: state });
        }
        return { ok: true as const, code };
    }));
  }

  /**
   * REVERSE a posted document (rule 2): a new ADJUSTMENT document, posted at once, whose lines undo
   * exactly what the original's did — one line per BOOK LINE it wrote, on the very row it touched
   * (`ma_bien_the`), so a warehouse holding a ready and a campaign row of one size gets back into the
   * right bucket; a transfer becomes two lines (+ source, − destination). The original becomes
   * `da-hoan-tac` and names its reversal. A reversal is never reversed again. Short of stock (the
   * goods already left, or are held for a customer) → nothing happens at all.
   */
  async reverse(code: string, actor: string): Promise<{ ok: true; code: string } | DocumentRefusal> {
    return this.retrying(() => this.store.transaction(async (tx) => {
        const original = await this.header(tx, code, true);
        if (!original) {
          const legacy = await this.readLegacy(code);
          return legacy ? refuse(409, "phieu_cu", "Phiếu cũ dựng lại từ sổ chỉ để xem — dùng phiếu điều chỉnh để sửa tồn.") : refuse(404, "khong_thay", "Không tìm thấy phiếu này.");
        }
        if (original.trang_thai !== DOCUMENT_STATES.posted) {
          return refuse(409, "khong_dao_duoc", original.trang_thai === DOCUMENT_STATES.reversed ? `Phiếu đã được đảo bằng ${original.ma_phieu_dao}.` : "Chỉ đảo được phiếu đã hoàn thành (đã ghi sổ).");
        }
        if (original.ma_phieu_goc !== "") return refuse(409, "khong_dao_duoc", "Phiếu đảo không đảo lại được — tạo phiếu mới nếu cần.");
        const lines = await this.lines(tx, code);
        const price = new Map(lines.map((l) => [`${l.code.toLowerCase()}|${l.size.toLowerCase()}`, l.unitPrice]));
        // The book lines this document wrote, oldest first (a transfer: out, then in, per line).
        const written = (await this.ledger.movementsWhere({ reference: code, limit: 2000 })).reverse();
        const reversed: DocumentLine[] = written.map((m) => ({
          code: m.code, size: m.size, warehouseId: m.warehouseId, quantity: -m.quantity, variantId: m.variantId,
          unitPrice: price.get(`${m.code.toLowerCase()}|${m.size.toLowerCase()}`) ?? 0, condition: "dat", note: `Đảo dòng ${code}`
        }));
        if (reversed.length === 0) return refuse(409, "khong_dao_duoc", "Phiếu này không có bút toán nào trong sổ để đảo.");
        const at = this.now();
        const used = await tx.rows(`SELECT ma FROM ${TABLES.documents} WHERE ma LIKE ?`, [`${documentCodePrefix("dieu-chinh", at)}%`]);
        const newCode = nextDocumentCode("dieu-chinh", at, used.map((r) => text(r["ma"])));
        const stamp = this.stamp();
        const header: HeaderRow = {
          ma: newCode, loai: "dieu-chinh", trang_thai: DOCUMENT_STATES.draft,
          kho_nguon: original.kho_nguon || original.kho_dich, kho_dich: original.kho_dich,
          ngay_chung_tu: localDay(at), doi_tac: original.doi_tac, ma_tham_chieu: code, nguoi_phu_trach: original.nguoi_phu_trach,
          ghi_chu: `Đảo phiếu ${code}`, phi_van_chuyen: 0, chi_phi_khac: 0, dinh_kem_json: null,
          ma_phieu_goc: code, ma_phieu_dao: "", boi: actor.slice(0, 190), tao_luc: stamp, sua_luc: stamp, ghi_so_luc: null
        };
        await tx.table(TABLES.documents).insert(header as unknown as Row);
        await this.writeLines(tx, newCode, reversed);
        await this.log(tx, newCode, DOCUMENT_LOG.create, `Phiếu đảo của ${code}`, actor);
        await this.post(tx, header, reversed, actor);
        await tx.table(TABLES.documents).update({ ma: code }, { trang_thai: DOCUMENT_STATES.reversed, ma_phieu_dao: newCode, sua_luc: stamp });
        await this.log(tx, code, DOCUMENT_LOG.reverse, `Đảo bằng phiếu ${newCode}`, actor);
        return { ok: true as const, code: newCode };
    }));
  }

  /** A copy as a new DRAFT: same header and lines, no stock numbers, no attachments, no reversal links. */
  async duplicate(code: string, actor: string): Promise<{ ok: true; code: string } | DocumentRefusal> {
    const original = await this.header(this.store, code, false);
    if (!original) return refuse(404, "khong_thay", "Không tìm thấy phiếu này (phiếu cũ dựng từ sổ không nhân bản được).");
    const lines = await this.lines(this.store, code);
    const made = await this.create({
      kind: original.loai, state: DOCUMENT_STATES.draft, from: original.kho_nguon, to: original.kho_dich, date: original.ngay_chung_tu,
      partner: original.doi_tac, reference: original.ma_tham_chieu, owner: original.nguoi_phu_trach, note: original.ghi_chu,
      shippingFee: original.phi_van_chuyen, otherCost: original.chi_phi_khac,
      lines: lines.map((l) => ({ ma: l.code, size: l.size, maKho: l.warehouseId, soLuong: l.quantity, donGia: l.unitPrice, tinhTrang: l.condition, ghiChu: l.note }))
    }, actor);
    if (!made.ok) return made;
    await this.log(this.store, made.code, DOCUMENT_LOG.duplicate, `Nhân bản từ ${code}`, actor);
    await this.log(this.store, code, DOCUMENT_LOG.duplicate, `Nhân bản thành ${made.code}`, actor);
    return made;
  }

  /** Adds an attachment already kept by the upload port. `false` = no such document. */
  async attach(code: string, file: { url: string; name: string }, actor: string): Promise<boolean> {
    return this.store.transaction(async (tx) => {
      const current = await this.header(tx, code, true);
      if (!current) return false;
      const list = attachmentsOf(current.dinh_kem_json);
      list.push({ url: file.url, ten: file.name.slice(0, 190) || file.url.split("/").pop() || "tep" });
      await tx.table(TABLES.documents).update({ ma: code }, { dinh_kem_json: JSON.stringify(list), sua_luc: this.stamp() });
      await this.log(tx, code, DOCUMENT_LOG.attach, `Đính kèm ${file.name || file.url}`.slice(0, 500), actor);
      return true;
    });
  }

  /** Is there a document (not a legacy one) with this code? */
  async exists(code: string): Promise<boolean> {
    return (await this.header(this.store, code, false)) !== null;
  }

  // ---- reading -------------------------------------------------------------------------------

  /** The list screen: newest first, with line count, signed quantity and goods value; `dem` counts the whole table. */
  async list(filter: { warehouseId?: string; kind?: string; state?: string; actor?: string; fromDay?: string; toDay?: string; limit?: number }): Promise<{ phieu: Record<string, unknown>[]; dem: Record<string, number> }> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (text(filter.warehouseId)) { clauses.push("(p.kho_nguon = ? OR p.kho_dich = ?)"); params.push(text(filter.warehouseId), text(filter.warehouseId)); }
    if (text(filter.kind)) { clauses.push("p.loai = ?"); params.push(text(filter.kind)); }
    if (text(filter.state)) { clauses.push("p.trang_thai = ?"); params.push(text(filter.state)); }
    if (text(filter.actor)) { clauses.push("p.boi = ?"); params.push(text(filter.actor)); }
    if (isDay(filter.fromDay)) { clauses.push("p.ngay_chung_tu >= ?"); params.push(text(filter.fromDay)); }
    if (isDay(filter.toDay)) { clauses.push("p.ngay_chung_tu <= ?"); params.push(text(filter.toDay)); }
    const limit = clampLimit(filter.limit, 200, 2000);
    const rows = await this.store.rows(
      `SELECT p.*, COALESCE(d.so_dong, 0) AS so_dong, COALESCE(d.so_luong, 0) AS tong_so_luong, COALESCE(d.tong_tien, 0) AS tong_tien
         FROM ${TABLES.documents} p
         LEFT JOIN (SELECT ma_phieu, COUNT(*) AS so_dong, SUM(so_luong) AS so_luong, SUM(so_luong * don_gia) AS tong_tien
                      FROM ${TABLES.documentLines} GROUP BY ma_phieu) d ON d.ma_phieu = p.ma
        ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
        ORDER BY p.tao_luc DESC, p.ma DESC
        LIMIT ?`,
      [...params, limit]
    );
    const month = localDay(this.now()).slice(0, 7);
    const counts = await this.store.rows(
      `SELECT
         SUM(CASE WHEN loai = 'nhap' AND trang_thai <> 'da-huy' AND ngay_chung_tu LIKE ? THEN 1 ELSE 0 END) AS nhap_thang,
         SUM(CASE WHEN loai = 'xuat' AND trang_thai <> 'da-huy' THEN 1 ELSE 0 END) AS xuat,
         SUM(CASE WHEN loai = 'chuyen' AND trang_thai <> 'da-huy' THEN 1 ELSE 0 END) AS chuyen,
         SUM(CASE WHEN trang_thai IN ('nhap', 'cho-duyet') THEN 1 ELSE 0 END) AS cho
         FROM ${TABLES.documents}`,
      [`${month}-%`]
    );
    const c = counts[0] ?? {};
    return {
      phieu: rows.map((r) => ({
        ma: text(r["ma"]), loai: text(r["loai"]), trangThai: text(r["trang_thai"]), khoNguon: text(r["kho_nguon"]), khoDich: text(r["kho_dich"]),
        soDong: Number(r["so_dong"] || 0), soLuong: Number(r["tong_so_luong"] || 0), tongTien: Number(r["tong_tien"] || 0),
        boi: text(r["boi"]), taoLuc: isoFromMysql(r["tao_luc"]), ngayChungTu: text(r["ngay_chung_tu"]),
        doiTac: text(r["doi_tac"]), maPhieuGoc: text(r["ma_phieu_goc"]), maPhieuDao: text(r["ma_phieu_dao"])
      })),
      dem: { nhapThang: Number(c["nhap_thang"] || 0), xuat: Number(c["xuat"] || 0), chuyen: Number(c["chuyen"] || 0), choXacNhan: Number(c["cho"] || 0) }
    };
  }

  /** One document in full (wire), or a legacy one rebuilt read-only from the book (rule 3), or null. */
  async read(code: string): Promise<Record<string, unknown> | null> {
    const header = await this.header(this.store, code, false);
    if (!header) return this.readLegacy(code);
    const lines = await this.lines(this.store, code);
    const names = await this.itemNames(lines.map((l) => l.code));
    const posted = header.ghi_so_luc !== null && header.ghi_so_luc !== undefined && header.ghi_so_luc !== "";
    const rawLines = await this.store.table(TABLES.documentLines).find({ where: { ma_phieu: code }, orderBy: "dong asc" });
    const log = await this.store.table(TABLES.documentLog).find({ where: { ma_phieu: code }, orderBy: "ma asc" });
    const book = await this.ledger.movementsWhere({ reference: code, limit: 2000 });
    // Posting writes the book in line order — one line each, two for a transfer (out, then in) — so the
    // bucket a line landed in (`nguon`, for "đổi giá" on exactly that row) is read back by position.
    const oldestFirst = [...book].reverse();
    const perLine = header.loai === "chuyen" ? 2 : 1;
    return {
      ...headerWire(header, lines),
      dinhKem: attachmentsOf(header.dinh_kem_json),
      dong: lines.map((l, i) => ({
        dong: i + 1, ma: l.code, ten: names.get(l.code.toLowerCase()) ?? "", size: l.size, maKho: l.warehouseId,
        soLuong: l.quantity, donGia: l.unitPrice, thanhTien: l.quantity * l.unitPrice,
        tonTruoc: posted ? nullableNumber(rawLines[i]?.["ton_truoc"]) : null, tonSau: posted ? nullableNumber(rawLines[i]?.["ton_sau"]) : null,
        tinhTrang: l.condition, ghiChu: l.note,
        // Transfer: `nguon` = where the pairs ARRIVED, `nguonDi` = the row they left.
        nguon: posted ? oldestFirst[i * perLine + perLine - 1]?.source ?? "" : "",
        ...(perLine === 2 ? { nguonDi: posted ? oldestFirst[i * 2]?.source ?? "" : "" } : {})
      })),
      nhatKy: log.map((r) => ({ viec: text(r["viec"]), noiDung: text(r["noi_dung"]), boi: text(r["boi"]), luc: isoFromMysql(r["luc"]) })),
      butToan: book,
      cu: false
    };
  }

  /**
   * RULE 3: a code the document table never had, rebuilt read-only from what the book kept —
   * an old goods-in slip (`PN-…`, from its own tables), any other reference written on book lines
   * (`chuyen_…`), or `BD-<id>` for ONE book line written with no reference at all.
   */
  async readLegacy(code: string): Promise<Record<string, unknown> | null> {
    const clean = text(code);
    if (!clean) return null;
    let movements: Movement[];
    const single = /^BD-(\d+)$/i.exec(clean);
    if (single) {
      const row = await this.store.table(TABLES.movements).one({ ma: Number(single[1]) });
      movements = row ? [movementOf(row)] : [];
    } else {
      movements = (await this.ledger.movementsWhere({ reference: clean, limit: 2000 })).reverse();
    }
    const receipt = clean.startsWith("PN-") ? await this.store.table(TABLES.receipts).one({ ma: clean }) : null;
    if (movements.length === 0 && !receipt) return null;

    type Line = { code: string; size: string; warehouseId: string; quantity: number; unitPrice: number; before: number | null; after: number | null; note: string };
    let kind: string;
    let from = "", to = "";
    let lines: Line[];
    if (receipt) {
      kind = "nhap";
      const slipLines = await this.store.table(TABLES.receiptLines).find({ where: { ma_phieu: clean }, orderBy: "dong asc" });
      lines = slipLines.map((l, i) => ({
        code: text(l["ma_mon"]), size: text(l["size"]), warehouseId: text(l["ma_kho"]), quantity: Number(l["so_luong"] || 0),
        unitPrice: Number(l["gia_von"] || 0), before: movements[i]?.before ?? null, after: movements[i]?.after ?? null, note: text(l["ghi_chu"])
      }));
      to = lines[0]?.warehouseId ?? "";
    } else if (movements.some((m) => m.kind === MOVEMENT_KINDS.transferOut || m.kind === MOVEMENT_KINDS.transferIn)) {
      kind = "chuyen";
      const out = movements.filter((m) => m.kind === MOVEMENT_KINDS.transferOut);
      from = out[0]?.warehouseId ?? "";
      to = movements.find((m) => m.kind === MOVEMENT_KINDS.transferIn)?.warehouseId ?? "";
      lines = out.map((m) => ({ code: m.code, size: m.size, warehouseId: m.warehouseId, quantity: -m.quantity, unitPrice: 0, before: m.before, after: m.after, note: m.note }));
    } else {
      kind = movementDocumentKind(clean, movements[0]!.kind);
      const warehouse = movements[0]!.warehouseId;
      if (kind === "nhap") to = warehouse; else from = warehouse;
      lines = movements.map((m) => ({
        code: m.code, size: m.size, warehouseId: m.warehouseId, quantity: kind === "xuat" ? -m.quantity : m.quantity,
        unitPrice: 0, before: m.before, after: m.after, note: m.note
      }));
    }
    const names = await this.itemNames(lines.map((l) => l.code));
    const first = movements[0];
    const createdAt = receipt ? isoFromMysql(receipt["tao_luc"]) : first?.at ?? "";
    return {
      ma: clean, loai: kind, trangThai: DOCUMENT_STATES.posted, khoNguon: from, khoDich: to,
      ngayChungTu: createdAt ? localDay(new Date(createdAt)) : "", doiTac: receipt ? text(receipt["nha_cung_cap"]) : "",
      maThamChieu: "", nguoiPhuTrach: "", ghiChu: receipt ? text(receipt["ghi_chu"]) : first?.note ?? "",
      phiVanChuyen: 0, chiPhiKhac: 0, maPhieuGoc: "", maPhieuDao: "",
      boi: receipt ? text(receipt["boi"]) : first?.actor ?? "", taoLuc: createdAt, suaLuc: createdAt, ghiSoLuc: createdAt,
      soDong: lines.length, soLuong: lines.reduce((t, l) => t + l.quantity, 0), tongTien: lines.reduce((t, l) => t + l.quantity * l.unitPrice, 0),
      dinhKem: [],
      dong: lines.map((l, i) => ({
        dong: i + 1, ma: l.code, ten: names.get(l.code.toLowerCase()) ?? "", size: l.size, maKho: l.warehouseId, soLuong: l.quantity,
        donGia: l.unitPrice, thanhTien: l.quantity * l.unitPrice, tonTruoc: l.before, tonSau: l.after, tinhTrang: "dat", ghiChu: l.note
      })),
      nhatKy: [],
      butToan: single ? movements : await this.ledger.movementsWhere({ reference: clean, limit: 2000 }),
      cu: true
    };
  }

  /**
   * The book lines with the item name and the document they belong to (`bien-dong`): a document of
   * this table gives its kind and state; an old reference is read as a posted document of its kind.
   */
  async annotate(movements: Movement[]): Promise<(Movement & { tenMon: string; loaiPhieu: string; trangThaiPhieu: string })[]> {
    const names = await this.itemNames(movements.map((m) => m.code));
    const references = [...new Set(movements.map((m) => m.reference).filter(Boolean))];
    const documents = references.length
      ? await this.store.table(TABLES.documents).find({ where: { ma: references }, columns: ["ma", "loai", "trang_thai"] })
      : [];
    const byCode = new Map(documents.map((d) => [text(d["ma"]), { kind: text(d["loai"]), state: text(d["trang_thai"]) }]));
    return movements.map((m) => {
      const own = byCode.get(m.reference);
      return {
        ...m, tenMon: names.get(m.code.toLowerCase()) ?? "",
        loaiPhieu: own ? own.kind : movementDocumentKind(m.reference, m.kind),
        trangThaiPhieu: own ? own.state : DOCUMENT_STATES.posted
      };
    });
  }

  // ---- inside ------------------------------------------------------------------------------------

  /**
   * POSTS a document inside the caller's transaction (rule 1). Each line goes through the stock
   * book; the first refusal throws `LedgerRefused` with its line number and the caller's transaction
   * rolls EVERYTHING back. Goods in at a price > 0 set the size's cost price.
   */
  private async post(tx: DataStore, header: HeaderRow, lines: DocumentLine[], actor: string): Promise<void> {
    const note = (l: DocumentLine) => (l.note || `Phiếu ${header.ma}`).slice(0, 255);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      const base = { code: line.code, size: line.size, note: note(line), actor, reference: header.ma };
      let shown: AdjustOutcome;
      if (header.loai === "nhap") {
        shown = await this.adjust(tx, i, { ...base, warehouseId: header.kho_dich, quantity: line.quantity, kind: MOVEMENT_KINDS.receipt }, true);
        if (shown.ok && line.unitPrice > 0) await tx.execute(`UPDATE ${TABLES.variants} SET gia_von = ? WHERE ma_bien_the = ?`, [line.unitPrice, shown.variantId]);
      } else if (header.loai === "xuat") {
        shown = await this.adjust(tx, i, { ...base, warehouseId: header.kho_nguon, quantity: -line.quantity, kind: MOVEMENT_KINDS.issue }, false);
      } else if (header.loai === "chuyen") {
        shown = await this.adjust(tx, i, { ...base, warehouseId: header.kho_nguon, quantity: -line.quantity, kind: MOVEMENT_KINDS.transferOut }, false);
        await this.adjust(tx, i, { ...base, warehouseId: header.kho_dich, quantity: line.quantity, kind: MOVEMENT_KINDS.transferIn }, true);
      } else if (line.variantId) {
        // A reversal line: exactly the row the original touched.
        shown = await this.ledger.adjustRowIn(tx as Tx, {
          ...base, variantId: line.variantId, warehouseId: line.warehouseId, quantity: line.quantity, kind: MOVEMENT_KINDS.adjust, respectReservations: line.quantity < 0
        });
        if (!shown.ok) throw new LedgerRefused(shown.reason, i + 1);
      } else {
        const warehouseId = line.warehouseId || header.kho_nguon || header.kho_dich;
        shown = await this.adjust(tx, i, { ...base, warehouseId, quantity: line.quantity, kind: MOVEMENT_KINDS.adjust }, line.quantity > 0);
      }
      if (shown.ok) await tx.table(TABLES.documentLines).update({ ma_phieu: header.ma, dong: i + 1 }, { ton_truoc: shown.before, ton_sau: shown.after });
    }
    const stamp = this.stamp();
    await tx.table(TABLES.documents).update({ ma: header.ma }, { trang_thai: DOCUMENT_STATES.posted, ghi_so_luc: stamp, sua_luc: stamp });
    await this.log(tx, header.ma, DOCUMENT_LOG.post, `Ghi sổ ${lines.length} dòng`, actor);
  }

  /**
   * One book write; a refusal throws (rolls the document back). `incoming` picks the bucket of a new
   * row; pairs going OUT of a declared ready warehouse come from its READY rows only (never a campaign
   * row that happens to hold more), and never from pairs held for a customer.
   */
  private async adjust(tx: DataStore, index: number, input: { code: string; size: string; warehouseId: string; quantity: number; kind: string; note: string; actor: string; reference: string }, incoming: boolean): Promise<AdjustOutcome> {
    // Same bucket rule both ways: out of a ready warehouse the READY row goes first, never a campaign row
    // that merely holds more; into it, the row already there.
    const source = incoming || this.warehouseKind(input.warehouseId) === "ready" ? await this.bucketFor(tx, input.warehouseId, input.code, input.size) : undefined;
    const outcome = await this.ledger.adjustIn(tx as Tx, { ...input, ...(source ? { source } : {}), respectReservations: input.quantity < 0 });
    if (!outcome.ok) throw new LedgerRefused(outcome.reason, index + 1);
    return outcome;
  }

  /**
   * Which bucket pairs coming IN land in: a ready warehouse → ready stock; otherwise the bucket the
   * warehouse already holds this size in; a new size in an order warehouse → partner (`campaign`)
   * stock, as the file import files it. Undeclared warehouse: the book's default.
   */
  private async bucketFor(tx: DataStore, warehouseId: string, code: string, size: string): Promise<Source | undefined> {
    const kind = this.warehouseKind(warehouseId);
    const rows = await tx.rows(`SELECT nguon FROM ${TABLES.variants} WHERE ma_mon = ? AND size = ? AND ma_kho = ? ORDER BY ton DESC`, [code, size, warehouseId]);
    const existing = rows.map((r) => text(r["nguon"])).filter((n): n is Source => (Object.values(SOURCE) as string[]).includes(n));
    // A row that already exists wins (review 18/09/2026: a product created in OMI has `own` rows at stock 0
    // in a ready warehouse; posting into it must not add a SECOND, ready, row per size). In a ready
    // warehouse holding several buckets of one size, the ready row is the one.
    if (kind === "ready" && existing.includes(SOURCE.ready)) return SOURCE.ready;
    if (existing[0]) return existing[0];
    if (kind === "ready") return SOURCE.ready;
    return kind === "order" ? SOURCE.campaign : undefined;
  }

  private async writeLines(tx: DataStore, code: string, lines: DocumentLine[]): Promise<void> {
    if (lines.length === 0) return;
    await tx.table(TABLES.documentLines).insertMany(lines.map((l, i) => ({
      ma_phieu: code, dong: i + 1, ma_mon: l.code, size: l.size, ma_kho: l.warehouseId, so_luong: l.quantity,
      don_gia: l.unitPrice, ton_truoc: null, ton_sau: null, tinh_trang: l.condition, ghi_chu: l.note
    })));
  }

  private async log(tx: DataStore, code: string, job: string, note: string, actor: string): Promise<void> {
    await tx.table(TABLES.documentLog).insert({ ma_phieu: code, viec: job, noi_dung: note.slice(0, 500), boi: actor.slice(0, 190), luc: this.stamp() });
  }

  private async header(tx: DataStore, code: string, lock: boolean): Promise<HeaderRow | null> {
    const rows = await tx.rows(`SELECT * FROM ${TABLES.documents} WHERE ma = ?${lock ? " FOR UPDATE" : ""}`, [text(code)]);
    const r = rows[0];
    if (!r) return null;
    return {
      ma: text(r["ma"]), loai: text(r["loai"]) as DocumentKind, trang_thai: text(r["trang_thai"]), kho_nguon: text(r["kho_nguon"]), kho_dich: text(r["kho_dich"]),
      ngay_chung_tu: text(r["ngay_chung_tu"]), doi_tac: text(r["doi_tac"]), ma_tham_chieu: text(r["ma_tham_chieu"]), nguoi_phu_trach: text(r["nguoi_phu_trach"]),
      ghi_chu: String(r["ghi_chu"] ?? ""), phi_van_chuyen: Number(r["phi_van_chuyen"] || 0), chi_phi_khac: Number(r["chi_phi_khac"] || 0),
      dinh_kem_json: r["dinh_kem_json"] === null || r["dinh_kem_json"] === undefined ? null : String(r["dinh_kem_json"]),
      ma_phieu_goc: text(r["ma_phieu_goc"]), ma_phieu_dao: text(r["ma_phieu_dao"]), boi: text(r["boi"]),
      tao_luc: String(r["tao_luc"] ?? ""), sua_luc: String(r["sua_luc"] ?? ""),
      ghi_so_luc: r["ghi_so_luc"] === null || r["ghi_so_luc"] === undefined ? null : String(r["ghi_so_luc"])
    };
  }

  private async lines(tx: DataStore, code: string): Promise<DocumentLine[]> {
    const rows = await tx.table(TABLES.documentLines).find({ where: { ma_phieu: text(code) }, orderBy: "dong asc" });
    return rows.map((r) => ({
      code: text(r["ma_mon"]), size: text(r["size"]), warehouseId: text(r["ma_kho"]), quantity: Number(r["so_luong"] || 0),
      unitPrice: Number(r["don_gia"] || 0), condition: text(r["tinh_trang"]) || "dat", note: text(r["ghi_chu"])
    }));
  }

  private async itemNames(codes: string[]): Promise<Map<string, string>> {
    const wanted = [...new Set(codes.map(text).filter(Boolean))];
    if (wanted.length === 0) return new Map();
    const rows = await this.store.table(TABLES.items).find({ where: { ma: wanted }, columns: ["ma", "ten"] });
    return new Map(rows.map((r) => [text(r["ma"]).toLowerCase(), text(r["ten"])]));
  }
}

/** The kind of document an old book line stands for (rule 3). */
export function movementDocumentKind(reference: string, movementKind: string): string {
  if (reference.startsWith("PN-")) return "nhap";
  if (reference.startsWith("chuyen_")) return "chuyen";
  if (movementKind === MOVEMENT_KINDS.transferIn || movementKind === MOVEMENT_KINDS.transferOut) return "chuyen";
  if (movementKind === MOVEMENT_KINDS.receipt) return "nhap";
  if (movementKind === MOVEMENT_KINDS.issue) return "xuat";
  if (movementKind === MOVEMENT_KINDS.returned) return MOVEMENT_KINDS.returned;
  return "dieu-chinh";
}

function headerWire(h: HeaderRow, lines: DocumentLine[]): Record<string, unknown> {
  return {
    ma: h.ma, loai: h.loai, trangThai: h.trang_thai, khoNguon: h.kho_nguon, khoDich: h.kho_dich, ngayChungTu: h.ngay_chung_tu,
    doiTac: h.doi_tac, maThamChieu: h.ma_tham_chieu, nguoiPhuTrach: h.nguoi_phu_trach, ghiChu: h.ghi_chu,
    phiVanChuyen: h.phi_van_chuyen, chiPhiKhac: h.chi_phi_khac, maPhieuGoc: h.ma_phieu_goc, maPhieuDao: h.ma_phieu_dao,
    boi: h.boi, taoLuc: isoFromMysql(h.tao_luc), suaLuc: isoFromMysql(h.sua_luc), ghiSoLuc: h.ghi_so_luc ? isoFromMysql(h.ghi_so_luc) : "",
    soDong: lines.length, soLuong: lines.reduce((t, l) => t + l.quantity, 0), tongTien: lines.reduce((t, l) => t + l.quantity * l.unitPrice, 0)
  };
}

function attachmentsOf(raw: string | null): { url: string; ten: string }[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? list.filter((x) => x && typeof x === "object").map((x) => ({ url: text((x as Record<string, unknown>)["url"]), ten: text((x as Record<string, unknown>)["ten"]) })) : [];
  } catch {
    return [];
  }
}

const isDay = (v: unknown): boolean => /^\d{4}-\d{2}-\d{2}$/.test(text(v));
const dayOr = (v: unknown, fallback: string): string => (isDay(v) ? text(v) : fallback);
const nullableNumber = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

function stockRefusal(e: LedgerRefused): DocumentRefusal {
  const reason: LedgerRefusal = e.reason;
  const where = e.line ? `Dòng ${e.line}: ` : "";
  return refuse(400, reason, `${where}${refusalText(reason)} Phiếu chưa được ghi sổ — không dòng nào bị trừ/cộng.`, e.line || undefined);
}
