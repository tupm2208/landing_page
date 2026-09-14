/**
 * @file The PUBLIC views of an order — what a customer sees when they look their order up.
 *
 * Three views, differing in "how much the customer proved":
 *
 *   detail — the RIGHT order id + lookup token (the link from the email / order popup). Sees the
 *            whole recipient profile, and may edit/cancel within the first 15 minutes.
 *   secret — order id + secret code. Sees the lines and the shipment, NOT the address, NOT the
 *            internal status.
 *   status — only order id + phone number. Sees only how far the order got.
 *
 * TWO THINGS THAT MUST NOT BREAK:
 *
 * 1. NEVER NAME THE WAREHOUSE / THE PARTNER to the customer (Mr Dũng, 10/09/2026). The `status`
 *    and `secret` views carry no warehouse name; the `detail` view is the customer's own order so
 *    it stays as on the running site — but NO view ever adds the cost price.
 * 2. MONEY IS NEVER DERIVED HERE. `paidAmount`/`remainingAmount` come from the Money module (via
 *    the order-money kit) and are passed in. This file adds and subtracts nothing on its own.
 *
 * The whole file is pure functions — one order in, one object out. No store, no system clock
 * (`now` is passed in), so the tests call them directly.
 */

/** How long after placing an order the customer may edit / cancel it. Same as the running site. */
export const EDIT_WINDOW_MINUTES = 15;

/** A line as the views read it. Everything optional: a bare test object is a valid input. */
export interface PublicLine {
  productCode?: string;
  productName?: string;
  size?: string;
  qty?: number;
  quantity?: number;
  price?: number;
  imageUrl?: string;
  warehouseId?: string;
  warehouseName?: string;
  warehouse?: string;
  brand?: string;
  productKind?: string;
  sourceName?: string;
  procurementStatus?: string;
}

/** One parcel of an order (the Shipping module fills these in later; today one parcel = the whole order). */
export interface PublicShipment {
  id?: string;
  shippingProvider?: string;
  trackingCode?: string;
  trackingUrl?: string;
  items?: PublicLine[];
}

/** The order fields the views read. A repository `Order` satisfies this; so does a bare test object. */
export interface PublicOrderSource {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
  customerName?: string;
  phone?: string;
  email?: string;
  address?: string;
  province?: string;
  district?: string;
  ward?: string;
  addressDetail?: string;
  note?: string;
  total?: number;
  status?: string;
  fulfillmentStatus?: string;
  paymentReference?: string;
  paymentAmount?: number;
  shippingProvider?: string;
  carrier?: string;
  trackingCode?: string;
  trackingUrl?: string;
  canCancelUntil?: string;
  items?: PublicLine[];
  shipments?: PublicShipment[];
}

/** Money the Money module computed for the order (`daTra` / `conPhaiTra` are its wire names). */
export interface PublicMoney {
  daTra?: number | undefined;
  conPhaiTra?: number | undefined;
}

const lower = (v: unknown): string => String(v || "").toLowerCase();
const itemsOf = (order: PublicOrderSource): PublicLine[] => (Array.isArray(order.items) ? order.items : []);
const procurementStatuses = (order: PublicOrderSource): string[] => itemsOf(order).map((m) => lower(m.procurementStatus));

const PREPARED_STATUSES = ["purchase_complete", "partner_confirmed", "ready_to_ship", "sent_to_sapo"];
const PREPARED_LINE_STATUSES = ["purchase_complete", "purchased"];
const CONFIRMED_STATUSES = ["partner_assigned", "purchase_ready", "purchase_partial", "waiting_purchase", "deposit_received"];
const CONFIRMED_LINE_STATUSES = ["stock_confirmed", "confirmed_in_stock", "available", "purchase_ready", "purchase_partial", "purchase_complete", "purchased"];

/** The status label the customer reads. Copied VERBATIM from the running site so customers see no difference. */
export function statusLabel(status = "", fulfillmentStatus = "", trackingCode = "", order: PublicOrderSource = {}, shipmentTag = ""): string {
  const k = lower(status);
  const g = lower(fulfillmentStatus);
  const lineStatuses = procurementStatuses(order);
  if (k === "cancelled" || k === "canceled") return "Đơn đã hủy";
  if (k === "completed" || k === "done") return "Đơn đã hoàn tất";
  if (shipmentTag === "partial") return "Một phần đơn đã có vận đơn";
  if (trackingCode || ["shipped", "in_transit", "shipping"].includes(g)) return "Đơn đã có vận đơn";
  if (["packed", "ready_to_ship"].includes(g)) return "Đơn đã sẵn sàng giao";
  if (PREPARED_STATUSES.includes(k) || (lineStatuses.length > 0 && lineStatuses.every((v) => PREPARED_LINE_STATUSES.includes(v)))) {
    return "Đã chuẩn bị đủ hàng - chờ giao vận";
  }
  if (CONFIRMED_STATUSES.includes(k) || (lineStatuses.length > 0 && lineStatuses.every((v) => CONFIRMED_LINE_STATUSES.includes(v)))) {
    return "Đã xác nhận có hàng - đang chuẩn bị hàng";
  }
  if (["payment_pending", "stock_confirmed"].includes(k) || g === "stock_reserved") return "Đã xác nhận có hàng";
  if (k === "waiting_partner_confirm" || g === "waiting_partner_confirm") return "TopRun đang xác nhận hàng";
  if (["confirmed", "processing"].includes(k)) return "Đơn đang được xử lý";
  return "TopRun đã nhận đơn";
}

/** The sentence that goes with the label. Also copied verbatim. */
export function statusNote(status = "", fulfillmentStatus = "", trackingCode = "", order: PublicOrderSource = {}, shipmentTag = ""): string {
  const k = lower(status);
  const g = lower(fulfillmentStatus);
  const lineStatuses = procurementStatuses(order);
  if (k === "cancelled" || k === "canceled") return "Đơn hàng đã được hủy. Vui lòng liên hệ TopRun nếu bạn cần kiểm tra thêm.";
  if (k === "completed" || k === "done") return "Đơn hàng đã hoàn tất. Cảm ơn bạn đã mua hàng tại TopRun.";
  if (shipmentTag === "partial") return "Một phần đơn đã có mã vận chuyển. Bạn có thể theo dõi từng kiện đã được bàn giao.";
  if (trackingCode) return "Đơn đã có mã vận chuyển. Bạn có thể bấm theo dõi vận chuyển để xem hành trình giao hàng.";
  if (["packed", "ready_to_ship", "shipped", "in_transit", "shipping"].includes(g)) return "Đơn đang ở bước giao hàng.";
  if (PREPARED_STATUSES.includes(k) || (lineStatuses.length > 0 && lineStatuses.every((v) => PREPARED_LINE_STATUSES.includes(v)))) {
    return "TopRun đã chuẩn bị đủ sản phẩm và đang chờ bàn giao cho đơn vị vận chuyển.";
  }
  if (CONFIRMED_STATUSES.includes(k) || (lineStatuses.length > 0 && lineStatuses.every((v) => CONFIRMED_LINE_STATUSES.includes(v)))) {
    return "Sản phẩm đã được xác nhận có hàng. TopRun đang mua hoặc chuẩn bị hàng cho đơn của bạn.";
  }
  if (["payment_pending", "stock_confirmed"].includes(k) || g === "stock_reserved") return "Sản phẩm trong đơn đã được xác nhận có hàng và đang chờ bước xử lý tiếp theo.";
  if (k === "waiting_partner_confirm" || g === "waiting_partner_confirm") return "TopRun đang xác nhận tồn kho và size sản phẩm trong đơn.";
  if (["confirmed", "processing"].includes(k)) return "TopRun đang xử lý đơn hàng của bạn.";
  return "TopRun đã nhận đơn và sẽ kiểm tra tồn kho/size trước khi xác nhận tiếp.";
}

/** A tracking link: SPX gets one; any other carrier gets an empty string rather than a guess. */
export function trackingUrl(order: PublicOrderSource = {}): string {
  const ready = String(order.trackingUrl || "").trim();
  if (ready) return ready;
  const code = String(order.trackingCode || "").trim();
  if (!code) return "";
  const carrier = String(order.shippingProvider || order.carrier || "").trim().toLowerCase();
  if (carrier === "spx" || carrier.includes("spx") || code.toUpperCase().startsWith("SPX")) {
    return `https://spx.vn/track?${encodeURIComponent(code)}`;
  }
  return "";
}

/**
 * When the customer's self-edit window closes.
 *
 * Reads `can_cancel_until` if the order carries it (the running site's table has that column);
 * otherwise placed-at + 15 minutes — the same value, since the running site writes exactly that.
 */
export function editDeadline(order: PublicOrderSource = {}): Date | null {
  const declared = String(order.canCancelUntil || "").trim();
  if (declared) {
    const t = new Date(declared);
    if (!Number.isNaN(t.getTime())) return t;
  }
  const placed = new Date(String(order.createdAt || ""));
  if (Number.isNaN(placed.getTime())) return null;
  return new Date(placed.getTime() + EDIT_WINDOW_MINUTES * 60 * 1000);
}

/** May the customer still edit? Not once cancelled, not after 15 minutes, not when the placed-at time is unknown (blocked by default). */
export function canEdit(order: PublicOrderSource = {}, now: Date = new Date()): boolean {
  const status = lower(order.status);
  if (status === "cancelled" || status === "canceled") return false;
  const deadline = editDeadline(order);
  if (!deadline) return false;
  return now.getTime() <= deadline.getTime();
}

/** The part all three views share: how far the order got. */
export interface StatusView {
  id: string;
  status: string;
  statusLabel: string;
  statusNote: string;
  fulfillmentStatus: string;
  shippingProvider: string;
  trackingCode: string;
  trackingUrl: string;
  shipments: PublicShipment[];
  updatedAt: string;
  createdAt: string;
}

/** Builds the shared status part. */
export function statusView(order: PublicOrderSource = {}): StatusView {
  const status = String(order.status || "pending").trim() || "pending";
  const fulfillmentStatus = String(order.fulfillmentStatus || "").trim();
  const trackingCode = String(order.trackingCode || "").trim();
  // Shipping is not yet split off the order, so there is no parcel list. One parcel = the whole order.
  const parcels = Array.isArray(order.shipments) ? order.shipments : [];
  const parcelsWithCode = parcels.filter((k) => k.trackingCode).length;
  const shipmentTag = trackingCode || (parcels.length > 0 && parcelsWithCode === parcels.length)
    ? "full"
    : parcelsWithCode > 0 ? "partial" : "";
  const effectiveCode = trackingCode || String(parcels.find((k) => k.trackingCode)?.trackingCode || "");
  return {
    id: order.id || "",
    status,
    statusLabel: statusLabel(status, fulfillmentStatus, effectiveCode, order, shipmentTag),
    statusNote: statusNote(status, fulfillmentStatus, effectiveCode, order, shipmentTag),
    fulfillmentStatus,
    shippingProvider: String(order.shippingProvider || ""),
    trackingCode,
    trackingUrl: trackingUrl(order),
    shipments: parcels,
    updatedAt: order.updatedAt || order.createdAt || "",
    createdAt: order.createdAt || ""
  };
}

/** A line trimmed for the customer: without the price when `withPrice` is false. */
function trimmedLine(m: PublicLine = {}, { withPrice = true } = {}): Record<string, unknown> {
  const base = {
    productCode: m.productCode || "",
    productName: m.productName || "",
    size: m.size || "",
    qty: Number(m.qty ?? m.quantity ?? 1),
    quantity: Number(m.qty ?? m.quantity ?? 1),
    imageUrl: m.imageUrl || ""
  };
  if (!withPrice) return base;
  return {
    ...base,
    price: Number(m.price || 0),
    warehouseId: m.warehouseId || "",
    warehouseName: m.warehouseName || m.warehouse || "",
    brand: m.brand || "",
    productKind: m.productKind || "",
    sourceName: m.sourceName || ""
  };
}

/** The DETAIL view (the customer holds their own lookup token). */
export interface DetailView extends StatusView {
  view: "detail";
  canEdit: boolean;
  canCancel: boolean;
  canEditUntil: string;
  privacyNote: string;
  items: Record<string, unknown>[];
  total: number;
  paymentReference: string;
  paymentAmount: number;
  paidAmount: number;
  remainingAmount: number;
  customer: {
    customerName: string; phone: string; email: string; province: string; district: string; ward: string;
    addressDetail: string; address: string; note: string;
  } | null;
}

/**
 * The DETAIL view.
 * @param money `{ daTra, conPhaiTra }` from the Money module. Absent = 0 paid, and it SAYS 0 rather
 *              than guessing from `paymentStatus` (RULE 3 of the orders module).
 */
export function detailView(order: PublicOrderSource = {}, { now = new Date(), money = null }: { now?: Date; money?: PublicMoney | null } = {}): DetailView {
  const editable = canEdit(order, now);
  const deadline = editDeadline(order);
  const total = Number(order.total || 0);
  const paid = Number(money?.daTra || 0);
  return {
    ...statusView(order),
    view: "detail",
    canEdit: editable,
    canCancel: editable,
    canEditUntil: deadline ? deadline.toISOString() : "",
    privacyNote: editable
      ? "Bạn có thể sửa thông tin hoặc hủy đơn trong 15 phút sau khi đặt."
      : "Đơn hàng đã quá thời gian tự chỉnh sửa. Để bảo mật, thông tin người nhận đã được ẩn.",
    items: itemsOf(order).map((m) => trimmedLine(m)),
    total,
    paymentReference: String(order.paymentReference || ""),
    paymentAmount: Number(order.paymentAmount || 0),
    paidAmount: paid,
    remainingAmount: Number(money?.conPhaiTra ?? Math.max(0, total - paid)),
    customer: editable ? {
      customerName: order.customerName || "",
      phone: order.phone || "",
      email: order.email || "",
      province: order.province || "",
      district: order.district || "",
      ward: order.ward || "",
      addressDetail: order.addressDetail || "",
      address: order.address || "",
      note: order.note || ""
    } : null
  };
}

/** The SECRET view (order id + secret code): lines and shipment, NO address, NO internal status. */
export interface SecretView extends Omit<StatusView, "status" | "fulfillmentStatus"> {
  view: "secret";
  customerName: string;
  items: Record<string, unknown>[];
  shipments: PublicShipment[];
}

/** Builds the SECRET view. */
export function secretView(order: PublicOrderSource = {}): SecretView {
  const { status: _status, fulfillmentStatus: _fulfillment, ...rest } = statusView(order);
  return {
    ...rest,
    view: "secret",
    customerName: String(order.customerName || ""),
    items: itemsOf(order).map((m) => trimmedLine(m, { withPrice: false })),
    shipments: (rest.shipments || []).map((k) => ({
      id: k.id || "",
      shippingProvider: k.shippingProvider || "",
      trackingCode: k.trackingCode || "",
      trackingUrl: k.trackingUrl || "",
      items: (k.items || []).map((m) => trimmedLine(m, { withPrice: false })) as PublicLine[]
    }))
  };
}

/** The STATUS view (order id + phone number): only how far the order got. */
export function statusOnlyView(order: PublicOrderSource = {}): StatusView & { view: "status" } {
  return { ...statusView(order), view: "status" };
}
