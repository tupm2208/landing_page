// VE MAY — kit dung chung: Xeon KY, landing SOI. Cung mot tep de hai ben khong bao gio lech hinh dang.
//
// Anh Dung chot 14/09/2026: mot goc tin cay duy nhat la khoa ky cua Xeon. Landing chi giu khoa
// CONG, soi chu ky tai cho, khong goi Xeon moi lan bam. Phan SOI khong co gi bi mat; phan KY chi
// chay duoc khi co khoa rieng (chi Xeon co). Bai kiem tra o server-khach va OMI dung phan KY
// de dung ve gia — nen ca hai phan nam o day, khong phu thuoc vao ma nguon cua Xeon.
//
// Hinh dang:  VM1.<than base64url>.<chu ky base64url>
//   than = JSON (khoa sap xep) cua { v, vai, shop, tenShop, maMay, tenMay, manh, truc, phatLuc, hetLuc, keyId }
//   chuoi ky = "ve-may." + than
//
// `vai`:  "quan-tri" = OMI cua chu shop · "dich-vu" = bo nao tren Xeon
// `manh`: nhung manh shop da mua — landing tu chan duong thuoc manh khong co trong ve.
//
// Khoa ky: Ed25519 co san trong node:crypto — khong them thu vien, chu ky 64 byte, khong co
// tham so de cau hinh sai. Ma nhan dien khoa (`keyId`) = "ky-" + 16 ky tu base64url cua
// SHA-256(SPKI) — bam KHOA nen on dinh qua moi lan nap.

"use strict";

const crypto = require("crypto");

const TIEN_TO = "VM1.";
const VAI = ["quan-tri", "dich-vu"];
/** Dong ho hai may lech nhau chut it la binh thuong; qua muc nay thi ve "tu tuong lai" bi tu choi. */
const LECH_GIO_CHO_PHEP_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------- khoa ky

/** Ma nhan dien khoa cong: `ky-` + 16 ky tu base64url cua SHA-256(SPKI). */
function keyIdCuaKhoaCong(khoaCongPem) {
  const spki = crypto.createPublicKey(khoaCongPem).export({ type: "spki", format: "der" });
  return `ky-${crypto.createHash("sha256").update(spki).digest("base64url").slice(0, 16)}`;
}

/** Sinh mot cap khoa Ed25519 moi. Tra { khoaRiengPem, khoaCongPem, keyId }. */
function sinhKhoaKy() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const khoaRiengPem = privateKey.export({ type: "pkcs8", format: "pem" });
  const khoaCongPem = publicKey.export({ type: "spki", format: "pem" });
  return { khoaRiengPem, khoaCongPem, keyId: keyIdCuaKhoaCong(khoaCongPem) };
}

/** Ky mot chuoi UTF-8, tra base64url. */
function kyChuoi(khoaRiengPem, chuoi) {
  return crypto.sign(null, Buffer.from(chuoi, "utf8"), crypto.createPrivateKey(khoaRiengPem)).toString("base64url");
}

/** Kiem chu ky Ed25519. Khoa hong hay chu ky hong deu la SAI, khong nem. */
function kiemChuKy(khoaCongPem, chuoi, chuKyB64url) {
  try {
    return crypto.verify(
      null, Buffer.from(chuoi, "utf8"), crypto.createPublicKey(khoaCongPem), Buffer.from(String(chuKyB64url), "base64url")
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- ve

/** JSON voi khoa sap xep — de hai phia ky va soi cung mot chuoi. */
function chuoiChuan(than) {
  const o = {};
  for (const k of Object.keys(than).sort()) o[k] = than[k];
  return JSON.stringify(o);
}

const b64 = (s) => Buffer.from(s, "utf8").toString("base64url");

/**
 * KY mot ve. `than` = { vai, shop, tenShop, maMay, tenMay, manh, truc, phatLuc, hetLuc };
 * `khoaKy` = { khoaRiengPem, keyId }. Nem neu than sai hinh dang — ky sai la loi lap trinh.
 */
function kyVe(than, { khoaRiengPem, keyId }) {
  if (!VAI.includes(than.vai)) throw new Error(`Ve: vai "${than.vai}" khong hop le.`);
  if (typeof than.shop !== "string" || than.shop === "") throw new Error("Ve: thieu shop.");
  if (!Number.isFinite(than.phatLuc) || !Number.isFinite(than.hetLuc) || than.hetLuc <= than.phatLuc) {
    throw new Error("Ve: phatLuc / hetLuc khong hop le.");
  }
  const thanDu = { v: 1, ...than, keyId };
  const thanB64 = b64(chuoiChuan(thanDu));
  return `${TIEN_TO}${thanB64}.${kyChuoi(khoaRiengPem, `ve-may.${thanB64}`)}`;
}

/**
 * Doc va SOI mot ve. KHONG nem — ve sai la chuyen binh thuong o cua vao.
 * @param khoaCongTheoKeyId  (keyId) => PEM | null
 * @param bayGio             Date
 * Tra { hopLe: true, than } hoac { hopLe: false, viSao }.
 */
function docVe(ve, { khoaCongTheoKeyId, bayGio }) {
  const chu = String(ve || "").trim();
  if (!chu.startsWith(TIEN_TO)) return { hopLe: false, viSao: "sai_hinh_dang" };
  const phan = chu.slice(TIEN_TO.length).split(".");
  if (phan.length !== 2 || !phan[0] || !phan[1]) return { hopLe: false, viSao: "sai_hinh_dang" };
  const [thanB64, chuKy] = phan;

  let than;
  try { than = JSON.parse(Buffer.from(thanB64, "base64url").toString("utf8")); } catch { return { hopLe: false, viSao: "than_hong" }; }
  if (!than || typeof than !== "object" || than.v !== 1) return { hopLe: false, viSao: "than_hong" };
  if (typeof than.keyId !== "string") return { hopLe: false, viSao: "thieu_keyId" };

  const khoaCong = khoaCongTheoKeyId(than.keyId);
  if (!khoaCong) return { hopLe: false, viSao: "khong_biet_khoa" };
  if (!kiemChuKy(khoaCong, `ve-may.${thanB64}`, chuKy)) return { hopLe: false, viSao: "chu_ky_sai" };

  if (!VAI.includes(than.vai) || typeof than.shop !== "string" || than.shop === "") return { hopLe: false, viSao: "than_hong" };
  const t = bayGio.getTime();
  if (!Number.isFinite(than.hetLuc) || t >= than.hetLuc) return { hopLe: false, viSao: "het_han" };
  if (!Number.isFinite(than.phatLuc) || than.phatLuc > t + LECH_GIO_CHO_PHEP_MS) return { hopLe: false, viSao: "chua_toi_gio" };
  if (!Array.isArray(than.manh)) than.manh = [];
  return { hopLe: true, than };
}

/** Ve co dang ve khong (de cong quyen biet nen soi ve hay so voi khoa dai han). */
function laVe(chuoi) {
  return String(chuoi || "").startsWith(TIEN_TO);
}

module.exports = {
  docVe, laVe, kyVe, chuoiChuan,
  sinhKhoaKy, keyIdCuaKhoaCong, kyChuoi, kiemChuKy,
  TIEN_TO, VAI, LECH_GIO_CHO_PHEP_MS
};
