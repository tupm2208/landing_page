"use strict";

const VTP_DEFAULT_BASE_URL = "https://partner.viettelpost.vn";
const VTP_PATHS = {
  login: "/v2/user/login-from-web",
  createOrder: "/v2/order/createOrderNlp",
  tracking: "/v2/order/getOrderByTrackingNumber",
  updateOrder: "/v2/order/UpdateOrder",
  printingCode: "/v2/order/printing-code"
};

function vtpBaseURL(config = {}) {
  return String(config.baseURL || VTP_DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
}

function vtpConfigMissingFields(config = {}) {
  if (String(config.token || "").trim()) return [];
  const missing = [];
  if (!String(config.username || "").trim()) missing.push("ViettelPost username");
  if (!String(config.password || "").trim()) missing.push("ViettelPost password");
  return missing;
}

function responseData(payload = {}) {
  return payload && payload.data !== undefined ? payload.data : payload;
}

function responseMessage(payload = {}, fallback = "") {
  return String(payload.message || payload.error || payload.data?.message || payload.data?.error || fallback || "").trim();
}

async function vtpRequest(config = {}, pathName = "", options = {}) {
  const endpoint = `${vtpBaseURL(config)}${pathName.startsWith("/") ? pathName : `/${pathName}`}`;
  const headers = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.token) headers.Token = options.token;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(endpoint, {
      method: options.method || (options.body !== undefined ? "POST" : "GET"),
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    const ok = response.ok
      && !payload.error
      && payload.status !== false
      && !(Number.isFinite(Number(payload.status)) && Number(payload.status) >= 400)
      && payload.success !== false
      && payload.ok !== false;
    return { ok, endpoint, data: responseData(payload), raw: payload, message: responseMessage(payload, ok ? "success" : `ViettelPost HTTP ${response.status}`) };
  } catch (error) {
    return { ok: false, endpoint, message: error?.name === "AbortError" ? "ViettelPost khong phan hoi (timeout)." : (error?.message || "Khong goi duoc ViettelPost API.") };
  } finally {
    clearTimeout(timeout);
  }
}

function vtpExtractToken(payload = {}) {
  const data = responseData(payload) || {};
  return String(data.token || data.TOKEN || payload.token || payload.TOKEN || "").trim();
}

async function vtpGetToken(config = {}) {
  const token = String(config.token || "").trim();
  if (token) return { ok: true, token };
  const missing = vtpConfigMissingFields(config);
  if (missing.length) return { ok: false, message: `Thieu cau hinh ViettelPost: ${missing.join(", ")}.` };
  const result = await vtpRequest(config, VTP_PATHS.login, { method: "POST", body: { USERNAME: config.username, PASSWORD: config.password } });
  const loggedToken = vtpExtractToken(result.raw || {});
  return loggedToken ? { ok: true, token: loggedToken } : { ok: false, message: result.message || "ViettelPost login khong tra token." };
}

async function vtpCreateOrder(config = {}, payload = {}) {
  const auth = await vtpGetToken(config);
  if (!auth.ok) return auth;
  return vtpRequest(config, VTP_PATHS.createOrder, { method: "POST", token: auth.token, body: payload });
}

function vtpExtractTrackingCode(payload = {}) {
  const data = responseData(payload) || {};
  return String(data.ORDER_NUMBER || data.orderNumber || data.trackingNumber || data.trackingCode || payload.ORDER_NUMBER || "").trim();
}

function vtpExtractFee(payload = {}) {
  const data = responseData(payload) || {};
  return Number(data.MONEY_TOTALFEE ?? data.moneyTotalFee ?? data.totalFee ?? data.fee ?? 0) || 0;
}

module.exports = { vtpConfigMissingFields, vtpCreateOrder, vtpExtractTrackingCode, vtpExtractFee };
