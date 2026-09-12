// CONG QUYEN — mot cho duy nhat tra loi "nguoi goi nay co duoc lam viec nay khong".
//
// Ban dang chay rai `isLandingAdminAuthorized(request, url)` khap server.js. Rai nhu vay
// thi them mot duong moi ma quen goi la lo mot cua. O day module KHONG tu doc tieu de:
// no hoi cong, va duong nao khong hoi thi nhin thay duoc trong to khai.
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
 * `maQuanTri` / `maDon`: lay tu bien moi truong (LANDING_ADMIN_TOKEN / LANDING_ORDERS_TOKEN).
 * KHONG cau hinh ma nao = tu choi tat ca (fail-closed) — giong ban dang chay.
 */
function taoCongQuyen({ maQuanTri = "", maDon = "" } = {}) {
  const cacMa = [maQuanTri, maDon].map((m) => String(m || "").trim()).filter((m) => m !== "");
  return {
    daCauHinh: () => cacMa.length > 0,
    laQuanTri(yc) {
      if (cacMa.length === 0) return false;
      const ma = maTrongYeuCau(yc);
      if (!ma) return false;
      return cacMa.some((that) => bangNhau(ma, that));
    }
  };
}

module.exports = { taoCongQuyen, maTrongYeuCau, bangNhau };
