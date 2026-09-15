/**
 * @file The order services: place, change status, record payment, read, search, read by token.
 *
 * These are what the manifest publishes as `don-khach.*` and what the HTTP routes call. The
 * three rules of the module are enforced here and in the repository:
 *
 * 1. PLACING AN ORDER RESERVES STOCK FIRST. Writing an order without a reservation sells one pair
 *    of shoes to two people. Reservation goes through Inventory's service — this module never
 *    touches stock itself.
 * 2. WRITING AN ORDER IS ONE TRANSACTION (see `OrderRepository.insert`).
 * 3. EVERY MONEY NUMBER GOES THROUGH THE ORDER-MONEY KIT (see `orderFromRows`).
 */

import crypto from "node:crypto";
import { EVENTS } from "../../contract";
import { transferCode } from "../../shared/transfer-code";
import type { OrderContext, ReserveResult } from "./context";
import { repositoryOf } from "./context";
import {
  isDuplicateKeyError, normaliseLine, type CustomerProfile, type NormalisedLine, type Order, type OrderDraft, type SearchFilter,
  type StockTaken
} from "./order-repository";

const CANCELLED = "cancelled";

const text = (v: unknown): string => String(v ?? "").trim();

/**
 * The shop's transfer prefix, read the way the Money module reads it: page content first (the owner
 * edits it), then the environment, then "TR". The reference stamped when the order is placed must
 * equal the one Money writes when the customer picks how to pay, or the QR shows one code while
 * reconciliation looks for another.
 */
async function transferPrefixOf(ctx: OrderContext): Promise<string> {
  const read = ctx.services["khung-nen-tang"]?.moneySettings;
  if (read) {
    try {
      const fromPage = (await read())?.tienToChuyenKhoan;
      if (fromPage) return fromPage;
    } catch (e) {
      ctx.ports.logger.warn(`[don-khach] khong doc duoc tien to chuyen khoan: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return String(ctx.config?.transferPrefix || "TR");
}

/** Result of placing an order. `code`/`size` say which line ran out when `reason` is `het_hang`. */
export type PlaceResult =
  | { ok: true; id: string; token: string; total: number; paymentReference: string }
  | { ok: false; reason: "don_khong_co_mon" | "thieu_ten_khach" | "thieu_dien_thoai" | "het_hang"; code?: string; size?: string };

/** Result of a status or payment write. */
export type WriteOutcome = { ok: true } | { ok: false; reason: string };

/** A status change: which order, the new status, an optional note and who did it. */
export interface ChangeStatusInput {
  id: string;
  status: string;
  note?: string | undefined;
  /** Who did it: `"quan-tri"`, `"khach"`, `"he-thong"`... Goes into `actor_type`. */
  actor?: string | undefined;
}

/** Money fields to write on an order; `null`/absent fields are left untouched. */
export interface RecordPaymentInput {
  id: string;
  paymentMethod?: string | null | undefined;
  paymentStatus?: string | null | undefined;
  paymentAmount?: number | null | undefined;
  paymentReference?: string | null | undefined;
  note?: string | undefined;
}

/** One order by id, or null. */
export function readOrder(ctx: OrderContext, id: string): Promise<Order | null> {
  return repositoryOf(ctx).read(String(id || ""));
}

/** Orders newest first, filtered by status / phone / since; at most 500. */
export function searchOrders(ctx: OrderContext, filter: SearchFilter = {}): Promise<Order[]> {
  return repositoryOf(ctx).search(filter);
}

/** An order by id + the customer's lookup token — the public routes' only key. */
export function readByLookupToken(ctx: OrderContext, { id = "", token = "" }: { id?: string; token?: string } = {}): Promise<Order | null> {
  return repositoryOf(ctx).readByLookupToken(String(id || ""), String(token || ""));
}

/** The recipient profile as the storefront sends it; `address` falls back to the joined parts. */
function profileFromBody(body: Record<string, unknown>): CustomerProfile {
  const addressDetail = text(body["addressDetail"]);
  const ward = text(body["ward"]);
  const district = text(body["district"]);
  const province = text(body["province"]);
  return {
    customerName: text(body["customerName"]),
    phone: text(body["phone"]),
    email: text(body["email"]),
    address: text(body["address"] || [addressDetail, ward, district, province].filter(Boolean).join(", ")),
    province, district, ward, addressDetail,
    note: text(body["note"])
  };
}

/** A stock hold on one line: the ticket plus what it covers. */
export interface Hold { ticket: string; variantId: string; quantity: number }

export type HoldOutcome =
  | { ok: true; held: Hold[]; missing: { code: string; size: string }[] }
  | { ok: false; code: string; size: string };

/**
 * Reserves stock for lines, in order.
 *
 * `strict` (the storefront): the first line out of stock releases every earlier hold and fails.
 * Not strict (the owner's manual order): a line out of stock is kept WITHOUT a hold and reported
 * in `missing` — a partner's pair that is not in the catalogue is still a real sale.
 * `trustClientPrice`: keep a positive price sent by the caller (the OWNER, from OMI or Desk);
 * otherwise the price is the stock line's (the CUSTOMER can edit anything they send).
 */
export async function holdLines(ctx: OrderContext, lines: NormalisedLine[], opts: { strict: boolean; trustClientPrice: boolean }): Promise<HoldOutcome> {
  const inventory = ctx.services["hang-kho"];
  const held: Hold[] = [];
  const missing: { code: string; size: string }[] = [];
  for (const line of lines) {
    const r: ReserveResult = await inventory.reserve({ code: line.code, size: line.size, quantity: line.quantity, heldBy: "dat-don" });
    if (!r.ok) {
      if (opts.strict) {
        for (const h of held) await inventory.release({ ticket: h.ticket });
        return { ok: false, code: line.code, size: line.size };
      }
      missing.push({ code: line.code, size: line.size });
      continue;
    }
    if (!opts.trustClientPrice || !(line.unitPrice > 0)) line.unitPrice = Math.max(0, Number(r.price || 0));
    if (!line.variantId) line.variantId = r.variantId || "";
    if (!line.warehouseId) line.warehouseId = r.warehouseId || "";
    if (!line.size) line.size = r.size || "";
    held.push({ ticket: r.ticket, variantId: r.variantId || line.variantId, quantity: line.quantity });
  }
  return { ok: true, held, missing };
}

/** Turns holds into sales and returns what was taken (written on the order). A failed commit is logged, not fatal. */
export async function commitHolds(ctx: OrderContext, held: Hold[], orderId: string): Promise<StockTaken[]> {
  const taken: StockTaken[] = [];
  for (const hold of held) {
    const committed = await ctx.services["hang-kho"].commit({ ticket: hold.ticket });
    if (committed.ok) taken.push({ maBienThe: committed.variantId || hold.variantId, soLuong: hold.quantity });
    else ctx.ports.logger.warn(`[don-khach] khong chot duoc phieu giu cua don ${orderId}: ${committed.reason}`);
  }
  return taken;
}

/**
 * Places an order. Reserves stock FIRST, then writes the whole order in ONE transaction.
 * If the reservation succeeded but the write failed, the reservation is released — stock is
 * never left hanging.
 */
export async function placeOrder(ctx: OrderContext, rawBody: unknown): Promise<PlaceResult> {
  const body = (rawBody && typeof rawBody === "object" ? rawBody : {}) as Record<string, unknown>;
  const lines = (Array.isArray(body["items"]) ? body["items"] : []).map(normaliseLine).filter((l): l is NormalisedLine => l !== null);
  if (lines.length === 0) return { ok: false, reason: "don_khong_co_mon" };
  if (!text(body["customerName"])) return { ok: false, reason: "thieu_ten_khach" };
  if (!text(body["phone"])) return { ok: false, reason: "thieu_dien_thoai" };

  // RULE 1: reserve before writing.
  // AND: THE PRICE COMES FROM STOCK, NOT FROM THE CUSTOMER. The order route is public — the
  // customer can edit anything they send. Trusting the client's `price` sells a pair of shoes
  // for 1 dong. The right price is the price of the stock line just reserved, as Inventory returns it.
  const hold = await holdLines(ctx, lines, { trustClientPrice: false, strict: true });
  if (!hold.ok) return { ok: false, reason: "het_hang", code: hold.code, size: hold.size };
  const held = hold.held;
  const releaseAll = async (holds: Hold[]) => { for (const h of holds) await ctx.services["hang-kho"].release({ ticket: h.ticket }); };

  const placedAt = ctx.ports.clock.now();
  const lookupToken = crypto.randomBytes(16).toString("hex");
  const total = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const prefix = await transferPrefixOf(ctx);
  const draft: Omit<OrderDraft, "id"> = {
    lookupToken, total, lines, profile: profileFromBody(body), paymentMethod: text(body["paymentMethod"]), placedAt
  };

  // ORDER ID from the timestamp (`ORD-<milliseconds>`) — the exact shape of the running site,
  // because Sales Desk and Image Tool read it. But two customers ordering in the SAME millisecond
  // collide: the second write is refused. Rare but real, and when it happens an order is lost
  // without anyone noticing. The patch: on a duplicate id, bump the timestamp by 1 ms and write
  // again — the shape is unchanged, and it is the REAL write that decides, because MySQL itself
  // reports the duplicate key.
  const repository = repositoryOf(ctx);
  let id = "";
  let lastError: unknown = null;
  for (let step = 0; step < 50; step += 1) {
    id = `ORD-${placedAt.getTime() + step}`;
    try {
      // The transfer reference is part of the order from the first write, as on the old site: the
      // checkout popup shows it right away, before the customer picks how to pay.
      await repository.insert({ ...draft, id, paymentReference: transferCode(id, prefix) });
      lastError = null;
      break;
    } catch (e) {
      lastError = e;
      if (!isDuplicateKeyError(e)) break;
    }
  }
  if (lastError) {
    await releaseAll(held);
    ctx.ports.logger.warn(`[don-khach] ghi don hong, da tra lai cho giu: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    throw lastError;
  }

  // RULE 1, SECOND HALF: THE HOLD BECOMES A SALE. Until 14/09/2026 nothing did this — the
  // 30-minute hold expired and the sold pair showed up as available again ("Lỗ 1"). Every ticket
  // is committed now, and what was taken is written on the order so a cancellation can put it
  // back. A commit that fails is logged, not fatal: the order is real, the shelf is corrected by hand.
  const taken = await commitHolds(ctx, held, id);
  if (taken.length > 0) await repository.recordStockTaken({ id, lines: taken, at: placedAt });

  ctx.bus.emit(EVENTS.orderCreated, { maDon: id, tong: total, soMon: lines.length, dienThoai: text(body["phone"]) });
  return { ok: true, id, token: lookupToken, total, paymentReference: transferCode(id, prefix) };
}

/**
 * Puts the pairs of a cancelled order back on the shelf — ONCE, whichever path cancelled it
 * (the customer within 15 minutes, the owner from OMI, Sales Desk). The repository hands the
 * lines out only the first time; a repeated cancel returns nothing.
 */
export async function returnStock(ctx: OrderContext, id: string): Promise<void> {
  const taken = await repositoryOf(ctx).markStockRestored({ id, at: ctx.ports.clock.now() });
  if (taken === null) return;
  for (const line of taken) {
    const r = await ctx.services["hang-kho"].restock({ variantId: line.maBienThe, quantity: line.soLuong });
    if (!r.ok) ctx.ports.logger.warn(`[don-khach] khong tra lai duoc ton cho don ${id} (${line.maBienThe}): ${r.reason}`);
  }
  ctx.ports.logger.info(`[don-khach] don ${id} huy: tra lai ${taken.length} dong ton kho`);
}

/** Sets a new status, logs it and announces it on the bus. `khong_co_don` when the id is unknown. */
export async function changeStatus(ctx: OrderContext, { id, status, note = "", actor = "he-thong" }: ChangeStatusInput): Promise<WriteOutcome> {
  const changed = await repositoryOf(ctx).changeStatus({
    id: String(id || ""), status: String(status || ""), note: String(note || ""), actor: String(actor), at: ctx.ports.clock.now()
  });
  if (changed === 0) return { ok: false, reason: "khong_co_don" };
  ctx.bus.emit(EVENTS.orderStatusChanged, { maDon: id, trangThai: status, boi: actor });
  if (String(status).toLowerCase() === CANCELLED) {
    await returnStock(ctx, String(id));
    ctx.bus.emit(EVENTS.orderCancelled, { maDon: id, boi: actor });
  }
  return { ok: true };
}

/**
 * A shipment was created for an order: remember its tracking number.
 *
 * Shipping does not know what an order is, and only this module writes the orders table, so the
 * two meet on the bus. Before this, a waybill created from OMI existed at the carrier and nowhere
 * else: the order screen still showed "chưa có vận đơn" and the customer's status page could not
 * show the journey.
 *
 * It deliberately does NOT move the order to "shipped". Handing the parcel over is a separate,
 * human act — the same invariant that keeps an Excel export from marking orders shipped.
 */
export async function recordShipment(ctx: OrderContext, { id, trackingCode, carrier = "" }: { id: string; trackingCode: string; carrier?: string }): Promise<WriteOutcome> {
  const orderId = text(id);
  const code = text(trackingCode);
  if (orderId === "" || code === "") return { ok: false, reason: "thieu_ma_don_hoac_ma_van_don" };
  const changed = await repositoryOf(ctx).updateHead({
    id: orderId,
    patch: { trackingCode: code, ...(text(carrier) === "" ? {} : { shippingProvider: text(carrier) }) },
    actor: "he-thong",
    note: `Đã tạo vận đơn ${code}${text(carrier) ? ` (${text(carrier)})` : ""}.`,
    at: ctx.ports.clock.now()
  });
  if (changed === 0) return { ok: false, reason: "khong_co_don" };
  ctx.ports.logger.info(`[don-khach] don ${orderId} nhan ma van don ${code}`);
  return { ok: true };
}

/**
 * Writes MONEY fields onto an order. Only the orders module writes the orders table — every other
 * feature (Money & reconciliation included) comes through this door, so two places never edit one
 * order. Every write appends a log entry so later someone can tell who changed what.
 */
export async function recordPayment(ctx: OrderContext, input: RecordPaymentInput): Promise<WriteOutcome> {
  const id = String(input.id || "");
  if (!id) return { ok: false, reason: "thieu_ma_don" };
  const changed = await repositoryOf(ctx).recordPayment({
    id,
    patch: {
      paymentMethod: input.paymentMethod ?? null,
      paymentStatus: input.paymentStatus ?? null,
      paymentAmount: input.paymentAmount ?? null,
      paymentReference: input.paymentReference ?? null
    },
    logStatus: String(input.paymentStatus || input.paymentMethod || "tien"),
    note: String(input.note || ""),
    at: ctx.ports.clock.now()
  });
  if (changed === -1) return { ok: false, reason: "khong_co_gi_de_ghi" };
  return changed > 0 ? { ok: true } : { ok: false, reason: "khong_co_don" };
}
