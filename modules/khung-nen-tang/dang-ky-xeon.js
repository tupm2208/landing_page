// DANG KY VOI XEON — landing tu khai minh voi Xeon bang chinh license key. Anh Dung chot 14/09/2026.
//
// Vi sao landing goi LEN chu khong phai Xeon day XUONG: luc moi cai, landing chua co khoa cong
// cua Xeon thi khong co gi de tin mot loi "day xuong". Landing goi len qua HTTPS (TLS toi ten
// mien cua Xeon la neo tin cay), nhan ve:
//   - khoa CONG ky cua Xeon  -> soi ve may cua OMI va ve dich vu cua bo nao, khong hoi Xeon nua
//   - ma nhan tin RIENG      -> hop thu dung no khi day tin sang Xeon; Xeon suy ra shop tu ma
//   - ma shop                -> ve nao ghi shop khac la tu choi
//
// Ket qua ghi vao so `khung-nen-tang-xeon`. Dang ky lai (cai lai hosting) la ma nhan tin cu chet
// tren Xeon — chi mot landing song cho moi shop.

"use strict";

const SO_XEON = "khung-nen-tang-xeon";
const MAU_KEY = /^TR-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

function chuanKey(key) {
  return String(key || "").trim().toUpperCase().replace(/\s+/g, "");
}

function chuanDiaChi(d) {
  const s = String(d || "").trim().replace(/\/+$/, "");
  try {
    const u = new URL(`${s}/`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return s;
  } catch {
    return "";
  }
}

/**
 * Goi Xeon dang ky. NEM khi khong dang ky duoc (mang, key sai, Xeon tu choi) — nguoi goi quyet
 * dinh in canh bao hay dung.
 */
async function dangKyXeon({ httpNgoai, diaChiXeon, key, diaChiLanding, hanMs = 15000 }) {
  const xeon = chuanDiaChi(diaChiXeon);
  if (!xeon) throw new Error("Dia chi Xeon khong hop le.");
  const k = chuanKey(key);
  if (!MAU_KEY.test(k)) throw new Error("License key phai co dang TR-XXXX-XXXX-XXXX-XXXX.");
  const landing = chuanDiaChi(diaChiLanding);
  if (!landing) throw new Error("Dia chi cong khai cua landing khong hop le (LANDING_SITE_BASE_URL).");

  const tl = await httpNgoai.goi(`${xeon}/license/landing-dang-ky`, {
    method: "POST", hanMs,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: k, diaChi: landing })
  });
  const than = await tl.json().catch(() => ({}));
  if (!tl.ok || than.ok !== true) {
    throw new Error(`Xeon tu choi dang ky: ${than.viSao || than.error || `HTTP ${tl.status}`}`);
  }
  for (const f of ["shop", "keyId", "khoaCongPem", "maNhanTin"]) {
    if (typeof than[f] !== "string" || than[f] === "") throw new Error(`Xeon tra thieu "${f}".`);
  }
  if (!/BEGIN PUBLIC KEY/.test(than.khoaCongPem)) throw new Error("Khoa Xeon tra ve khong phai khoa cong.");
  return {
    key: k,
    shop: than.shop,
    tenShop: String(than.tenShop || ""),
    keyId: than.keyId,
    khoaCongPem: than.khoaCongPem,
    maNhanTin: than.maNhanTin,
    diaChiXeon: chuanDiaChi(than.diaChiXeon) || xeon,
    diaChiLanding: landing
  };
}

async function docXeon(kho) {
  const so = await kho.so(SO_XEON).doc(null);
  return so && typeof so === "object" && so.keyId ? so : null;
}

async function luuXeon(kho, ban, luc) {
  await kho.so(SO_XEON).ghi({ ...ban, dangKyLuc: luc.toISOString() });
}

/** Ban dua ra man hinh — KHONG mang ma nhan tin, khong mang key. */
function xeonGon(so) {
  if (!so) return null;
  return {
    shop: so.shop, tenShop: so.tenShop || "", keyId: so.keyId,
    diaChiXeon: so.diaChiXeon, diaChiLanding: so.diaChiLanding, dangKyLuc: so.dangKyLuc || ""
  };
}

module.exports = { dangKyXeon, docXeon, luuXeon, xeonGon, chuanKey, chuanDiaChi, SO_XEON, MAU_KEY };
