/**
 * @file Repository over the three Purchasing tables — hides SQL and column names from the rules.
 *
 * Column names stay Vietnamese (on-disk); everything the rules see is typed and English, except
 * the fields that go out on the wire unchanged (`maPhieu`...).
 */

import type { DataStore, Row } from "../../contract";
import { PARTNERS_TABLE, PURCHASES_TABLE, STOCK_OUTS_TABLE } from "./schema";

/** A purchasing partner as the rules see one. */
export interface Partner {
  id: string;
  name: string;
  portalCode: string;
}

export interface PurchaseRow {
  ma_phieu: string;
  ma_doi_tac: string;
  ma_don: string;
  ma_dong: string;
  ma_mon: string;
  size: string;
  so_luong: number;
  gia_von: number;
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
  ghiChu: string;
  taoLuc: string;
}

const s = (v: unknown): string => String(v ?? "");

export class PurchaseRepository {
  constructor(private readonly store: DataStore) {}

  /** The ACTIVE partner behind a portal code — a switched-off partner is `null`, whatever the cookie says. */
  async activePartnerByPortalCode(portalCode: string): Promise<Partner | null> {
    const row = await this.store.table(PARTNERS_TABLE).one({ ma_cong: String(portalCode), trang_thai: "active" });
    return row ? { id: s(row["ma"]), name: s(row["ten"]), portalCode: s(row["ma_cong"]) } : null;
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
    return rows.map((r) => ({
      maPhieu: s(r["ma_phieu"]), maDoiTac: s(r["ma_doi_tac"]), maDon: s(r["ma_don"]), maDong: s(r["ma_dong"]),
      maMon: s(r["ma_mon"]), size: s(r["size"]), soLuong: Number(r["so_luong"] || 0), giaVon: Number(r["gia_von"] || 0),
      ghiChu: s(r["ghi_chu"]), taoLuc: s(r["tao_luc"])
    }));
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

  /** Every partner, by name — the admin screen's list (rows go out as they are). */
  listPartners(): Promise<Row[]> {
    return this.store.table(PARTNERS_TABLE).find({ orderBy: "ten asc" });
  }

  /** Creates or replaces a partner. */
  async upsertPartner(row: PartnerRow): Promise<void> {
    await this.store.table(PARTNERS_TABLE).upsert(row as unknown as Row);
  }
}

/** The store reports a unique-key collision with this text (mysql2's `ER_DUP_ENTRY` message). */
export function isDuplicateKeyError(e: unknown): boolean {
  return /duplicate entry/i.test(e instanceof Error ? e.message : String(e ?? ""));
}
