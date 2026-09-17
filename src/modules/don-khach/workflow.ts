/**
 * @file THE EIGHT TABS of the order screen — which step of the shop's work an order is at.
 *
 * Copied line for line from Sales Desk's `operationalOrderStatuses` (`app.js:8570-8594`), branch
 * order included. The order of the branches IS the meaning: the first one that matches wins, so
 * a completed order with an out-of-stock line counts as completed, not as needing attention.
 * Reordering them quietly moves orders between tabs, which is why they are not "tidied up" here.
 *
 * WHY THE SERVER DECIDES, not the screen. Desk worked this out in the browser, in three places,
 * and the three drifted apart — the tab counts, the row badge and the partner portal could each
 * say something different about the same order. Here it is computed once and every caller reads
 * the same answer.
 *
 * ONE ORDER CAN BE IN TWO TABS. An order being bought that the customer has not paid for yet
 * belongs in BOTH "Đang mua" and "Chờ khách CK" — Desk returns an array for exactly this reason
 * (`app.js:8589`), and so does this. Returning a single value makes the counts wrong.
 *
 * WHAT DIFFERS FROM DESK, on purpose: this landing has no `shipping_status` and no
 * `source_order_status` columns, so Desk's triple `(status, fulfillmentStatus, shippingStatus)`
 * is a pair here plus the tracking code. Every status VALUE below is Desk's own.
 *
 * NOTHING IN THIS FILE READS THE DATABASE OR CALLS A SERVICE. `purchasedQty` arrives already
 * counted, from `mua-ho.purchasedByLine` at the route — Purchasing calls `don-khach.search`, so
 * asking it back from inside the order read would close a loop.
 */

import { orderDepositConfirmed } from "../../shared/order-money";

/** The eight tabs, in Desk's order (`app.js:8445-8454`). `ma` is the wire value. */
export const WORKFLOW_TABS: readonly { ma: string; ten: string }[] = [
  { ma: "workflow_new", ten: "Đơn mới" },
  { ma: "workflow_stock", ten: "Chờ xác nhận hàng" },
  { ma: "workflow_payment", ten: "Chờ khách CK" },
  { ma: "workflow_purchase", ten: "Đang mua" },
  { ma: "workflow_delivery", ten: "Chờ giao" },
  { ma: "workflow_completed", ten: "Hoàn tất" },
  { ma: "workflow_attention", ten: "Cần xử lý" },
  { ma: "cancelled", ten: "Đã hủy" }
];

/** One line, as this file reads it. Structural so both the stored row and the view fit. */
export interface WorkflowLine {
  procurementStatus?: string;
  purchaseAuthorized?: boolean;
  partnerId?: string;
  warehouseId?: string;
  quantity?: number;
  qty?: number;
  /** Counted from the purchase slips by the caller. */
  daMua?: number;
  /** Stamped when a partner reported buying this line, or when the order was completed by hand. */
  purchaseLockedAt?: string;
}

/** One order, as this file reads it. */
export interface WorkflowOrder {
  status?: string;
  fulfillmentStatus?: string;
  trackingCode?: string;
  daXoa?: boolean;
  total?: number;
  paidAmount?: number;
  paymentAmount?: number;
  paymentStatus?: string;
  items?: WorkflowLine[];
  /** A real order carries more than this file reads; the money kit takes the whole thing. */
  [extra: string]: unknown;
}

const lower = (v: unknown): string => String(v || "").toLowerCase();
const linesOf = (order: WorkflowOrder): WorkflowLine[] => (Array.isArray(order.items) ? order.items : []);
const qtyOf = (line: WorkflowLine): number => Math.max(1, Math.trunc(Number(line.quantity ?? line.qty ?? 1)));

/** Desk's `landingOrderIsCancelled` (`app.js:8601`): in the bin, or ended one way or another. */
export function isCancelled(order: WorkflowOrder): boolean {
  if (order.daXoa === true) return true;
  return [order.status, order.fulfillmentStatus]
    .map(lower)
    .some((v) => ["cancelled", "canceled", "returned_to_stock", "soft_deleted"].includes(v));
}

/** Desk's `orderLineStockConfirmed`: the line is known to be obtainable. */
export function lineStockConfirmed(line: WorkflowLine): boolean {
  return ["stock_confirmed", "confirmed_in_stock", "available", "purchase_ready", "purchase_partial", "purchase_complete", "purchased"]
    .includes(lower(line.procurementStatus));
}

/** Is somebody responsible for getting this pair? */
function isAssigned(line: WorkflowLine): boolean {
  return String(line.partnerId || "").trim() !== "" || String(line.warehouseId || "").trim() !== "";
}

/**
 * Which tabs this order belongs in. First branch that matches wins — except the purchase/payment
 * pair, which is deliberately both.
 */
export function operationalStatuses(order: WorkflowOrder): string[] {
  if (isCancelled(order)) return ["cancelled"];

  const values = [order.status, order.fulfillmentStatus].map(lower);
  const lines = linesOf(order);
  const hasActualPurchase = lines.some((l) => Number(l.daMua ?? 0) > 0);
  const manuallyPushed = lines.some((l) => l.purchaseAuthorized === true || lower(l.procurementStatus) === "purchase_ready");

  if (values.some((v) => ["completed", "delivered", "fulfilled"].includes(v))) return ["workflow_completed"];

  // "Cần xử lý" has exactly two entrances (Desk's comment, app.js:8576): cannot be bought, or
  // cannot be delivered. A note to call the customer back is NOT one of them.
  const purchaseBlocked = lines.some((l) => lower(l.procurementStatus) === "partner_out_of_stock");
  if (purchaseBlocked || values.some((v) =>
    ["partner_out_of_stock", "failed", "delivery_failed", "shipping_issue", "returning", "returned", "return_requested"].includes(v))) {
    return ["workflow_attention"];
  }

  if (values.some((v) => [
    "purchase_complete", "partner_confirmed", "assigned_to_warehouse", "ready_to_ship", "sent_to_sapo",
    "shipping_requested", "shipping_created", "shipping", "shipped", "packed"
  ].includes(v)) || String(order.trackingCode || "").trim() !== "") {
    return ["workflow_delivery"];
  }

  const deposited = orderDepositConfirmed(order);
  const purchasing = hasActualPurchase
    || manuallyPushed
    || values.some((v) => ["purchase_partial", "purchased", "waiting_purchase"].includes(v))
    || (values.some((v) => ["partner_assigned", "deposit_received"].includes(v)) && deposited);

  const assigned = lines.filter(isAssigned);
  const waitingPayment = !deposited && (purchasing || (assigned.length > 0 && assigned.every(lineStockConfirmed)));

  // Being bought AND not paid for: the order is genuinely in both places at once.
  if (purchasing && waitingPayment) return ["workflow_purchase", "workflow_payment"];
  if (purchasing) return ["workflow_purchase"];
  if (waitingPayment) return ["workflow_payment"];
  if (assigned.length > 0 || values.some((v) => ["waiting_partner_confirm", "stock_reserved"].includes(v))) return ["workflow_stock"];
  return ["workflow_new"];
}

/** Whether an order belongs in one named tab. */
export function inTab(order: WorkflowOrder, tab: string): boolean {
  return operationalStatuses(order).includes(tab);
}

/**
 * How many orders sit in each tab.
 *
 * Because an order can be in two tabs, the counts can add up to more than the number of orders —
 * that is correct, and Desk behaves the same way.
 */
export function countByTab(orders: readonly WorkflowOrder[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const tab of WORKFLOW_TABS) out[tab.ma] = 0;
  for (const order of orders) {
    for (const tab of operationalStatuses(order)) out[tab] = (out[tab] ?? 0) + 1;
  }
  return out;
}

/**
 * Lines still to be bought — what "Sẵn sàng giao" checks before letting an order through.
 *
 * A line counts as bought by any of three signs, and all three are needed:
 *   - its warehouse needs nobody (the shop's own shelf, or a pair bought outside the system);
 *   - the purchase slips cover the quantity ordered (`daMua`);
 *   - the line is marked `purchase_complete` / `purchased`, or stamped as locked.
 *
 * The third is not a shortcut for the second. A merchant may not have bought Purchasing at all, in
 * which case there are no slips to count and the mark IS the record; and an order completed by
 * hand marks its lines without any partner ever having reported anything. Reading only `daMua`
 * would keep the gate shut on orders that are demonstrably ready — which is exactly the state the
 * "Chờ ship bắt buộc" escape hatch exists for, and the escape hatch should stay rare.
 */
export function linesNotReady(order: WorkflowOrder): WorkflowLine[] {
  return linesOf(order).filter((line) => {
    const warehouse = lower(line.warehouseId);
    if (warehouse === "wh_external" || warehouse.startsWith("wh_toprun")) return false;
    if (["purchase_complete", "purchased"].includes(lower(line.procurementStatus))) return false;
    if (String(line.purchaseLockedAt || "").trim() !== "") return false;
    if (!isAssigned(line)) return true;
    return Number(line.daMua ?? 0) < qtyOf(line);
  });
}
