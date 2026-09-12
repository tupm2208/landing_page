// LINK CHIA SE BO LOC — /l/<token>.
//
// Khach loc "Nike, size 42, duoi 2 trieu" roi bam chia se. Neu gui ca query string that thi
// Messenger/Zalo hay cat mat phan sau dau "?", nen bo loc duoc goi thanh mot token base64url
// thuan ASCII. May chu mo token ra va 302 ve link loc day du.
//
// Day la cho nhan chu tu nguoi la roi dua vao tieu de Location, nen no la mot cua. Ba lop giu:
//   1. Token phai la base64url va khong qua dai.
//   2. Chi nhung khoa loc DA KHAI moi duoc di tiep — them khoa la phai sua o day.
//   3. Moi ky tu dieu khien, dau nhon, dau nhay deu lam token do bi bo — tra ve "/".
// Sai o dau cung ra "/" chu khong bao gio ra mot duong tuyet doi sang site khac.

"use strict";

const KHOA_CHO_QUA = new Set([
  "q", "query", "size", "gender", "sport", "category", "type", "division",
  "brand", "warehouse", "price_min", "price_max", "sale", "ban", "sort", "ref"
]);

function dichToken(token = "") {
  const chu = String(token || "").trim();
  if (!/^[A-Za-z0-9_-]{1,700}$/.test(chu)) return "/";

  let mo = "";
  try {
    mo = Buffer.from(chu.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return "/";
  }
  if (!mo || /[\u0000-\u001f<>"'\\]/.test(mo)) return "/";

  let thamSo;
  try { thamSo = new URLSearchParams(mo); } catch { return "/"; }

  const sach = new URLSearchParams();
  for (const [khoa, gt] of thamSo) {
    if (!KHOA_CHO_QUA.has(khoa)) continue;
    const chuGt = String(gt || "").trim();
    if (!chuGt || chuGt.length > 200 || sach.has(khoa)) continue;
    sach.set(khoa, chuGt);
  }
  const truyVan = sach.toString();
  return truyVan ? `/?${truyVan}` : "/";
}

module.exports = { dichToken, KHOA_CHO_QUA };
