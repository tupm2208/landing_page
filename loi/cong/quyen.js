// CONG QUYEN — mot cho duy nhat tra loi "nguoi goi nay la ai, co duoc lam viec nay khong".
//
// Ban dang chay rai `isLandingAdminAuthorized(request, url)` khap server.js. Rai nhu vay
// thi them mot duong moi ma quen goi la lo mot cua. O day module KHONG tu doc tieu de va
// KHONG tu goi ham kiem: no khai `quyen` cho tung duong trong to khai, khung chan truoc
// khi goi tay module (anh Dung chot 12/09/2026).
//
// Ba danh tinh (anh chot 12/09): nguoi / may / dich vu. Doi nay moi lam duoc mot nua —
// phan biet MA QUAN TRI voi MA DICH VU. "Ve 15 phut" doi tu khoa dai han la viec cua dot
// sau; hinh dang cong nay khong doi khi lam: van la `vai(yc)` va `duoc(yc, quyen)`.
//
// Ba cach dua ma giu y het ban dang chay (Desk va Image Tool dang dung ca ba):
//   Authorization: Bearer <ma>   |   x-landing-token: <ma>   |   ?token=<ma>

"use strict";

const crypto = require("crypto");

/** So sanh khong de lo do dai/vi tri byte sai. */
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
 * `maQuanTri` / `maDon`: LANDING_ADMIN_TOKEN / LANDING_ORDERS_TOKEN — chu shop, Desk, Image Tool.
 * `maDichVu`: rieng cho bo nao tren Xeon, de thu hoi duoc ma khong dung toi Desk.
 * KHONG cau hinh ma nao = tu choi tat ca (fail-closed) — giong ban dang chay.
 */
function taoCongQuyen({ maQuanTri = "", maDon = "", maDichVu = "" } = {}) {
  const maQt = [maQuanTri, maDon].map((m) => String(m || "").trim()).filter(Boolean);
  const maDv = [maDichVu].map((m) => String(m || "").trim()).filter(Boolean);

  function vai(yc) {
    const ma = maTrongYeuCau(yc);
    if (!ma) return "khach-vang-lai";
    if (maQt.some((that) => bangNhau(ma, that))) return "quan-tri";
    if (maDv.some((that) => bangNhau(ma, that))) return "dich-vu";
    return "khach-vang-lai";
  }

  return {
    daCauHinh: () => maQt.length > 0 || maDv.length > 0,
    vai,
    /** Vai nay co du de goi duong khai `can` khong. Quan tri di duoc ca duong dich vu. */
    duoc(yc, can) {
      if (can === "cong-khai") return true;
      const v = vai(yc);
      if (can === "quan-tri") return v === "quan-tri";
      if (can === "dich-vu") return v === "dich-vu" || v === "quan-tri";
      return false; // quyen la = tu choi
    },
    /** Giu lai cho cho nao con goi truc tiep; duong moi thi khai `quyen` trong to khai. */
    laQuanTri: (yc) => vai(yc) === "quan-tri"
  };
}

module.exports = { taoCongQuyen, maTrongYeuCau, bangNhau };
