/**
 * @file The OWNER's doors on orders (OMI) and Sales Desk's sync door: manual order, edit, delete,
 * and the customer list.
 *
 * Why these are separate from `order-service.ts`: the storefront's rules (price from stock,
 * strict stock, 15-minute window) are the CUSTOMER's rules. The owner is trusted: they may set a
 * price, sell a pair that is not in the catalogue (a partner's), and change lines. What stays the
 * same is the bookkeeping — every pair taken is written on the order and given back on cancel or
 * delete, and every write leaves a log line saying who did it.
 *
 * Manual orders are `MAN-…`, the running site's shape (Sales Desk and Image Tool read the prefix).
 * They carry a LOOKUP SECRET (`TR-XXXX-XXXX-XXXX`) instead of a link token: the seller reads it to
 * the customer over the phone, and the lookup form accepts it with or without dashes.
 */

import crypto from "node:crypto";
import type { ReplyDraft, Row } from "../../contract";
import { isoFromMysql } from "../../shared/mysql-time";
import type { OrderContext } from "./context";
import { repositoryOf } from "./context";
import { CustomerRepository } from "./customer-repository";
import { normaliseLine, type CustomerProfile, type HeadPatch, type NormalisedLine } from "./order-repository";
import { commitHolds, holdLines, readOrder, returnStock } from "./order-service";

const text = (v: unknown): string => String(v ?? "").trim();
const refuse = (status: number, error: string, message: string): ReplyDraft => ({ status, body: { ok: false, error, message } });
const NO_STORE = { "Cache-Control": "no-store" };

/** `TR-XXXX-XXXX-XXXX` — the lookup secret of a manual order, as the running site minted it. */
export function createLookupSecret(): string {
  const raw = crypto.randomBytes(6).toString("hex").toUpperCase();
  return `TR-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

/** Stored and compared without dashes or spaces, upper-case: the customer may type it either way. */
export function normalizeLookupSecret(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/[\s-]+/g, "");
}

function profileFromBody(body: Record<string, unknown>, current: Partial<CustomerProfile> = {}): CustomerProfile {
  const pick = (key: string, fallback: unknown): string => (body[key] === undefined ? text(fallback) : text(body[key]));
  const province = pick("province", current.province);
  const district = pick("district", current.district);
  const ward = pick("ward", current.ward);
  const addressDetail = pick("addressDetail", current.addressDetail);
  const joined = [addressDetail, ward, district, province].filter(Boolean).join(", ");
  return {
    customerName: text(body["customerName"] ?? body["customer"] ?? current.customerName),
    phone: pick("phone", current.phone),
    email: pick("email", current.email),
    address: text(body["address"]) || joined || text(current.address),
    province, district, ward, addressDetail,
    note: pick("note", current.note)
  };
}

/** Head fields the owner may send. Only present keys become a change. */
function headPatchFromBody(body: Record<string, unknown>): HeadPatch {
  const patch: HeadPatch = {};
  const profileKeys = ["customerName", "customer", "phone", "email", "address", "province", "district", "ward", "addressDetail", "note"];
  if (profileKeys.some((k) => body[k] !== undefined)) {
    const p: Partial<CustomerProfile> = {};
    if (body["customerName"] !== undefined || body["customer"] !== undefined) p.customerName = text(body["customerName"] ?? body["customer"]);
    for (const k of ["phone", "email", "address", "province", "district", "ward", "addressDetail", "note"] as const) {
      if (body[k] !== undefined) p[k] = text(body[k]);
    }
    patch.profile = p;
  }
  if (body["paymentStatus"] !== undefined) patch.paymentStatus = text(body["paymentStatus"]);
  if (body["paymentMethod"] !== undefined) patch.paymentMethod = text(body["paymentMethod"]);
  if (body["paymentReference"] !== undefined) patch.paymentReference = text(body["paymentReference"]);
  if (body["paymentAmount"] !== undefined || body["paidAmount"] !== undefined) patch.paymentAmount = Math.max(0, Number(body["paymentAmount"] ?? body["paidAmount"]) || 0);
  if (body["fulfillmentStatus"] !== undefined) patch.fulfillmentStatus = text(body["fulfillmentStatus"]);
  if (body["shippingProvider"] !== undefined || body["carrier"] !== undefined) patch.shippingProvider = text(body["shippingProvider"] ?? body["carrier"]);
  if (body["trackingCode"] !== undefined) patch.trackingCode = text(body["trackingCode"]);
  if (body["customerId"] !== undefined) patch.customerId = body["customerId"] === null || body["customerId"] === "" ? null : Number(body["customerId"]);
  return patch;
}

function linesFromBody(body: Record<string, unknown>): NormalisedLine[] {
  return (Array.isArray(body["items"]) ? body["items"] : []).map(normaliseLine).filter((l): l is NormalisedLine => l !== null);
}

/** Takes stock for the owner's lines (not strict, owner's price trusted) and writes what was taken on the order. */
async function takeForOwner(ctx: OrderContext, id: string, lines: NormalisedLine[]): Promise<{ thieu: { code: string; size: string }[] }> {
  const hold = await holdLines(ctx, lines, { strict: false, trustClientPrice: true });
  if (!hold.ok) return { thieu: [{ code: hold.code, size: hold.size }] }; // unreachable when not strict; keeps the type honest
  const taken = await commitHolds(ctx, hold.held, id);
  if (taken.length > 0) await repositoryOf(ctx).recordStockTaken({ id, lines: taken, at: ctx.ports.clock.now() });
  return { thieu: hold.missing };
}

export interface ManualOrderInput {
  body: Record<string, unknown>;
  /** `quan-tri` (OMI) or `sales-desk`. */
  actor: string;
}

/**
 * Creates or updates a MANUAL order. Sales Desk's wire (`POST /api/admin/manual-orders/sync`,
 * body or `body.order`) and OMI's (`POST /api/orders/thu-cong`) are the same shape.
 *
 * Reply keeps the running site's fields: `orderId`, `lookupUrl`, `lookupSecret` (only when
 * freshly minted — the stored one is a hash), `created`, plus `stock.thieu` for lines the
 * catalogue did not have.
 */
export async function upsertManualOrder(ctx: OrderContext, input: ManualOrderInput): Promise<ReplyDraft> {
  const body = (input.body["order"] && typeof input.body["order"] === "object" ? input.body["order"] : input.body) as Record<string, unknown>;
  const now = ctx.ports.clock.now();
  const id = text(body["id"]) || `MAN-${now.getTime()}`;
  if (!/^MAN-/i.test(id)) return refuse(422, "invalid_manual_order", "Mã đơn thủ công phải bắt đầu bằng MAN-.");
  const lines = linesFromBody(body);
  const repository = repositoryOf(ctx);
  const existing = await repository.read(id);
  const siteUrl = text(ctx.config.siteUrl || "https://toprun.site").replace(/\/+$/, "");
  const lookupUrl = `${siteUrl}/order-status.html?order=${encodeURIComponent(id)}`;

  if (existing) {
    const rotate = input.body["rotateLookupSecret"] === true;
    const secret = text(input.body["lookupSecret"]) || (rotate ? createLookupSecret() : "");
    if (secret) await repository.setLookupToken({ id, token: normalizeLookupSecret(secret), at: now });
    let stock: { thieu: { code: string; size: string }[] } = { thieu: [] };
    if (Array.isArray(body["items"]) && lines.length > 0) {
      await returnStock(ctx, id);
      stock = await takeForOwner(ctx, id, lines);
      await repository.replaceLines({ id, lines, total: Number(body["total"] ?? lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0)), at: now });
    }
    const patch = headPatchFromBody(body);
    if (body["status"] !== undefined) patch.status = text(body["status"]);
    await repository.updateHead({ id, patch, actor: input.actor, note: input.actor === "sales-desk" ? "Sales Desk cập nhật đơn thủ công" : "Chủ shop sửa đơn thủ công", at: now });
    return { status: 200, headers: NO_STORE, body: { ok: true, orderId: id, lookupUrl, lookupSecret: secret, created: false, stock: { ok: true, ...stock } } };
  }

  if (!text(body["customerName"] ?? body["customer"])) return refuse(422, "thieu_ten_khach", "Đơn thủ công cần tên khách.");
  if (lines.length === 0) return refuse(422, "don_khong_co_mon", "Đơn thủ công cần ít nhất một món.");
  const secret = text(input.body["lookupSecret"]) || createLookupSecret();
  const total = Number(body["total"] ?? lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0)) || 0;
  const paidAmount = Math.max(0, Number(body["paidAmount"] ?? body["paymentAmount"] ?? 0) || 0);
  await repository.insert({
    id, lookupToken: normalizeLookupSecret(secret), total, lines, profile: profileFromBody(body),
    paymentMethod: text(body["paymentMethod"]), placedAt: now,
    status: text(body["status"]) || (input.actor === "sales-desk" ? "processing" : "pending"),
    // Status VALUES are the order-money kit's vocabulary (`paid`, `partially_paid`): the kit only counts money under those.
    paymentStatus: text(body["paymentStatus"]) || (paidAmount >= total && total > 0 ? "paid" : paidAmount > 0 ? "partially_paid" : "payment_pending"),
    paymentAmount: paidAmount,
    paymentReference: text(body["paymentReference"]) || id,
    fulfillmentStatus: text(body["fulfillmentStatus"]) || "not_assigned",
    shippingProvider: text(body["shippingProvider"] ?? body["carrier"]),
    trackingCode: text(body["trackingCode"]),
    customerId: body["customerId"] ? Number(body["customerId"]) : null,
    actor: input.actor,
    logNote: input.actor === "sales-desk" ? "Sales Desk tạo đơn thủ công" : "Chủ shop tạo đơn thủ công"
  });
  // Lines are priced by the owner; stock is taken where the catalogue has it, the rest is still sold.
  const stock = await takeForOwner(ctx, id, lines);
  // Prices may have been filled from stock for lines the owner sent without one: write them back.
  await repository.replaceLines({ id, lines, total: Number(body["total"] ?? lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0)), at: now });
  ctx.ports.logger.info(`[don-khach] ${input.actor} tạo đơn thủ công ${id}: ${lines.length} dòng${stock.thieu.length ? `, ${stock.thieu.length} dòng ngoài kho` : ""}`);
  return { status: 200, headers: NO_STORE, body: { ok: true, orderId: id, lookupUrl, lookupSecret: secret, created: true, stock: { ok: true, ...stock } } };
}

/** The owner edits an order: recipient, money, shipping, and — when `items` is sent — the lines (stock moves with them). */
export async function editOrder(ctx: OrderContext, id: string, body: Record<string, unknown>, actor: string): Promise<ReplyDraft> {
  const repository = repositoryOf(ctx);
  const order = await repository.read(id);
  if (!order) return refuse(404, "khong_thay", "Không có đơn này.");
  const now = ctx.ports.clock.now();
  let stock: { thieu: { code: string; size: string }[] } = { thieu: [] };
  const changed: string[] = [];
  if (Array.isArray(body["items"])) {
    const lines = linesFromBody(body);
    if (lines.length === 0) return refuse(422, "don_khong_co_mon", "Đơn phải còn ít nhất một món.");
    // Old pairs go back first, then the new lines are taken — a changed size is one restock + one take.
    await returnStock(ctx, id);
    stock = await takeForOwner(ctx, id, lines);
    await repository.replaceLines({ id, lines, total: lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0), at: now });
    changed.push("món");
  }
  const patch = headPatchFromBody(body);
  if (patch.profile) changed.push("người nhận");
  if (patch.paymentStatus !== undefined || patch.paymentAmount !== undefined || patch.paymentMethod !== undefined || patch.paymentReference !== undefined) changed.push("tiền");
  if (patch.shippingProvider !== undefined || patch.trackingCode !== undefined || patch.fulfillmentStatus !== undefined) changed.push("giao hàng");
  if (Object.keys(patch).length > 0 || changed.length > 0) {
    await repository.updateHead({ id, patch, actor, note: `Sửa đơn: ${changed.join(", ") || "không đổi gì"}`, at: now });
  }
  return { status: 200, headers: NO_STORE, body: { ok: true, order: await readOrder(ctx, id), stock: { ok: true, ...stock } } };
}

/** Removes an order for good. Pairs it took go back to the shelf first. */
export async function deleteOrder(ctx: OrderContext, id: string, actor: string): Promise<ReplyDraft> {
  const repository = repositoryOf(ctx);
  const order = await repository.read(id);
  if (!order) return refuse(404, "khong_thay", "Không có đơn này.");
  await returnStock(ctx, id);
  const removed = await repository.purge(id);
  ctx.ports.logger.info(`[don-khach] ${actor} xoá đơn ${id}`);
  return { status: 200, headers: NO_STORE, body: { ok: removed > 0, daXoa: removed > 0, maDon: id } };
}

// ---- customers as the owner sees them ----------------------------------------------------------

function accountWire(r: Row): Record<string, unknown> {
  return {
    id: Number(r["id"]), tenDangNhap: text(r["username"]), email: text(r["email"]), ten: text(r["name"]), dienThoai: text(r["phone"]),
    emailDaXacThuc: Number(r["email_verified"] || 0) === 1, soDon: Number(r["so_don"] || 0), taoLuc: isoFromMysql(r["created_at"])
  };
}

function fromOrdersWire(r: Row): Record<string, unknown> {
  return {
    dienThoai: text(r["phone"]), ten: text(r["customer_name"]), email: text(r["email"]), tinh: text(r["province"]),
    soDon: Number(r["so_don"] || 0), tongTien: Number(r["tong_tien"] || 0), donCuoi: isoFromMysql(r["don_cuoi"]),
    maTaiKhoan: r["customer_id"] === null || r["customer_id"] === undefined ? null : Number(r["customer_id"])
  };
}

/** Two lists: accounts (registered) and customers known from orders (one row per phone). */
export async function listCustomers(ctx: OrderContext, q: string, limit: number): Promise<ReplyDraft> {
  const repo = new CustomerRepository(ctx.ports.store);
  const [accounts, fromOrders] = await Promise.all([repo.listAccounts(q, limit), repo.listFromOrders(q, limit)]);
  return { status: 200, headers: NO_STORE, body: { ok: true, taiKhoan: accounts.map(accountWire), theoDon: fromOrders.map(fromOrdersWire) } };
}
