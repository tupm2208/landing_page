/**
 * @file THE PARTNER'S SCREEN, assembled from the three purchasing tables.
 *
 * The portal page (`goc/partner-portal.js`, a verbatim copy of the running site) reads one payload
 * and draws seven tabs from it. This file builds that payload. The field names below are therefore
 * WIRE FORMAT — renaming one blanks a tab on a page nobody is going to re-test by hand.
 *
 * WHAT CHANGED FROM THE RUNNING SITE, and why:
 *
 * 1. NOTHING IS STORED THAT CAN BE COUNTED. The old site kept purchase "sessions" with running
 *    totals and a `revision`, and every undo had to rewrite them. Here a slip is a row, and what is
 *    owed is counted from the slips each time it is asked for. A stored total goes stale the moment
 *    a slip is undone — and then two screens disagree about money.
 *
 * 2. EVERY QUANTITY IS KEYED BY LINE ID (`<mã đơn>#<biến thể>`), never by the line's position in the
 *    order. That is the trap of 10/09/2026 (incident ORD-1788854262493), and it is kept closed here
 *    as well as in the tables.
 *
 * 3. THE PARTNER NEVER SEES THE CUSTOMER'S PRICE. Only the shop's cost reaches this payload;
 *    `price` (what the customer pays) is dropped on the way in. A test asserts it.
 *
 * 4. A PARTNER SEES ONLY THE LINES THE SHOP GAVE THEM (16/09/2026). The first port listed every
 *    line of every live order to every partner — and let any of them buy it. The running site's
 *    rule is back: the line's `partnerId` is this partner, the order is paid or the line was pushed
 *    to buy, and the line is not blocked. An empty partner id is the SHOP's own view: every partner.
 */

import { orderLineId } from "../../shared/order-line-id";
import type { PackingState, Partner, PurchaseSlip, ShipmentRequestState, StockOutReport } from "./purchase-repository";
import { PACKED } from "./purchase-repository";

/** One order line as the Orders module hands it over (the order wire format). */
export interface PortalOrderLine {
  /** The line's stable id (`order_items.line_id`). Present since 16/09/2026; older lines have none. */
  maDong?: string;
  variantId?: string | number;
  productCode?: string;
  productName?: string;
  size?: string;
  qty?: number | string;
  quantity?: number | string;
  /** What the SHOP pays for the pair, as the catalogue said when the order was placed. */
  saleFilePrice?: number | string;
  /** The cost locked when the line was pushed to buy (Desk-era orders carry only this one). */
  costPrice?: number | string;
  /** The partner the shop gave this line to. Empty = nobody chosen yet. */
  partnerId?: string;
  purchaseAuthorized?: boolean;
  procurementStatus?: string;
}

/** One order as the Orders module hands it over. */
export interface PortalOrder {
  id?: string;
  customerName?: string;
  createdAt?: string;
  status?: string;
  paymentStatus?: string;
  paidAmount?: number | string;
  trackingCode?: string;
  shippingProvider?: string;
  fulfillmentStatus?: string;
  daXoa?: boolean;
  items?: PortalOrderLine[];
}

/** One order a need row is waiting on. */
export interface NeedOrder {
  orderId: string;
  maDong: string;
  quantity: number;
  unitCost: number;
  purchasedQty: number;
  remainingQty: number;
  createdAt: string;
}

/** One product-and-size row of "what to buy", with the orders waiting behind it. */
export interface NeedRow {
  productCode: string;
  productName: string;
  size: string;
  unitCost: number;
  currentUnitCost: number;
  priceDelta: number;
  priceChanged: boolean;
  requiredQty: number;
  purchasedQty: number;
  missingQty: number;
  newQty: number;
  backlogQty: number;
  latestOrderAt: string;
  status: "pending" | "partial" | "done";
  orders: NeedOrder[];
}

/** One line of one order, as the "history" and "orders" tabs read it. */
export interface OrderLineRow {
  orderId: string;
  maDong: string;
  customerName: string;
  createdAt: string;
  productCode: string;
  productName: string;
  size: string;
  unitCost: number;
  quantity: number;
  purchasedQty: number;
  missingQty: number;
  status: "pending";
  packingStatus: string;
  packingStatusLabel: string;
  packingLocked: boolean;
}

/** One order in the packing / shipment lists. */
export interface ParcelRow {
  orderId: string;
  lineRef: string;
  customerName: string;
  createdAt: string;
  products: string[];
  trackingCode: string;
  trackingUrl: string;
  carrier: string;
  shippingStatus: string;
  purchaseComplete: boolean;
  externalShip: boolean;
  requestPending: boolean;
  requestStale: boolean;
  requestError: string;
  canRequest: boolean;
  canPack: boolean;
  packingStatus: string;
  packingStatusLabel: string;
  packingLocked: boolean;
}

/** What the shop owes this partner, counted fresh every time. */
export interface PortalSummary {
  purchasedQty: number;
  orderCount: number;
  feeAmount: number;
  paidAmount: number;
  adjustmentAmount: number;
  debtAmount: number;
}

/**
 * Everything the builders need to know about who is looking and what was already done.
 *
 * TWO purchase counts, on purpose (the running site's `portalPurchasedQtyForLine` with and without
 * a partner): what is still MISSING is the line minus what ANYBODY bought, but "new vs top-up" and
 * "you bought N" are this partner's own work.
 */
export interface PortalView {
  /** `""` = the shop's own screen: every partner's lines. */
  partnerId: string;
  purchasedByAnyone: ReadonlyMap<string, number>;
  purchasedByPartner: ReadonlyMap<string, number>;
  /** Lines this partner (or anyone, for the shop's view) reported out of stock. */
  reportedOut: ReadonlySet<string>;
  packing: ReadonlyMap<string, PackingState>;
  /** The last waybill request per order, for the shipment tab's pending / error rows. */
  shipmentRequests?: ReadonlyMap<string, ShipmentRequestState>;
  /** The catalogue's cost today, keyed `code|size` (lower case), for the "⚠ Giá đổi" badge. */
  currentCost?: ReadonlyMap<string, number>;
  now: Date;
}

const text = (v: unknown): string => String(v ?? "").trim();
const lower = (v: unknown): string => text(v).toLowerCase();
const qtyOf = (line: PortalOrderLine): number => Math.max(1, Math.trunc(Number(line.qty ?? line.quantity ?? 1)));

/** How long a waybill request may stay "creating" before the button offers to try again. */
export const SHIPMENT_REQUEST_STALE_MS = 15 * 60 * 1000;

/** Most parcels the packing tab lists — the running site's cap. */
const MAX_PARCELS = 50;

/**
 * THE stable line id — one spelling for the whole server, in `shared/order-line-id.ts`.
 *
 * A line handed over by Orders now carries `maDong` (its `line_id` column). When it does, that is
 * the id; the older shapes stay as fallbacks so a line written before the column existed still
 * resolves to the same string its purchase slips were written with.
 */
export function lineIdOf(order: PortalOrder, line: PortalOrderLine, index: number): string {
  return orderLineId(order.id, line.maDong, line.variantId, index);
}

/** The key the catalogue cost map uses. */
export function costKey(productCode: unknown, size: unknown): string {
  return `${lower(productCode)}|${lower(size)}`;
}

/**
 * What the shop pays for one pair of this line.
 *
 * The running site's order (`orderItemSnapshotCost`): the cost locked when the line was pushed to
 * buy, then the catalogue cost stamped on the order. Web orders carry the second, Desk-era orders
 * only the first — reading only `saleFilePrice` showed every Desk order as "Thiếu giá", and the
 * page disables "Xác nhận" on a zero price.
 */
export function unitCostOf(line: PortalOrderLine): number {
  for (const value of [line.costPrice, line.saleFilePrice]) {
    const n = Number(value || 0);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

/** Order statuses where buying no longer makes sense (running site: `PARTNER_PORTAL_INACTIVE_ORDER_STATUSES`). */
const INACTIVE_ORDER_STATUSES = new Set([
  "ready_to_ship", "sent_to_sapo", "shipping", "shipped", "delivered", "fulfilled", "completed",
  "cancelled", "canceled", "partner_out_of_stock", "soft_deleted", "draft", "customer_recontact"
]);
const INACTIVE_FLOW_STATUSES = new Set(["ready_to_ship", "shipped", "shipping", "delivered", "fulfilled", "completed", "cancelled"]);

/** Orders a partner may still be asked to buy for. */
export function orderNeedsPurchase(order: PortalOrder): boolean {
  if (order.daXoa) return false;
  if (INACTIVE_ORDER_STATUSES.has(lower(order.status))) return false;
  if (INACTIVE_FLOW_STATUSES.has(lower(order.fulfillmentStatus))) return false;
  return true;
}

/** Orders that still belong on the packing / shipment tabs: dead ones never do. */
const DEAD_STATUSES = new Set(["cancelled", "canceled", "soft_deleted", "customer_recontact", "draft"]);

export function isLiveOrder(order: PortalOrder): boolean {
  return !order.daXoa && !DEAD_STATUSES.has(lower(order.status));
}

const PAID_STATUSES = new Set(["paid", "partially_paid", "payment_confirmed", "deposit_received"]);
const BLOCKED_LINE_STATUSES = new Set(["purchase_blocked", "partner_out_of_stock"]);

/** Is this line given to the partner looking? The shop's view (`""`) sees every assigned line. */
function lineBelongsTo(line: PortalOrderLine, partnerId: string): boolean {
  if (partnerId === "") return text(line.partnerId) !== "";
  return text(line.partnerId) === partnerId;
}

/**
 * May this line be bought right now? (running site: `portalOrderLineEligibleForPurchase`)
 *
 * Money first: an unpaid order is not bought unless the shop pushed the line on purpose — a pair
 * bought for a customer who never pays is the shop's loss, not the partner's.
 */
export function lineOpenForPurchase(order: PortalOrder, line: PortalOrderLine, partnerId: string): boolean {
  if (!orderNeedsPurchase(order) || !lineBelongsTo(line, partnerId)) return false;
  const status = lower(line.procurementStatus);
  if (BLOCKED_LINE_STATUSES.has(status)) return false;
  const paid = Number(order.paidAmount || 0) > 0 || PAID_STATUSES.has(lower(order.paymentStatus));
  const pushed = line.purchaseAuthorized === true || status === "purchase_ready";
  return paid || pushed;
}

/** A line still waiting for this partner, with what is missing on it. */
export interface OpenLine {
  order: PortalOrder;
  line: PortalOrderLine;
  lineId: string;
  wanted: number;
  boughtByPartner: number;
  remaining: number;
}

/**
 * Every line this partner still has to buy, oldest order first.
 *
 * The one list the needs tab, the orders tab, the scan and the allocation all read — four
 * different filters were how the first port ended up with four different answers.
 */
export function openLines(orders: PortalOrder[], view: PortalView): OpenLine[] {
  const out: OpenLine[] = [];
  const sorted = [...orders].sort((a, b) => text(a.createdAt).localeCompare(text(b.createdAt)));
  for (const order of sorted) {
    (order.items ?? []).forEach((line, index) => {
      if (!text(line.productCode) || !lineOpenForPurchase(order, line, view.partnerId)) return;
      const lineId = lineIdOf(order, line, index);
      const boughtByPartner = view.purchasedByPartner.get(lineId) ?? 0;
      // Reported out of stock and nothing bought: the shop must re-source it, not this partner.
      if (view.reportedOut.has(lineId) && boughtByPartner === 0) return;
      const wanted = qtyOf(line);
      const remaining = Math.max(0, wanted - (view.purchasedByAnyone.get(lineId) ?? 0));
      if (remaining <= 0) return;
      out.push({ order, line, lineId, wanted, boughtByPartner, remaining });
    });
  }
  return out;
}

/**
 * "What is still to buy", grouped by product and size — the way a person shops: one trip to the
 * shelf for `DV1234 size 42`, not one trip per order that happens to want it.
 *
 * `newQty` vs `backlogQty` is the running site's distinction, kept because the partner plans the day
 * around it: nothing bought for this line yet, versus a line half-bought that needs topping up.
 */
export function buildNeeds(orders: PortalOrder[], view: PortalView): NeedRow[] {
  const rows = new Map<string, NeedRow>();
  for (const open of openLines(orders, view)) {
    const { order, line, lineId, boughtByPartner, remaining } = open;
    const productCode = text(line.productCode);
    const size = text(line.size);
    const unitCost = unitCostOf(line);
    const key = costKey(productCode, size);
    let row = rows.get(key);
    if (!row) {
      row = {
        productCode, productName: text(line.productName) || productCode, size,
        unitCost, currentUnitCost: 0, priceDelta: 0, priceChanged: false,
        requiredQty: 0, purchasedQty: 0, missingQty: 0, newQty: 0, backlogQty: 0,
        latestOrderAt: "", status: "pending", orders: []
      };
      rows.set(key, row);
    }
    if (row.unitCost === 0 && unitCost > 0) row.unitCost = unitCost;
    row.requiredQty += remaining;
    row.orders.push({
      orderId: text(order.id), maDong: lineId, quantity: remaining, unitCost,
      purchasedQty: boughtByPartner, remainingQty: remaining, createdAt: text(order.createdAt)
    });
  }

  for (const [key, row] of rows) {
    row.purchasedQty = row.orders.reduce((sum, o) => sum + o.purchasedQty, 0);
    row.newQty = row.orders.reduce((sum, o) => sum + (o.purchasedQty > 0 ? 0 : o.remainingQty), 0);
    row.backlogQty = row.orders.reduce((sum, o) => sum + (o.purchasedQty > 0 ? o.remainingQty : 0), 0);
    row.missingQty = row.newQty + row.backlogQty;
    row.latestOrderAt = row.orders.reduce((latest, o) => (o.createdAt > latest ? o.createdAt : latest), "");
    row.status = row.missingQty <= 0 ? "done" : row.purchasedQty > 0 ? "partial" : "pending";
    // The catalogue moved since the order was placed: the partner must not be surprised at the till.
    const current = view.currentCost?.get(key) ?? 0;
    if (current > 0) {
      row.currentUnitCost = current;
      if (row.unitCost > 0 && current !== row.unitCost) {
        row.priceChanged = true;
        row.priceDelta = current - row.unitCost;
      }
    }
  }
  // Newest waiting order first, as the running site sorts: that is the one the customer just paid for.
  return [...rows.values()].sort((a, b) =>
    b.latestOrderAt.localeCompare(a.latestOrderAt) || a.productCode.localeCompare(b.productCode) || a.size.localeCompare(b.size));
}

/** The running site's `partnerOrderAutoPacked`: the warehouse already received it, nobody packs it again. */
function autoPacked(order: PortalOrder): boolean {
  const value = lower(order.fulfillmentStatus);
  return ["received", "delivered", "warehouse_received", "in_warehouse", "nhan_hang", "nhap_kho"].some((word) => value.includes(word));
}

function packingStatusOf(order: PortalOrder, view: PortalView): string {
  if (autoPacked(order)) return PACKED;
  return view.packing.get(text(order.id))?.trangThai === PACKED ? PACKED : "pending";
}

/** The "orders" and "history" tabs: this partner's lines still missing something, newest order first. */
export function buildOrderLines(orders: PortalOrder[], view: PortalView): OrderLineRow[] {
  return openLines(orders, view)
    .reverse()
    .map(({ order, line, lineId, boughtByPartner, remaining }) => {
      const status = packingStatusOf(order, view);
      return {
        orderId: text(order.id), maDong: lineId,
        customerName: text(order.customerName),
        createdAt: text(order.createdAt),
        productCode: text(line.productCode),
        productName: text(line.productName) || text(line.productCode),
        size: text(line.size),
        unitCost: unitCostOf(line),
        quantity: remaining,
        purchasedQty: boughtByPartner,
        missingQty: remaining,
        status: "pending" as const,
        packingStatus: status,
        packingStatusLabel: status === PACKED ? "Đã đóng hàng" : "Chưa đóng hàng",
        packingLocked: autoPacked(order)
      };
    });
}

/** Handed to the carrier already: off the packing list (running site: `partnerPackingShippedOut`). */
function shippedOut(order: PortalOrder): boolean {
  const values = [lower(order.fulfillmentStatus), lower(order.status)];
  return values.some((v) =>
    v === "shipped" || v === "shipping" || v === "fulfilled" ||
    ["in_transit", "delivering", "delivered", "completed", "da_giao"].some((word) => v.includes(word)));
}

/**
 * The parcels: one per order, listed once THIS partner's lines on it are bought in full.
 *
 * SEVEN STEPS (Dũng, 06/08/2026), kept: bought in full -> waiting for a waybill -> creating ->
 * (error with a reason | a code) -> waiting to be packed -> packed. The button to pack only opens
 * once a waybill exists — or the order ships outside a carrier — so nothing is sealed that the
 * courier has no label for. A parcel stays until the carrier has it, then leaves the list.
 */
export function buildParcels(orders: PortalOrder[], view: PortalView): ParcelRow[] {
  const out: ParcelRow[] = [];
  const sorted = [...orders].sort((a, b) => text(b.createdAt).localeCompare(text(a.createdAt)));
  for (const order of sorted) {
    if (!isLiveOrder(order) || shippedOut(order)) continue;
    const scoped = (order.items ?? [])
      .map((line, index) => ({ line, lineId: lineIdOf(order, line, index) }))
      .filter(({ line }) => lineBelongsTo(line, view.partnerId));
    if (scoped.length === 0) continue;
    // Bought by ANYONE counts: the parcel is complete when the pairs exist, whoever fetched them.
    const complete = scoped.every(({ line, lineId }) => (view.purchasedByAnyone.get(lineId) ?? 0) >= qtyOf(line));
    if (!complete) continue;

    const orderId = text(order.id);
    const trackingCode = text(order.trackingCode);
    const carrier = lower(order.shippingProvider) || "spx";
    const externalShip = carrier === "external";
    const request = trackingCode ? undefined : view.shipmentRequests?.get(orderId);
    const pendingAge = request?.dangTao ? view.now.getTime() - new Date(request.luc).getTime() : 0;
    const requestPending = Boolean(request?.dangTao) && pendingAge < SHIPMENT_REQUEST_STALE_MS;
    const requestStale = Boolean(request?.dangTao) && pendingAge >= SHIPMENT_REQUEST_STALE_MS;
    const canPack = trackingCode !== "" || externalShip;
    const status = packingStatusOf(order, view);
    out.push({
      orderId, lineRef: orderId,
      customerName: text(order.customerName),
      createdAt: text(order.createdAt),
      products: scoped.map(({ line }) => `${text(line.productCode)} · size ${text(line.size) || "-"} · SL ${qtyOf(line)}`),
      trackingCode,
      // The order does not keep the carrier's tracking page; the code itself is what the partner copies.
      trackingUrl: "",
      carrier,
      shippingStatus: text(order.fulfillmentStatus),
      purchaseComplete: true,
      externalShip,
      requestPending,
      requestStale,
      requestError: !trackingCode && request && !request.dangTao ? request.loi : "",
      canRequest: trackingCode === "" && !externalShip && !requestPending,
      canPack,
      packingStatus: canPack ? status : "waiting_tracking",
      packingStatusLabel: !canPack ? "Chờ vận đơn" : status === PACKED ? "Đã đóng hàng" : "Chưa đóng hàng",
      packingLocked: autoPacked(order)
    });
    if (out.length >= MAX_PARCELS) break;
  }
  return out;
}

/**
 * Which session a slip belongs to: the partner's command id without its per-line suffix.
 *
 * One tap on "Xác nhận" can spread over several order lines, one slip each (`<lệnh>#0`, `#1`…).
 * The page shows that tap as ONE purchase session, as the running site did.
 */
export function sessionIdOf(slip: Pick<PurchaseSlip, "maLenh" | "maPhieu">): string {
  const command = text(slip.maLenh);
  return command ? command.replace(/#\d+$/, "") : slip.maPhieu;
}

/**
 * Purchase slips as the page's "sessions" tab draws them: one tap on "Xác nhận" is one session.
 *
 * `unitCost` is what the SYSTEM said the pair costs when the slip was written, `actualCostPrice`
 * what the partner paid — the page compares the two ("Khớp giá" / "Lệch"). Slips written before
 * the system price was stored show the paid price on both sides.
 */
export function buildSessions(slips: PurchaseSlip[], partner: Partner, names?: ReadonlyMap<string, string>): Record<string, unknown>[] {
  const groups = new Map<string, PurchaseSlip[]>();
  for (const slip of slips) {
    const id = sessionIdOf(slip);
    const group = groups.get(id);
    if (group) group.push(slip); else groups.set(id, [slip]);
  }
  return [...groups.entries()].map(([id, group]) => {
    const first = group[0]!;
    const systemCost = (slip: PurchaseSlip) => slip.giaHeThong > 0 ? slip.giaHeThong : slip.giaVon;
    const name = names?.get(lower(first.maMon)) || first.maMon;
    const quantity = group.reduce((sum, s) => sum + s.soLuong, 0);
    return {
      id,
      createdAt: group.reduce((earliest, s) => (s.taoLuc < earliest ? s.taoLuc : earliest), first.taoLuc),
      productCode: first.maMon,
      size: first.size,
      quantity,
      unitCost: systemCost(first),
      actualCostPrice: first.giaVon,
      note: first.ghiChu,
      feeAmount: feeForSlips(group, partner),
      lines: [{
        productCode: first.maMon, productName: name, size: first.size,
        quantity, unitCost: systemCost(first), actualCostPrice: first.giaVon,
        lineTotal: group.reduce((sum, s) => sum + s.giaVon * s.soLuong, 0)
      }],
      allocations: group.map((slip) => ({
        orderId: slip.maDon,
        // The page passes this back on undo; the server keys undo on session + order.
        lineIndex: 0,
        maDong: slip.maDong,
        productCode: slip.maMon,
        size: slip.size,
        quantity: slip.soLuong,
        unitCost: systemCost(slip),
        actualCostPrice: slip.giaVon,
        respondedAt: slip.taoLuc
      }))
    };
  });
}

/**
 * What the partner has earned on these slips.
 *
 * `moi-mon` pays per pair, `moi-don` per distinct order, `ca-hai` both. Counted, never stored — see
 * rule 1 at the top of this file. The running site's names (`product`, `order`, `both`) are read
 * too, so a partner imported as-is is not paid twice.
 */
export function feeForSlips(slips: PurchaseSlip[], partner: Partner): number {
  const mode = normaliseFeeMode(partner.feeMode);
  const perItem = mode === "moi-don" ? 0 : Math.max(0, partner.feePerItem);
  const perOrder = mode === "moi-mon" ? 0 : Math.max(0, partner.feePerOrder);
  const pairs = slips.reduce((sum, s) => sum + Math.max(0, s.soLuong), 0);
  const orders = new Set(slips.map((s) => s.maDon).filter(Boolean)).size;
  return pairs * perItem + orders * perOrder;
}

/** `moi-mon` · `moi-don` · `ca-hai`, from either spelling. */
export function normaliseFeeMode(mode: unknown): "moi-mon" | "moi-don" | "ca-hai" {
  const value = lower(mode);
  if (value === "moi-mon" || value === "product") return "moi-mon";
  if (value === "moi-don" || value === "order") return "moi-don";
  return "ca-hai";
}

/**
 * What the partner earned, THE RUNNING SITE'S WAY (Dũng, 16/09/2026: "cứ tính như bản cũ"): the fee is
 * counted per purchase SESSION — pairs in the session, plus distinct orders in the session. An order
 * bought across two sessions therefore earns the per-order fee twice; that is what partners were paid.
 */
export function feeBySession(slips: PurchaseSlip[], partner: Partner): number {
  const sessions = new Map<string, PurchaseSlip[]>();
  for (const slip of slips) {
    const id = sessionIdOf(slip);
    const group = sessions.get(id);
    if (group) group.push(slip); else sessions.set(id, [slip]);
  }
  let total = 0;
  for (const group of sessions.values()) total += feeForSlips(group, partner);
  return total;
}

/** The money box on the fees tab: earned, paid, agreed on top, still owed. `slips` must be ALL of them. */
export function buildSummary(slips: PurchaseSlip[], partner: Partner, paid: number, extra: number): PortalSummary {
  const feeAmount = feeBySession(slips, partner);
  return {
    purchasedQty: slips.reduce((sum, s) => sum + Math.max(0, s.soLuong), 0),
    orderCount: new Set(slips.map((s) => s.maDon).filter(Boolean)).size,
    feeAmount,
    paidAmount: paid,
    adjustmentAmount: extra,
    debtAmount: Math.max(0, feeAmount + extra - paid)
  };
}

/** Lines this partner reported out of stock, as the screen lists them. */
export function buildStockOuts(reports: StockOutReport[]): StockOutReport[] {
  return reports;
}
