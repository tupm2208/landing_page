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
import { computeCheckout, DELIVERY_METHODS, discountTypeOf, SHIPPING_PAYERS } from "./checkout";
import { findProfileByPhone, saveProfile } from "./customer-profiles";
import { CONTACTS_TABLE } from "./returns-and-contacts";
import { normaliseLine, type CustomerProfile, type HeadPatch, type NormalisedLine, type OrderExtra } from "./order-repository";
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

/** A twin-site slug (`dasbui`), or "" for the main site. */
export function siteSlug(value: unknown): string {
  const v = text(value).toLowerCase();
  return /^[a-z][a-z0-9-]{0,39}$/.test(v) ? v : "";
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

/** The checkout + delivery fields present in a body (Đ2). Absent keys stay absent. */
function extraFromBody(body: Record<string, unknown>): OrderExtra {
  const extra: OrderExtra = {};
  const has = (k: string) => body[k] !== undefined && body[k] !== null;
  if (has("discountType")) extra.discountType = discountTypeOf(body["discountType"]);
  if (has("discountValue")) extra.discountValue = Math.max(0, Number(body["discountValue"]) || 0);
  if (has("shippingFee")) extra.shippingFee = Math.max(0, Math.round(Number(body["shippingFee"]) || 0));
  if (has("shippingPayer")) extra.shippingPayer = (SHIPPING_PAYERS as readonly string[]).includes(text(body["shippingPayer"])) ? text(body["shippingPayer"]) : "";
  if (has("deliveryMethod")) extra.deliveryMethod = (DELIVERY_METHODS as readonly string[]).includes(text(body["deliveryMethod"])) ? text(body["deliveryMethod"]) : "";
  if (has("tags")) extra.tags = (Array.isArray(body["tags"]) ? (body["tags"] as unknown[]).map(text) : text(body["tags"]).split(",")).map((t) => t.trim()).filter(Boolean).join(", ").slice(0, 500);
  if (has("shippingNote")) extra.shippingNote = text(body["shippingNote"]).slice(0, 500);
  if (has("customerProfileId")) extra.customerProfileId = text(body["customerProfileId"]).slice(0, 64);
  // Đ10: the twin site an order belongs to. Lower-case slug only; anything else = the main site.
  if (has("site")) extra.site = siteSlug(body["site"]);
  return extra;
}

const CHECKOUT_KEYS = ["discountType", "discountValue", "shippingFee"];

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
  const extra = extraFromBody(body);
  // Đ2: the SERVER computes what the customer owes from lines, discounts and shipping. Sales Desk's
  // sync still sends `total` (it computed it itself) and is trusted on its own wire.
  const checkout = computeCheckout(lines, { ...extra, paidAmount: 0 });
  extra.subtotal = checkout.subtotal;
  const total = Number(body["total"] ?? checkout.customerPayable) || 0;
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
    extra,
    actor: input.actor,
    logNote: input.actor === "sales-desk" ? "Sales Desk tạo đơn thủ công" : "Chủ shop tạo đơn thủ công"
  });
  // Lines are priced by the owner; stock is taken where the catalogue has it, the rest is still sold.
  const stock = await takeForOwner(ctx, id, lines);
  // Prices may have been filled from stock for lines the owner sent without one: write them back —
  // and the total with them, since a filled price changes what is owed.
  await repository.replaceLines({ id, lines, total: Number(body["total"] ?? computeCheckout(lines, extra).customerPayable), at: now });
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
  const extra = extraFromBody(body);
  // Settings not sent this time keep what the order already has: editing the address must not
  // silently drop a shipping fee typed last week.
  const settings = {
    discountType: extra.discountType ?? order.discountType,
    discountValue: extra.discountValue ?? order.discountValue,
    shippingFee: extra.shippingFee ?? order.shippingFee
  };
  let lines: NormalisedLine[] | null = null;
  if (Array.isArray(body["items"])) {
    lines = linesFromBody(body);
    if (lines.length === 0) return refuse(422, "don_khong_co_mon", "Đơn phải còn ít nhất một món.");
    // Old pairs go back first, then the new lines are taken — a changed size is one restock + one take.
    await returnStock(ctx, id);
    stock = await takeForOwner(ctx, id, lines);
    await repository.replaceLines({ id, lines, total: computeCheckout(lines, settings).customerPayable, at: now });
    changed.push("món");
  }
  const patch = headPatchFromBody(body);
  if (lines !== null || CHECKOUT_KEYS.some((k) => body[k] !== undefined)) {
    const priced = lines ?? order.items.map((l) => ({ quantity: l.quantity, unitPrice: l.price, discountType: l.discountType, discountValue: l.discountValue }));
    const checkout = computeCheckout(priced, settings);
    patch.total = checkout.customerPayable;
    extra.subtotal = checkout.subtotal;
    if (lines === null) changed.push("tiền");
  }
  if (Object.keys(extra).length > 0) {
    patch.extra = extra;
    if (extra.deliveryMethod !== undefined || extra.shippingPayer !== undefined || extra.shippingNote !== undefined) changed.push("cách giao");
    if (extra.customerProfileId !== undefined) changed.push("hồ sơ khách");
    if (extra.site !== undefined) changed.push("site");
  }
  if (patch.profile) changed.push("người nhận");
  if (patch.paymentStatus !== undefined || patch.paymentAmount !== undefined || patch.paymentMethod !== undefined || patch.paymentReference !== undefined) changed.push("tiền");
  if (patch.shippingProvider !== undefined || patch.trackingCode !== undefined || patch.fulfillmentStatus !== undefined) changed.push("giao hàng");
  if (Object.keys(patch).length > 0 || changed.length > 0) {
    await repository.updateHead({ id, patch, actor, note: `Sửa đơn: ${changed.join(", ") || "không đổi gì"}`, at: now });
  }
  return { status: 200, headers: NO_STORE, body: { ok: true, order: await readOrder(ctx, id), stock: { ok: true, ...stock } } };
}

/**
 * "Duyệt khách" of an order (Đ2) — Sales Desk's `confirm-remote-existing-customer` /
 * `confirm-remote-new-customer`. Either links the order to a profile already in the book
 * (`maKhach`), or makes one from what the order says (`moi: true`) — name, phone, and the order's
 * address as the profile's first address. A phone already in the book is LINKED, not duplicated.
 */
export async function reviewOrderCustomer(ctx: OrderContext, id: string, body: Record<string, unknown>, actor: string): Promise<ReplyDraft> {
  const repository = repositoryOf(ctx);
  const order = await repository.read(id);
  if (!order) return refuse(404, "khong_thay", "Không có đơn này.");
  let profileId = text(body["maKhach"]);
  let created = false;
  if (profileId !== "") {
    const found = await ctx.ports.store.table(CONTACTS_TABLE).one({ ma: profileId });
    if (!found) return refuse(404, "khong_thay_ho_so", "Không thấy hồ sơ khách này.");
  } else if (body["moi"] === true) {
    const same = await findProfileByPhone(ctx, order.phone);
    if (same) {
      profileId = text(same["ma"]);
    } else {
      const saved = await saveProfile(ctx, {
        ten: order.customerName || order.phone, dienThoai: order.phone, email: order.email, nguon: "don-web",
        ...(order.province || order.ward || order.addressDetail
          ? { diaChiMoi: { tinh: order.province, huyen: order.district, xa: order.ward, chiTiet: order.addressDetail || order.address, he: order.district ? "ba-cap" : "hai-cap" } }
          : {})
      });
      if (saved.status !== 200) return saved;
      profileId = text(((saved.body as Record<string, unknown>)["khach"] as Record<string, unknown> | undefined)?.["ma"]);
      created = true;
    }
  } else {
    return refuse(422, "thieu_lua_chon", "Chọn một hồ sơ khách (maKhach) hoặc tạo hồ sơ mới (moi: true).");
  }
  await repository.updateHead({ id, patch: { extra: { customerProfileId: profileId } }, actor, note: `Duyệt khách: ${created ? "tạo hồ sơ mới" : "gắn hồ sơ"} ${profileId}`, at: ctx.ports.clock.now() });
  return { status: 200, headers: NO_STORE, body: { ok: true, maKhach: profileId, taoMoi: created, order: await readOrder(ctx, id) } };
}

/**
 * A new lookup secret for an order. The old one cannot be shown again (only its hash is stored), so
 * "Copy link tra cứu" mints a fresh one — and the old one stops working, which is what a seller wants
 * when the link went to the wrong person.
 */
export async function rotateLookupSecret(ctx: OrderContext, id: string, actor: string): Promise<ReplyDraft> {
  const repository = repositoryOf(ctx);
  const order = await repository.read(id);
  if (!order) return refuse(404, "khong_thay", "Không có đơn này.");
  const secret = createLookupSecret();
  const now = ctx.ports.clock.now();
  await repository.setLookupToken({ id, token: normalizeLookupSecret(secret), at: now });
  await repository.updateHead({ id, patch: {}, actor, note: "Cấp lại mã tra cứu (mã cũ hết hiệu lực)", at: now });
  const siteUrl = text(ctx.config.siteUrl || "https://toprun.site").replace(/\/+$/, "");
  return { status: 200, headers: NO_STORE, body: { ok: true, maDon: id, maBiMat: secret, duongTraCuu: `${siteUrl}/order-status.html?order=${encodeURIComponent(id)}` } };
}

/**
 * Puts an order in the bin and gives its pairs back to the shelf.
 *
 * This is what the Xoá button does now (16/09/2026). It used to remove the row for good: one
 * mis-click and a real customer's order, its lines and its whole history were gone. Sales Desk has
 * always kept a bin, and a seller who deletes the wrong order needs it back, not an apology.
 *
 * The stock goes back HERE rather than on the permanent delete, because the pairs stop being
 * spoken for the moment the order leaves the working list — the shop must be able to sell them
 * again straight away. Restoring takes them again; see `restoreOrder`.
 */
export async function deleteOrder(ctx: OrderContext, id: string, actor: string): Promise<ReplyDraft> {
  const repository = repositoryOf(ctx);
  const order = await repository.read(id);
  if (!order) return refuse(404, "khong_thay", "Không có đơn này.");
  // `false` = it was already in the bin. Returning the stock again would invent pairs.
  const moved = await repository.markSoftDeleted({ id, at: ctx.ports.clock.now() });
  if (!moved) return { status: 200, headers: NO_STORE, body: { ok: true, daXoa: false, maDon: id, viSao: "Đơn này đã ở thùng rác." } };
  await returnStock(ctx, id);
  ctx.ports.logger.info(`[don-khach] ${actor} xoá đơn ${id} (còn khôi phục được)`);
  return { status: 200, headers: NO_STORE, body: { ok: true, daXoa: true, maDon: id } };
}

/**
 * Takes an order back out of the bin and takes its pairs again.
 *
 * Stock may be gone — someone bought the last pair while the order sat in the bin. That does NOT
 * block the restore: the order comes back and the missing lines are named (`thieu`), exactly as a
 * manual order reports lines the catalogue never had. Refusing to restore an order over one line
 * of stock would leave the seller with nothing but a bin.
 */
export async function restoreOrder(ctx: OrderContext, id: string, actor: string): Promise<ReplyDraft> {
  const repository = repositoryOf(ctx);
  const order = await repository.read(id);
  if (!order) return refuse(404, "khong_thay", "Không có đơn này.");
  const back = await repository.markRestored({ id, at: ctx.ports.clock.now() });
  if (!back.ok) {
    return { status: 200, headers: NO_STORE, body: { ok: true, daKhoiPhuc: false, maDon: id, viSao: "Đơn này không ở thùng rác." } };
  }
  const lines = (order.items ?? []).map((m) => normaliseLine({
    productCode: m.productCode, variantId: m.variantId, productName: m.productName, size: m.size,
    qty: m.qty, price: m.price, saleFilePrice: m.saleFilePrice,
    source: m.source, sourceName: m.sourceName, warehouseId: m.warehouseId, warehouse: m.warehouseName, imageUrl: m.imageUrl
  })).filter((l): l is NormalisedLine => l !== null);
  const stock = lines.length > 0 ? await takeForOwner(ctx, id, lines) : { thieu: [] };
  ctx.ports.logger.info(`[don-khach] ${actor} khôi phục đơn ${id}${stock.thieu.length ? `, ${stock.thieu.length} dòng ngoài kho` : ""}`);
  return {
    status: 200, headers: NO_STORE,
    body: { ok: true, daKhoiPhuc: true, maDon: id, trangThai: back.status, order: await readOrder(ctx, id), stock: { ok: true, ...stock } }
  };
}

/**
 * Removes an order for good — row, lines and history.
 *
 * Only from the bin: emptying the bin is a decision about something already set aside, never a
 * second meaning for the Xoá button. The stock was returned when it went in, so nothing is
 * returned here.
 */
export async function purgeOrder(ctx: OrderContext, id: string, actor: string): Promise<ReplyDraft> {
  const repository = repositoryOf(ctx);
  const order = await repository.read(id);
  if (!order) return refuse(404, "khong_thay", "Không có đơn này.");
  if (!order.daXoa) return refuse(409, "chua_xoa_mem", "Xoá vĩnh viễn chỉ làm được với đơn đang ở thùng rác. Xoá đơn trước đã.");
  const removed = await repository.purge(id);
  ctx.ports.logger.info(`[don-khach] ${actor} xoá VĨNH VIỄN đơn ${id}`);
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
