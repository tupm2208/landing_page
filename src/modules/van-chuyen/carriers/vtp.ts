/**
 * @file Viettel Post — the second carrier, for shops that do not use SPX.
 *
 * Ported from `viettelpost_shipping.js` + `viettelpost-portal-shipment.js`. Same rules as SPX:
 * no network calls of its own, no environment variables.
 *
 * Unlike SPX it must LOG IN for a token first. A token may be given in the config (the shop takes
 * it from the partner site) — then the login step is skipped.
 */

import {
  deliveryStateFromStatus, errorMessage, firstMoney, isAbortError, itemPrice, itemQuantity, slipItems, slipTotals,
  type Carrier, type CarrierAnswer, type CarrierDeps, type CreateShipmentResult, type LabelResult, type ShippingSlip, type TrackResult, type TrackSnapshot
} from "./carrier";

const DEFAULT_BASE_URL = "https://partner.viettelpost.vn";

export const VTP_PATHS = {
  login: "/v2/user/login-from-web",
  createOrder: "/v2/order/createOrderNlp",
  track: "/v2/order/getOrderByTrackingNumber",
  // Đ3 (17/09/2026), from Sales Desk's `viettelpost_shipping.js`: TYPE 4 = cancel; printing link.
  updateOrder: "/v2/order/UpdateOrder",
  printingCode: "/v2/order/printing-code"
} as const;

/** Viettel Post credentials. A `token` alone is enough; otherwise username + password. */
export interface VtpConfig {
  token?: string;
  username?: string;
  password?: string;
  /** Kept from the environment for a later pickup-address feature; not used by this version. */
  groupAddressId?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

/** The exact JSON Viettel Post expects. Field names are theirs. */
export interface VtpOrderPayload {
  ORDER_NUMBER: string;
  SENDER_FULLNAME: string;
  SENDER_PHONE: string;
  SENDER_ADDRESS: string;
  RECEIVER_FULLNAME: string;
  RECEIVER_PHONE: string;
  RECEIVER_ADDRESS: string;
  PRODUCT_NAME: string;
  PRODUCT_QUANTITY: number;
  PRODUCT_PRICE: number;
  PRODUCT_WEIGHT: number;
  MONEY_COLLECTION: number;
  ORDER_NOTE: string;
  ORDER_PAYMENT: number;
  ORDER_SERVICE: string;
  LIST_ITEM: { PRODUCT_NAME: string; PRODUCT_PRICE: number; PRODUCT_QUANTITY: number }[];
}

function text(v: unknown): string {
  return String(v || "").trim();
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? v as Record<string, unknown> : {};
}

function baseUrl(config: VtpConfig): string {
  return String(config.baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
}

/** Which credentials are missing. A ready token needs nothing else. */
export function missingVtpConfig(config: VtpConfig = {}): string[] {
  if (text(config.token)) return [];
  const missing: string[] = [];
  if (!text(config.username)) missing.push("ViettelPost username");
  if (!text(config.password)) missing.push("ViettelPost password");
  return missing;
}

/** Viettel Post wraps some answers in `data` and some not. */
function payloadOf(raw: Record<string, unknown>): Record<string, unknown> {
  return raw["data"] !== undefined ? asRecord(raw["data"]) : raw;
}

function messageOf(raw: Record<string, unknown>, fallback = ""): string {
  const data = asRecord(raw["data"]);
  return String(raw["message"] || raw["error"] || data["message"] || data["error"] || fallback || "").trim();
}

export function vtpTrackingUrl(trackingNumber = ""): string {
  return trackingNumber ? `https://viettelpost.com.vn/tra-cuu-hanh-trinh-don/?tracking=${encodeURIComponent(trackingNumber)}` : "";
}

/** The tracking number out of a create-order answer, under any of the names Viettel Post uses. */
export function extractTrackingNumber(raw: unknown): string {
  const r = asRecord(raw);
  const d = payloadOf(r);
  return text(d["ORDER_NUMBER"] || d["orderNumber"] || d["trackingNumber"] || d["trackingCode"] || r["ORDER_NUMBER"]);
}

/** The shipping fee out of a create-order answer. */
export function extractFee(raw: unknown): number {
  const d = payloadOf(asRecord(raw));
  return Number(d["MONEY_TOTALFEE"] ?? d["moneyTotalFee"] ?? d["totalFee"] ?? d["fee"] ?? 0) || 0;
}

function extractToken(raw: unknown): string {
  const r = asRecord(raw);
  const d = payloadOf(r);
  return text(d["token"] || d["TOKEN"] || r["token"] || r["TOKEN"]);
}

/** Builds the Viettel Post payload from the same normalised slip SPX uses. */
export function buildVtpPayload({ slip = {} }: { slip?: ShippingSlip }): VtpOrderPayload {
  const sender = slip.nguoiGui ?? {};
  const receiver = slip.nguoiNhan ?? {};
  const items = slipItems(slip);
  const { cod, declaredValue, weightKg, quantity } = slipTotals(slip);

  return {
    ORDER_NUMBER: String(slip.maPhieu || "").slice(0, 50),
    SENDER_FULLNAME: String(sender.ten || ""),
    SENDER_PHONE: String(sender.dienThoai || ""),
    SENDER_ADDRESS: [sender.diaChiChiTiet, sender.xa, sender.huyen, sender.tinh].filter(Boolean).join(", "),
    RECEIVER_FULLNAME: String(receiver.ten || ""),
    RECEIVER_PHONE: String(receiver.dienThoai || ""),
    RECEIVER_ADDRESS: text(receiver.diaChiDayDu)
      || [receiver.diaChiChiTiet, receiver.xa, receiver.huyen, receiver.tinh].filter(Boolean).join(", "),
    PRODUCT_NAME: String(slip.tenGoiHang || items[0]?.ten || "Hàng hoá").slice(0, 250),
    PRODUCT_QUANTITY: quantity,
    PRODUCT_PRICE: declaredValue,
    PRODUCT_WEIGHT: Math.max(100, Math.round((weightKg || 0) * 1000)),   // Viettel Post counts in grams
    MONEY_COLLECTION: cod,
    ORDER_NOTE: String(slip.danDo || "").slice(0, 250),
    ORDER_PAYMENT: String(slip.aiTraShip || "").toLowerCase() === "nguoi-gui" ? 1 : 2,
    ORDER_SERVICE: String(slip.dichVu || "VCN"),
    LIST_ITEM: items.map((m) => ({
      PRODUCT_NAME: String(m.ten || "").slice(0, 250),
      PRODUCT_PRICE: itemPrice(m),
      PRODUCT_QUANTITY: itemQuantity(m)
    }))
  };
}

interface VtpCallOptions {
  method?: string;
  token?: string;
  body?: unknown;
}

interface VtpCallResult {
  ok: boolean;
  url: string;
  data: unknown;
  raw: Record<string, unknown>;
  message: string;
}

/** Viettel Post as a carrier strategy. */
export class ViettelPostCarrier implements Carrier {
  readonly name = "vtp" as const;

  constructor(private readonly deps: CarrierDeps, private readonly config: VtpConfig = {}) {}

  /** One call to Viettel Post. Never throws. */
  private async call(path: string, options: VtpCallOptions = {}): Promise<VtpCallResult> {
    const url = `${baseUrl(this.config)}${path.startsWith("/") ? path : `/${path}`}`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.token) headers["Token"] = options.token;
    try {
      const response = await this.deps.http.fetch(url, {
        method: options.method || (options.body !== undefined ? "POST" : "GET"),
        timeoutMs: Number(this.config.timeoutMs || 20000),
        headers,
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
      });
      const raw = asRecord(await response.json().catch(() => ({})));
      // Viettel Post reports errors in several shapes depending on the endpoint — check all five.
      const status = raw["status"];
      const ok = response.ok
        && !raw["error"]
        && status !== false
        && !(Number.isFinite(Number(status)) && Number(status) >= 400)
        && raw["success"] !== false
        && raw["ok"] !== false;
      return { ok, url, data: payloadOf(raw), raw, message: messageOf(raw, ok ? "success" : `ViettelPost HTTP ${response.status}`) };
    } catch (e) {
      return {
        ok: false, url, data: null, raw: {},
        message: isAbortError(e) ? "ViettelPost không phản hồi (quá hạn chờ)." : errorMessage(e, "Không gọi được ViettelPost.")
      };
    }
  }

  /** The configured token, or one from logging in. */
  private async token(): Promise<{ ok: true; token: string } | { ok: false; message: string }> {
    const ready = text(this.config.token);
    if (ready) return { ok: true, token: ready };
    const missing = missingVtpConfig(this.config);
    if (missing.length) return { ok: false, message: `Thiếu cấu hình ViettelPost: ${missing.join(", ")}.` };
    const r = await this.call(VTP_PATHS.login, {
      method: "POST", body: { USERNAME: this.config.username, PASSWORD: this.config.password }
    });
    const token = extractToken(r.raw);
    return token ? { ok: true, token } : { ok: false, message: r.message || "ViettelPost đăng nhập không trả token." };
  }

  async createShipment(slip: ShippingSlip): Promise<CreateShipmentResult> {
    if (missingVtpConfig(this.config).length) return { daGoi: false, viSao: "vtp_chua_cau_hinh" };
    const login = await this.token();
    if (!login.ok) return { daGoi: true, ok: false, loiNhan: login.message };

    const r = await this.call(VTP_PATHS.createOrder, { method: "POST", token: login.token, body: buildVtpPayload({ slip }) });
    const trackingNumber = extractTrackingNumber(r.raw);
    if (!r.ok || !trackingNumber) return { daGoi: true, ok: false, loiNhan: r.message || "ViettelPost không trả mã vận đơn." };
    return {
      daGoi: true, ok: true, maVanDon: trackingNumber, duongTra: vtpTrackingUrl(trackingNumber),
      phiUocTinh: extractFee(r.raw), loiNhan: `Đã tạo vận đơn ViettelPost ${trackingNumber}.`
    };
  }

  async track(trackingNumber: string): Promise<TrackResult> {
    const login = await this.token();
    if (!login.ok) return { ok: false, loiNhan: login.message };
    const r = await this.call(`${VTP_PATHS.track}?orderNumber=${encodeURIComponent(trackingNumber)}`, { token: login.token });
    if (!r.ok) return { ok: false, loiNhan: r.message };
    return { ok: true, don: r.data ?? null, duongTra: vtpTrackingUrl(trackingNumber) };
  }

  /** Desk `vtpExtractStatus` + `vtpExtractFinance`. */
  readTrack(record: unknown): TrackSnapshot {
    const d = asRecord(record);
    const status = text(d["ORDER_STATUS_NAME"] || d["orderStatusName"] || d["STATUS_NAME"] || d["statusName"] || d["ORDER_STATUS"] || d["status"]);
    return {
      trangThai: status,
      trangThaiGiao: deliveryStateFromStatus(status),
      codDuKien: firstMoney(d, ["MONEY_COLLECTION", "moneyCollection", "COD_AMOUNT", "codAmount"]),
      codDaThu: firstMoney(d, ["MONEY_COLLECTION_ACTUAL", "moneyCollectionActual", "COD_COLLECTED_AMOUNT", "codCollectedAmount", "MONEY_COLLECTED", "moneyCollected"]),
      phi: firstMoney(d, ["MONEY_TOTALFEE", "moneyTotalFee", "TOTAL_FEE", "totalFee", "fee"])
    };
  }

  async cancel(trackingNumber: string): Promise<CarrierAnswer> {
    const login = await this.token();
    if (!login.ok) return { ok: false, loiNhan: login.message };
    const r = await this.call(VTP_PATHS.updateOrder, { method: "POST", token: login.token, body: { TYPE: 4, ORDER_NUMBER: text(trackingNumber) } });
    return r.ok ? { ok: true, loiNhan: `Đã huỷ vận đơn ViettelPost ${text(trackingNumber)}.` } : { ok: false, loiNhan: `ViettelPost không huỷ được vận đơn: ${r.message}` };
  }

  async label(trackingNumber: string): Promise<LabelResult> {
    const login = await this.token();
    if (!login.ok) return { ok: false, loiNhan: login.message };
    const r = await this.call(VTP_PATHS.printingCode, { method: "POST", token: login.token, body: { TYPE: 1, ORDER_ARRAY: [text(trackingNumber)] } });
    if (!r.ok) return { ok: false, loiNhan: `ViettelPost không trả phiếu in: ${r.message}` };
    const data: unknown = r.raw["data"];
    const link = typeof data === "string" ? data.trim() : text(asRecord(data)["url"] || asRecord(data)["URL"] || asRecord(data)["link"] || asRecord(data)["file"]);
    return link ? { ok: true, duongDan: link, loiNhan: "Đã lấy phiếu in ViettelPost." } : { ok: false, loiNhan: "ViettelPost không trả link phiếu in." };
  }

  async verify(): Promise<CarrierAnswer> {
    const login = await this.token();
    return login.ok ? { ok: true, loiNhan: "Kết nối ViettelPost OK: đăng nhập được." } : { ok: false, loiNhan: login.message };
  }
}
