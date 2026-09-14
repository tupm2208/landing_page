/**
 * THE OVERVIEW REPORT — and the rule "money goes through one corner".
 *
 * No MySQL needed: `overview` receives a reader function, so the tests feed it rows by hand.
 * What is protected is the WAY OF COUNTING, not the SQL statement.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_DAYS, overview, type OverviewOptions, type ReportOrderRow } from "../dist/modules/don-khach/reports.js";

const NOW = new Date("2026-09-12T10:00:00.000Z");   // 17:00 Vietnam time

function order(extra: Partial<ReportOrderRow> = {}): ReportOrderRow {
  return {
    id: "ORD-1", total: 1000000, status: "pending",
    payment_status: "payment_pending", payment_amount: 0,
    created_at: "2026-09-12 03:00:00",    // 10:00 Vietnam time, same day
    mon: [{ product_code: "A1", product_name: "Giày A", quantity: 1, price: 1000000 }],
    ...extra
  };
}

const run = (rows: ReportOrderRow[], options: Partial<Omit<OverviewOptions, "readOrders" | "now">> = {}) =>
  overview({ readOrders: async () => rows, now: NOW, ...options });

test("counts orders, sums value, and computes COLLECTED money through the kit", async () => {
  const report = await run([
    order({ id: "D1" }),
    // "paid" without an amount = the FULL total has been paid (the order-money kit's rule).
    order({ id: "D2", total: 2000000, payment_status: "paid", payment_amount: 0 }),
    // A confirmed 500k deposit.
    order({ id: "D3", total: 3000000, payment_status: "deposit_received", payment_amount: 500000 })
  ]);
  assert.equal(report.tong.soDon, 3);
  assert.equal(report.tong.giaTri, 6000000);
  assert.equal(report.tong.daThu, 0 + 2000000 + 500000);
  assert.equal(report.tong.conPhaiThu, 1000000 + 0 + 2500000);
});

test("money must NOT be a plain sum of payment_amount: an unconfirmed status has collected nothing", async () => {
  // The easiest place to get wrong: an order carries an amount but its status is unconfirmed
  // (the customer says they transferred, the shop has not checked). Summing `payment_amount`
  // reports money that does not exist yet.
  const report = await run([order({ total: 1000000, payment_status: "payment_pending", payment_amount: 900000 })]);
  assert.equal(report.tong.daThu, 0);
  assert.equal(report.tong.conPhaiThu, 1000000);
});

test("CANCELLED orders are not revenue, but are counted on their own", async () => {
  const report = await run([
    order({ id: "D1", total: 1000000 }),
    order({ id: "D2", total: 5000000, status: "cancelled" })
  ]);
  assert.equal(report.tong.soDon, 1, "only live orders are counted");
  assert.equal(report.tong.giaTri, 1000000);
  assert.equal(report.tong.soDonHuy, 1);
  assert.equal(report.tong.giaTriHuy, 5000000);
  // The by-status table DOES include cancelled orders — people need to see the cancel rate.
  assert.ok(report.theoTrangThai.some((t) => t.trangThai === "cancelled" && t.soDon === 1));
});

test("split by LOCAL day, not by UTC day", async () => {
  // 2026-09-11 18:00 UTC = 2026-09-12 01:00 Vietnam time. Split by UTC this order lands on the
  // 11th — the owner opens "today" and cannot find the order they just sold at one in the morning.
  const report = await run([order({ created_at: "2026-09-11 18:00:00" })]);
  assert.equal(report.theoNgay.length, 1);
  assert.equal(report.theoNgay[0]?.ngay, "2026-09-12");
});

test("best sellers ordered by quantity, summed across orders", async () => {
  const report = await run([
    order({ id: "D1", mon: [{ product_code: "A1", product_name: "Giày A", quantity: 2, price: 500000 }] }),
    order({ id: "D2", mon: [{ product_code: "A1", product_name: "Giày A", quantity: 1, price: 500000 },
                            { product_code: "B2", product_name: "Giày B", quantity: 1, price: 700000 }] })
  ]);
  assert.equal(report.banChay[0]?.ma, "A1");
  assert.equal(report.banChay[0]?.soLuong, 3);
  assert.equal(report.banChay[0]?.giaTri, 1500000);
  assert.equal(report.banChay.length, 2);
});

test("day window: default 14, too large is clamped, garbage falls back to the default", async () => {
  assert.equal((await run([])).soNgay, 14);
  assert.equal((await run([], { days: 1000 })).soNgay, MAX_DAYS);
  assert.equal((await run([], { days: 0 })).soNgay, 14);
  assert.equal((await run([], { days: "bay" })).soNgay, 14);
  assert.equal((await run([], { days: 7 })).soNgay, 7);
});

test("no orders at all: empty tables, no throw", async () => {
  const report = await run([]);
  assert.equal(report.ok, true);
  assert.equal(report.tong.soDon, 0);
  assert.deepEqual(report.theoNgay, []);
  assert.deepEqual(report.banChay, []);
  assert.equal(report.chamTran, false);
});
