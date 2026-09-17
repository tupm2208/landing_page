/**
 * @file The public order door's two jobs around `placeOrder`: place ONCE per checkout form, and
 * refuse in the old site's words.
 *
 * Kept apart from `order-service.ts` because both belong to the HTTP door the storefront calls;
 * the `don-khach.place` service other modules use stays the plain `placeOrder`.
 */

import type { OrderContext } from "./context";
import { placeOrder, type PlaceResult } from "./order-service";

const text = (v: unknown): string => String(v ?? "").trim();

/** How long a repeated `clientOrderId` returns the order already placed — the old site's 10 minutes. */
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_REMEMBERED = 2000;

type Placed = Extract<PlaceResult, { ok: true }>;
type Refused = Extract<PlaceResult, { ok: false }>;
type Placement = { at: number; result: Promise<PlaceResult> };

/** Remembered placements per store — one store per kernel, so two kernels in one process never share. */
const placementsByStore = new WeakMap<object, Map<string, Placement>>();

/**
 * Places an order once per `clientOrderId`. Every checkout form carries one (app.js, product.js,
 * mobile-v1.js, m-order.js); a customer who presses again after a network error gets the SAME order
 * back instead of a second order holding the stock twice (old site, fix of 01/08/2026). Kept in
 * memory: the orders table has no column for it, and a retry reaches the same process within seconds.
 */
export async function placeOrderOnce(ctx: OrderContext, rawBody: unknown, headers: Record<string, string | undefined> = {}): Promise<(Placed & { duplicate?: true }) | Refused> {
  const body = (rawBody && typeof rawBody === "object" ? rawBody : {}) as Record<string, unknown>;
  const key = text(body["clientOrderId"]).slice(0, 64);
  if (!key) return placeOrder(ctx, rawBody, headers);

  const now = ctx.ports.clock.now().getTime();
  let placements = placementsByStore.get(ctx.ports.store);
  if (!placements) {
    placements = new Map();
    placementsByStore.set(ctx.ports.store, placements);
  }
  for (const [k, p] of placements) if (now - p.at > DUPLICATE_WINDOW_MS) placements.delete(k);

  const earlier = placements.get(key);
  if (earlier) {
    const settled = await earlier.result;
    if (settled.ok) return { ...settled, duplicate: true };
  }

  const result = placeOrder(ctx, rawBody, headers);
  const mine: Placement = { at: now, result };
  placements.set(key, mine);
  if (placements.size > MAX_REMEMBERED) {
    const oldest = placements.keys().next().value;
    if (oldest !== undefined) placements.delete(oldest);
  }
  // Forget only OUR entry: a refusal must not block the corrected retry, and must not erase a newer attempt.
  const forget = () => { if (placements.get(key) === mine) placements.delete(key); };
  try {
    const settled = await result;
    if (!settled.ok) forget();
    return settled;
  } catch (e) {
    forget();
    throw e;
  }
}

/** Messages of the old site's `invalid_order`, shown by the storefront as they are. */
const INVALID_ORDER_MESSAGES: Record<Exclude<Refused["reason"], "het_hang">, string> = {
  don_khong_co_mon: "Đơn hàng chưa có sản phẩm nào.",
  thieu_ten_khach: "Vui lòng nhập họ tên người nhận.",
  thieu_dien_thoai: "Vui lòng nhập số điện thoại người nhận."
};

/**
 * A refused order as the old site sent it: 409 `insufficient_stock` when a size ran out, 422
 * `invalid_order` for a missing name / phone / item, both with a Vietnamese `message`. The pages
 * show `message`, and m-order.js branches on 409 and on `invalid_order`. Until 15/09/2026 every
 * refusal was a 400 with a code the pages do not know, so the customer read "Chưa gửi được đơn"
 * instead of "hết size". `lyDo` keeps this build's precise reason.
 */
export function placeRefusal(result: Refused): { status: number; body: Record<string, unknown> } {
  if (result.reason === "het_hang") {
    const what = `${result.code || "đã chọn"}${result.size ? ` size ${result.size}` : ""}`;
    return {
      status: 409,
      body: {
        ok: false, error: "insufficient_stock", message: `Sản phẩm ${what} không còn đủ tồn.`,
        shortage: { productCode: result.code ?? "", size: result.size ?? "" }, lyDo: result.reason
      }
    };
  }
  return { status: 422, body: { ok: false, error: "invalid_order", message: INVALID_ORDER_MESSAGES[result.reason], lyDo: result.reason } };
}
