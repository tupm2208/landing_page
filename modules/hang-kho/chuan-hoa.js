// CHUAN HOA HANG HOA — port nguyen ban tu `server.js`.
//
// Hai hinh dang cua mot mon hang, va KHONG duoc lan lon:
//   - BAN TRONG NHA (`chuanHoaMon`): co gia von, ton tung kho, thu tu uu tien kho.
//   - BAN CONG KHAI (`banCongKhai`): bo het thu tren. Day la ban duy nhat duoc ra khoi may.
//
// LUAT SO 1 cua tep nay: gia von va ton thuc te KHONG bao gio duoc chui vao ban cong khai.
// Ban cong khai chi noi "con" hay "het" (qty 1 hoac 0), khong noi con MAY DOI — doi thu
// biet ton chinh xac cua shop la biet ho ban duoc bao nhieu.
//
// LUAT SO 2: khong noi TEN KHO cho khach. Kho duoc rut thanh nhan ngan (TR, Y, CD...) —
// anh Dung nhac 10/09: cau gui khach cam kem ten kho hay ten doi tac.

"use strict";

const crypto = require("crypto");

function soDuongDauTien(...cacGiaTri) {
  for (const g of cacGiaTri) {
    const n = Number(g || 0);
    if (n > 0) return n;
  }
  return 0;
}

function khoaKho(giaTri = "") {
  return String(giaTri || "")
    .trim().toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Nhan ngan cua kho de hien cho khach — KHONG phai ten kho that. */
function nhanKho(ma = "", ten = "") {
  const khoa = khoaKho(ma) || khoaKho(ten);
  if (/^wh_toprun(_|$)/.test(khoa)) return "TR";
  const daBiet = { wh_yen: "Y", wh_cau_dien: "CD", wh_phuong_thu: "PT", wh_toprun: "TR", wh_hang_td: "HTD" };
  if (daBiet[khoa]) return daBiet[khoa];
  const nguon = String(ten || ma || "").replace(/^wh_/i, "").replace(/_/g, " ").trim();
  const chuDau = nguon.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d")
    .split(/\s+/).map((p) => p[0]).join("").toUpperCase();
  return chuDau.slice(0, 3) || nguon.slice(0, 3).toUpperCase();
}

function danhSachChuoi(giaTri) {
  const ds = Array.isArray(giaTri) ? giaTri : String(giaTri || "").split(/[,\n]/);
  return [...new Set(ds.map((x) => String(x || "").trim()).filter(Boolean))];
}

function khongTrung(cacGiaTri = []) {
  const daThay = new Set();
  const ra = [];
  for (const g of Array.isArray(cacGiaTri) ? cacGiaTri : []) {
    const x = String(g || "").trim();
    const k = x.toLowerCase();
    if (!x || daThay.has(k)) continue;
    daThay.add(k);
    ra.push(x);
  }
  return ra;
}

/** Anh nhap lieu noi bo (thumbnail so sanh) khong duoc lo ra web. */
function laAnhNoiBo(giaTri = "") {
  const url = String(giaTri || "").trim().toLowerCase();
  if (!url) return true;
  if (/\/assets\/thumbnails\//.test(url) || /^assets\/thumbnails\//.test(url)) return true;
  if (/(^|[_/-])(thumb|thumbnail|compare|source-thumb|original-thumb)([_./-]|$)/i.test(url)) return true;
  return false;
}
const anhCongKhai = (g) => { const u = String(g || "").trim(); return u && !laAnhNoiBo(u) ? u : ""; };
const cacAnhCongKhai = (g) => danhSachChuoi(g).filter((u) => !laAnhNoiBo(u));

function banDoTon(giaTri) {
  if (!giaTri || typeof giaTri !== "object" || Array.isArray(giaTri)) return {};
  return Object.fromEntries(Object.entries(giaTri)
    .map(([k, sl]) => [String(k || "").trim(), Number(sl || 0)])
    .filter(([k, sl]) => k && Number.isFinite(sl) && sl > 0));
}

function thongTinKho(giaTri) {
  return (Array.isArray(giaTri) ? giaTri : []).map((x) => {
    if (!x || typeof x !== "object") return null;
    const id = String(x.id || "").trim();
    const ten = String(x.name || x.ten || "").trim();
    if (!id || !ten) return null;
    return { id, name: ten, active: x.active !== false };
  }).filter(Boolean);
}

function trangThaiMon(giaTri) {
  const t = String(giaTri || "").trim().toLowerCase();
  const an = ["hidden", "out_of_stock", "out-of-stock", "sold_out", "sold-out", "archived", "discontinued", "inactive"];
  return an.includes(t) ? "hidden" : "orderable";
}

function duongDanMon(giaTri, ma = "", ten = "") {
  const nguon = String(giaTri || `${ma} ${ten}` || ma || ten || "").trim();
  return nguon
    .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    || String(ma || "").trim().toLowerCase();
}

function maBienThe(mon = {}, dong = {}) {
  const daCo = String(dong.variantId || dong.variant_id || "").trim();
  if (daCo) return daCo;
  const dinhDanh = [
    mon.code || mon.productCode,
    dong.warehouseId || dong.warehouse_id || khoaKho(dong.warehouse || dong.warehouseName),
    dong.rawSize || dong.raw_size || dong.size
  ].map((g) => String(g || "").trim().toUpperCase()).join("|");
  return `var_${crypto.createHash("sha1").update(dinhDanh).digest("hex").slice(0, 16)}`;
}

/** Kho nao duoc uu tien lay hang truoc — so nho hon la uu tien cao hon. */
function thuTuKho(mon = {}, dong = {}) {
  const maDong = String(dong.warehouseId || khoaKho(dong.warehouse || dong.warehouseName)).trim();
  const tenDong = String(dong.warehouse || dong.warehouseName || "").trim();
  const khoa = [];
  for (const g of Array.isArray(mon.warehousePriorityIds) ? mon.warehousePriorityIds : []) khoa.push(String(g || "").trim());
  for (const g of Array.isArray(mon.warehousePriority) ? mon.warehousePriority : []) khoa.push(khoaKho(g));
  for (const m of Array.isArray(mon.warehouseMeta) ? mon.warehouseMeta : []) {
    khoa.push(String(m?.id || "").trim());
    khoa.push(khoaKho(m?.name));
  }
  const ungVien = [maDong, khoaKho(tenDong)].filter(Boolean);
  const i = khoa.filter(Boolean).findIndex((k) => ungVien.includes(k));
  return i >= 0 ? i : Number.MAX_SAFE_INTEGER;
}

/**
 * BAN TRONG NHA. Tra `null` khi thieu ma hoac ten — mon khong co ma thi khong ban duoc.
 *
 * Quirk giu nguyen: gia ban = gia NHO NHAT trong cac size (khach nhin thay "tu ... d").
 * Gia ban > gia niem yet la du lieu sai -> tu an mon di (`invalid_price_sale_gt_list`),
 * vi hien len la khach thay "giam gia" am.
 */
function chuanHoaMon(mon = {}) {
  const ma = String(mon.code || "").trim();
  const ten = String(mon.name || "").trim();
  if (!ma || !ten) return null;

  const cacSize = Array.isArray(mon.sizes) ? mon.sizes : [];
  const giaTheoSize = cacSize
    .map((s) => soDuongDauTien(s.suggestedPrice, s.salePrice, s.sellPrice, s.price))
    .filter((g) => g > 0);
  const gia = giaTheoSize.length ? Math.min(...giaTheoSize)
    : soDuongDauTien(mon.suggestedPrice, mon.salePrice, mon.sellPrice, mon.price);
  const giaNiemYet = soDuongDauTien(mon.listPrice, mon.originalPrice, mon.retailPrice, mon.marketPrice, mon.msrp);
  const giaSai = giaNiemYet > 0 && gia > giaNiemYet;

  const giaGocKhiChuaCongLai = soDuongDauTien(
    mon.preMarkupSalePrice, mon.originalSalePrice, mon.saleFilePrice, mon.baseSalePrice, mon.rawSalePrice);
  const giamRoTrenDuLieu = soDuongDauTien(mon.discountPercent, mon.discount_percent);
  const tiLeGiam = Number(mon.saleRatio || mon.sale_ratio || 0);
  const phanTramGiam = giamRoTrenDuLieu > 0
    ? Math.round(giamRoTrenDuLieu)
    : (tiLeGiam > 0
      ? Math.round(tiLeGiam <= 1 ? tiLeGiam * 100 : tiLeGiam)
      : (giaNiemYet > 0 && (giaGocKhiChuaCongLai || gia) > 0 && (giaGocKhiChuaCongLai || gia) < giaNiemYet
        ? Math.round((1 - (giaGocKhiChuaCongLai || gia) / giaNiemYet) * 100) : 0));

  return {
    offerKey: String(mon.offerKey || "").trim(),
    originalCode: String(mon.originalCode || ma).trim(),
    code: ma,
    name: ten,
    source: mon.source === "partner" ? "partner" : "own",
    sourceName: String(mon.sourceName || "").trim() || "TopRun",
    brand: String(mon.brand || "").trim(),
    productKind: String(mon.productKind || mon.kind || mon.productType || "").trim(),
    category: String(mon.category || mon.sport || "").trim(),
    division: String(mon.division || mon.type || "").trim(),
    gender: String(mon.gender || "").trim(),
    sizes: cacSize,
    price: gia,
    suggestedPrice: gia,
    salePrice: gia,
    preMarkupSalePrice: giaGocKhiChuaCongLai,
    originalSalePrice: giaGocKhiChuaCongLai,
    listPrice: giaNiemYet,
    saleRatio: phanTramGiam > 0 ? phanTramGiam / 100 : 0,
    discountPercent: phanTramGiam,
    discount_percent: phanTramGiam,
    status: giaSai ? "hidden" : trangThaiMon(mon.status),
    hiddenReason: giaSai ? "invalid_price_sale_gt_list" : String(mon.hiddenReason || "").trim(),
    thumbnailImage: anhCongKhai(mon.thumbnailImage || mon.image || ""),
    highImage: anhCongKhai(mon.highImage || ""),
    galleryImages: khongTrung(cacAnhCongKhai(mon.galleryImages || mon.gallery || mon.images || mon.localImages)),
    warehouseStocks: banDoTon(mon.warehouseStocks),
    warehouseStockIds: banDoTon(mon.warehouseStockIds),
    warehousePriority: danhSachChuoi(mon.warehousePriority),
    warehousePriorityIds: danhSachChuoi(mon.warehousePriorityIds),
    warehouseMeta: thongTinKho(mon.warehouseMeta),
    slug: duongDanMon(mon.slug || mon.code, ma, ten),
    shortDescription: String(mon.shortDescription || mon.short_description || "").trim(),
    description: String(mon.description || mon.introduction || mon.productDescription || "").trim(),
    seoTitle: String(mon.seoTitle || "").trim(),
    seoDescription: String(mon.seoDescription || "").trim(),
    productUrl: String(mon.productUrl || mon.product_url || "").trim(),
    sourcePageUrl: String(mon.sourcePageUrl || mon.source_page_url || "").trim(),
    detailUrl: String(mon.detailUrl || mon.detail_url || "").trim(),
    partnerCampaign: Boolean(mon.partnerCampaign),
    partnerSource: String(mon.partnerSource || "").trim(),
    campaignId: String(mon.campaignId || "").trim(),
    campaignName: String(mon.campaignName || "").trim(),
    campaignStatus: String(mon.campaignStatus || "").trim(),
    campaignExpiresAt: String(mon.campaignExpiresAt || "").trim(),
    policy: String(mon.policy || "").trim()
  };
}

/** Mot dong size o ban CONG KHAI: chi con/het, khong bao gio noi con may doi. */
function sizeCongKhai(mon = {}, dong = {}) {
  if (!dong || typeof dong !== "object") return null;
  const size = String(dong.size || "").trim();
  if (!size) return null;
  const conLai = Math.max(0, Number(dong.qty ?? dong.available ?? dong.stockQty ?? 0));
  const maKho = String(dong.warehouseId || "").trim() || khoaKho(dong.warehouse || dong.warehouseName);
  const tenKho = String(dong.warehouse || dong.warehouseName || maKho).trim();
  const nhan = nhanKho(maKho, tenKho);
  const gia = soDuongDauTien(dong.suggestedPrice, dong.salePrice, dong.sellPrice, dong.price);
  const giaNiemYet = soDuongDauTien(dong.listPrice, dong.originalPrice, mon.listPrice, mon.originalPrice);
  const uuTien = thuTuKho(mon, dong);
  return {
    variantId: maBienThe(mon, dong),
    size,
    available: conLai > 0,
    qty: conLai > 0 ? 1 : 0,      // CHI 1 hoac 0 — khong lo ton that
    price: gia,
    suggestedPrice: gia,
    salePrice: gia,
    listPrice: giaNiemYet,
    warehouseId: maKho,
    warehouse: nhan,
    warehouseName: nhan,
    warehouseLabel: nhan,
    ...(uuTien < Number.MAX_SAFE_INTEGER ? { selectionRank: uuTien } : {}),
    ...(String(dong.stockMode || "").trim().toLowerCase() === "ready" ? { stockMode: "ready" } : {}),
    partnerCampaignLineId: String(dong.partnerCampaignLineId || "").trim()
  };
}

/** BAN CONG KHAI — ban duy nhat duoc ra khoi may. Khong gia von, khong ton that, khong ten kho. */
function banCongKhai(mon = {}) {
  if (!mon || typeof mon !== "object") return null;
  const cacSize = (Array.isArray(mon.sizes) ? mon.sizes : []).map((d) => sizeCongKhai(mon, d)).filter(Boolean);
  const gia = soDuongDauTien(mon.suggestedPrice, mon.salePrice, mon.sellPrice, mon.price);
  const giaNiemYet = soDuongDauTien(mon.listPrice, mon.originalPrice, mon.retailPrice, mon.marketPrice, mon.msrp);
  return {
    code: String(mon.code || "").trim(),
    originalCode: String(mon.originalCode || mon.code || "").trim(),
    name: String(mon.name || "").trim(),
    source: mon.source === "partner" ? "partner" : "own",
    sourceName: String(mon.sourceName || "TopRun").trim(),
    brand: String(mon.brand || "").trim(),
    productKind: String(mon.productKind || "").trim(),
    category: String(mon.category || "").trim(),
    division: String(mon.division || "").trim(),
    gender: String(mon.gender || "").trim(),
    sizes: cacSize,
    price: gia,
    suggestedPrice: gia,
    salePrice: gia,
    listPrice: giaNiemYet,
    saleRatio: Number(mon.saleRatio || 0),
    discountPercent: Number(mon.discountPercent || mon.discount_percent || 0),
    discount_percent: Number(mon.discountPercent || mon.discount_percent || 0),
    // Het sach moi size thi mon do la "het hang", du ho so ghi gi.
    status: trangThaiMon(cacSize.some((d) => Number(d.qty || 0) > 0) ? mon.status : "out_of_stock"),
    thumbnailImage: anhCongKhai(mon.thumbnailImage || mon.image || ""),
    highImage: anhCongKhai(mon.highImage || ""),
    galleryImages: cacAnhCongKhai(mon.galleryImages || mon.gallery || mon.images || mon.localImages),
    slug: String(mon.slug || "").trim(),
    shortDescription: String(mon.shortDescription || mon.short_description || "").trim(),
    description: String(mon.description || mon.introduction || mon.productDescription || "").trim(),
    seoTitle: String(mon.seoTitle || "").trim(),
    seoDescription: String(mon.seoDescription || "").trim(),
    partnerCampaign: Boolean(mon.partnerCampaign),
    policy: String(mon.policy || "").trim(),
    ...(String(mon.readyPolicySummary || "").trim() ? { readyPolicySummary: String(mon.readyPolicySummary).trim() } : {})
  };
}

/** Tim mot mon theo ma, offerKey, hay duong dan — cach nao cung ra. */
function timTheoKhoa(cacMon, khoa) {
  const duong = duongDanMon(khoa);
  const chu = String(khoa || "").toLowerCase();
  return (Array.isArray(cacMon) ? cacMon : []).find((m) => {
    const ma = String(m.code || "").trim();
    const offer = String(m.offerKey || "").trim();
    return ma.toLowerCase() === chu
      || offer.toLowerCase() === chu
      || duongDanMon(m.slug || ma) === duong
      || duongDanMon(`${ma}-${m.name || ""}`) === duong;
  }) || null;
}

module.exports = {
  chuanHoaMon, banCongKhai, sizeCongKhai, timTheoKhoa,
  soDuongDauTien, khoaKho, nhanKho, trangThaiMon, duongDanMon, maBienThe, thuTuKho,
  danhSachChuoi, khongTrung, laAnhNoiBo, anhCongKhai, cacAnhCongKhai, banDoTon, thongTinKho
};
