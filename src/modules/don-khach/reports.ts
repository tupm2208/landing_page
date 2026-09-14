/**
 * @file The overview report — the shop owner opens OMI and sees how much sold today.
 *
 * Three rules of this file:
 *
 * 1. MONEY GOES THROUGH THE ORDER-MONEY KIT. The report must not add up `payment_amount` and call
 *    it "collected": an order marked `paid` without an amount has paid the FULL total (the kit's
 *    rule). So money is computed by reading each order and passing it through the kit — NOT with
 *    MySQL's SUM(). Slower, but never differs from the number the customer sees on the lookup page.
 *
 * 2. THERE IS A DATE WINDOW, and a cap. A shop running three years has tens of thousands of
 *    orders; the report must not be a statement that scans the whole table.
 *
 * 3. CANCELLED ORDERS DO NOT COUNT AS REVENUE. They are counted separately so the cancel rate is visible.
 *
 * Pure: it receives a reader function, so the tests feed rows by hand. What is protected here is
 * the WAY OF COUNTING, not the SQL.
 */

import { paidAmountForOrder, remainingAmountForOrder } from "../../shared/order-money";
import { isoFromMysql, toMysqlDateTime } from "../../shared/mysql-time";

/** Days in the window when the caller does not say (or says garbage). */
export const DEFAULT_DAYS = 14;
/** The longest window a caller may ask for. */
export const MAX_DAYS = 365;
/** At most this many orders enter one report; `chamTran` tells the reader the cap was hit. */
export const ORDER_CAP = 20000;

const CANCELLED = new Set(["cancelled", "canceled"]);

/** One line of an order as the report query returns it (column names, not the client shape). */
export interface ReportLineRow {
  product_code?: unknown;
  product_name?: unknown;
  quantity?: unknown;
  price?: unknown;
}

/** One order as the report query returns it. */
export interface ReportOrderRow {
  id?: unknown;
  total?: unknown;
  status?: unknown;
  payment_status?: unknown;
  payment_amount?: unknown;
  created_at?: unknown;
  mon?: ReportLineRow[];
}

/** Reads the orders placed at or after `since` (a MySQL DATETIME string, UTC). */
export type ReportReader = (since: string) => Promise<ReportOrderRow[]>;

/** Inputs of the overview: the reader, "now", the window and the seller's time zone. */
export interface OverviewOptions {
  readOrders: ReportReader;
  now: Date;
  /** Days in the window; garbage falls back to the default, too many is clamped. */
  days?: number | string | undefined;
  /** Minutes east of UTC of the seller's local day. Default +07:00 (Vietnam). */
  timezoneOffsetMinutes?: number | undefined;
}

/** The report as OMI reads it. Field names are wire format. */
export interface Overview {
  ok: true;
  soNgay: number;
  tuNgay: string;
  denNgay: string;
  chamTran: boolean;
  tong: { soDon: number; giaTri: number; daThu: number; conPhaiThu: number; soDonHuy: number; giaTriHuy: number };
  theoTrangThai: { trangThai: string; soDon: number; giaTri: number }[];
  theoNgay: { ngay: string; soDon: number; giaTri: number; daThu: number }[];
  banChay: { ma: string; ten: string; soLuong: number; giaTri: number }[];
}

/** The calendar date in the seller's local time (default +07:00 — Vietnam). */
export function localDate(iso: string, offsetMinutes: number): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  return new Date(t.getTime() + offsetMinutes * 60 * 1000).toISOString().slice(0, 10);
}

/** Computes the overview for the last `days` days. */
export async function overview({ readOrders, now, days = DEFAULT_DAYS, timezoneOffsetMinutes = 7 * 60 }: OverviewOptions): Promise<Overview> {
  const dayCount = Math.min(Math.max(1, Math.trunc(Number(days) || DEFAULT_DAYS)), MAX_DAYS);
  const until = now instanceof Date ? now : new Date();
  const from = new Date(until.getTime() - (dayCount - 1) * 24 * 60 * 60 * 1000);
  // Cut back to the start of the LOCAL day, or an order placed at 8 this morning falls out of the window.
  const fromStartOfDay = new Date(`${localDate(from.toISOString(), timezoneOffsetMinutes)}T00:00:00.000Z`);
  fromStartOfDay.setTime(fromStartOfDay.getTime() - timezoneOffsetMinutes * 60 * 1000);

  const rows = await readOrders(toMysqlDateTime(fromStartOfDay));

  const totals = { soDon: 0, giaTri: 0, daThu: 0, conPhaiThu: 0, soDonHuy: 0, giaTriHuy: 0 };
  const byStatus = new Map<string, Overview["theoTrangThai"][number]>();
  const byDay = new Map<string, Overview["theoNgay"][number]>();
  const bestSellers = new Map<string, Overview["banChay"][number]>();

  for (const row of rows) {
    const order = {
      total: Number(row.total || 0),
      paymentStatus: String(row.payment_status || ""),
      paymentAmount: Number(row.payment_amount || 0)
    };
    const paid = paidAmountForOrder(order);
    const remaining = remainingAmountForOrder(order);
    const status = String(row.status || "").toLowerCase();
    const cancelled = CANCELLED.has(status);

    const s = byStatus.get(status) ?? { trangThai: status, soDon: 0, giaTri: 0 };
    s.soDon += 1;
    s.giaTri += order.total;
    byStatus.set(status, s);

    if (cancelled) {
      totals.soDonHuy += 1;
      totals.giaTriHuy += order.total;
      continue;                      // RULE 3: not revenue
    }

    totals.soDon += 1;
    totals.giaTri += order.total;
    totals.daThu += paid;
    totals.conPhaiThu += remaining;

    const day = localDate(isoFromMysql(row.created_at), timezoneOffsetMinutes);
    const d = byDay.get(day) ?? { ngay: day, soDon: 0, giaTri: 0, daThu: 0 };
    d.soDon += 1;
    d.giaTri += order.total;
    d.daThu += paid;
    byDay.set(day, d);

    for (const line of Array.isArray(row.mon) ? row.mon : []) {
      const code = String(line.product_code || "").trim() || "(không mã)";
      const b = bestSellers.get(code) ?? { ma: code, ten: String(line.product_name || ""), soLuong: 0, giaTri: 0 };
      const quantity = Math.max(0, Math.trunc(Number(line.quantity || 0)));
      b.soLuong += quantity;
      b.giaTri += Math.max(0, Number(line.price || 0)) * quantity;
      bestSellers.set(code, b);
    }
  }

  return {
    ok: true,
    soNgay: dayCount,
    tuNgay: localDate(fromStartOfDay.toISOString(), timezoneOffsetMinutes),
    denNgay: localDate(until.toISOString(), timezoneOffsetMinutes),
    chamTran: rows.length >= ORDER_CAP,
    tong: totals,
    theoTrangThai: [...byStatus.values()].sort((a, b) => b.soDon - a.soDon),
    theoNgay: [...byDay.values()].sort((a, b) => (a.ngay < b.ngay ? 1 : -1)),
    banChay: [...bestSellers.values()].sort((a, b) => b.soLuong - a.soLuong).slice(0, 10)
  };
}
