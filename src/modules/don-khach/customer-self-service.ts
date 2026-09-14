/**
 * @file The customer's own doors: view, edit and cancel THEIR order, and the lookup form.
 *
 * These routes are PUBLIC (a customer on the web has no token), so they protect themselves with
 * exactly one thing: the RIGHT order id together with the RIGHT lookup token. One of the two
 * wrong = nothing is shown — and it never says WHICH one was wrong, or the token could be guessed.
 *
 * Every function here returns a `ReplyDraft` ready for the route; the rules of what may be edited
 * (profile only, first 15 minutes, never lines or prices) live here, the views in `public-orders.ts`.
 */

import { EVENTS, type ReplyDraft } from "../../contract";
import type { OrderContext, OrderMoneySummary } from "./context";
import { repositoryOf } from "./context";
import type { CustomerProfile, Order } from "./order-repository";
import { changeStatus, readByLookupToken, readOrder } from "./order-service";
import { canEdit, detailView, secretView, statusOnlyView } from "./public-orders";

const NO_STORE = { "Cache-Control": "no-store" };
const text = (v: unknown): string => String(v ?? "").trim();

/** Digits only, so the phone number matches however the customer typed it. */
export function digitsOnly(value: unknown): string {
  return String(value || "").replace(/[^0-9]/g, "");
}

const refuse = (status: number, error: string, message: string): ReplyDraft => ({ status, body: { ok: false, error, message } });
const MISSING_TOKEN = () => refuse(422, "thieu_ma_tra_cuu", "Thiếu mã đơn hoặc link không hợp lệ.");
const NOT_FOUND = () => refuse(404, "khong_thay_don", "Không tìm thấy đơn hàng phù hợp.");

/** Money on the order as the Money module computes it. No Money module = null (the page still works, just without the paid amount). */
async function moneyOf(ctx: OrderContext, orderId: string): Promise<OrderMoneySummary | null> {
  const service = ctx.services["tien-doi-soat"]?.orderMoney;
  if (!service) return null;
  try {
    return await service(String(orderId || ""));
  } catch (e) {
    // A broken money path still lets the customer see the order — only the paid amount is missing.
    ctx.ports.logger.warn(`[don-khach] khong tinh duoc tien cua don ${orderId}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

async function detailReply(ctx: OrderContext, order: Order, now: Date): Promise<ReplyDraft> {
  return { status: 200, headers: NO_STORE, body: { ok: true, order: detailView(order, { now, money: await moneyOf(ctx, order.id) }) } };
}

/** The customer opens the link from the email / order popup: order id + lookup token -> detail view. */
export async function viewByLookupToken(ctx: OrderContext, { id = "", token = "" }: { id?: string; token?: string } = {}): Promise<ReplyDraft> {
  if (!id || !token) return MISSING_TOKEN();
  const order = await readByLookupToken(ctx, { id, token });
  if (!order) return NOT_FOUND();
  return detailReply(ctx, order, ctx.ports.clock.now());
}

/**
 * The customer edits the recipient profile within the first 15 minutes.
 *
 * ONLY the profile (name, phone, address, note). NOT the lines and NOT the prices — the storefront
 * does send a line list, but it is ignored here completely: changing lines changes stock and
 * money, and that goes through the seller. The running site allows line changes; this is
 * deliberately different and documented as such.
 */
export async function editCustomerProfile(ctx: OrderContext, { id = "", token = "", body = {} }: { id?: string; token?: string; body?: Record<string, unknown> } = {}): Promise<ReplyDraft> {
  if (!id || !token) return MISSING_TOKEN();
  const order = await readByLookupToken(ctx, { id, token });
  if (!order) return NOT_FOUND();
  if (!canEdit(order, ctx.ports.clock.now())) return refuse(409, "het_gio_sua", "Đơn hàng đã quá thời gian tự chỉnh sửa.");

  const customerName = text(body["customerName"] ?? order.customerName);
  const phone = text(body["phone"] ?? order.phone);
  if (!customerName) return refuse(422, "thieu_ten_khach", "Vui lòng nhập tên người nhận.");
  if (digitsOnly(phone).length < 9) return refuse(422, "sai_dien_thoai", "Số điện thoại chưa đúng.");

  const province = text(body["province"] ?? order.province);
  const district = text(body["district"] ?? order.district);
  const ward = text(body["ward"] ?? order.ward);
  const addressDetail = text(body["addressDetail"] ?? order.addressDetail);
  const profile: CustomerProfile = {
    customerName, phone,
    email: text(body["email"] ?? order.email),
    address: text(body["address"] || [addressDetail, ward, district, province].filter(Boolean).join(", ")),
    province, district, ward, addressDetail,
    note: text(body["note"] ?? order.note)
  };

  const now = ctx.ports.clock.now();
  await repositoryOf(ctx).updateCustomerProfile({ id: order.id, profile, currentStatus: order.status, at: now });
  const fresh = await readOrder(ctx, order.id);
  ctx.ports.logger.info(`[don-khach] khach tu sua ho so don ${order.id}`);
  return detailReply(ctx, fresh ?? order, now);
}

/**
 * The customer cancels within the first 15 minutes.
 *
 * ONE THING STILL OPEN (stated so nobody assumes it is done): cancelling does NOT yet return stock.
 * On the running site, placing an order deducts real stock, so cancelling adds it back. In the
 * split build, placing only RESERVES for 30 minutes and the reservation ticket is not written on
 * the order — so here we only emit `don-khach.da-huy`; the Inventory module will listen to it and
 * release once reservations are persisted. See "reservation after placing" in KIEM-KE-TINH-NANG.md.
 */
export async function cancelByCustomer(ctx: OrderContext, { id = "", token = "" }: { id?: string; token?: string } = {}): Promise<ReplyDraft> {
  if (!id || !token) return MISSING_TOKEN();
  const order = await readByLookupToken(ctx, { id, token });
  if (!order) return NOT_FOUND();
  if (String(order.status || "").toLowerCase() === "cancelled") return refuse(409, "da_huy_roi", "Đơn hàng đã được hủy.");
  if (!canEdit(order, ctx.ports.clock.now())) return refuse(409, "het_gio_huy", "Đơn hàng đã quá thời gian tự hủy.");

  const outcome = await changeStatus(ctx, { id: order.id, status: "cancelled", note: "Khách tự hủy đơn", actor: "khach" });
  if (!outcome.ok) return refuse(409, outcome.reason, "Chưa hủy được đơn hàng.");
  ctx.bus.emit(EVENTS.orderCancelled, { maDon: order.id, boi: "khach" });

  const fresh = await readOrder(ctx, order.id);
  return detailReply(ctx, fresh ?? order, ctx.ports.clock.now());
}

/**
 * The lookup form. Three ways a customer proves the order is theirs:
 *   order id + lookup token          -> detail view (like opening the link)
 *   order id + secret code           -> secret view: lines and shipment, no address
 *   order id + phone number / email  -> status only
 */
export async function lookupOrder(ctx: OrderContext, rawBody: unknown): Promise<ReplyDraft> {
  const body = (rawBody && typeof rawBody === "object" ? rawBody : {}) as Record<string, unknown>;
  const id = text(body["orderId"] || body["order"] || body["id"]);
  const token = text(body["token"] || body["orderToken"]);
  const secret = text(body["lookupSecret"] || body["secret"]);
  const contact = text(body["contact"] || body["phone"] || body["email"]);
  if (!id) return refuse(422, "thieu_ma_don", "Vui lòng nhập mã đơn và mã bí mật.");

  if (token) return viewByLookupToken(ctx, { id, token });

  if (secret) {
    // Customers type the secret with dashes or in lower case. Try both the normalised and the raw
    // form, like the running site — a correctly typed code must never come back "not found".
    const normalised = secret.toUpperCase().replace(/[\s-]+/g, "");
    for (const candidate of new Set([secret, normalised])) {
      const order = await readByLookupToken(ctx, { id, token: candidate });
      if (order) return { status: 200, headers: NO_STORE, body: { ok: true, order: secretView(order) } };
    }
    return NOT_FOUND();
  }

  if (contact) {
    const head = await repositoryOf(ctx).headRow(id);
    if (!head) return NOT_FOUND();
    const phoneMatches = digitsOnly(contact).length >= 9 && digitsOnly(head["phone"]) === digitsOnly(contact);
    const emailMatches = contact.includes("@") && text(head["email"]).toLowerCase() === contact.toLowerCase();
    // Same refusal as "no such order": the two answers must be identical or an order's existence leaks.
    if (!phoneMatches && !emailMatches) return NOT_FOUND();
    const order = await readOrder(ctx, id);
    return { status: 200, headers: NO_STORE, body: { ok: true, order: statusOnlyView(order ?? {}) } };
  }

  return refuse(422, "thieu_ma_tra_cuu", "Vui lòng nhập mã đơn và mã bí mật.");
}
