// VE NGAN HAN — anh Dung duyet 12/09/2026: "ba danh tinh + ve 15 phut".
//
// Truoc: moi ben cam mot chuoi ma trong bien moi truong, KHONG BAO GIO het han. Ai lay duoc
// la dung mai toi khi doi tay. Va nhat ky chi biet "co nguoi cam ma hop le", khong biet la ai.
//
// Nay: moi ben giu mot KHOA DAI HAN cua rieng minh, dung khoa do doi lay mot VE song 15 phut.
// Ve lo thi chi thiet 15 phut. Ve mang theo TEN cua nguoi goi nen nhat ky ghi duoc ai vua goi.
//
// Ve tu ky bang HMAC-SHA256 — khong can thu vien ngoai, va khong can cho de kiem: may chu tu
// ky thi tu kiem duoc. Hinh dang: `<phan-than-base64url>.<chu-ky-base64url>`.
//
// TUONG THICH: khoa dai han VAN goi thang duoc. Sales Desk va Image Tool dang cam ma cu va
// khong biet gi ve ve; cat chung ngay la gay he dang ban hang. Ho doi sang ve luc nao cung
// duoc, va khi het nguoi dung khoa dai han thi moi tat duong do.

"use strict";

const crypto = require("crypto");

const SONG_MAC_DINH_MS = 15 * 60 * 1000;

const b64 = (b) => Buffer.from(b).toString("base64url");
const tuB64 = (s) => Buffer.from(String(s), "base64url");

function ky(than, biMat) {
  return crypto.createHmac("sha256", String(biMat)).update(than, "utf8").digest("base64url");
}

function bangNhau(a, b) {
  const x = Buffer.from(String(a ?? ""), "utf8");
  const y = Buffer.from(String(b ?? ""), "utf8");
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/**
 * @param biMat   bi mat de ky ve (BI_MAT_VE). Doi no = moi ve dang song chet ngay.
 * @param gio     dong ho — de bai kiem tra ep duoc thoi gian
 */
function taoBoVe({ biMat, gio, songMs = SONG_MAC_DINH_MS } = {}) {
  if (!biMat || String(biMat).length < 16) {
    throw new Error("Bí mật ký vé phải dài ít nhất 16 ký tự.");
  }

  function phat({ vai, ten }) {
    const bayGio = gio.bayGio().getTime();
    const than = b64(JSON.stringify({ vai, ten, phatLuc: bayGio, hetLuc: bayGio + songMs }));
    return { ve: `${than}.${ky(than, biMat)}`, hetSauMs: songMs };
  }

  /** Tra `{ hopLe, vai, ten, viSao }`. KHONG nem — sai ve la chuyen binh thuong. */
  function doc(ve) {
    const chu = String(ve || "");
    const cham = chu.lastIndexOf(".");
    if (cham <= 0) return { hopLe: false, viSao: "sai_hinh_dang" };

    const than = chu.slice(0, cham);
    if (!bangNhau(chu.slice(cham + 1), ky(than, biMat))) return { hopLe: false, viSao: "chu_ky_sai" };

    let d;
    try { d = JSON.parse(tuB64(than).toString("utf8")); } catch { return { hopLe: false, viSao: "than_hong" }; }
    if (gio.bayGio().getTime() >= Number(d.hetLuc || 0)) return { hopLe: false, viSao: "het_han" };
    if (typeof d.vai !== "string" || typeof d.ten !== "string") return { hopLe: false, viSao: "thieu_vai_hoac_ten" };
    return { hopLe: true, vai: d.vai, ten: d.ten, hetLuc: d.hetLuc };
  }

  return { phat, doc, songMs };
}

module.exports = { taoBoVe, SONG_MAC_DINH_MS };
