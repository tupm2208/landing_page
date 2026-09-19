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
  returned: "hoan-hang",
  /** Goods out on a stock document (`xuat`), 18/09/2026. */
  issue: "xuat"
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
  /**
   * The bucket (`nguon`) of the row the line touched — read from the row today, so "" when the row is
   * gone. OMI passes it to `doi-gia` to price exactly that row (18/09/2026).
   */
  source: string;
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
  /**
   * Stock documents (18/09/2026): a take-away may not dig into pairs HELD for a customer. Off for the
   * older doors (a person setting the shelf to what they counted must still be able to).
   */
  respectReservations?: boolean;
}

/** One book line to undo, by the exact row it touched (a document reversal). */
export interface RowAdjustInput {
  variantId: string;
  /** Used only when the row is gone and pairs come BACK: the row is recreated by code / size / warehouse. */
  code: string;
  size: string;
  warehouseId: string;
  quantity: number;
  note?: string | undefined;
  actor: string;
  kind?: string;
  reference?: string;
  respectReservations?: boolean;
}

/** A `LIMIT` from a query string: an integer in [1, max], `fallback` when unreadable. */
export function clampLimit(value: unknown, fallback: number, max: number): number {
  const n = Math.trunc(Number(value));
  return Math.min(Math.max(1, Number.isFinite(n) && n > 0 ? n : fallback), max);
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

/** What a transaction hands the ledger: statements and tables on the transaction's connection. */
export type Tx = Pick<DataStore, "rows" | "execute" | "table">;

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
    return this.movementsWhere({ ...(filter.code ? { code: filter.code } : {}), limit: clampLimit(filter.limit, 200, 2000) });
  }

  /**
   * The book narrowed the way the warehouse screen asks (OMI v1, 18/09/2026): warehouse, kind, who,
   * a window of `luc` (UTC moments, the caller turns local days into them), one code, one reference.
   */
  async movementsWhere(filter: { code?: string; warehouseId?: string; kind?: string; actor?: string; reference?: string; from?: Date | null; to?: Date | null; limit?: number }): Promise<Movement[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => { clauses.push(sql); params.push(value); };
    if (text(filter.code)) add("bd.ma_mon = ?", text(filter.code));
    if (text(filter.warehouseId)) add("bd.ma_kho = ?", text(filter.warehouseId));
    if (text(filter.kind)) add("bd.loai = ?", text(filter.kind));
    if (text(filter.actor)) add("bd.boi = ?", text(filter.actor));
    if (filter.reference !== undefined) add("bd.ma_tham_chieu = ?", text(filter.reference));
    if (filter.from) add("bd.luc >= ?", toMysqlDateTime(filter.from, { ms: true }));
    if (filter.to) add("bd.luc < ?", toMysqlDateTime(filter.to, { ms: true }));
    const limit = clampLimit(filter.limit, 200, 2000);
    const rows = await this.store.rows(
      `SELECT bd.*, bt.nguon AS nguon FROM ${TABLES.movements} bd LEFT JOIN ${TABLES.variants} bt ON bt.ma_bien_the = bd.ma_bien_the
        ${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY bd.ma DESC LIMIT ?`,
      [...params, limit]
    );
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

  /**
   * Every warehouse id the shelf knows, with how many pairs and which buckets. `products` counts
   * distinct item codes with a line there (stock 0 included); `lastChange` is the newest line edit.
   */
  async warehouses(): Promise<{ id: string; pairs: number; sizes: number; sources: string[]; products: number; lastChange: string }[]> {
    const rows = await this.store.rows(
      `SELECT ma_kho, SUM(ton) AS doi, COUNT(*) AS dong, GROUP_CONCAT(DISTINCT nguon) AS nguon, COUNT(DISTINCT ma_mon) AS mon, MAX(sua_luc) AS sua
         FROM ${TABLES.variants} WHERE ma_kho <> '' GROUP BY ma_kho ORDER BY ma_kho`
    );
    return rows.map((r) => ({
      id: text(r["ma_kho"]), pairs: Number(r["doi"] || 0), sizes: Number(r["dong"] || 0), sources: text(r["nguon"]).split(",").filter(Boolean),
      products: Number(r["mon"] || 0), lastChange: isoFromMysql(r["sua"])
    }));
  }

  // ---- inside a transaction ------------------------------------------------------------------

  /**
   * ADJUST inside a transaction the CALLER owns. Public since 18/09/2026: a stock document posts all
   * its lines through here in one transaction and rolls the whole document back on the first refusal
   * (throw `LedgerRefused`). A refusal is returned, never thrown, so the caller decides.
   */
  async adjustIn(tx: Tx, input: AdjustInput): Promise<AdjustOutcome> {
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
    if (id && input.quantity < 0 && input.respectReservations && before - (await this.heldOn(tx, id)) + input.quantity < 0) return refuse("khong_du_ton");

    let storedCode = code;
    if (!id) {
      if (input.quantity < 0) return refuse("khong_du_ton");
      const item = await tx.rows(`SELECT ma, gia_niem_yet FROM ${TABLES.items} WHERE ma = ? LIMIT 1`, [code]);
      if (!item[0]) return refuse("khong_co_mon");
      // The catalogue's own spelling of the code: MySQL matched "kv1" to "KV1", the new row must say "KV1".
      storedCode = text(item[0]["ma"]) || code;
      // The price of a size the warehouse never held: the item's own sizes elsewhere say what it sells for.
      const sibling = await tx.rows(`SELECT gia, gia_niem_yet FROM ${TABLES.variants} WHERE ma_mon = ? AND gia > 0 ORDER BY gia ASC LIMIT 1`, [code]);
      // The variant id folds the bucket in, so a ready row and an order row of one size and warehouse never collide.
      id = variantId({ code: storedCode }, { warehouseId: input.source && input.source !== SOURCE.ready ? warehouseId : `${warehouseId}|ready`, size });
      await tx.table(TABLES.variants).insert({
        ma_bien_the: id, ma_mon: storedCode, size, ma_kho: warehouseId, ton: after,
        gia: Number(sibling[0]?.["gia"] || 0), gia_niem_yet: Number(sibling[0]?.["gia_niem_yet"] || item[0]["gia_niem_yet"] || 0),
        thu_tu_kho: 2147483647, nguon: input.source ?? SOURCE.ready, ma_chien_dich: "", ma_dong_doi_tac: "", sua_luc: at
      });
    } else {
      await tx.execute(`UPDATE ${TABLES.variants} SET ton = ?, sua_luc = ? WHERE ma_bien_the = ?`, [after, at, id]);
    }

    await tx.table(TABLES.movements).insert({
      ma_mon: storedCode, size, ma_kho: warehouseId, ma_bien_the: id, loai: input.kind ?? MOVEMENT_KINDS.adjust,
      so_luong: input.quantity, ton_truoc: before, ton_sau: after,
      ghi_chu: text(input.note).slice(0, 255), ma_tham_chieu: text(input.reference).slice(0, 128), boi: text(input.actor).slice(0, 190), luc: at
    });
    return { ok: true, variantId: id, before, after };
  }

  /**
   * ADJUST EXACTLY ONE ROW, by variant id, inside the caller's transaction — how a document reversal
   * undoes a book line. Reversing by code / size / warehouse picks "the row with most stock", which in
   * a warehouse holding a ready AND a campaign row of one size is the wrong bucket (review 18/09/2026).
   * The row gone (a full push replaced its source) and pairs coming back: recreated like `adjustIn`.
   */
  async adjustRowIn(tx: Tx, input: RowAdjustInput): Promise<AdjustOutcome> {
    const quantity = Math.trunc(Number(input.quantity));
    if (!Number.isFinite(quantity) || quantity === 0) return refuse("so_luong_sai");
    const locked = await tx.rows(`SELECT ma_bien_the, ma_mon, size, ma_kho, ton FROM ${TABLES.variants} WHERE ma_bien_the = ? FOR UPDATE`, [text(input.variantId)]);
    const row = locked[0];
    if (!row) {
      if (quantity < 0) return refuse("khong_du_ton");
      return this.adjustIn(tx, { code: input.code, size: input.size, warehouseId: input.warehouseId, quantity, note: input.note, actor: input.actor, ...(input.kind ? { kind: input.kind } : {}), ...(input.reference ? { reference: input.reference } : {}) });
    }
    const id = text(row["ma_bien_the"]);
    const before = Number(row["ton"] || 0);
    const after = before + quantity;
    if (after < 0) return refuse("khong_du_ton");
    if (quantity < 0 && input.respectReservations && before - (await this.heldOn(tx, id)) + quantity < 0) return refuse("khong_du_ton");
    const at = toMysqlDateTime(this.now(), { ms: true });
    await tx.execute(`UPDATE ${TABLES.variants} SET ton = ?, sua_luc = ? WHERE ma_bien_the = ?`, [after, at, id]);
    await tx.table(TABLES.movements).insert({
      ma_mon: text(row["ma_mon"]), size: text(row["size"]), ma_kho: text(row["ma_kho"]), ma_bien_the: id, loai: input.kind ?? MOVEMENT_KINDS.adjust,
      so_luong: quantity, ton_truoc: before, ton_sau: after,
      ghi_chu: text(input.note).slice(0, 255), ma_tham_chieu: text(input.reference).slice(0, 128), boi: text(input.actor).slice(0, 190), luc: at
    });
    return { ok: true, variantId: id, before, after };
  }

  /**
   * REMOVES one size row from a warehouse (the table's "Xoá size", 18/09/2026). Pairs still on it go
   * out through the book first (one adjust line to 0), so the history says where they went. A row with
   * pairs HELD for a customer is refused — deleting it would strand the order. Returns the row as it
   * was, for "Hoàn tác".
   */
  async removeRow(input: { variantId: string; warehouseId: string; actor: string; note?: string }): Promise<{ ok: true; row: Row } | { ok: false; reason: "khong_thay" | "dang_giu"; message: string }> {
    return this.store.transaction(async (tx) => {
      const locked = await tx.rows(`SELECT * FROM ${TABLES.variants} WHERE ma_bien_the = ? AND ma_kho = ? FOR UPDATE`, [text(input.variantId), text(input.warehouseId)]);
      const row = locked[0];
      if (!row) return { ok: false as const, reason: "khong_thay" as const, message: "Size này không còn trong kho (có thể vừa bị xoá)." };
      const id = text(row["ma_bien_the"]);
      const held = await this.heldOn(tx, id);
      if (held > 0) return { ok: false as const, reason: "dang_giu" as const, message: `Size ${text(row["size"])} đang giữ ${held} đôi cho đơn — xử lý đơn trước rồi mới xoá.` };
      const before = Number(row["ton"] || 0);
      const at = toMysqlDateTime(this.now(), { ms: true });
      if (before !== 0) {
        await tx.table(TABLES.movements).insert({
          ma_mon: text(row["ma_mon"]), size: text(row["size"]), ma_kho: text(row["ma_kho"]), ma_bien_the: id, loai: MOVEMENT_KINDS.adjust,
          so_luong: -before, ton_truoc: before, ton_sau: 0,
          ghi_chu: (text(input.note) || "Xoá size khỏi kho").slice(0, 255), ma_tham_chieu: "", boi: text(input.actor).slice(0, 190), luc: at
        });
      }
      await tx.table(TABLES.variants).delete({ ma_bien_the: id });
      return { ok: true as const, row };
    });
  }

  /** Puts back a row `removeRow` took away: the row with its prices, then its pairs through the book. */
  async restoreRow(input: { row: Row; actor: string; note?: string }): Promise<{ ok: true } | { ok: false; reason: "da_co"; message: string }> {
    return this.store.transaction(async (tx) => {
      const id = text(input.row["ma_bien_the"]);
      const live = await tx.rows(`SELECT ma_bien_the FROM ${TABLES.variants} WHERE ma_bien_the = ? FOR UPDATE`, [id]);
      if (live[0]) return { ok: false as const, reason: "da_co" as const, message: `Size ${text(input.row["size"])} đã có lại trong kho — không khôi phục chồng lên.` };
      const pairs = Number(input.row["ton"] || 0);
      const at = toMysqlDateTime(this.now(), { ms: true });
      await tx.table(TABLES.variants).insert({ ...input.row, ton: pairs, sua_luc: at });
      if (pairs !== 0) {
        await tx.table(TABLES.movements).insert({
          ma_mon: text(input.row["ma_mon"]), size: text(input.row["size"]), ma_kho: text(input.row["ma_kho"]), ma_bien_the: id, loai: MOVEMENT_KINDS.adjust,
          so_luong: pairs, ton_truoc: 0, ton_sau: pairs,
          ghi_chu: (text(input.note) || "Hoàn tác xoá size").slice(0, 255), ma_tham_chieu: "", boi: text(input.actor).slice(0, 190), luc: at
        });
      }
      return { ok: true as const };
    });
  }

  /** Pairs of one row held by unexpired reservations. */
  private async heldOn(tx: Tx, id: string): Promise<number> {
    const rows = await tx.rows(`SELECT COALESCE(SUM(so_luong), 0) AS n FROM ${TABLES.reservations} WHERE ma_bien_the = ? AND het_han_luc > ?`, [id, toMysqlDateTime(this.now(), { ms: true })]);
    return Number(rows[0]?.["n"] || 0);
  }
}

/** Thrown inside a transaction to roll it back on a refusal; carries the reason out. */
export class LedgerRefused extends Error {
  constructor(public readonly reason: LedgerRefusal, public readonly line = 0) { super(reason); }
}

/** The Vietnamese sentence of a refusal, for callers that answer HTTP themselves. */
export function refusalText(reason: LedgerRefusal): string {
  return REFUSAL_TEXT[reason];
}

export function movementOf(r: Row): Movement {
  return {
    id: text(r["ma"]), code: text(r["ma_mon"]), size: text(r["size"]), warehouseId: text(r["ma_kho"]), variantId: text(r["ma_bien_the"]),
    kind: text(r["loai"]), quantity: Number(r["so_luong"] || 0), before: Number(r["ton_truoc"] || 0), after: Number(r["ton_sau"] || 0),
    note: text(r["ghi_chu"]), reference: text(r["ma_tham_chieu"]), actor: text(r["boi"]), at: isoFromMysql(r["luc"]), source: text(r["nguon"])
  };
}
