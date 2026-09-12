// Tao van don SPX TRUC TIEP tu landing cho yeu cau o portal doi tac — khong phu thuoc
// Sales Desk dang bat hay tat. Port thu gon tu Sales Desk server.js (buildSpxApiOrderPayload
// + createSpxShipments + convertLegacyAddressToTwoTier) ngay 2026-08-06.
// QUY TAC DONG BO: logic payload SPX ton tai o 2 noi (Desk + landing/dasbui); sua mot ben
// thi phai sua ben kia cung dot.
//
// Khac biet co chu dich so voi ban Desk:
// - Dia chi (nguoi nhan + kho lay hang) CHI dung truong co cau truc tren ban ghi
//   (khong parse chuoi tu do bang dataset nhu Desk). Thieu cap nao -> tra ve
//   attempted:false de server day yeu cau vao hang doi cho Desk xu ly voi parser day du.
// - Khoi luong: khong co bang loai san pham -> mac dinh giay 0.75kg/doi (shop ban giay).

const fs = require("fs");
const path = require("path");
const { spxCreateOrders, spxGetPickupTime, spxConfigMissingFields } = require("./spx_shipping");

const ADDRESS_MERGE_MAP_PATH = path.join(__dirname, "data", "address-merge-map-2025.json");
const addressMergeMapCache = { mtimeMs: 0, index: null, version: "" };

// ===== Chuyen dia chi 3 cap (he cu) -> 2 cap (he 2025) — port nguyen ban tu Desk =====

function normalizeMergeText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripMergePrefix(normalized = "") {
  return String(normalized || "").replace(/^(tinh|thanh pho|tp|quan|huyen|thi xa|phuong|xa|thi tran|dac khu)\s+/, "").trim();
}

const MERGE_TEXT_ALIASES = { "thua thien hue": "hue" };

function mergeTextKeys(value = "") {
  const base = normalizeMergeText(value);
  if (!base) return [""];
  const keys = [base];
  const stripped = stripMergePrefix(base);
  if (stripped && stripped !== base) keys.push(stripped);
  for (const key of keys.slice()) {
    const alias = MERGE_TEXT_ALIASES[key];
    if (alias && !keys.includes(alias)) keys.push(alias);
  }
  return keys;
}

const MERGE_DISTRICT_ALIASES = {
  "quan 2": "thu duc",
  "quan 9": "thu duc",
  "quan thu duc": "thu duc",
  "thi xa cua lo": "vinh",
  "cua lo": "vinh"
};

function readAddressMergeMapIndex() {
  try {
    if (!fs.existsSync(ADDRESS_MERGE_MAP_PATH)) return null;
    const stats = fs.statSync(ADDRESS_MERGE_MAP_PATH);
    if (addressMergeMapCache.index && addressMergeMapCache.mtimeMs === stats.mtimeMs) {
      return addressMergeMapCache.index;
    }
    const raw = JSON.parse(fs.readFileSync(ADDRESS_MERGE_MAP_PATH, "utf8"));
    const index = new Map();
    for (const entry of Array.isArray(raw.entries) ? raw.entries : []) {
      for (const provinceKey of mergeTextKeys(entry.oldProvince)) {
        for (const districtKey of mergeTextKeys(entry.oldDistrict)) {
          for (const wardKey of mergeTextKeys(entry.oldWard)) {
            const key = `${stripMergePrefix(provinceKey)}|${stripMergePrefix(districtKey)}|${wardKey}`;
            if (!index.has(key)) index.set(key, entry);
          }
        }
      }
    }
    addressMergeMapCache.mtimeMs = stats.mtimeMs;
    addressMergeMapCache.index = index;
    addressMergeMapCache.version = String(raw.version || "");
    return index;
  } catch (_) {
    return null;
  }
}

function convertLegacyAddressToTwoTier(parts = {}) {
  const index = readAddressMergeMapIndex();
  if (!index) return { ok: false, reason: "merge_map_missing" };
  const provinceKeys = mergeTextKeys(parts.province).map(stripMergePrefix);
  const districtKeys = mergeTextKeys(parts.district).map(stripMergePrefix);
  for (const key of mergeTextKeys(parts.district)) {
    const alias = MERGE_DISTRICT_ALIASES[key];
    if (alias && !districtKeys.includes(alias)) districtKeys.push(alias);
  }
  const wardKeys = mergeTextKeys(parts.ward);
  let entry = null;
  for (const provinceKey of provinceKeys) {
    for (const districtKey of districtKeys) {
      for (const wardKey of wardKeys) {
        entry = index.get(`${provinceKey}|${districtKey}|${wardKey}`);
        if (entry) break;
      }
      if (entry) break;
    }
    if (entry) break;
  }
  if (!entry || !Array.isArray(entry.targets) || !entry.targets.length) {
    return { ok: false, reason: "not_mapped" };
  }
  const primary = entry.targets[0];
  return {
    ok: true,
    province: primary.province,
    ward: primary.ward,
    ambiguous: entry.targets.length > 1,
    alternatives: entry.targets,
    oldWard: entry.oldWard,
    version: addressMergeMapCache.version
  };
}

// ===== Cau hinh + tien ich =====

function envText(name = "") {
  return String(process.env[name] || "").trim();
}

function spxRuntimeConfig() {
  return {
    appId: envText("SPX_APP_ID"),
    appSecret: envText("SPX_APP_SECRET"),
    userId: envText("SPX_USER_ID"),
    userSecret: envText("SPX_SECRET_KEY"),
    environment: (envText("SPX_ENVIRONMENT") || "live").toLowerCase() === "test" ? "test" : "live",
    baseURL: envText("SPX_BASE_URL"),
    collectType: Number(envText("SPX_COLLECT_TYPE") || 1) === 2 ? 2 : 1
  };
}

function isSpxConfigured() {
  return spxConfigMissingFields(spxRuntimeConfig()).length === 0;
}

function spxTrackingUrl(trackingCode = "") {
  const code = String(trackingCode || "").trim();
  return code ? `https://spx.vn/track?${encodeURIComponent(code)}` : "";
}

function orderItems(order = {}) {
  if (Array.isArray(order.items) && order.items.length) return order.items;
  if (order.productCode || order.productName) {
    return [{
      productCode: order.productCode || "",
      productName: order.productName || "",
      size: order.size || "",
      quantity: order.quantity || order.qty || 1,
      price: order.price || 0
    }];
  }
  return [];
}

function itemWeightKg(item = {}) {
  const kindText = normalizeMergeText(item.productKind || item.productType || item.kind || item.category || "");
  const quantity = Math.max(1, Number(item.quantity || item.qty || 1));
  const isApparel = ["apparel", "clothing", "quan ao", "phu kien", "accessory", "accessories"].some((word) => kindText.includes(word));
  return (isApparel ? 0.2 : 0.75) * quantity;
}

function orderWeightKg(order = {}) {
  return orderItems(order).reduce((sum, item) => sum + itemWeightKg(item), 0);
}

function orderTotalQuantity(order = {}) {
  return orderItems(order).reduce((sum, item) => sum + Math.max(1, Number(item.quantity || item.qty || 1)), 0);
}

function orderProductValue(order = {}) {
  if (order.shippingProductValue !== undefined && order.shippingProductValue !== null) {
    return Math.max(0, Number(order.shippingProductValue || 0));
  }
  return orderItems(order).reduce((sum, item) => {
    const quantity = Math.max(1, Number(item.quantity || item.qty || 1));
    return sum + Math.max(0, Number(item.price || item.unitPrice || 0)) * quantity;
  }, 0);
}

function orderPaidAmount(order = {}) {
  const value = order.paidAmount ?? order.paymentAmount ?? order.paymentReceivedAmount ?? 0;
  return Math.max(0, Number(value || 0));
}

function orderCodAmount(order = {}) {
  if (order.codAmount !== undefined && order.codAmount !== null) return Math.max(0, Number(order.codAmount || 0));
  if (order.remainingAmount !== undefined && order.remainingAmount !== null) return Math.max(0, Number(order.remainingAmount || 0));
  return Math.max(0, orderProductValue(order) - orderPaidAmount(order));
}

function shippingItemLabel(item = {}) {
  return [
    item.productCode || item.sku || "",
    item.productName || "",
    item.size ? `size ${item.size}` : ""
  ].filter(Boolean).join(" ") || "San pham";
}

function shippingProductName(order = {}) {
  return orderItems(order)
    .map((item) => [
      item.productCode || item.sku || "",
      item.productName || "",
      item.size ? `size ${item.size}` : "",
      `SL ${Math.max(1, Number(item.quantity || item.qty || 1))}`
    ].filter(Boolean).join(" "))
    .filter(Boolean)
    .join(", ");
}

// Ten nguoi gui in tren van don = thuong hieu site + chu cai dau ten partner
// (quy tac anh chot 2026-08-05, giong shippingSenderDisplayName ben Desk).
function senderDisplayName(partner = {}) {
  const brand = envText("SPX_SENDER_NAME") || "TopRun";
  const cleanedName = String(partner.name || "")
    .trim()
    .replace(/^partner[_-]?(wh[_-]?)?/i, "");
  const initial = cleanedName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^A-Za-z]/g, "")
    .charAt(0)
    .toUpperCase();
  return initial ? `${brand} ${initial}` : brand;
}

// Dia chi lay hang: CHI dung truong co cau truc cua partner (Address Kit nhap 3 cap).
function senderAddressParts(partner = {}) {
  return {
    province: String(partner.addressProvince || "").trim(),
    district: String(partner.addressDistrict || "").trim(),
    ward: String(partner.addressWard || "").trim(),
    addressDetail: String(partner.addressDetail || partner.address || "").trim()
  };
}

// Dia chi nhan: tin truong co cau truc tren don; don he 2 cap giu nguyen theo addressScheme.
function deliverAddressParts(order = {}) {
  const province = String(order.province || order.addressProvince || "").trim();
  const district = String(order.district || order.addressDistrict || "").trim();
  const ward = String(order.ward || order.addressWard || "").trim();
  const addressDetail = String(order.addressDetail || order.addressLine || "").trim();
  const fullAddress = String(order.address || "").trim();
  if (String(order.addressScheme || "") === "two_tier") {
    const full2 = fullAddress || [addressDetail, ward, province].filter(Boolean).join(", ");
    return { scheme: "two_tier", province, district: "", ward, addressDetail: addressDetail || full2, fullAddress: full2 };
  }
  return {
    scheme: "legacy",
    province,
    district,
    ward,
    addressDetail,
    fullAddress: fullAddress || [addressDetail, ward, district, province].filter(Boolean).join(", ")
  };
}

// ===== Payload SPX (giu dung cac quirk da thuc nghiem 2026-08-05 ben Desk) =====

function buildPortalSpxPayload({ order = {}, lineRef = "", partner = {} } = {}) {
  const address = deliverAddressParts(order);
  const senderParts = senderAddressParts(partner);
  const senderName = senderDisplayName(partner);
  const senderPhone = envText("SPX_SENDER_PHONE");
  const codAmount = Math.round(orderCodAmount(order));
  const productValue = Math.round(orderProductValue(order));
  // Don khong ghi nguoi tra ship truoc day roi ve payment_role 1 (shop chiu phi) du khong
  // ai chon. Chot 2026-08-25: TRONG = NGUOI NHAN TRA, chi "sender/shop" moi la shop tra.
  const payer = String(order.shippingPayer || order.shippingPaymentPayer || "").trim().toLowerCase();
  const paymentRole = ["sender", "shop", "seller", "nguoi_gui"].includes(payer) ? 1 : 2;
  const items = orderItems(order);
  const missing = [];
  if (!senderName) missing.push("ten nguoi gui");
  if (!senderPhone) missing.push("SDT nguoi gui (SPX_SENDER_PHONE)");
  if (!senderParts.province || !senderParts.district || !senderParts.ward) {
    missing.push("dia chi lay hang 3 cap cua doi tac");
  }
  // Guard hong font (dieu tra 2026-08-23, cung benh voi Desk): dia chi doi tac dinh
  // U+FFFD lam convertLegacyAddressToTwoTier tra fail -> roi ve he 3 cap cu -> SPX
  // -130002 "location not found" kho hieu. Chan som voi thong bao ro de goi dong bo lai.
  if ([senderParts.province, senderParts.district, senderParts.ward, senderParts.addressDetail]
    .some((part) => String(part || "").includes("\uFFFD"))) {
    missing.push("dia chi lay hang cua doi tac bi hong font (can dong bo lai tu Sales Desk)");
  }
  if (!String(order.customerName || order.customer || "").trim()) missing.push("ten khach nhan");
  if (!String(order.phone || "").trim()) missing.push("SDT khach nhan");
  const twoTierDeliver = address.scheme === "two_tier";
  if (twoTierDeliver) {
    if (!address.province || !address.ward) missing.push("dia chi nhan 2 cap tinh/phuong");
  } else if (!address.province || !address.district || !address.ward) {
    missing.push("dia chi nhan 3 cap tinh/quan/phuong");
  }
  if (!(address.addressDetail || address.fullAddress)) missing.push("dia chi chi tiet khach nhan");
  if (!items.length) missing.push("san pham trong don");
  const senderConversion = senderParts.province && senderParts.district && senderParts.ward
    ? convertLegacyAddressToTwoTier(senderParts)
    : { ok: false, reason: "sender_incomplete" };
  const senderTwoTier = Boolean(senderConversion.ok && !senderConversion.ambiguous);
  const deliverConversion = !twoTierDeliver && address.province && address.district && address.ward
    ? convertLegacyAddressToTwoTier(address)
    : null;
  const deliverTwoTier = twoTierDeliver || Boolean(deliverConversion && deliverConversion.ok && !deliverConversion.ambiguous);
  const deliverState = deliverTwoTier && !twoTierDeliver ? deliverConversion.province : address.province;
  const deliverWard = deliverTwoTier && !twoTierDeliver ? deliverConversion.ward : address.ward;
  const payload = {
    order_id: String(lineRef || order.id || "").slice(0, 32),
    base_info: { service_type: 1 },
    sender_info: {
      sender_name: senderName,
      sender_phone: senderPhone,
      sender_state: senderTwoTier ? senderConversion.province : senderParts.province,
      sender_city: senderTwoTier ? senderConversion.ward : senderParts.district,
      sender_district: senderTwoTier ? "" : senderParts.ward,
      sender_detail_address: (senderParts.addressDetail || "").slice(0, 256),
      // SPX address_version: 0 = he cu 3 cap, 2 = he moi 2 cap (gia tri 1 bi tu choi).
      sender_address_version: senderTwoTier ? 2 : 0
    },
    deliver_info: {
      deliver_name: String(order.customerName || order.customer || "").trim().slice(0, 64),
      deliver_phone: String(order.phone || "").trim(),
      deliver_state: deliverState,
      deliver_city: deliverTwoTier ? deliverWard : address.district,
      deliver_district: deliverTwoTier ? "" : address.ward,
      deliver_detail_address: (address.addressDetail || address.fullAddress || "").slice(0, 256),
      deliver_instruction: String(order.shippingNote || order.note || "").slice(0, 256),
      deliver_address_version: deliverTwoTier ? 2 : 0
    },
    fulfillment_info: {
      payment_role: paymentRole,
      cod_collection: codAmount > 0 ? 1 : 0,
      ...(codAmount > 0 ? { cod_amount: Math.min(codAmount, 20000000) } : {}),
      high_value_processing_collection: productValue >= 3000000 ? 1 : 0,
      collect_type: spxRuntimeConfig().collectType,
      // Chot 2026-09-03: mac dinh CHI cho xem hang (dong kiem), KHONG cho thu hang.
      allow_mutual_check: 1,
      allow_try_on: 0
    },
    parcel_info: {
      parcel_weight: Math.max(0.1, Math.round(orderWeightKg(order) * 100) / 100),
      parcel_item_name: (shippingProductName(order) || "Hang hoa TopRun").slice(0, 256),
      parcel_item_quantity: orderTotalQuantity(order),
      ...(productValue >= 3000000 ? { express_insured_value: Math.min(productValue, 20000000) } : {}),
      item_list: items.map((item) => ({
        item_name: shippingItemLabel(item).slice(0, 128),
        // SPX bat item_price kieu CHUOI (gui number bi loi unmarshal 11001).
        item_price: String(Math.max(0, Math.round(Number(item.price || item.unitPrice || 0)))),
        item_quantity: Math.max(1, Number(item.quantity || item.qty || 1))
      }))
    }
  };
  return { payload, missing, codAmount, productValue };
}

async function firstPickupSlot(config) {
  const result = await spxGetPickupTime(config, 1);
  if (!result.ok) return { ok: false, message: result.message };
  // Shape thuc te: [{date, pickup_time, slots: [{pickup_time_range_id, pickup_time_range}]}]
  const days = Array.isArray(result.data) ? result.data : [];
  for (const day of days) {
    const pickupTime = Number(day?.pickup_time || 0);
    const slots = Array.isArray(day?.slots) ? day.slots : [];
    const slot = slots.find((item) => item && item.pickup_time_range_id !== undefined);
    if (pickupTime && slot) {
      return {
        ok: true,
        pickupTime,
        timeRangeId: Number(slot.pickup_time_range_id),
        timeRange: String(slot.pickup_time_range || "")
      };
    }
  }
  return { ok: false, message: "SPX khong tra khung gio lay hang nao." };
}

function isOrderIdUsedMessage(message = "") {
  return /used already|has been used|da ton tai|đã tồn tại/i.test(String(message || ""));
}

// Ket qua:
// - { attempted:false, reason, missing? }  -> chua goi SPX (thieu cau hinh/du lieu), fallback hang doi Desk
// - { attempted:true, ok:true, trackingCode, trackingUrl, spxOrderId, estimatedFee, message }
// - { attempted:true, ok:false, message }  -> SPX tu choi that su, hien loi cho doi tac
async function createPortalShipment({ order = {}, lineRef = "", partner = {} } = {}) {
  const config = spxRuntimeConfig();
  if (spxConfigMissingFields(config).length) {
    return { attempted: false, reason: "spx_not_configured" };
  }
  const draft = buildPortalSpxPayload({ order, lineRef, partner });
  if (draft.missing.length) {
    return { attempted: false, reason: "payload_incomplete", missing: draft.missing };
  }
  if (config.collectType === 1) {
    const slot = await firstPickupSlot(config);
    if (!slot.ok) {
      return { attempted: true, ok: false, message: `Khong lay duoc khung gio SPX den lay hang: ${slot.message}` };
    }
    draft.payload.fulfillment_info.pickup_time = slot.pickupTime;
    draft.payload.fulfillment_info.pickup_time_range_id = slot.timeRangeId;
    if (slot.timeRange) draft.payload.fulfillment_info.pickup_time_range = slot.timeRange;
  }
  const baseOrderId = draft.payload.order_id;
  let lastMessage = "";
  // SPX khoa vinh vien order_id da nop (ke ca lan nop loi truoc do khong luu tracking)
  // -> tu dong thu lai voi hau to -R2/-R3 thay vi bat khach sua tay (su co ORD-1785739667173).
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const suffix = attempt === 1 ? "" : `-R${attempt}`;
    draft.payload.order_id = suffix
      ? `${baseOrderId.slice(0, 32 - suffix.length)}${suffix}`
      : baseOrderId;
    const result = await spxCreateOrders(config, [draft.payload]);
    const createdList = Array.isArray(result.data?.orders) ? result.data.orders : [];
    const failList = Array.isArray(result.data?.fail_list) ? result.data.fail_list : [];
    const created = createdList.find((entry) => String(entry.tracking_no || entry.trackingNo || "").trim());
    if (result.ok && created) {
      const trackingCode = String(created.tracking_no || created.trackingNo || "").trim();
      return {
        attempted: true,
        ok: true,
        trackingCode,
        trackingUrl: String(created.tracking_link || "").trim() || spxTrackingUrl(trackingCode),
        spxOrderId: String(created.order_id || draft.payload.order_id),
        estimatedFee: Number(created.estimated_shipping_fee ?? created.basic_shipping_fee ?? 0) || 0,
        codAmount: draft.codAmount,
        message: `Da tao van don SPX ${trackingCode}.`
      };
    }
    const failMessage = failList.map((entry) => String(entry.message || entry.reason || "")).filter(Boolean).join("; ");
    lastMessage = failMessage || result.message || "SPX khong tra ket qua tao van don.";
    if (!isOrderIdUsedMessage(lastMessage)) break;
  }
  return { attempted: true, ok: false, message: `SPX tu choi tao van don: ${lastMessage}` };
}

module.exports = {
  isSpxConfigured,
  createPortalShipment,
  buildPortalSpxPayload,
  convertLegacyAddressToTwoTier,
  spxTrackingUrl
};
