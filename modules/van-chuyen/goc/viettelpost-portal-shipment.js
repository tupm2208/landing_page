"use strict";

const orderMoneyKit = require("./order-money-kit.js");
const { vtpConfigMissingFields, vtpCreateOrder, vtpExtractTrackingCode, vtpExtractFee } = require("./viettelpost_shipping");

function envText(name = "") {
  return String(process.env[name] || "").trim();
}

function runtimeConfig() {
  return {
    baseURL: envText("VIETTELPOST_BASE_URL") || "https://partner.viettelpost.vn",
    username: envText("VIETTELPOST_USERNAME"),
    password: envText("VIETTELPOST_PASSWORD"),
    token: envText("VIETTELPOST_TOKEN")
  };
}

function trackingUrl(code = "") {
  return code ? `https://viettelpost.com.vn/tra-cuu-hanh-trinh-don/?tracking=${encodeURIComponent(code)}` : "";
}

function items(order = {}) {
  if (Array.isArray(order.items) && order.items.length) return order.items;
  return order.productCode || order.productName ? [{ ...order, quantity: order.quantity || 1 }] : [];
}

function senderName(partner = {}) {
  const siteURL = envText("LANDING_SITE_BASE_URL").toLowerCase();
  const defaultBrand = siteURL.includes("dasbui") ? "Dasbui" : "TopRun";
  const brand = envText("VIETTELPOST_SENDER_NAME") || envText("SPX_SENDER_NAME") || defaultBrand;
  const initial = String(partner.name || "").replace(/^partner[_-]?(wh[_-]?)?/i, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z]/g, "").charAt(0).toUpperCase();
  return initial ? `${brand} ${initial}` : brand;
}

function buildPayload({ order = {}, lineRef = "", partner = {} } = {}) {
  const orderItems = items(order);
  const productValue = orderItems.reduce((sum, item) => sum + Math.max(0, Number(item.price || item.unitPrice || 0)) * Math.max(1, Number(item.quantity || item.qty || 1)), 0);
  const senderAddress = [partner.addressDetail, partner.addressWard, partner.addressDistrict, partner.addressProvince].filter(Boolean).join(", ") || partner.address || envText("VIETTELPOST_SENDER_ADDRESS");
  const receiverAddress = String(order.address || "").trim() || [order.addressDetail, order.addressWard || order.ward, order.addressDistrict || order.district, order.addressProvince || order.province].filter(Boolean).join(", ");
  const payload = {
    ORDER_NUMBER: String(lineRef || order.id || "").slice(0, 100),
    SENDER_FULLNAME: senderName(partner),
    SENDER_ADDRESS: senderAddress,
    SENDER_PHONE: envText("VIETTELPOST_SENDER_PHONE"),
    RECEIVER_FULLNAME: String(order.customerName || order.customer || "").trim(),
    RECEIVER_ADDRESS: receiverAddress,
    RECEIVER_PHONE: String(order.phone || "").trim(),
    PRODUCT_NAME: orderItems.map((item) => [item.productCode || item.sku, item.productName, item.size ? `size ${item.size}` : ""].filter(Boolean).join(" ")).join(", ") || `Hang hoa ${defaultBrand}`,
    PRODUCT_DESCRIPTION: String(order.shippingNote || order.note || "Cho xem hang khi nhan").slice(0, 500),
    PRODUCT_QUANTITY: orderItems.reduce((sum, item) => sum + Math.max(1, Number(item.quantity || item.qty || 1)), 0),
    PRODUCT_PRICE: productValue,
    PRODUCT_WEIGHT: Math.max(100, Math.round(orderItems.reduce((sum, item) => sum + Number(item.weight || 750) * Math.max(1, Number(item.quantity || item.qty || 1)), 0))),
    PRODUCT_LENGTH: Number(order.productLength || 0),
    PRODUCT_WIDTH: Number(order.productWidth || 0),
    PRODUCT_HEIGHT: Number(order.productHeight || 0),
    ORDER_PAYMENT: Number(order.shippingPaymentType || 3),
    ORDER_SERVICE: String(order.shippingService || "VCN"),
    ORDER_SERVICE_ADD: "",
    ORDER_NOTE: String(order.shippingNote || order.note || "Cho xem hang khi nhan").slice(0, 500),
    MONEY_COLLECTION: orderMoneyKit.codAmountForOrder({ ...order, total: order.total ?? productValue }),
    EXTRA_MONEY: Number(order.extraMoney || 0),
    PRODUCT_TYPE: "HH",
    CHECK_UNIQUE: true,
    LIST_ITEM: orderItems.map((item) => ({
      PRODUCT_NAME: item.productName || item.productCode || item.sku || "San pham",
      PRODUCT_PRICE: Number(item.price || item.unitPrice || 0),
      PRODUCT_WEIGHT: Number(item.weight || 750),
      PRODUCT_QUANTITY: Math.max(1, Number(item.quantity || item.qty || 1))
    }))
  };
  const missing = [];
  [["SENDER_FULLNAME", "ten nguoi gui"], ["SENDER_ADDRESS", "dia chi lay hang"], ["SENDER_PHONE", "SDT nguoi gui"], ["RECEIVER_FULLNAME", "ten khach nhan"], ["RECEIVER_ADDRESS", "dia chi khach nhan"], ["RECEIVER_PHONE", "SDT khach nhan"]].forEach(([key, label]) => {
    if (!String(payload[key] || "").trim()) missing.push(label);
  });
  if (!orderItems.length) missing.push("san pham trong don");
  return { payload, missing };
}

async function createPortalViettelPostShipment(input = {}) {
  const config = runtimeConfig();
  if (vtpConfigMissingFields(config).length) return { attempted: false, reason: "viettelpost_not_configured" };
  const draft = buildPayload(input);
  if (draft.missing.length) return { attempted: false, reason: "payload_incomplete", missing: draft.missing };
  const result = await vtpCreateOrder(config, draft.payload);
  const trackingCode = vtpExtractTrackingCode(result.raw || result.data || {});
  if (!result.ok || !trackingCode) return { attempted: true, ok: false, message: `ViettelPost tu choi tao van don: ${result.message || "khong tra ma van don"}` };
  return { attempted: true, ok: true, carrier: "viettel_post", trackingCode, trackingUrl: trackingUrl(trackingCode), estimatedFee: vtpExtractFee(result.raw || result.data || {}), message: `Da tao van don ViettelPost ${trackingCode}.` };
}

module.exports = { createPortalViettelPostShipment, buildPortalViettelPostPayload: buildPayload, viettelPostTrackingUrl: trackingUrl };
