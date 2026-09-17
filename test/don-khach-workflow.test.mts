/**
 * THE EIGHT TABS of the order screen.
 *
 * Copied branch for branch from Sales Desk (`app.js:8570-8594`), so these tests are the proof that
 * the copy is faithful: one case per branch, in the order the branches are tried, plus the two
 * things a rewrite gets wrong most easily — that the FIRST match wins, and that an order being
 * bought but not yet paid for is in TWO tabs at once.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WORKFLOW_TABS, countByTab, inTab, isCancelled, linesNotReady, operationalStatuses,
  type WorkflowLine, type WorkflowOrder
} from "../dist/modules/don-khach/workflow.js";

/** An order with nothing decided about it yet. */
const order = (extra: Partial<WorkflowOrder> = {}): WorkflowOrder => ({
  status: "pending", fulfillmentStatus: "not_assigned", trackingCode: "",
  total: 1000000, paidAmount: 0, paymentStatus: "payment_pending", items: [], ...extra
});

/** A line nobody has decided anything about. */
const line = (extra: Partial<WorkflowLine> = {}): WorkflowLine => ({
  procurementStatus: "", purchaseAuthorized: false, partnerId: "", warehouseId: "", quantity: 1, daMua: 0, ...extra
});

test("the eight tabs are Desk's, in Desk's order", () => {
  assert.deepEqual(WORKFLOW_TABS.map((t) => t.ma), [
    "workflow_new", "workflow_stock", "workflow_payment", "workflow_purchase",
    "workflow_delivery", "workflow_completed", "workflow_attention", "cancelled"
  ]);
  assert.equal(WORKFLOW_TABS.find((t) => t.ma === "workflow_payment")?.ten, "Chờ khách CK");
});

test("Đơn mới — nothing decided yet", () => {
  assert.deepEqual(operationalStatuses(order()), ["workflow_new"]);
});

test("Chờ xác nhận hàng — a line has a warehouse, or the order says so", () => {
  assert.deepEqual(operationalStatuses(order({ items: [line({ partnerId: "partner_wh_yen" })] })), ["workflow_stock"]);
  assert.deepEqual(operationalStatuses(order({ status: "waiting_partner_confirm" })), ["workflow_stock"]);
  assert.deepEqual(operationalStatuses(order({ fulfillmentStatus: "stock_reserved" })), ["workflow_stock"]);
});

test("Chờ khách CK — stock is confirmed but no money has arrived", () => {
  const o = order({ items: [line({ partnerId: "partner_wh_yen", procurementStatus: "stock_confirmed" })] });
  assert.deepEqual(operationalStatuses(o), ["workflow_payment"]);
  // One deposit in, and it stops waiting for money.
  assert.deepEqual(operationalStatuses({ ...o, paidAmount: 200000, paymentStatus: "partially_paid" }), ["workflow_stock"]);
});

test("Đang mua — a slip exists, or a line was pushed to the buying list", () => {
  const paid = { paidAmount: 1000000, paymentStatus: "paid" };
  assert.deepEqual(operationalStatuses(order({ ...paid, items: [line({ partnerId: "p", daMua: 1 })] })), ["workflow_purchase"]);
  assert.deepEqual(operationalStatuses(order({ ...paid, items: [line({ partnerId: "p", purchaseAuthorized: true })] })), ["workflow_purchase"]);
  assert.deepEqual(operationalStatuses(order({ ...paid, status: "waiting_purchase" })), ["workflow_purchase"]);
});

test("BEING BOUGHT AND NOT PAID FOR IS TWO TABS — the case a rewrite flattens by accident", () => {
  const o = order({ items: [line({ partnerId: "partner_wh_yen", daMua: 1 })] });
  assert.deepEqual(operationalStatuses(o), ["workflow_purchase", "workflow_payment"]);
  assert.equal(inTab(o, "workflow_purchase"), true);
  assert.equal(inTab(o, "workflow_payment"), true);
});

test("Chờ giao — bought in full, ready to ship, or already carrying a tracking number", () => {
  assert.deepEqual(operationalStatuses(order({ status: "purchase_complete" })), ["workflow_delivery"]);
  assert.deepEqual(operationalStatuses(order({ fulfillmentStatus: "ready_to_ship" })), ["workflow_delivery"]);
  assert.deepEqual(operationalStatuses(order({ trackingCode: "SPXVN999" })), ["workflow_delivery"], "a waybill means it is on its way out");
});

test("Hoàn tất", () => {
  assert.deepEqual(operationalStatuses(order({ status: "completed" })), ["workflow_completed"]);
  assert.deepEqual(operationalStatuses(order({ fulfillmentStatus: "delivered" })), ["workflow_completed"]);
});

test("Cần xử lý — exactly two entrances: cannot buy, or cannot deliver", () => {
  assert.deepEqual(operationalStatuses(order({ items: [line({ procurementStatus: "partner_out_of_stock" })] })), ["workflow_attention"]);
  assert.deepEqual(operationalStatuses(order({ fulfillmentStatus: "delivery_failed" })), ["workflow_attention"]);
  // A note to ring the customer back is NOT one of them (Desk's comment, app.js:8577).
  assert.ok(!inTab(order({ status: "customer_recontact" }), "workflow_attention"));
});

test("Đã hủy — cancelled, returned to stock, or in the bin", () => {
  for (const o of [order({ status: "cancelled" }), order({ status: "returned_to_stock" }), order({ daXoa: true })]) {
    assert.deepEqual(operationalStatuses(o), ["cancelled"]);
    assert.equal(isCancelled(o), true);
  }
});

test("THE FIRST BRANCH WINS — the order of the branches is the meaning, not tidiness", () => {
  // Completed AND a line reported out of stock: completed. Reordering the branches would move
  // finished orders into "Cần xử lý" and the shop would chase work that is already done.
  assert.deepEqual(operationalStatuses(order({ status: "completed", items: [line({ procurementStatus: "partner_out_of_stock" })] })), ["workflow_completed"]);
  // Cancelled beats everything, including a tracking number.
  assert.deepEqual(operationalStatuses(order({ status: "cancelled", trackingCode: "SPXVN999" })), ["cancelled"]);
  // Out of stock beats "on its way": a parcel cannot leave with a pair nobody could buy.
  assert.deepEqual(operationalStatuses(order({ status: "ready_to_ship", items: [line({ procurementStatus: "partner_out_of_stock" })] })), ["workflow_attention"]);
});

test("the counts can add up to MORE than the number of orders — and that is correct", () => {
  const both = order({ items: [line({ partnerId: "p", daMua: 1 })] });      // purchase + payment
  const counts = countByTab([both, order(), order({ status: "completed" })]);
  assert.equal(counts["workflow_purchase"], 1);
  assert.equal(counts["workflow_payment"], 1);
  assert.equal(counts["workflow_new"], 1);
  assert.equal(counts["workflow_completed"], 1);
  assert.equal(Object.values(counts).reduce((s, n) => s + n, 0), 4, "3 orders, 4 counted places");
  // Every tab is present even at zero, so the screen never has to guess a missing key.
  assert.deepEqual(Object.keys(counts).sort(), WORKFLOW_TABS.map((t) => t.ma).sort());
});

test("linesNotReady: what blocks 'Sẵn sàng giao'", () => {
  assert.equal(linesNotReady(order({ items: [line()] })).length, 1, "nobody is buying it yet");
  assert.equal(linesNotReady(order({ items: [line({ partnerId: "p", quantity: 2, daMua: 1 })] })).length, 1, "half bought is not bought");
  assert.equal(linesNotReady(order({ items: [line({ partnerId: "p", quantity: 2, daMua: 2 })] })).length, 0);
  // The shop's own shelf and a pair bought outside the system need nobody.
  assert.equal(linesNotReady(order({ items: [line({ warehouseId: "wh_toprun_yen" })] })).length, 0);
  assert.equal(linesNotReady(order({ items: [line({ warehouseId: "wh_external" })] })).length, 0);
});

test("a line MARKED bought counts as bought, even with no slips to count", () => {
  // A shop may not have bought Purchasing at all, so there are no slips; and an order completed by
  // hand marks its lines without any partner reporting anything. Reading only the slip count would
  // keep the gate shut on orders that are demonstrably ready, and push sellers onto the forced
  // route — which should stay rare enough to mean something.
  assert.equal(linesNotReady(order({ items: [line({ partnerId: "p", procurementStatus: "purchase_complete" })] })).length, 0);
  assert.equal(linesNotReady(order({ items: [line({ partnerId: "p", procurementStatus: "purchased" })] })).length, 0);
  assert.equal(linesNotReady(order({ items: [line({ partnerId: "p", purchaseLockedAt: "2026-09-16T10:00:00.000Z" })] })).length, 0);
  // …but a line merely ASSIGNED is still work to do.
  assert.equal(linesNotReady(order({ items: [line({ partnerId: "p", procurementStatus: "waiting_partner_confirm" })] })).length, 1);
});
