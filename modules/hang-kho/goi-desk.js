// DOI GOI CUA SALES DESK thanh hinh dang mon ma module nay dung.
//
// Hai duong Desk day vao co hinh dang RIENG, khong giong danh muc cua Image Tool. Truoc
// 12/09/2026 ban tach chi doc `sizes`, nen ca goi hang co san (dung `variants` + `branches`)
// bi bo sach ma khong bao mot loi nao. Tep nay la cho duy nhat biet hai hinh dang do.
//
// Ba luat khong duoc pha:
//
// 1. HANG CO SAN CHI CUA SHOP NAY. Kho nao duoc ban la mot danh sach KHAI TRUOC (`khoChoPhep`);
//    kho khong khai thi bo dong do. Ban Dasbui khai mot kho duy nhat, nen hang cua TopRun
//    khong bao gio lot sang. Day la day thep trong AGENTS.md, khong phai canh bao suong.
//
// 2. MOI DONG CHIEN DICH CO MOT MA DONG RIENG, on dinh. Su co 10/09 (don ORD-1788854262493):
//    bao het hang theo VI TRI dong, thay mot dong la danh dau sai dong khac va nhan sai cho
//    khach. Ma dong sinh tu (offerKey, ma, size, kho) nen sinh lai luon ra y nguyen.
//
// 3. KHONG DOI TEN DOI TAC O DAY. Trong so phai giu ten doi tac that — khong co no thi khong
//    biet dat mua o dau. Viec che ten la viec cua BAN CONG KHAI (`banCongKhai` trong
//    chuan-hoa.js), mot cho duy nhat, va co bai giu.

"use strict";

const crypto = require("crypto");
const { duongDanMon } = require("./chuan-hoa");

/** Kho hang co san duoc phep ban, theo mac dinh (ban TopRun). Ban Dasbui khai lai trong cau hinh. */
const KHO_CO_SAN_MAC_DINH = ["wh_toprun*", "wh_partner_dasbui"];

function khop(mau, giaTri) {
  const m = String(mau || "").trim().toLowerCase();
  const g = String(giaTri || "").trim().toLowerCase();
  if (!m || !g) return false;
  if (m.endsWith("*")) return g.startsWith(m.slice(0, -1));
  return g === m;
}

function duocBan(maKho, khoChoPhep) {
  return (Array.isArray(khoChoPhep) ? khoChoPhep : []).some((mau) => khop(mau, maKho));
}

function soDuong(...cacGiaTri) {
  for (const g of cacGiaTri) {
    const n = Number(g);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return 0;
}

function khoaDong(ma, size, maKho) {
  return [ma, size, maKho].map((x) => String(x || "").trim().toUpperCase()).join("|");
}

/**
 * Goi HANG CO SAN cua Desk -> danh sach mon.
 *
 * Goi that:
 *   { revision, policy: { summaryText }, branches: [{ id, name, active }],
 *     products: [{ code, name, imageUrl, galleryImages, variants: [{ size, branchId, qty, salePrice, listPrice }] }],
 *     pendingSales: [{ orderId, code, size, branchId, qty }] }
 */
function doiGoiHangCoSan(goi, { khoChoPhep = KHO_CO_SAN_MAC_DINH } = {}) {
  if (!goi || typeof goi !== "object") return [];

  const chiNhanh = new Map(
    (Array.isArray(goi.branches) ? goi.branches : [])
      .map((b) => [String(b?.id || "").trim(), { ten: String(b?.name || "").trim(), bat: b?.active !== false }])
      .filter(([id]) => id)
  );

  // Dang giu cho: don web da tru nhung Desk chua ghi so. Khoa theo (ma + size + kho).
  const dangGiu = new Map();
  for (const g of Array.isArray(goi.pendingSales) ? goi.pendingSales : []) {
    const k = khoaDong(g?.code, g?.size, g?.branchId);
    dangGiu.set(k, (dangGiu.get(k) || 0) + Math.max(0, Number(g?.qty || 0)));
  }

  const chinhSach = String(goi.policy?.summaryText || "").trim();
  const mon = [];

  for (const sp of Array.isArray(goi.products) ? goi.products : []) {
    const ma = String(sp?.code || "").trim();
    const ten = String(sp?.name || "").trim();
    if (!ma || !ten) continue;

    // Goi that cua Desk dung `variants`; vai noi (va bai kiem tra) day len dang gon voi
    // `sizes`. Ca hai vao cung mot cua o day, nen LUAT 1 (kho phai duoc khai) ap cho ca hai —
    // khong co hinh dang nao lot qua duoc.
    const cacDong = Array.isArray(sp.variants) && sp.variants.length
      ? sp.variants
      : (Array.isArray(sp.sizes) ? sp.sizes : []);

    const cacSize = [];
    for (const bt of cacDong) {
      const size = String(bt?.size || "").trim();
      const maKho = String(bt?.branchId || bt?.warehouseId || "").trim();
      if (!size || !maKho) continue;
      if (!duocBan(maKho, khoChoPhep)) continue;              // LUAT 1
      const cn = chiNhanh.get(maKho);
      if (cn && !cn.bat) continue;                            // chi nhanh da tat
      const gia = soDuong(bt?.salePrice, bt?.price);
      const con = Math.max(0, Math.trunc(Number(bt?.qty || 0)) - (dangGiu.get(khoaDong(ma, size, maKho)) || 0));
      if (con <= 0 || gia <= 0) continue;                     // het ton, hoac khong ro gia
      cacSize.push({
        variantId: "",
        size,
        qty: con,
        price: gia,
        suggestedPrice: gia,
        salePrice: gia,
        listPrice: soDuong(bt?.listPrice),
        warehouseId: maKho,
        warehouse: cn?.ten || bt?.warehouseName || bt?.warehouse || "TopRun",
        warehouseName: cn?.ten || bt?.warehouseName || bt?.warehouse || "TopRun",
        stockMode: "ready"
      });
    }
    if (cacSize.length === 0) continue;

    const anh = String(sp.imageUrl || sp.thumbnailImage || "").trim();
    const anhKhac = Array.isArray(sp.galleryImages) && sp.galleryImages.length
      ? sp.galleryImages
      : (anh ? [anh] : []);

    mon.push({
      code: ma,
      name: ten,
      source: "own",            // hang co san la hang cua shop
      sourceName: "TopRun",
      brand: String(sp.brand || "").trim(),
      productKind: String(sp.productKind || "").trim(),
      division: String(sp.division || "").trim(),
      category: String(sp.category || "").trim(),
      gender: String(sp.gender || "").trim(),
      status: "orderable",
      thumbnailImage: anh,
      highImage: anh,
      galleryImages: anhKhac,
      sizes: cacSize,
      ...(chinhSach ? { readyPolicySummary: chinhSach } : {})
    });
  }

  return mon;
}

/** Ma dong chien dich: on dinh theo (offerKey, ma, size, kho, vi tri). Sinh lai luon ra y nguyen. */
function maDongChienDich(mon, dong, viTri) {
  const nguon = [
    mon.offerKey, mon.code, dong.size, dong.warehouseId, dong.warehouse || dong.warehouseName, viTri
  ].map((x) => String(x || "").trim()).join("|");
  return `pcl_${crypto.createHash("sha1").update(nguon).digest("hex").slice(0, 16)}`;
}

/**
 * Goi CHIEN DICH DOI TAC cua Desk -> danh sach mon.
 *
 * Goi that: { campaigns: [{ id, status, expiresAt, endsAt, name }], products: [ ... co `sizes` ... ] }
 *
 * Bo mon khi: chien dich khong con "active", chien dich da het han, hoac mon khong con size
 * nao con hang. Giong ban dang chay — khong de hang het han nam tren web.
 */
function doiGoiChienDich(goi, { bayGio = new Date() } = {}) {
  if (!goi || typeof goi !== "object") return [];
  const chienDich = new Map(
    (Array.isArray(goi.campaigns) ? goi.campaigns : [])
      .map((c) => [String(c?.id || "").trim(), c])
      .filter(([id]) => id)
  );
  const luc = bayGio instanceof Date ? bayGio.getTime() : Date.parse(bayGio) || Date.now();

  const mon = [];
  for (const sp of Array.isArray(goi.products) ? goi.products : []) {
    const ma = String(sp?.code || "").trim();
    const ten = String(sp?.name || "").trim();
    if (!ma || !ten) continue;

    const cd = chienDich.get(String(sp.campaignId || "").trim());
    if (cd && String(cd.status || "").trim() !== "active") continue;
    const hetHan = Date.parse(sp.campaignExpiresAt || cd?.expiresAt || cd?.endsAt || "");
    if (Number.isFinite(hetHan) && hetHan > 0 && hetHan < luc) continue;

    const cacSize = (Array.isArray(sp.sizes) ? sp.sizes : [])
      .filter((d) => Number(d?.qty || 0) > 0)
      .map((d, i) => ({ ...d, partnerCampaignLineId: String(d.partnerCampaignLineId || "").trim() || maDongChienDich(sp, d, i) }));
    if (cacSize.length === 0) continue;

    mon.push({
      ...sp,
      sizes: cacSize,
      // Duong dan cua Desk mang ten doi tac ("jr5074-supersports-..."). Dat lai theo ma + ten
      // mon: duong dan la thu khach thay tren thanh dia chi, khong duoc lo ai la nguon hang.
      slug: duongDanMon(`${ma}-${ten}`, ma, ten),
      partnerCampaign: true,
      campaignName: sp.campaignName || cd?.name || "",
      campaignExpiresAt: sp.campaignExpiresAt || cd?.expiresAt || cd?.endsAt || ""
    });
  }
  return mon;
}

module.exports = { doiGoiHangCoSan, doiGoiChienDich, maDongChienDich, KHO_CO_SAN_MAC_DINH, duocBan };
