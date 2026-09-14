/**
 * @file Names of the events modules exchange over the in-process bus.
 *
 * A module NEVER calls another module's function; it emits one of these and whoever listens
 * reacts. The values follow `<module id>.<what happened>` so a log line says who emitted it.
 * Names are stable identifiers (they appear in logs and in manifests), so they stay as they were.
 */

export const EVENTS = {
  orderCreated: "don-khach.da-tao",
  orderStatusChanged: "don-khach.doi-trang-thai",
  orderCancelled: "don-khach.da-huy",
  paymentReceived: "tien-doi-soat.da-nhan",
  stockOut: "hang-kho.het-hang",
  stockBack: "hang-kho.ve-lai",
  shipmentCreated: "van-chuyen.da-tao-van-don",
  shipmentStatusChanged: "van-chuyen.doi-trang-thai",
  messageIn: "hop-thu.tin-den",
  messageOut: "hop-thu.tin-di"
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
