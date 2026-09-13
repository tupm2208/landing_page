// CONG QUYEN — mot cho duy nhat tra loi "nguoi goi nay LA AI, co duoc lam viec nay khong".
//
// Ban dang chay rai `isLandingAdminAuthorized(request, url)` khap server.js; them mot duong
// ma quen goi la lo mot cua. O day module KHONG tu kiem: no khai `quyen` (va `manh`) cho tung
// duong trong to khai, khung chan truoc khi goi vao module (anh Dung chot 12/09/2026).
//
// HAI CACH VAO (anh Dung chot 14/09/2026 — bo ve 15 phut va ghep may):
//
//   1. VE MAY ky tu Xeon (`VM1.…`). OMI cua chu shop cam ve vai "quan-tri"; bo nao cam ve vai
//      "dich-vu". Landing soi bang KHOA CONG cua Xeon (nhan luc dang ky), khong goi Xeon. Ve
//      mang `shop` — phai la chinh shop nay; `manh` — landing tu chan duong thuoc manh chua mua.
//   2. KHOA DAI HAN co ten (Sales Desk, Image Tool cua TopRun). Khong bi chan theo manh: do la
//      cong cu noi bo cua TopRun, khong phai thu ban theo manh.
//
// Ba cach dua ma giu y het ban dang chay (Desk va Image Tool dang dung ca ba):
//   Authorization: Bearer <ma>   |   x-landing-token: <ma>   |   ?token=<ma>

"use strict";

const crypto = require("crypto");
const { docVe, laVe } = require("../../../chung/ve-may.js");

function bangNhau(a, b) {
  const x = Buffer.from(String(a ?? ""), "utf8");
  const y = Buffer.from(String(b ?? ""), "utf8");
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function maTrongYeuCau(yc) {
  const tieuDe = yc?.tieuDe ?? {};
  const bearer = String(tieuDe.authorization || "").trim();
  if (/^Bearer\s+/i.test(bearer)) return bearer.replace(/^Bearer\s+/i, "").trim();
  const rieng = String(tieuDe["x-landing-token"] || "").trim();
  if (rieng) return rieng;
  return String(yc?.truyVan?.token || "").trim();
}

/**
 * @param cacKhoa  [{ ma, ten, vai }] — khoa dai han co TEN. `vai`: "quan-tri" | "dich-vu".
 * @param xeon     { keyId, khoaCongPem, shop } — nhan luc landing dang ky voi Xeon. Chua co thi
 *                 moi ve deu bi tu choi (chua dang ky = chua ai duoc vao bang ve).
 * @param gio      dong ho (de soi han ve)
 * @param nhatKy   de ghi "ai vua goi"
 *
 * Giu them `maQuanTri` / `maDon` / `maDichVu` cho tuong thich voi cach cu.
 * KHONG cau hinh khoa nao va chua dang ky Xeon = tu choi tat ca (fail-closed).
 */
function taoCongQuyen({ cacKhoa = [], maQuanTri = "", maDon = "", maDichVu = "", xeon = null, gio = null, nhatKy = null } = {}) {
  const ky = nhatKy ?? { tin: () => {}, canhBao: () => {} };
  const bayGio = () => (gio?.bayGio ? gio.bayGio() : new Date());

  const khoa = [
    ...cacKhoa.map((k) => ({ ma: String(k.ma || "").trim(), ten: String(k.ten || "khong-ten"), vai: k.vai })),
    { ma: String(maQuanTri || "").trim(), ten: "quan-tri", vai: "quan-tri" },
    { ma: String(maDon || "").trim(), ten: "don-hang", vai: "quan-tri" },
    { ma: String(maDichVu || "").trim(), ten: "bo-nao", vai: "dich-vu" }
  ].filter((k) => k.ma !== "" && (k.vai === "quan-tri" || k.vai === "dich-vu"));

  /** Khoa cong cua Xeon — co the co vai khoa khi Xeon dang xoay khoa. */
  const khoaXeon = new Map();
  let shopCuaToi = "";
  function datXeon(x) {
    if (!x?.keyId || !x?.khoaCongPem || !x?.shop) throw new Error("datXeon can { keyId, khoaCongPem, shop }.");
    khoaXeon.set(String(x.keyId), String(x.khoaCongPem));
    shopCuaToi = String(x.shop);
    ky.tin(`[quyen] nhan khoa cong Xeon ${x.keyId} cho shop "${x.shop}"`);
  }
  if (xeon) datXeon(xeon);

  /** Tra `{ vai, ten, bang, ... }` — `bang` = "ve-xeon" | "khoa-dai-han" | ly do tu choi. */
  function ai(yc) {
    const ma = maTrongYeuCau(yc);
    if (!ma) return { vai: "khach-vang-lai", ten: "", bang: "khong-co-ma" };

    if (laVe(ma)) {
      if (khoaXeon.size === 0) return { vai: "khach-vang-lai", ten: "", bang: "chua-dang-ky-xeon" };
      const v = docVe(ma, { khoaCongTheoKeyId: (id) => khoaXeon.get(id) ?? null, bayGio: bayGio() });
      if (!v.hopLe) return { vai: "khach-vang-lai", ten: "", bang: `ve-${v.viSao}` };
      if (v.than.shop !== shopCuaToi) return { vai: "khach-vang-lai", ten: "", bang: "ve-shop-khac" };
      return {
        vai: v.than.vai,
        ten: `${v.than.shop}:${v.than.tenMay || v.than.maMay || "?"}`,
        bang: "ve-xeon",
        shop: v.than.shop, maMay: v.than.maMay, manh: v.than.manh, truc: v.than.truc === true,
        hetLuc: v.than.hetLuc
      };
    }

    for (const k of khoa) {
      if (bangNhau(ma, k.ma)) return { vai: k.vai, ten: k.ten, bang: "khoa-dai-han" };
    }
    return { vai: "khach-vang-lai", ten: "", bang: "ma-la" };
  }

  return {
    daCauHinh: () => khoa.length > 0 || khoaXeon.size > 0,
    daDangKyXeon: () => khoaXeon.size > 0,
    shop: () => shopCuaToi,
    datXeon,
    ai,
    vai: (yc) => ai(yc).vai,

    /** Vai nay co du de goi duong khai `can` khong. Quan tri di duoc ca duong dich vu. */
    duoc(yc, can) {
      if (can === "cong-khai") return true;
      const n = ai(yc);
      return can === "quan-tri" ? n.vai === "quan-tri"
        : can === "dich-vu" ? (n.vai === "dich-vu" || n.vai === "quan-tri")
          : false;
    },

    /**
     * Nguoi goi bang VE co thieu manh nay khong. Khoa dai han (Desk, Image Tool) khong bi chan
     * theo manh. Khach vang lai cung khong (duong cong khai khong xet manh).
     */
    thieuManh(yc, manh) {
      const n = ai(yc);
      if (n.bang !== "ve-xeon") return false;
      return !(Array.isArray(n.manh) && n.manh.includes(manh));
    },

    /** Ten cac khoa dai han dang co — KHONG bao gio tra ban ma. */
    tenCacKhoa: () => khoa.map((k) => ({ ten: k.ten, vai: k.vai })),

    /** Giu lai cho cho nao con goi truc tiep; duong moi thi khai `quyen` trong to khai. */
    laQuanTri: (yc) => ai(yc).vai === "quan-tri"
  };
}

module.exports = { taoCongQuyen, maTrongYeuCau, bangNhau };
