/**
 * @file Repository over the three Purchasing tables — hides SQL and column names from the rules.
 *
 * Column names stay Vietnamese (on-disk); everything the rules see is typed and English, except
 * the fields that go out on the wire unchanged (`maPhieu`...).
 */

import type { DataStore, Row } from "../../contract";
import { LoginLockout } from "../../shared/login-lockout";
import { fromMysqlDateTime, toMysqlDateTime } from "../../shared/mysql-time";
import { LEDGER_TABLE, LOGIN_FAILURES_TABLE, PACKING_TABLE, PARTNERS_TABLE, PURCHASES_TABLE, SHIPMENT_REQUESTS_TABLE, STOCK_OUTS_TABLE } from "./schema";

/** A purchasing partner as the rules see one. */
export interface Partner {
  id: string;
  name: string;
  portalCode: string;
  /** The name they type to log in. Empty = this partner has no login yet (link-only, as before). */
  login: string;
  /** Fee per pair bought. */
  feePerItem: number;
  /** Fee per order handled. */
  feePerOrder: number;
  /** Which of the two counts: `moi-mon`, `moi-don`, or `ca-hai`. */
  feeMode: string;
}

/** One line of the partner's money ledger: a transfer from the shop, or an agreed extra cost. */
export interface LedgerRow {
  ma: string;
  ma_doi_tac: string;
  loai: string;
  so_tien: number;
  ghi_chu: string;
  boi: string;
  tao_luc: string;
}

/** A ledger line as the portal reads it. */
export interface LedgerEntry {
  ma: string;
  loai: string;
  soTien: number;
  ghiChu: string;
  taoLuc: string;
  /** Who wrote it (`quan-tri`, `omi`…). */
  boi?: string;
  /** Đ4: set when the line was corrected. */
  suaLuc?: string;
  /** Đ4: set when the line was voided — it no longer counts. */
  huyLuc?: string;
  lyDoHuy?: string;
}

/** The shop transferred money to the partner. */
export const LEDGER_PAID = "tra";
/** An extra cost agreed with the partner (a taxi to the warehouse, a parking fee). */
export const LEDGER_EXTRA = "phat_sinh";

/** Packing state of one order for one partner. `trang_thai` is `packed` / `chua_dong`. */
export interface PackingRow {
  ma_don: string;
  ma_doi_tac: string;
  trang_thai: string;
  boi: string;
  sua_luc: string;
}

/** Packing as the portal reads it. */
export interface PackingState {
  maDon: string;
  trangThai: string;
  boi: string;
  suaLuc: string;
}

export const PACKED = "packed";

export interface PurchaseRow {
  ma_phieu: string;
  ma_doi_tac: string;
  ma_don: string;
  ma_dong: string;
  ma_mon: string;
  size: string;
  so_luong: number;
  gia_von: number;
  /** What the system said the pair costs when the slip was written (the page's "Khớp giá / Lệch"). */
  gia_he_thong: number;
  ma_lenh: string;
  ghi_chu: string;
  tao_luc: string;
}

export interface StockOutRow {
  ma_dong: string;
  ma_doi_tac: string;
  ma_don: string;
  ma_mon: string;
  size: string;
  ly_do: string;
  bao_luc: string;
}

export interface PartnerRow {
  ma: string;
  ten: string;
  ma_cong: string;
  trang_thai: string;
  dien_thoai: string;
  tinh: string;
  huyen: string;
  xa: string;
  dia_chi_chi_tiet: string;
  sua_luc: string;
  /**
   * Left out when the shop is not changing the login or the password (`upsert` writes what it is given).
   * NULL, never `""`: the column is unique and MySQL allows many NULLs but only one empty string.
   */
  dang_nhap?: string | null;
  bam_mat_khau?: string;
  bam_cap_luc?: string | null;
  cong_moi_mon?: number;
  cong_moi_don?: number;
  cach_tinh?: string;
  telegram_chat_id?: string;
  email?: string;
}

/** One line reported out of stock, as other modules ask for it (field names as in the old JS). */
export interface StockOutReport {
  maDong: string;
  maMon: string;
  size: string;
  lyDo: string;
}

/** A purchase slip as the SHOP's screen reads it — carries the cost price (rule 4 is about partners). */
export interface PurchaseSlip {
  maPhieu: string;
  maDoiTac: string;
  maDon: string;
  maDong: string;
  maMon: string;
  size: string;
  soLuong: number;
  giaVon: number;
  /** 0 on slips written before 16/09/2026. */
  giaHeThong: number;
  maLenh: string;
  ghiChu: string;
  taoLuc: string;
}

/** The last waybill request of one order: still creating, or failed with a reason. */
export interface ShipmentRequestState {
  maDon: string;
  maDoiTac: string;
  dangTao: boolean;
  loi: string;
  luc: string;
}

const s = (v: unknown): string => String(v ?? "");

/** One partner row as the rules see it. */
function slipOf(r: Row): PurchaseSlip {
  return {
    maPhieu: s(r["ma_phieu"]), maDoiTac: s(r["ma_doi_tac"]), maDon: s(r["ma_don"]), maDong: s(r["ma_dong"]),
    maMon: s(r["ma_mon"]), size: s(r["size"]), soLuong: Number(r["so_luong"] || 0), giaVon: Number(r["gia_von"] || 0),
    giaHeThong: Number(r["gia_he_thong"] || 0), maLenh: s(r["ma_lenh"]),
    ghiChu: s(r["ghi_chu"]), taoLuc: s(r["tao_luc"])
  };
}

function ledgerOf(r: Row): LedgerEntry {
  const at = (v: unknown): string => (v === null || v === undefined || v === "" ? "" : s(v));
  return {
    ma: s(r["ma"]), loai: s(r["loai"]), soTien: Number(r["so_tien"] || 0), ghiChu: s(r["ghi_chu"]), taoLuc: s(r["tao_luc"]),
    boi: s(r["boi"]), suaLuc: at(r["sua_luc"]), huyLuc: at(r["huy_luc"]), lyDoHuy: s(r["ly_do_huy"])
  };
}

function partnerOf(row: Row): Partner {
  return {
    id: s(row["ma"]), name: s(row["ten"]), portalCode: s(row["ma_cong"]), login: s(row["dang_nhap"]),
    feePerItem: Number(row["cong_moi_mon"] || 0),
    feePerOrder: Number(row["cong_moi_don"] || 0),
    feeMode: s(row["cach_tinh"]) || "ca-hai"
  };
}

export class PurchaseRepository {
  constructor(private readonly store: DataStore) {}

  /** The ACTIVE partner behind a portal code — a switched-off partner is `null`, whatever the cookie says. */
  async activePartnerByPortalCode(portalCode: string): Promise<Partner | null> {
    const row = await this.store.table(PARTNERS_TABLE).one({ ma_cong: String(portalCode), trang_thai: "active" });
    return row ? partnerOf(row) : null;
  }

  /**
   * The ACTIVE partner behind a login name, WITH the password hash.
   *
   * The only method that reads the hash, and the login route is its only caller — everything else
   * goes through `activePartnerByPortalCode`, which cannot leak it.
   */
  async activePartnerForLogin(login: string): Promise<(Partner & { passwordHash: string }) | null> {
    const name = String(login ?? "").trim().toLowerCase();
    if (!name) return null;
    // The running site accepted the partner's id as a login too (`partner_yen`), and partners use it.
    const row = await this.store.table(PARTNERS_TABLE).one({ dang_nhap: name, trang_thai: "active" })
      ?? await this.store.table(PARTNERS_TABLE).one({ ma: name, trang_thai: "active" });
    return row ? { ...partnerOf(row), passwordHash: s(row["bam_mat_khau"]) } : null;
  }

  /**
   * Line ids already dealt with — bought or reported out of stock.
   *
   * An EMPTY partner id means "by anybody", which is what the shop's own screen asks: a line one
   * partner already bought is not still waiting just because a second partner never touched it.
   * The portal always passes a real partner id, so a partner still sees only their own work.
   */
  async settledLineIds(partnerId: string): Promise<Set<string>> {
    const where = partnerId === "" ? {} : { where: { ma_doi_tac: partnerId } };
    const bought = await this.store.table(PURCHASES_TABLE).find({ ...where, columns: ["ma_dong"] });
    const out = await this.store.table(STOCK_OUTS_TABLE).find({ ...where, columns: ["ma_dong"] });
    return new Set([...bought, ...out].map((r) => s(r["ma_dong"])));
  }

  /** Lines reported out of stock — by this partner, or by anybody when the id is empty. */
  async stockOutLineIds(partnerId: string): Promise<Set<string>> {
    const rows = await this.store.table(STOCK_OUTS_TABLE).find({ ...(partnerId ? { where: { ma_doi_tac: partnerId } } : {}), columns: ["ma_dong"] });
    return new Set(rows.map((r) => s(r["ma_dong"])));
  }

  /** The purchase slip already written for a partner's command id, if any. */
  async purchaseByCommand(partnerId: string, commandId: string): Promise<{ maPhieu: string } | null> {
    const row = await this.store.table(PURCHASES_TABLE).one({ ma_doi_tac: partnerId, ma_lenh: commandId });
    return row ? { maPhieu: s(row["ma_phieu"]) } : null;
  }

  /** Inserts a purchase slip. Throws the store's duplicate-key error when the command id was written meanwhile. */
  async insertPurchase(row: PurchaseRow): Promise<void> {
    await this.store.table(PURCHASES_TABLE).insert(row as unknown as Row);
  }

  /**
   * Purchase slips for the shop's own screen, newest first.
   *
   * RULE 4 runs the other way here: the cost price IS the shop's, so the shop's screen is exactly
   * where it belongs. It never leaves through a partner door (`partner-session.ts` decides that).
   */
  async recentPurchases(partnerId = "", limit = 200): Promise<PurchaseSlip[]> {
    const rows = await this.store.table(PURCHASES_TABLE).find({
      ...(partnerId ? { where: { ma_doi_tac: partnerId } } : {}),
      orderBy: ["tao_luc desc"],
      limit: Math.min(Math.max(1, Number(limit) || 200), 1000)
    });
    return rows.map(slipOf);
  }

  /**
   * EVERY slip of a partner — what the money box counts. The list on screen is capped; what is owed
   * is not: counting only the newest 50 slips quietly forgave the shop everything older.
   */
  async allPurchases(partnerId: string): Promise<PurchaseSlip[]> {
    const rows = await this.store.table(PURCHASES_TABLE).find({ where: { ma_doi_tac: String(partnerId) }, orderBy: ["tao_luc desc"] });
    return rows.map(slipOf);
  }

  /** The slips of one purchase session (one tap: `<lệnh>` and `<lệnh>#n`), optionally only one order's. */
  async sessionSlips(partnerId: string, sessionId: string, orderId = ""): Promise<PurchaseSlip[]> {
    const params: unknown[] = [String(partnerId), String(sessionId), String(sessionId), `${escapeLike(String(sessionId))}#%`];
    if (orderId) params.push(String(orderId));
    const rows = await this.store.rows(
      `SELECT * FROM \`${PURCHASES_TABLE}\` WHERE ma_doi_tac = ? AND (ma_phieu = ? OR ma_lenh = ? OR ma_lenh LIKE ?)` +
      (orderId ? " AND ma_don = ?" : ""),
      params
    );
    return rows.map(slipOf);
  }

  /** Every line a partner reported out of stock, newest first — the shop must re-source these. */
  async recentStockOuts(partnerId = "", limit = 200): Promise<(StockOutReport & { maDoiTac: string; maDon: string; baoLuc: string })[]> {
    const rows = await this.store.table(STOCK_OUTS_TABLE).find({
      ...(partnerId ? { where: { ma_doi_tac: partnerId } } : {}),
      orderBy: ["bao_luc desc"],
      limit: Math.min(Math.max(1, Number(limit) || 200), 1000)
    });
    return rows.map((r) => ({
      maDong: s(r["ma_dong"]), maDoiTac: s(r["ma_doi_tac"]), maDon: s(r["ma_don"]),
      maMon: s(r["ma_mon"]), size: s(r["size"]), lyDo: s(r["ly_do"]), baoLuc: s(r["bao_luc"])
    }));
  }

  /** Writes or overwrites the out-of-stock report of a line (keyed by LINE ID). */
  async upsertStockOut(row: StockOutRow): Promise<void> {
    await this.store.table(STOCK_OUTS_TABLE).upsert(row as unknown as Row);
  }

  /** Lines of an order reported out of stock. */
  async stockOutsForOrder(orderId: string): Promise<StockOutReport[]> {
    const rows = await this.store.table(STOCK_OUTS_TABLE).find({ where: { ma_don: String(orderId || "") } });
    return rows.map((r) => ({ maDong: s(r["ma_dong"]), maMon: s(r["ma_mon"]), size: s(r["size"]), lyDo: s(r["ly_do"]) }));
  }

  /**
   * How many pairs of each LINE this partner has already reported bought.
   *
   * Keyed by line id, like everything else here (the trap of 10/09). An empty partner id counts
   * the work of everybody, which is what the shop's own screen asks for.
   */
  async purchasedByLine(partnerId: string): Promise<Map<string, number>> {
    const rows = await this.store.table(PURCHASES_TABLE).find({
      ...(partnerId ? { where: { ma_doi_tac: partnerId } } : {}),
      columns: ["ma_dong", "so_luong"]
    });
    const out = new Map<string, number>();
    for (const r of rows) {
      const line = s(r["ma_dong"]);
      out.set(line, (out.get(line) ?? 0) + Number(r["so_luong"] || 0));
    }
    return out;
  }

  /**
   * Giá vốn THẬT của từng dòng đơn: bình quân theo số đôi, từ chính các phiếu mua.
   *
   * Bình quân chứ không phải phiếu cuối: một dòng ba đôi có thể mua hai lần ở hai giá, và giá vốn
   * của dòng đó là số tiền đã chi chia cho số đôi — không phải giá của lần mua gần nhất.
   */
  async costByLine(partnerId = ""): Promise<Map<string, number>> {
    const rows = await this.store.table(PURCHASES_TABLE).find({
      ...(partnerId ? { where: { ma_doi_tac: partnerId } } : {}),
      columns: ["ma_dong", "so_luong", "gia_von"]
    });
    const sum = new Map<string, { tien: number; doi: number }>();
    for (const r of rows) {
      const line = s(r["ma_dong"]);
      const doi = Math.max(0, Number(r["so_luong"] || 0));
      if (line === "" || doi <= 0) continue;
      const at = sum.get(line) ?? { tien: 0, doi: 0 };
      at.tien += Number(r["gia_von"] || 0) * doi;
      at.doi += doi;
      sum.set(line, at);
    }
    const out = new Map<string, number>();
    for (const [line, { tien, doi }] of sum) if (doi > 0 && tien > 0) out.set(line, Math.round(tien / doi));
    return out;
  }

  /** One purchase slip of THIS partner — undo reads it before giving the line back. */
  async purchaseOfPartner(partnerId: string, slipId: string): Promise<PurchaseSlip | null> {
    const r = await this.store.table(PURCHASES_TABLE).one({ ma_doi_tac: String(partnerId), ma_phieu: String(slipId) });
    return r ? slipOf(r) : null;
  }

  /**
   * Removes a purchase slip: the line goes back to "still to buy".
   *
   * Scoped to the partner, so one partner can never undo another's work. Returns how many rows
   * went — 0 means "already undone, or never theirs", which the caller answers politely.
   */
  deletePurchase(partnerId: string, slipId: string): Promise<number> {
    return this.store.table(PURCHASES_TABLE).delete({ ma_doi_tac: String(partnerId), ma_phieu: String(slipId) });
  }

  /** Clears an out-of-stock report (the partner found the pair after all). */
  deleteStockOut(partnerId: string, lineId: string): Promise<number> {
    return this.store.table(STOCK_OUTS_TABLE).delete({ ma_doi_tac: String(partnerId), ma_dong: String(lineId) });
  }

  /** Packing state of every order this partner has touched, keyed by order id. */
  async packingFor(partnerId: string): Promise<Map<string, PackingState>> {
    const rows = await this.store.table(PACKING_TABLE).find({ where: { ma_doi_tac: String(partnerId) } });
    return new Map(rows.map((r) => [s(r["ma_don"]), {
      maDon: s(r["ma_don"]), trangThai: s(r["trang_thai"]), boi: s(r["boi"]), suaLuc: s(r["sua_luc"])
    }]));
  }

  /** Writes the packing state of ONE order for ONE partner (a row each, so two partners never collide). */
  async setPacking(row: PackingRow): Promise<void> {
    await this.store.table(PACKING_TABLE).upsert(row as unknown as Row);
  }

  /** The partner's money ledger, newest first: what the shop transferred and what was agreed on top. */
  async ledgerFor(partnerId: string, limit = 50, { withVoided = false } = {}): Promise<LedgerEntry[]> {
    const rows = await this.store.table(LEDGER_TABLE).find({
      where: { ma_doi_tac: String(partnerId) },
      orderBy: ["tao_luc desc"],
      limit: Math.min(Math.max(1, Number(limit) || 50), 2000)
    });
    // A VOIDED line is history, not money: every sum and the partner's own page skip it.
    return rows.map(ledgerOf).filter((l) => withVoided || !l.huyLuc);
  }

  /** One ledger line by id (voided or not). */
  async ledgerLine(id: string): Promise<(LedgerEntry & { maDoiTac: string }) | null> {
    const r = await this.store.table(LEDGER_TABLE).one({ ma: String(id || "") });
    return r ? { ...ledgerOf(r), maDoiTac: s(r["ma_doi_tac"]) } : null;
  }

  /** Corrects amount + note of a line that is not voided. Returns rows changed. */
  correctLedger(id: string, change: { soTien: number; ghiChu: string; boi: string; at: string }): Promise<number> {
    return this.store.table(LEDGER_TABLE).update({ ma: String(id), huy_luc: null }, {
      so_tien: change.soTien, ghi_chu: change.ghiChu.slice(0, 255), sua_luc: change.at, sua_boi: change.boi.slice(0, 190)
    });
  }

  /** Voids a line: kept for history, never counted again. Returns rows changed (0 = already voided). */
  voidLedger(id: string, change: { lyDo: string; boi: string; at: string }): Promise<number> {
    return this.store.table(LEDGER_TABLE).update({ ma: String(id), huy_luc: null }, {
      huy_luc: change.at, ly_do_huy: change.lyDo.slice(0, 255), sua_boi: change.boi.slice(0, 190)
    });
  }

  /** Moves a slip to another order line (and optionally another partner / a smaller quantity). */
  moveSlip(slipId: string, change: { maDon: string; maDong: string; maDoiTac?: string; soLuong?: number }): Promise<number> {
    return this.store.table(PURCHASES_TABLE).update({ ma_phieu: String(slipId) }, {
      ma_don: change.maDon, ma_dong: change.maDong,
      ...(change.maDoiTac ? { ma_doi_tac: change.maDoiTac } : {}),
      ...(change.soLuong !== undefined ? { so_luong: change.soLuong } : {})
    });
  }

  /** Slips of one order (any partner), oldest first. */
  async slipsOfOrder(orderId: string): Promise<PurchaseSlip[]> {
    const rows = await this.store.table(PURCHASES_TABLE).find({ where: { ma_don: String(orderId) }, orderBy: ["tao_luc asc"] });
    return rows.map(slipOf);
  }

  /** A slip by id, whoever wrote it. */
  async slipById(slipId: string): Promise<PurchaseSlip | null> {
    const r = await this.store.table(PURCHASES_TABLE).one({ ma_phieu: String(slipId || "") });
    return r ? slipOf(r) : null;
  }

  /** Writes one ledger line (the shop paid, or an extra cost was agreed). */
  async insertLedger(row: LedgerRow): Promise<void> {
    await this.store.table(LEDGER_TABLE).insert(row as unknown as Row);
  }

  /**
   * Every partner, by name — the admin screen's list.
   *
   * The columns are LISTED, never `*`: `bam_mat_khau` lives in this table and a `SELECT *` here
   * would put every partner's password hash into an HTTP reply.
   */
  listPartners(): Promise<Row[]> {
    return this.store.table(PARTNERS_TABLE).find({
      orderBy: "ten asc",
      columns: [
        "ma", "ten", "ma_cong", "dang_nhap", "trang_thai", "dien_thoai", "tinh", "huyen", "xa", "dia_chi_chi_tiet",
        "cong_moi_mon", "cong_moi_don", "cach_tinh", "telegram_chat_id", "email", "sua_luc"
      ]
    });
  }

  /** Creates or replaces a partner. */
  async upsertPartner(row: PartnerRow): Promise<void> {
    await this.store.table(PARTNERS_TABLE).upsert(row as unknown as Row);
  }

  /** A partner by id, active or not, without the password hash. */
  async partnerById(id: string): Promise<(Partner & { hasPassword: boolean; active: boolean; telegramChatId: string }) | null> {
    const row = await this.store.table(PARTNERS_TABLE).one({ ma: String(id || "") });
    return row ? {
      ...partnerOf(row), hasPassword: s(row["bam_mat_khau"]) !== "", active: s(row["trang_thai"]) === "active",
      telegramChatId: s(row["telegram_chat_id"])
    } : null;
  }

  /** The last waybill request per order of this partner. */
  async shipmentRequestsFor(partnerId: string): Promise<Map<string, ShipmentRequestState>> {
    const rows = await this.store.table(SHIPMENT_REQUESTS_TABLE).find({ where: { ma_doi_tac: String(partnerId) } });
    return new Map(rows.map((r) => [s(r["ma_don"]), {
      maDon: s(r["ma_don"]), maDoiTac: s(r["ma_doi_tac"]), dangTao: Number(r["dang_tao"] || 0) === 1,
      loi: s(r["loi"]), luc: fromMysqlDateTime(r["luc"])?.toISOString() ?? ""
    }]));
  }

  /** Records a waybill request starting (`dangTao`) or failing (`loi`). One row per order: the last word wins. */
  async setShipmentRequest(state: { maDon: string; maDoiTac: string; dangTao: boolean; loi: string; at: Date }): Promise<void> {
    await this.store.table(SHIPMENT_REQUESTS_TABLE).upsert({
      ma_don: state.maDon, ma_doi_tac: state.maDoiTac, dang_tao: state.dangTao ? 1 : 0,
      loi: state.loi.slice(0, 500), luc: toMysqlDateTime(state.at, { ms: true })
    });
  }

  /** The request row goes once the order has its waybill: nothing is left to report. */
  async clearShipmentRequest(orderId: string): Promise<void> {
    await this.store.table(SHIPMENT_REQUESTS_TABLE).delete({ ma_don: String(orderId) });
  }

  /** Wrong-password counting for the portal login (`shared/login-lockout.ts`). */
  loginLockout(): LoginLockout {
    return new LoginLockout(this.store, LOGIN_FAILURES_TABLE);
  }
}

/** Escapes `\\`, `%` and `_` for a LIKE pattern. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** The store reports a unique-key collision with this text (mysql2's `ER_DUP_ENTRY` message). */
export function isDuplicateKeyError(e: unknown): boolean {
  return /duplicate entry/i.test(e instanceof Error ? e.message : String(e ?? ""));
}
