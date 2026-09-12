const crypto = require("crypto");

// SPX Express Open API client (VN).
// Spec: https://spx.vn/vi/integration — mọi request POST JSON, ký HMAC-SHA256:
//   check-sign = hex(HMAC_SHA256(app_secret, `${app_id}_${timestamp}_${random_num}_${body}`))
// Body được ký phải trùng từng byte với body gửi đi.

const SPX_LIVE_BASE_URL = "https://spx.vn";
const SPX_TEST_BASE_URL = "https://test-stable.spx.vn";

const SPX_PATHS = {
  verifyAccount: "/open/api/v1/account/verify",
  createOrder: "/open/api/v1/order/batch_create_order",
  searchOrder: "/open/api/v1/order/batch_search_order",
  cancelOrder: "/open/api/v1/order/batch_cancel_order",
  shippingLabel: "/open/api/v1/order/batch_get_shipping_label",
  checkOrder: "/open/api/v1/order/batch_check_order",
  pickupTime: "/open/api/v1/order/get_pickup_time"
};

function spxBaseURL(config = {}) {
  const override = String(config.baseURL || "").trim().replace(/\/+$/, "");
  if (override && /^https?:\/\//i.test(override)) return override;
  return String(config.environment || "").trim().toLowerCase() === "test" ? SPX_TEST_BASE_URL : SPX_LIVE_BASE_URL;
}

function spxConfigMissingFields(config = {}) {
  const missing = [];
  if (!String(config.appId || "").trim()) missing.push("SPX App ID");
  if (!String(config.appSecret || "").trim()) missing.push("SPX App Secret");
  if (!String(config.userId || "").trim()) missing.push("SPX User ID");
  if (!String(config.userSecret || "").trim()) missing.push("SPX Secret Key");
  return missing;
}

function spxUserIdValue(userId) {
  const text = String(userId || "").trim();
  return /^\d+$/.test(text) && text.length <= 16 ? Number(text) : text;
}

function spxCheckSign(appId, appSecret, timestamp, randomNum, payloadText) {
  const message = `${appId}_${timestamp}_${randomNum}_${payloadText}`;
  return crypto.createHmac("sha256", String(appSecret || "")).update(message, "utf8").digest("hex");
}

async function callSpxAPI(config = {}, pathName = "", body = {}) {
  const missing = spxConfigMissingFields(config);
  if (missing.length) {
    return { ok: false, error: "spx_not_configured", message: `Thiếu cấu hình SPX: ${missing.join(", ")}.` };
  }
  const appId = String(config.appId || "").trim();
  const payloadObject = {
    user_id: spxUserIdValue(config.userId),
    user_secret: String(config.userSecret || "").trim(),
    ...body
  };
  const payloadText = JSON.stringify(payloadObject);
  const timestamp = Math.floor(Date.now() / 1000);
  const randomNum = crypto.randomInt(1, 281474976710655);
  const endpoint = `${spxBaseURL(config)}${pathName.startsWith("/") ? pathName : `/${pathName}`}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(config.timeoutMs || 30000));
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "app-id": appId,
        "check-sign": spxCheckSign(appId, config.appSecret, timestamp, randomNum, payloadText),
        "timestamp": String(timestamp),
        "random-num": String(randomNum)
      },
      body: payloadText
    });
    const payload = await response.json().catch(() => ({}));
    const retCode = Number(payload?.ret_code ?? payload?.retcode ?? NaN);
    const ok = response.ok && retCode === 0;
    return {
      ok,
      endpoint,
      httpStatus: response.status,
      retCode: Number.isFinite(retCode) ? retCode : null,
      message: String(payload?.message || (ok ? "success" : `SPX HTTP ${response.status}`)),
      data: payload?.data ?? null,
      raw: payload
    };
  } catch (error) {
    return {
      ok: false,
      endpoint,
      error: "spx_request_failed",
      message: error?.name === "AbortError" ? "SPX không phản hồi (timeout)." : (error?.message || "Không gọi được SPX API.")
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function spxVerifyAccount(config = {}) {
  const result = await callSpxAPI(config, SPX_PATHS.verifyAccount, {});
  if (!result.ok) return result;
  const matched = Boolean(result.data?.match_result);
  return {
    ...result,
    ok: matched,
    matched,
    message: matched
      ? "Kết nối SPX OK: User ID và Secret Key hợp lệ."
      : "SPX phản hồi nhưng User ID/Secret Key không khớp. Kiểm tra lại 2 mã trong Hồ sơ Shop trên spx.vn."
  };
}

// orders: mảng order đã đúng schema SPX (base_info/sender_info/deliver_info/fulfillment_info/parcel_info)
async function spxCreateOrders(config = {}, orders = []) {
  return callSpxAPI(config, SPX_PATHS.createOrder, { orders });
}

// query: { trackingNos: [], orderIds: [] } — chỉ gửi một loại theo spec
async function spxSearchOrders(config = {}, query = {}) {
  const body = {};
  if (Array.isArray(query.trackingNos) && query.trackingNos.length) body.tracking_no_list = query.trackingNos;
  else if (Array.isArray(query.orderIds) && query.orderIds.length) body.order_id_list = query.orderIds;
  return callSpxAPI(config, SPX_PATHS.searchOrder, body);
}

async function spxCancelOrders(config = {}, trackingNos = []) {
  return callSpxAPI(config, SPX_PATHS.cancelOrder, { tracking_no_list: trackingNos });
}

async function spxGetShippingLabels(config = {}, trackingNos = []) {
  return callSpxAPI(config, SPX_PATHS.shippingLabel, { tracking_no_list: trackingNos });
}

async function spxCheckOrders(config = {}, orders = []) {
  return callSpxAPI(config, SPX_PATHS.checkOrder, { orders });
}

async function spxGetPickupTime(config = {}, serviceType = 1) {
  return callSpxAPI(config, SPX_PATHS.pickupTime, { service_type: Number(serviceType || 1) });
}

module.exports = {
  SPX_LIVE_BASE_URL,
  SPX_TEST_BASE_URL,
  SPX_PATHS,
  spxBaseURL,
  spxConfigMissingFields,
  spxCheckSign,
  callSpxAPI,
  spxVerifyAccount,
  spxCreateOrders,
  spxSearchOrders,
  spxCancelOrders,
  spxGetShippingLabels,
  spxCheckOrders,
  spxGetPickupTime
};
