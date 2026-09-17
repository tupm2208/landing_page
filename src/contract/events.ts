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
  paymentRefunded: "tien-doi-soat.da-hoan",
  stockOut: "hang-kho.het-hang",
  stockBack: "hang-kho.ve-lai",
  /** Một đối tác vừa báo đã mua một dòng đơn. Đơn hàng nghe để khoá kho của dòng đó. */
  purchaseReported: "mua-ho.da-mua",
  /**
   * Một đối tác báo KHÔNG mua được một dòng đơn (hết hàng ở chỗ họ). Khác `stockOut` của kho:
   * đây là một dòng đơn cần tìm nguồn khác, không phải một biến thể trong danh mục hết tồn.
   */
  partnerStockOut: "mua-ho.bao-het",
  shipmentCreated: "van-chuyen.da-tao-van-don",
  shipmentStatusChanged: "van-chuyen.doi-trang-thai",
  messageIn: "hop-thu.tin-den",
  messageOut: "hop-thu.tin-di",
  /** Đ10: a person the shop listed (`lenh_ton_zalo`) wrote in Zalo — maybe a stock command (tồn / hết / hoàn). Not for the bot. */
  stockCommand: "hop-thu.lenh-ton"
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
