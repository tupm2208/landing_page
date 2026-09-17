/**
 * @file AUTOMATIC PURCHASE QUEUE — Desk `supersports_auto_order.js` (decided 07/09/2026), per shop config.
 *
 * Flow: a customer paid → the lines of that order stocked by the partner the shop buys online from
 * (`mua_ho_tu_khoa` found in the line's warehouse / source name, e.g. "supersports") join a queue → the
 * browser extension (logged in to the partner's web shop, `omi/tien-ich/mua-ho-tu-dong`) claims ONE job,
 * adds the right size, fills the shop's fixed recipient, picks COD and COMPARES THE PRICE before ordering.
 *
 * THE PRICE RULE (kept from Desk): the expected cost on the order line against the price read at checkout.
 * Any difference = STOP, do not order, alert. A line missing code / size / cost is never bought blind: it is
 * queued as "blocked" and alerted ONCE; the next scan reopens it when the data is there.
 *
 * Nothing about TopRun is hard-coded: recipient, keyword and web shop are the shop's settings. Field
 * names of a queue item are Desk's — the extension's buyer script reads them.
 */

const ITEM_TTL_MS = 72 * 3600 * 1000;
const MAX_KEEP_ITEMS = 300;
const WORKING_TIMEOUT_MS = 15 * 60 * 1000;
export const QUEUE_DOCUMENT = "tinh-nang-shop-mua-ho";

const PAID = ["paid", "partially_paid", "payment_confirmed", "deposit_received"];
const PURCHASED = ["purchase_complete", "purchased", "partner_out_of_stock"];

export interface Recipient { fullName: string; firstName: string; lastName: string; phone: string; address1: string; ward: string; district: string; province: string; country: string; zip: string }

export interface QueueItem {
  id: string;
  dedupeKey: string;
  orderId: string;
  orderCode: string;
  customerName: string;
  lineKey: string;
  productCode: string;
  productName: string;
  size: string;
  qty: number;
  productUrl: string;
  searchQuery: string;
  site: string;
  expectedUnitCost: number;
  expectedLineTotal: number;
  currency: "VND";
  recipient: Recipient;
  paymentMethod: "cod";
  status: "pending" | "working" | "success" | "stopped" | "error" | "blocked" | "expired";
  reason: string;
  actualUnitPrice: number;
  actualTotal: number;
  supersportsOrderNumber: string;
  error: string;
  createdAt: string;
  startedAt: string;
  doneAt: string;
}

export interface QueueBook { version: 1; items: QueueItem[] }

/** The order shape this reads (don-khach wire). */
export interface OrderLike {
  id: string;
  status?: string;
  paymentStatus?: string;
  customerName?: string;
  daXoa?: boolean;
  items?: { maDong?: string; productCode?: string; productName?: string; size?: string; qty?: number; quantity?: number; costPrice?: number; saleFilePrice?: number; warehouseId?: string; warehouse?: string; warehouseName?: string; sourceName?: string; procurementStatus?: string; productUrl?: string }[];
}

export interface QueueSettings { enabled: boolean; keyword: string; site: string; recipient: Recipient; problems: string[] }

const text = (v: unknown): string => String(v ?? "").trim();
const fold = (v: unknown): string => text(v).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");

/** The shop's settings → the queue's. `problems` names what is missing (the screen shows it). */
export function queueSettingsOf(s: Record<string, string>): QueueSettings {
  const fullName = text(s["mua_ho_nguoi_nhan"]);
  const parts = fullName.split(/\s+/);
  const recipient: Recipient = {
    fullName, firstName: parts.length > 1 ? parts[parts.length - 1]! : fullName, lastName: parts.length > 1 ? parts.slice(0, -1).join(" ") : "",
    phone: text(s["mua_ho_dien_thoai"]), address1: text(s["mua_ho_dia_chi"]), ward: text(s["mua_ho_xa"]), district: text(s["mua_ho_huyen"]),
    province: text(s["mua_ho_tinh"]), country: "Vietnam", zip: ""
  };
  const keyword = text(s["mua_ho_tu_khoa"]);
  const problems = [
    keyword ? "" : "từ khoá kho / nguồn được đặt hộ",
    fullName ? "" : "tên người nhận", recipient.phone ? "" : "điện thoại người nhận", recipient.address1 ? "" : "địa chỉ nhận"
  ].filter(Boolean);
  return { enabled: text(s["mua_ho_bat"]) === "1" && problems.length === 0, keyword, site: text(s["mua_ho_trang_web"]).replace(/\/+$/, ""), recipient, problems };
}

const isPaid = (o: OrderLike) => PAID.includes(fold(o.paymentStatus)) || PAID.includes(fold(o.status));
const isDead = (o: OrderLike) => o.daXoa === true || fold(o.status).includes("cancel") || fold(o.status).includes("huy") || fold(o.status) === "soft_deleted";

/** Adds the paid, not-yet-bought lines of the keyword's partner. Returns what changed and what must be alerted. */
export function scanOrders(book: QueueBook | null, orders: OrderLike[], settings: QueueSettings, now: Date): { book: QueueBook; added: QueueItem[]; blocked: QueueItem[]; reopened: number } {
  const items = [...(book?.items ?? [])].map((i) => ({ ...i }));
  const known = new Set(items.filter((i) => ["pending", "working", "success"].includes(i.status)).map((i) => i.dedupeKey));
  const blockedBefore = new Map(items.filter((i) => i.status === "blocked").map((i) => [i.dedupeKey, i]));
  const added: QueueItem[] = [];
  const blocked: QueueItem[] = [];
  let reopened = 0;
  const key = fold(settings.keyword);
  if (!key) return { book: { version: 1, items }, added, blocked, reopened };
  for (const order of orders) {
    if (isDead(order) || !isPaid(order)) continue;
    (order.items ?? []).forEach((line, index) => {
      if (!fold([line.warehouseId, line.warehouse, line.warehouseName, line.sourceName].filter(Boolean).join(" ")).includes(key)) return;
      if (PURCHASED.includes(fold(line.procurementStatus))) return;
      const lineKey = text(line.maDong) || [text(line.productCode).toUpperCase(), text(line.size), String(index)].join("|");
      const dedupeKey = `${order.id}::${lineKey}`;
      if (known.has(dedupeKey)) return;
      const qty = Math.max(1, Math.trunc(Number(line.qty ?? line.quantity ?? 1)));
      const cost = [line.costPrice, line.saleFilePrice].map(Number).find((n) => Number.isFinite(n) && n > 0) ?? 0;
      const missing = [text(line.productCode) ? "" : "mã sản phẩm", text(line.size) ? "" : "size", cost > 0 ? "" : "giá nhập"].filter(Boolean);
      const previous = blockedBefore.get(dedupeKey);
      if (previous) {
        if (missing.length) return;
        Object.assign(previous, { status: "pending", reason: "", doneAt: "", expectedUnitCost: cost, expectedLineTotal: cost * qty, qty });
        known.add(dedupeKey);
        reopened += 1;
        return;
      }
      const at = now.toISOString();
      const record: QueueItem = {
        id: `mh_${now.getTime()}_${items.length + 1}`, dedupeKey, orderId: order.id, orderCode: order.id, customerName: text(order.customerName), lineKey,
        productCode: text(line.productCode), productName: text(line.productName), size: text(line.size), qty,
        productUrl: text(line.productUrl), searchQuery: text(line.productCode), site: settings.site,
        expectedUnitCost: cost, expectedLineTotal: cost * qty, currency: "VND", recipient: settings.recipient, paymentMethod: "cod",
        status: missing.length ? "blocked" : "pending", reason: missing.length ? `Thiếu ${missing.join(", ")} trên dòng đơn.` : "",
        actualUnitPrice: 0, actualTotal: 0, supersportsOrderNumber: "", error: "", createdAt: at, startedAt: "", doneAt: missing.length ? at : ""
      };
      items.push(record);
      known.add(dedupeKey);
      (missing.length ? blocked : added).push(record);
    });
  }
  return { book: { version: 1, items: items.slice(-MAX_KEEP_ITEMS) }, added, blocked, reopened };
}

/** Hands out ONE job: a problem touches one order and the partner's cart never mixes products. */
export function claimNext(book: QueueBook | null, now: Date): { book: QueueBook; item: QueueItem | null; busy: boolean } {
  const items = [...(book?.items ?? [])].map((i) => ({ ...i }));
  for (const i of items) {
    if ((i.status === "pending" || i.status === "working") && now.getTime() - (Date.parse(i.createdAt) || now.getTime()) > ITEM_TTL_MS) {
      i.status = "expired";
      i.doneAt = now.toISOString();
    }
  }
  const busy = items.find((i) => i.status === "working");
  if (busy) {
    if (now.getTime() - (Date.parse(busy.startedAt) || 0) <= WORKING_TIMEOUT_MS) return { book: { version: 1, items }, item: null, busy: true };
    busy.status = "pending";           // the extension died mid-job: give it back
    busy.startedAt = "";
  }
  const next = items.find((i) => i.status === "pending") ?? null;
  if (next) { next.status = "working"; next.startedAt = now.toISOString(); }
  return { book: { version: 1, items }, item: next, busy: false };
}

export function applyResult(book: QueueBook | null, body: Record<string, unknown>, now: Date): { book: QueueBook; item: QueueItem | null } {
  const items = [...(book?.items ?? [])].map((i) => ({ ...i }));
  const target = items.find((i) => i.id === text(body["id"])) ?? null;
  if (!target) return { book: { version: 1, items }, item: null };
  target.actualUnitPrice = Math.max(0, Number(body["actualUnitPrice"]) || 0);
  target.actualTotal = Math.max(0, Number(body["actualTotal"]) || 0);
  target.doneAt = now.toISOString();
  target.startedAt = "";
  if (body["ok"] === true) {
    target.status = "success";
    target.supersportsOrderNumber = text(body["orderNumber"]).slice(0, 80);
    target.error = "";
  } else {
    target.status = text(body["status"]) === "stopped" ? "stopped" : "error";
    target.reason = text(body["reason"]).slice(0, 500);
    target.error = text(body["error"]).slice(0, 500);
  }
  return { book: { version: 1, items }, item: target };
}

export function requeue(book: QueueBook | null, ids: string[]): { book: QueueBook; count: number } {
  const items = [...(book?.items ?? [])].map((i) => ({ ...i }));
  let count = 0;
  for (const i of items) {
    if (!ids.includes(i.id) || ["pending", "working", "success"].includes(i.status)) continue;
    Object.assign(i, { status: "pending", reason: "", error: "", doneAt: "", startedAt: "" });
    count += 1;
  }
  return { book: { version: 1, items }, count };
}

export function snapshot(book: QueueBook | null, settings: QueueSettings) {
  const items = book?.items ?? [];
  return {
    enabled: settings.enabled, site: settings.site, thieu: settings.problems,
    pending: items.filter((i) => i.status === "pending").length, working: items.filter((i) => i.status === "working").length,
    recent: items.slice(-30).reverse()
  };
}

const vnd = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}đ`;

export function alertText(item: QueueItem): string {
  const head = `Đơn ${item.orderCode} · ${item.productCode || "?"} size ${item.size || "?"} x${item.qty}`;
  if (item.status === "blocked") return ["⛔ Mua hộ tự động - KHÔNG tự đặt được", head, item.reason, "Cần xử lý tay."].join("\n");
  if (item.status === "success") return ["✅ Mua hộ tự động - đã đặt COD", head, `Mã đơn bên bán: ${item.supersportsOrderNumber || "(không đọc được)"}`, `Giá nhập kỳ vọng: ${vnd(item.expectedLineTotal)} · Thực trả: ${vnd(item.actualTotal)}`].join("\n");
  const price = item.actualTotal > 0
    ? `Giá nhập kỳ vọng: ${vnd(item.expectedLineTotal)} · Trên web: ${vnd(item.actualTotal)} (lệch ${vnd(item.actualTotal - item.expectedLineTotal)})`
    : `Giá nhập kỳ vọng: ${vnd(item.expectedLineTotal)}`;
  return [item.status === "stopped" ? "🟡 Mua hộ tự động - DỪNG, chưa đặt" : "⛔ Mua hộ tự động - LỖI, chưa đặt", head, item.reason || item.error || "Không rõ lý do.", price, item.productUrl].filter(Boolean).join("\n");
}
