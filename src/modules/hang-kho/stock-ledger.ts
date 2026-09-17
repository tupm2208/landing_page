/**
 * @file THE STOCK BOOK — every change of `ton` done by a person, written down.
 *
 * Sales Desk's warehouse page (`warehouse.html`) kept its own 5 MB JSON store with TWO buckets per
 * product (`readyStock`, `orderStock`) and a movement log. Its adjustments and transfers moved the
 * PRODUCT totals only, never the sizes, so the two drifted apart. None of that is copied.
 *
 * Here stock already lives in ONE place: `hang_kho_bien_the`, a row per item + size + warehouse.
 * This file adds what the page needs on top of it, all on those rows:
 *   - ADJUST: add or take N pairs of one size in one warehouse (the row is created if missing);
 *   - TRANSFER: move N pairs of one size from one warehouse to another, in ONE transaction;
 *   - RECEIPT: a goods-in slip (supplier, cost per line) that adds every line at once;
 *   - THE BOOK: each of those writes a movement row — kind, signed quantity, before, after, who, why.
 *
 * TWO RULES:
 * 1. Stock never goes below zero, and a refusal says why. A transfer of more than the source holds
 *    is refused whole; it never moves "what there was".
 * 2. Every write is one transaction with its movement row. A book that can disagree with the shelf
 *    is worse than no book.
 *
 * Note: Image Tool's full catalogue push (`POST /api/products`) REPLACES house (`own`) stock. The
 * book keeps what was adjusted, but the shelf follows the push — adjust ready stock (`ready`)
 * warehouses here, or push corrected numbers from Image Tool.
 */

import type { DataStore, Row } from "../../contract";
import { isoFromMysql, toMysqlDateTime } from "../../shared/mysql-time";
import { variantId } from "./normalise";
import { SOURCE, type Source } from "./catalog-repository";
import { TABLES } from "./schema";

export const MOVEMENT_KINDS = {
  adjust: "dieu-chinh",
  receipt: "nhap",
  transferOut: "chuyen-di",
  transferIn: "chuyen-den",
  returned: "hoan-hang"
} as const;

export interface Movement {
  id: string;
  code: string;
  size: string;
  warehouseId: string;
  variantId: string;
  kind: string;
  quantity: number;
  before: number;
  after: number;
  note: string;
  reference: string;
  actor: string;
  at: string;
}

export type LedgerRefusal = "thieu_thong_tin" | "khong_co_mon" | "khong_du_ton" | "cung_kho" | "so_luong_sai";
export type AdjustOutcome = { ok: true; variantId: string; before: number; after: number } | { ok: false; reason: LedgerRefusal; message: string };

export interface AdjustInput {
  code: string;
  size: string;
  warehouseId: string;
  /** Signed: +3 adds, -2 takes away. */
  quantity: number;
  note?: string | undefined;
  actor: string;
  /**
   * THE BUCKET: `ready` (kho sẵn) or `own` / `campaign` (kho order). Given, it picks the row of THAT
   * source in the warehouse and creates one of that source if missing — one warehouse may hold both
   * buckets of the same size, and adjusting one must never touch the other (16/09/2026: an "order"
   * adjustment created a ready row, then order→ready saw the same warehouse twice). Not given: any
   * row of the warehouse, and a new row is ready stock.
   */
  source?: Source;
  kind?: string;
  reference?: string;
}

export interface ReceiptLine {
  code: string;
  size: string;
  warehouseId: string;
  quantity: number;
  cost: number;
  note?: string | undefined;
}

const text = (v: unknown): string => String(v ?? "").trim();
const REFUSAL_TEXT: Record<LedgerRefusal, string> = {
  thieu_thong_tin: "Thiếu mã hàng, size hoặc kho.",
  khong_co_mon: "Mã hàng này chưa có trong danh mục — thêm món trước.",
  khong_du_ton: "Kho không đủ tồn để trừ / chuyển số lượng này.",
  cung_kho: "Kho đi và kho đến phải khác nhau.",
  so_luong_sai: "Số lượng phải là số nguyên khác 0."
};

const refuse = (reason: LedgerRefusal): { ok: false; reason: LedgerRefusal; message: string } => ({ ok: false, reason, message: REFUSAL_TEXT[reason] });

type Tx = Pick<DataStore, "rows" | "execute" | "table">;

export class StockLedger {
  constructor(private readonly store: DataStore, private readonly now: () => Date) {}

  /** ADJUST one size in one warehouse. Creates the row when the warehouse never held this size. */
  async adjust(input: AdjustInput): Promise<AdjustOutcome> {
    const quantity = Math.trunc(Number(input.quantity));
    if (!Number.isFinite(quantity) || quantity === 0) return refuse("so_luong_sai");
    return this.store.transaction((tx) => this.adjustIn(tx, { ...input, quantity }));
  }

  /** MOVE pairs between two warehouses — both rows and both book lines, or nothing. */
  async transfer(input: { code: string; size: string; from: string; to: string; fromSource?: Source; toSource?: Source; quantity: number; note?: string; actor: string }): Promise<{ ok: true; from: AdjustOutcome; to: AdjustOutcome } | { ok: false; reason: LedgerRefusal; message: string }> {
    const quantity = Math.trunc(Number(input.quantity));
    if (!Number.isFinite(quantity) || quantity <= 0) return refuse("so_luong_sai");
    const from = text(input.from), to = text(input.to);
    if (!from || !to) return refuse("thieu_thong_tin");
    if (from === to && (input.fromSource ?? "") === (input.toSource ?? "")) return refuse("cung_kho");
    const reference = `chuyen_${this.now().getTime()}`;
    try {
      return await this.store.transaction(async (tx) => {
        const out = await this.adjustIn(tx, { code: input.code, size: input.size, warehouseId: from, quantity: -quantity, note: input.note, actor: input.actor, kind: MOVEMENT_KINDS.transferOut, reference, ...(input.fromSource ? { source: input.fromSource } : {}) });
        if (!out.ok) throw new LedgerRefused(out.reason);
        const inn = await this.adjustIn(tx, { code: input.code, size: input.size, warehouseId: to, quantity, note: input.note, actor: input.actor, kind: MOVEMENT_KINDS.transferIn, reference, ...(input.toSource ? { source: input.toSource } : {}) });
        if (!inn.ok) throw new LedgerRefused(inn.reason);
        return { ok: true as const, from: out, to: inn };
      });
    } catch (e) {
      if (e instanceof LedgerRefused) return refuse(e.reason);
      throw e;
    }
  }

  /** A GOODS-IN SLIP: header, lines, and every line added to the shelf — one transaction. */
  async receipt(input: { supplier: string; note: string; lines: (ReceiptLine & { source?: Source })[]; actor: string }): Promise<{ ok: true; id: string; totalQuantity: number; totalCost: number } | { ok: false; reason: LedgerRefusal; message: string; line?: number }> {
    const lines = input.lines.filter((l) => text(l.code) && Math.trunc(Number(l.quantity)) > 0);
    if (lines.length === 0) return refuse("thieu_thong_tin");
    const at = this.now();
    const id = `PN-${toMysqlDateTime(at).slice(0, 10).replace(/-/g, "")}-${at.getTime().toString(36).toUpperCase()}`;
    let failedAt = -1;
    try {
      return await this.store.transaction(async (tx) => {
        let totalQuantity = 0, totalCost = 0;
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i]!;
          const quantity = Math.trunc(Number(line.quantity));
          failedAt = i;
          const done = await this.adjustIn(tx, { code: line.code, size: line.size, warehouseId: line.warehouseId, quantity, note: line.note, actor: input.actor, kind: MOVEMENT_KINDS.receipt, reference: id, source: line.source ?? SOURCE.ready });
          if (!done.ok) throw new LedgerRefused(done.reason);
          const cost = Math.max(0, Number(line.cost) || 0);
          await tx.table(TABLES.receiptLines).insert({
            ma_phieu: id, dong: i + 1, ma_mon: text(line.code), size: text(line.size), ma_kho: text(line.warehouseId),
            so_luong: quantity, gia_von: cost, ghi_chu: text(line.note).slice(0, 255)
          });
          totalQuantity += quantity;
          totalCost += quantity * cost;
        }
        await tx.table(TABLES.receipts).insert({
          ma: id, nha_cung_cap: text(input.supplier).slice(0, 190), ghi_chu: text(input.note).slice(0, 500),
          tong_so_luong: totalQuantity, tong_tien: totalCost, boi: input.actor.slice(0, 190), tao_luc: toMysqlDateTime(at, { ms: true })
        });
        return { ok: true as const, id, totalQuantity, totalCost };
      });
    } catch (e) {
      if (e instanceof LedgerRefused) return { ...refuse(e.reason), line: failedAt + 1 };
      throw e;
    }
  }

  /** The book, newest first — all of it, or one item's. */
  async movements(filter: { code?: string; limit?: number } = {}): Promise<Movement[]> {
    const rows = await this.store.table(TABLES.movements).find({
      ...(filter.code ? { where: { ma_mon: text(filter.code) } } : {}),
      orderBy: "ma desc", limit: Math.min(Math.max(1, Number(filter.limit) || 200), 2000)
    });
    return rows.map(movementOf);
  }

  /** Goods-in slips, newest first, each with its lines. */
  async receipts(limit = 50): Promise<Record<string, unknown>[]> {
    const heads = await this.store.table(TABLES.receipts).find({ orderBy: "tao_luc desc", limit: Math.min(Math.max(1, limit), 500) });
    return Promise.all(heads.map(async (h) => ({
      id: text(h["ma"]), supplier: text(h["nha_cung_cap"]), note: text(h["ghi_chu"]),
      totalQuantity: Number(h["tong_so_luong"] || 0), totalCost: Number(h["tong_tien"] || 0),
      actor: text(h["boi"]), createdAt: isoFromMysql(h["tao_luc"]),
      lines: (await this.store.table(TABLES.receiptLines).find({ where: { ma_phieu: text(h["ma"]) }, orderBy: "dong asc" })).map((l) => ({
        code: text(l["ma_mon"]), size: text(l["size"]), warehouseId: text(l["ma_kho"]),
        quantity: Number(l["so_luong"] || 0), cost: Number(l["gia_von"] || 0), note: text(l["ghi_chu"])
      }))
    })));
  }

  /** Every warehouse id the shelf knows, with how many pairs and which buckets. */
  async warehouses(): Promise<{ id: string; pairs: number; sizes: number; sources: string[] }[]> {
    const rows = await this.store.rows(
      `SELECT ma_kho, SUM(ton) AS doi, COUNT(*) AS dong, GROUP_CONCAT(DISTINCT nguon) AS nguon FROM ${TABLES.variants} WHERE ma_kho <> '' GROUP BY ma_kho ORDER BY ma_kho`
    );
    return rows.map((r) => ({ id: text(r["ma_kho"]), pairs: Number(r["doi"] || 0), sizes: Number(r["dong"] || 0), sources: text(r["nguon"]).split(",").filter(Boolean) }));
  }

  // ---- inside a transaction ------------------------------------------------------------------

  private async adjustIn(tx: Tx, input: AdjustInput): Promise<AdjustOutcome> {
    const code = text(input.code), size = text(input.size);
    const warehouseId = text(input.warehouseId);
    if (!code || !size || !warehouseId) return refuse("thieu_thong_tin");
    const at = toMysqlDateTime(this.now(), { ms: true });

    const locked = await tx.rows(
      `SELECT ma_bien_the, ton FROM ${TABLES.variants} WHERE ma_mon = ? AND size = ? AND ma_kho = ?${input.source ? " AND nguon = ?" : ""} ORDER BY ton DESC LIMIT 1 FOR UPDATE`,
      input.source ? [code, size, warehouseId, input.source] : [code, size, warehouseId]
    );
    let id = text(locked[0]?.["ma_bien_the"]);
    const before = Number(locked[0]?.["ton"] || 0);
    const after = before + input.quantity;
    if (after < 0) return refuse("khong_du_ton");

    if (!id) {
      if (input.quantity < 0) return refuse("khong_du_ton");
      const item = await tx.rows(`SELECT ma, gia_niem_yet FROM ${TABLES.items} WHERE ma = ? LIMIT 1`, [code]);
      if (!item[0]) return refuse("khong_co_mon");
      // The price of a size the warehouse never held: the item's own sizes elsewhere say what it sells for.
      const sibling = await tx.rows(`SELECT gia, gia_niem_yet FROM ${TABLES.variants} WHERE ma_mon = ? AND gia > 0 ORDER BY gia ASC LIMIT 1`, [code]);
      // The variant id folds the bucket in, so a ready row and an order row of one size and warehouse never collide.
      id = variantId({ code }, { warehouseId: input.source && input.source !== SOURCE.ready ? warehouseId : `${warehouseId}|ready`, size });
      await tx.table(TABLES.variants).insert({
        ma_bien_the: id, ma_mon: code, size, ma_kho: warehouseId, ton: after,
        gia: Number(sibling[0]?.["gia"] || 0), gia_niem_yet: Number(sibling[0]?.["gia_niem_yet"] || item[0]["gia_niem_yet"] || 0),
        thu_tu_kho: 2147483647, nguon: input.source ?? SOURCE.ready, ma_chien_dich: "", ma_dong_doi_tac: "", sua_luc: at
      });
    } else {
      await tx.execute(`UPDATE ${TABLES.variants} SET ton = ?, sua_luc = ? WHERE ma_bien_the = ?`, [after, at, id]);
    }

    await tx.table(TABLES.movements).insert({
      ma_mon: code, size, ma_kho: warehouseId, ma_bien_the: id, loai: input.kind ?? MOVEMENT_KINDS.adjust,
      so_luong: input.quantity, ton_truoc: before, ton_sau: after,
      ghi_chu: text(input.note).slice(0, 255), ma_tham_chieu: text(input.reference).slice(0, 128), boi: text(input.actor).slice(0, 190), luc: at
    });
    return { ok: true, variantId: id, before, after };
  }
}

class LedgerRefused extends Error {
  constructor(public readonly reason: LedgerRefusal) { super(reason); }
}

function movementOf(r: Row): Movement {
  return {
    id: text(r["ma"]), code: text(r["ma_mon"]), size: text(r["size"]), warehouseId: text(r["ma_kho"]), variantId: text(r["ma_bien_the"]),
    kind: text(r["loai"]), quantity: Number(r["so_luong"] || 0), before: Number(r["ton_truoc"] || 0), after: Number(r["ton_sau"] || 0),
    note: text(r["ghi_chu"]), reference: text(r["ma_tham_chieu"]), actor: text(r["boi"]), at: isoFromMysql(r["luc"])
  };
}
