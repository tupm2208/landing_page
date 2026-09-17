/**
 * @file SPX (Shopee Express): signing, calling, building the payload, creating a shipment.
 *
 * Ported from `spx-portal-shipment.js` + `spx_shipping.js` of the running site. Two differences:
 *   1. It never calls `fetch` and never reads `process.env` — it receives the HTTP port and its
 *      config. So a test runs the whole create path without calling SPX once.
 *   2. It receives a normalised SHIPPING SLIP, not an "order". Shipping must not know the shape of
 *      the shop's orders — that is the Orders module's business.
 *
 * EVERY QUIRK BELOW WAS PAID FOR. Changing any line needs a reason.
 * SYNC RULE: the SPX payload logic exists in TWO places (Sales Desk + here). Fix one, fix the other
 * in the same pass.
 */

import crypto from "node:crypto";
import { convertToTwoTier, hasBrokenFont } from "../address";
import {
  deliveryStateFromStatus, errorMessage, firstMoney, isAbortError, itemPrice, itemQuantity, slipItems, slipTotals,
  type Carrier, type CarrierAnswer, type CarrierDeps, type CreateShipmentResult, type LabelResult, type ShippingSlip, type TrackResult, type TrackSnapshot
} from "./carrier";

export const SPX_LIVE = "https://spx.vn";
export const SPX_SANDBOX = "https://test-stable.spx.vn";

export const SPX_PATHS = {
  verifyAccount: "/open/api/v1/shop/verify_account",
  createOrder: "/open/api/v1/order/create_order",
  searchOrder: "/open/api/v1/order/search_order",
  cancelOrder: "/open/api/v1/order/cancel_order",
  label: "/open/api/v1/order/shipping_label",
  pickupTime: "/open/api/v1/order/pickup_time",
  // Đ3 (17/09/2026): the BATCH doors Sales Desk calls in production today (`spx_shipping.js`) for
  // verify / cancel / label. Create and track keep the running site's doors above, which work.
  verify: "/open/api/v1/account/verify",
  batchCancel: "/open/api/v1/order/batch_cancel_order",
  batchLabel: "/open/api/v1/order/batch_get_shipping_label"
} as const;

/** SPX credentials and options. Everything optional: "not configured" is a state the carrier reports, not a crash. */
export interface SpxConfig {
  appId?: string;
  appSecret?: string;
  userId?: string;
  userSecret?: string;
  /** 1 = SPX comes to pick up (needs a pickup slot), 2 = the shop drops off. Default 2. */
  collectType?: number;
  /** Overrides the host entirely (must start with http). */
  baseUrl?: string;
  /** `"thu"` = the SPX sandbox host. */
  environment?: string;
  timeoutMs?: number;
}

/** The exact JSON SPX expects for one order. Field names are SPX's. */
export interface SpxOrderPayload {
  order_id: string;
  base_info: { service_type: number };
  sender_info: {
    sender_name: string;
    sender_phone: string;
    sender_state: string;
    sender_city: string;
    sender_district: string;
    sender_detail_address: string;
    sender_address_version: number;
  };
  deliver_info: {
    deliver_name: string;
    deliver_phone: string;
    deliver_state: string;
    deliver_city: string;
    deliver_district: string;
    deliver_detail_address: string;
    deliver_instruction: string;
    deliver_address_version: number;
  };
  fulfillment_info: {
    payment_role: number;
    cod_collection: number;
    cod_amount?: number;
    high_value_processing_collection: number;
    collect_type: number;
    allow_mutual_check: number;
    allow_try_on: number;
    pickup_time?: number;
    pickup_time_range_id?: number;
    pickup_time_range?: string;
  };
  parcel_info: {
    parcel_weight: number;
    parcel_item_name: string;
    parcel_item_quantity: number;
    express_insured_value?: number;
    item_list: { item_name: string; item_price: string; item_quantity: number }[];
  };
}

export interface SpxPayloadDraft {
  payload: SpxOrderPayload;
  /** Not empty = must NOT be sent yet. Vietnamese, shown to the seller. */
  thieu: string[];
  cod: number;
  declaredValue: number;
}

function text(v: unknown): string {
  return String(v || "").trim();
}

function baseUrl(config: SpxConfig): string {
  const set = text(config.baseUrl).replace(/\/+$/, "");
  if (set && /^https?:\/\//i.test(set)) return set;
  return text(config.environment).toLowerCase() === "thu" ? SPX_SANDBOX : SPX_LIVE;
}

/** Which SPX credentials are missing (Vietnamese labels, shown to the seller). */
export function missingSpxConfig(config: SpxConfig = {}): string[] {
  const missing: string[] = [];
  if (!text(config.appId)) missing.push("SPX App ID");
  if (!text(config.appSecret)) missing.push("SPX App Secret");
  if (!text(config.userId)) missing.push("SPX User ID");
  if (!text(config.userSecret)) missing.push("SPX Secret Key");
  return missing;
}

/** SPX takes `user_id` as a number when it is numeric and at most 16 digits; longer ids must go as a string. */
function userIdValue(userId: unknown): number | string {
  const s = text(userId);
  return /^\d+$/.test(s) && s.length <= 16 ? Number(s) : s;
}

/** The `check-sign` header: HMAC-SHA256 over `appId_timestamp_nonce_body`. */
export function signSpx(appId: string, appSecret: string | undefined, timestamp: number, nonce: number, body: string): string {
  return crypto.createHmac("sha256", String(appSecret || ""))
    .update(`${appId}_${timestamp}_${nonce}_${body}`, "utf8").digest("hex");
}

export function spxTrackingUrl(trackingNumber = ""): string {
  return trackingNumber ? `https://spx.vn/express/track?${new URLSearchParams({ spx_tn: trackingNumber })}` : "";
}

/** SPX locks an `order_id` forever once submitted — these messages mean "already used". */
export function isDuplicateOrderIdError(message = ""): boolean {
  return /used already|has been used|da ton tai|đã tồn tại/i.test(String(message || ""));
}

/**
 * Builds the SPX payload from a normalised slip.
 * `thieu` not empty = do not send. The address logic decides `address_version` per party.
 */
export function buildSpxPayload({ slip = {}, config = {} }: { slip?: ShippingSlip; config?: SpxConfig }): SpxPayloadDraft {
  const sender = slip.nguoiGui ?? {};
  const receiver = slip.nguoiNhan ?? {};
  const items = slipItems(slip);
  const thieu: string[] = [];

  if (!text(sender.ten)) thieu.push("tên người gửi");
  if (!text(sender.dienThoai)) thieu.push("số điện thoại người gửi");
  if (!sender.tinh || !sender.huyen || !sender.xa) thieu.push("địa chỉ lấy hàng đủ ba cấp");
  // A broken-font address misses the conversion table -> falls back to the three-tier system ->
  // SPX answers "location not found", which nobody understands. Stop early with a clear message
  // (investigated 23/08/2026).
  if (hasBrokenFont(sender.tinh, sender.huyen, sender.xa, sender.diaChiChiTiet)) {
    thieu.push("địa chỉ lấy hàng bị hỏng font — cần đồng bộ lại");
  }
  if (!text(receiver.ten)) thieu.push("tên khách nhận");
  if (!text(receiver.dienThoai)) thieu.push("số điện thoại khách nhận");

  const receiverTwoTier = String(receiver.heDiaChi || "") === "2-cap";
  if (receiverTwoTier) {
    if (!receiver.tinh || !receiver.xa) thieu.push("địa chỉ nhận hai cấp tỉnh/phường");
  } else if (!receiver.tinh || !receiver.huyen || !receiver.xa) {
    thieu.push("địa chỉ nhận ba cấp tỉnh/quận/phường");
  }
  if (!(receiver.diaChiChiTiet || receiver.diaChiDayDu)) thieu.push("địa chỉ chi tiết của khách nhận");
  if (items.length === 0) thieu.push("sản phẩm trong đơn");

  const senderConversion = (sender.tinh && sender.huyen && sender.xa)
    ? convertToTwoTier({ tinh: sender.tinh, huyen: sender.huyen, xa: sender.xa })
    : null;
  // An ambiguous conversion (old ward split in two) is NOT used: guessing could deliver to the
  // wrong district. When unsure, send the old three-tier address — SPX still accepts it.
  const senderTwoTier = senderConversion?.ok === true && !senderConversion.ambiguous ? senderConversion : null;

  const receiverConversion = (!receiverTwoTier && receiver.tinh && receiver.huyen && receiver.xa)
    ? convertToTwoTier({ tinh: receiver.tinh, huyen: receiver.huyen, xa: receiver.xa })
    : null;
  const receiverConverted = receiverConversion?.ok === true && !receiverConversion.ambiguous ? receiverConversion : null;
  const receiverNormalised = receiverTwoTier || receiverConverted !== null;
  const receiverProvince = receiverConverted ? receiverConverted.province : receiver.tinh;
  const receiverWard = receiverConverted ? receiverConverted.ward : receiver.xa;

  const { cod, declaredValue, weightKg } = slipTotals(slip);
  // Decided 25/08/2026: BLANK = THE RECEIVER PAYS. Before, an order without a payer fell to 1
  // (the shop pays) although nobody chose it — the shop lost money for nothing.
  const payer = text(slip.aiTraShip).toLowerCase();
  const paymentRole = ["nguoi-gui", "sender", "shop", "seller"].includes(payer) ? 1 : 2;

  const payload: SpxOrderPayload = {
    order_id: String(slip.maPhieu || "").slice(0, 32),
    base_info: { service_type: 1 },
    sender_info: {
      sender_name: String(sender.ten || "").slice(0, 64),
      sender_phone: text(sender.dienThoai),
      sender_state: senderTwoTier ? senderTwoTier.province : String(sender.tinh ?? ""),
      sender_city: senderTwoTier ? senderTwoTier.ward : String(sender.huyen ?? ""),
      sender_district: senderTwoTier ? "" : String(sender.xa ?? ""),
      sender_detail_address: String(sender.diaChiChiTiet || "").slice(0, 256),
      // 0 = old three-tier system, 2 = new two-tier system. The value 1 IS REFUSED BY SPX.
      sender_address_version: senderTwoTier ? 2 : 0
    },
    deliver_info: {
      deliver_name: text(receiver.ten).slice(0, 64),
      deliver_phone: text(receiver.dienThoai),
      deliver_state: String(receiverProvince ?? ""),
      deliver_city: receiverNormalised ? String(receiverWard ?? "") : String(receiver.huyen ?? ""),
      deliver_district: receiverNormalised ? "" : String(receiver.xa ?? ""),
      deliver_detail_address: String(receiver.diaChiChiTiet || receiver.diaChiDayDu || "").slice(0, 256),
      deliver_instruction: String(slip.danDo || "").slice(0, 256),
      deliver_address_version: receiverNormalised ? 2 : 0
    },
    fulfillment_info: {
      payment_role: paymentRole,
      cod_collection: cod > 0 ? 1 : 0,
      ...(cod > 0 ? { cod_amount: Math.min(cod, 20000000) } : {}),
      high_value_processing_collection: declaredValue >= 3000000 ? 1 : 0,
      collect_type: Number(config.collectType || 2),
      // Decided 03/09/2026: by default the customer may INSPECT the parcel, NOT try the goods on.
      allow_mutual_check: 1,
      allow_try_on: 0
    },
    parcel_info: {
      parcel_weight: Math.max(0.1, Math.round((weightKg || 0) * 100) / 100),
      parcel_item_name: String(slip.tenGoiHang || items[0]?.ten || "Hàng hoá").slice(0, 256),
      parcel_item_quantity: items.reduce((t, m) => t + itemQuantity(m), 0),
      ...(declaredValue >= 3000000 ? { express_insured_value: Math.min(declaredValue, 20000000) } : {}),
      item_list: items.map((m) => ({
        item_name: String(m.ten || "").slice(0, 128),
        // SPX REQUIRES item_price as a STRING. A number fails with unmarshal error 11001.
        item_price: String(itemPrice(m)),
        item_quantity: itemQuantity(m)
      }))
    }
  };

  return { payload, thieu, cod, declaredValue };
}

interface SpxCallResult {
  ok: boolean;
  url: string;
  httpStatus?: number;
  retCode?: number | null;
  message: string;
  data: unknown;
  raw?: unknown;
  error?: string;
}

interface SpxEnvelope {
  ret_code?: unknown;
  retcode?: unknown;
  message?: unknown;
  data?: unknown;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? v as Record<string, unknown> : {};
}

/** SPX as a carrier strategy. Stateless apart from its dependencies; one instance per call is fine. */
export class SpxCarrier implements Carrier {
  readonly name = "spx" as const;

  constructor(private readonly deps: CarrierDeps, private readonly config: SpxConfig = {}) {}

  /** One signed POST to SPX. Never throws: a network failure is a result the seller can read. */
  private async call(path: string, body: Record<string, unknown> = {}): Promise<SpxCallResult> {
    const missing = missingSpxConfig(this.config);
    const url = `${baseUrl(this.config)}${path.startsWith("/") ? path : `/${path}`}`;
    if (missing.length) return { ok: false, url, error: "spx_chua_cau_hinh", message: `Thiếu cấu hình SPX: ${missing.join(", ")}.`, data: null };

    const appId = text(this.config.appId);
    const envelope = { user_id: userIdValue(this.config.userId), user_secret: text(this.config.userSecret), ...body };
    const bodyText = JSON.stringify(envelope);
    const timestamp = Math.floor(this.deps.clock.now().getTime() / 1000);
    const nonce = crypto.randomInt(1, 281474976710655);

    try {
      const response = await this.deps.http.fetch(url, {
        method: "POST",
        timeoutMs: Number(this.config.timeoutMs || 30000),
        headers: {
          "Content-Type": "application/json",
          "app-id": appId,
          "check-sign": signSpx(appId, this.config.appSecret, timestamp, nonce, bodyText),
          "timestamp": String(timestamp),
          "random-num": String(nonce)
        },
        body: bodyText
      });
      const raw = asRecord(await response.json().catch(() => ({}))) as SpxEnvelope;
      const retCode = Number(raw.ret_code ?? raw.retcode ?? NaN);
      const ok = response.ok && retCode === 0;
      return {
        ok, url, httpStatus: response.status,
        retCode: Number.isFinite(retCode) ? retCode : null,
        message: String(raw.message || (ok ? "success" : `SPX HTTP ${response.status}`)),
        data: raw.data ?? null,
        raw
      };
    } catch (e) {
      return {
        ok: false, url, error: "spx_goi_that_bai", data: null,
        message: isAbortError(e) ? "SPX không phản hồi (quá hạn chờ)." : errorMessage(e, "Không gọi được SPX.")
      };
    }
  }

  /** The first pickup slot SPX offers — needed when SPX comes to collect (`collectType` 1). */
  private async firstPickupSlot(): Promise<{ ok: true; pickupTime: number; slotId: number; slot: string } | { ok: false; message: string }> {
    const r = await this.call(SPX_PATHS.pickupTime, { service_type: 1 });
    if (!r.ok) return { ok: false, message: r.message };
    const days = Array.isArray(r.data) ? r.data as unknown[] : [];
    for (const day of days) {
      const d = asRecord(day);
      const pickupTime = Number(d["pickup_time"] || 0);
      const slots = Array.isArray(d["slots"]) ? d["slots"] as unknown[] : [];
      const slot = slots.map(asRecord).find((x) => x["pickup_time_range_id"] !== undefined);
      if (pickupTime && slot) {
        return { ok: true, pickupTime, slotId: Number(slot["pickup_time_range_id"]), slot: String(slot["pickup_time_range"] || "") };
      }
    }
    return { ok: false, message: "SPX không trả khung giờ lấy hàng nào." };
  }

  async createShipment(slip: ShippingSlip): Promise<CreateShipmentResult> {
    if (missingSpxConfig(this.config).length) return { daGoi: false, viSao: "spx_chua_cau_hinh" };

    const draft = buildSpxPayload({ slip, config: this.config });
    if (draft.thieu.length) return { daGoi: false, viSao: "phieu_thieu", thieu: draft.thieu };

    if (Number(this.config.collectType || 2) === 1) {
      const slot = await this.firstPickupSlot();
      if (!slot.ok) return { daGoi: true, ok: false, loiNhan: `Không lấy được khung giờ SPX đến lấy hàng: ${slot.message}` };
      draft.payload.fulfillment_info.pickup_time = slot.pickupTime;
      draft.payload.fulfillment_info.pickup_time_range_id = slot.slotId;
      if (slot.slot) draft.payload.fulfillment_info.pickup_time_range = slot.slot;
    }

    const originalId = draft.payload.order_id;
    let lastError = "";
    // SPX locks an order_id FOREVER once submitted, even when that submission failed and no
    // tracking number was saved. Retry automatically with suffix -R2/-R3 instead of making the
    // seller edit by hand (incident ORD-1785739667173).
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const suffix = attempt === 1 ? "" : `-R${attempt}`;
      draft.payload.order_id = suffix ? `${originalId.slice(0, 32 - suffix.length)}${suffix}` : originalId;

      const r = await this.call(SPX_PATHS.createOrder, { orders: [draft.payload] });
      const data = asRecord(r.data);
      const orders = (Array.isArray(data["orders"]) ? data["orders"] as unknown[] : []).map(asRecord);
      const created = orders.find((d) => text(d["tracking_no"] || d["trackingNo"]));

      if (r.ok && created) {
        const trackingNumber = text(created["tracking_no"] || created["trackingNo"]);
        return {
          daGoi: true, ok: true, maVanDon: trackingNumber,
          duongTra: text(created["tracking_link"]) || spxTrackingUrl(trackingNumber),
          maDonSpx: String(created["order_id"] || draft.payload.order_id),
          phiUocTinh: Number(created["estimated_shipping_fee"] ?? created["basic_shipping_fee"] ?? 0) || 0,
          cod: draft.cod,
          loiNhan: `Đã tạo vận đơn SPX ${trackingNumber}.`
        };
      }
      const failures = (Array.isArray(data["fail_list"]) ? data["fail_list"] as unknown[] : [])
        .map(asRecord).map((d) => String(d["message"] || d["reason"] || "")).filter(Boolean).join("; ");
      lastError = failures || r.message || "SPX không trả kết quả tạo vận đơn.";
      if (!isDuplicateOrderIdError(lastError)) break;
    }
    return { daGoi: true, ok: false, loiNhan: `SPX từ chối tạo vận đơn: ${lastError}` };
  }

  async track(trackingNumber: string): Promise<TrackResult> {
    const r = await this.call(SPX_PATHS.searchOrder, { tracking_no_list: [String(trackingNumber || "")] });
    if (!r.ok) return { ok: false, loiNhan: r.message };
    const data = asRecord(r.data);
    const orders = Array.isArray(data["orders"]) ? data["orders"] as unknown[] : [];
    return { ok: true, don: orders[0] ?? null, duongTra: spxTrackingUrl(trackingNumber) };
  }

  /** Desk `spxExtractFinance` + the status text of `syncSpxTrackingFromAPI`. */
  readTrack(record: unknown): TrackSnapshot {
    const row = asRecord(record);
    const merged = { ...asRecord(row["fulfillment_info"] ?? row["fulfillmentInfo"]), ...asRecord(row["finance_info"] ?? row["financeInfo"]), ...row };
    const status = text(row["status"] || row["status_desc"] || row["tracking_status"]) || text(row["status_code"]);
    return {
      trangThai: status,
      trangThaiGiao: deliveryStateFromStatus(status),
      codDuKien: firstMoney(merged, ["cod_amount", "codAmount", "cod_collection_amount"]),
      codDaThu: firstMoney(merged, ["cod_collected_amount", "codCollectedAmount", "actual_cod_amount", "actualCodAmount", "collected_cod_amount", "collectedCodAmount"]),
      phi: firstMoney(merged, ["actual_shipping_fee", "actualShippingFee", "shipping_fee", "shippingFee", "total_shipping_fee", "totalShippingFee"])
    };
  }

  async cancel(trackingNumber: string): Promise<CarrierAnswer> {
    const tn = text(trackingNumber);
    const r = await this.call(SPX_PATHS.batchCancel, { tracking_no_list: [tn] });
    if (!r.ok) return { ok: false, loiNhan: `SPX không huỷ được vận đơn: ${r.message}` };
    const data = asRecord(r.data);
    const cancelled = (Array.isArray(data["tracking_no_list"]) ? data["tracking_no_list"] as unknown[] : []).map(text);
    if (cancelled.includes(tn)) return { ok: true, loiNhan: `Đã huỷ vận đơn SPX ${tn}.` };
    const reasons = (Array.isArray(data["fail_list"]) ? data["fail_list"] as unknown[] : []).map(asRecord)
      .map((f) => text(f["message"] || f["debug_msg"] || (f["ret_code"] !== undefined ? `ret_code ${String(f["ret_code"])}` : ""))).filter(Boolean);
    return { ok: false, loiNhan: reasons.join("; ") || "SPX từ chối huỷ vận đơn (chỉ huỷ được khi đơn còn chờ lấy hàng)." };
  }

  async label(trackingNumber: string): Promise<LabelResult> {
    const r = await this.call(SPX_PATHS.batchLabel, { tracking_no_list: [text(trackingNumber)] });
    if (!r.ok) return { ok: false, loiNhan: `SPX không trả phiếu gửi: ${r.message}` };
    const link = text(asRecord(r.data)["awb_link"]);
    return link ? { ok: true, duongDan: link, loiNhan: "Đã lấy phiếu gửi SPX." } : { ok: false, loiNhan: "SPX không trả link phiếu gửi (AWB)." };
  }

  async verify(): Promise<CarrierAnswer> {
    const missing = missingSpxConfig(this.config);
    if (missing.length) return { ok: false, loiNhan: `Thiếu cấu hình SPX: ${missing.join(", ")}.` };
    const r = await this.call(SPX_PATHS.verify, {});
    if (!r.ok) return { ok: false, loiNhan: `SPX không nhận: ${r.message}` };
    return asRecord(r.data)["match_result"]
      ? { ok: true, loiNhan: "Kết nối SPX OK: User ID và Secret Key hợp lệ." }
      : { ok: false, loiNhan: "SPX phản hồi nhưng User ID/Secret Key không khớp. Kiểm tra lại hai mã trong Hồ sơ Shop trên spx.vn." };
  }
}
