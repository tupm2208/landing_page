/**
 * @file What SHIPPING tells an order (Đ3, 17/09/2026): a tracking number was created, a delivery
 * state changed. Orders learns it through the bus — it never calls the carrier itself.
 *
 * A slip reference is either the ORDER id (one parcel, the usual case → `tracking_code`,
 * `fulfillment_status` on the order) or a PARCEL id `<order>-NN` (a split order → one entry per
 * parcel in `shipping_shipments_json`). A parcel id is never an order in the book.
 */

import type { OrderContext } from "./context";
import { repositoryOf } from "./context";
import { recordShipment } from "./order-service";

const text = (v: unknown): string => String(v ?? "").trim();
const PARCEL_ID = /^(.+)-(\d{2})$/;

/** Order id + parcel id of a slip reference, when the order exists. `null` = neither an order nor a parcel of one. */
export async function resolveSlip(ctx: OrderContext, slipRef: string): Promise<{ orderId: string; parcelId: string } | null> {
  const ref = text(slipRef);
  if (ref === "") return null;
  const repository = repositoryOf(ctx);
  if (await repository.read(ref)) return { orderId: ref, parcelId: "" };
  const m = PARCEL_ID.exec(ref);
  if (m && m[1] && (await repository.read(m[1]))) return { orderId: m[1], parcelId: ref };
  return null;
}

export async function onShipmentCreated(ctx: OrderContext, input: { maPhieu: string; maVanDon: string; hang: string }): Promise<{ ok: boolean; reason?: string }> {
  const slip = await resolveSlip(ctx, input.maPhieu);
  if (slip === null) return { ok: false, reason: "khong_co_don" };
  if (slip.parcelId === "") return recordShipment(ctx, { id: slip.orderId, trackingCode: input.maVanDon, carrier: input.hang });
  const done = await repositoryOf(ctx).upsertParcelShipment({
    id: slip.orderId, entry: { maKien: slip.parcelId, maVanDon: text(input.maVanDon), hang: text(input.hang), trangThaiGiao: "shipping_created" },
    actor: "he-thong", note: `Kiện ${slip.parcelId}: đã tạo vận đơn ${text(input.maVanDon)}${input.hang ? ` (${text(input.hang)})` : ""}.`, at: ctx.ports.clock.now()
  });
  return done ? { ok: true } : { ok: false, reason: "khong_co_don" };
}

/** A carrier's new delivery state. Same state again = nothing written (the sync runs often). */
export async function onDeliveryState(ctx: OrderContext, input: { maPhieu: string; trangThaiGiao: string; trangThai?: string }): Promise<void> {
  const state = text(input.trangThaiGiao);
  const slip = await resolveSlip(ctx, input.maPhieu);
  if (slip === null || state === "") return;
  const repository = repositoryOf(ctx);
  const order = await repository.read(slip.orderId);
  if (!order) return;
  const at = ctx.ports.clock.now();
  const why = input.trangThai ? ` (${text(input.trangThai)})` : "";
  if (slip.parcelId === "") {
    if (order.fulfillmentStatus === state) return;
    await repository.updateHead({ id: slip.orderId, patch: { fulfillmentStatus: state }, actor: "van-chuyen", note: `Hãng báo: ${state}${why}`, at });
    return;
  }
  const current = order.vanDonKien.find((p) => p.maKien === slip.parcelId);
  if (current?.trangThaiGiao === state) return;
  await repository.upsertParcelShipment({ id: slip.orderId, entry: { maKien: slip.parcelId, trangThaiGiao: state }, actor: "van-chuyen", note: `Kiện ${slip.parcelId}: hãng báo ${state}${why}`, at });
}
