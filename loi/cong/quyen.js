// CONG QUYEN — mot cho duy nhat tra loi "nguoi goi nay LA AI, co duoc lam viec nay khong".
//
// Ban dang chay rai `isLandingAdminAuthorized(request, url)` khap server.js; them mot duong
// ma quen goi la lo mot cua. O day module KHONG tu kiem: no khai `quyen` cho tung duong
// trong to khai, khung chan truoc khi goi vao module (anh Dung chot 12/09/2026).
//
// BA DANH TINH + VE 15 PHUT (anh duyet 12/09, artifact 8d181936):
//
//   - Moi ben giu mot KHOA DAI HAN cua rieng minh, co TEN. Nho co ten nen nhat ky ghi duoc
//     "bo-nao vua goi", chu khong phai "co nguoi cam ma hop le".
//   - Khoa dai han doi lay VE song 15 phut (`POST /api/ve`). Ve lo chi thiet 15 phut.
//   - Khoa dai han VAN goi thang duoc: Sales Desk va Image Tool dang cam ma cu, cat ngay la
//     gay he dang ban hang. Nhung moi lan dung khoa dai han deu duoc ghi nhat ky, de biet
//     con ai chua doi sang ve.
//
// Ba cach dua ma giu y het ban dang chay (Desk va Image Tool dang dung ca ba):
//   Authorization: Bearer <ma>   |   x-landing-token: <ma>   |   ?token=<ma>

"use strict";

const crypto = require("crypto");

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
 * @param boVe     bo phat/doc ve ngan han (tuy chon; khong co thi chi con khoa dai han)
 * @param nhatKy   de ghi "ai vua goi"
 *
 * Giu them `maQuanTri` / `maDon` / `maDichVu` cho tuong thich voi cach cu.
 * KHONG cau hinh khoa nao = tu choi tat ca (fail-closed) — giong ban dang chay.
 */
function taoCongQuyen({ cacKhoa = [], maQuanTri = "", maDon = "", maDichVu = "", boVe = null, nhatKy = null } = {}) {
  const ky = nhatKy ?? { tin: () => {}, canhBao: () => {} };

  const khoa = [
    ...cacKhoa.map((k) => ({ ma: String(k.ma || "").trim(), ten: String(k.ten || "khong-ten"), vai: k.vai })),
    { ma: String(maQuanTri || "").trim(), ten: "quan-tri", vai: "quan-tri" },
    { ma: String(maDon || "").trim(), ten: "don-hang", vai: "quan-tri" },
    { ma: String(maDichVu || "").trim(), ten: "bo-nao", vai: "dich-vu" }
  ].filter((k) => k.ma !== "" && (k.vai === "quan-tri" || k.vai === "dich-vu"));

  /** Tra `{ vai, ten, bang }` — `bang` = "ve" hay "khoa-dai-han". */
  function ai(yc) {
    const ma = maTrongYeuCau(yc);
    if (!ma) return { vai: "khach-vang-lai", ten: "", bang: "khong-co-ma" };

    // Ve truoc: ve la duong duoc khuyen dung, va doc ve khong phai so voi tung khoa.
    if (boVe && ma.includes(".")) {
      const v = boVe.doc(ma);
      if (v.hopLe) return { vai: v.vai, ten: v.ten, bang: "ve" };
      if (v.viSao === "het_han") return { vai: "khach-vang-lai", ten: "", bang: "ve-het-han" };
      // Chu ky sai thi roi xuong duoi thu nhu khoa dai han — mot khoa co the chua dau cham.
    }

    for (const k of khoa) {
      if (bangNhau(ma, k.ma)) return { vai: k.vai, ten: k.ten, bang: "khoa-dai-han" };
    }
    return { vai: "khach-vang-lai", ten: "", bang: "ma-la" };
  }

  return {
    daCauHinh: () => khoa.length > 0,
    ai,
    vai: (yc) => ai(yc).vai,

    /** Vai nay co du de goi duong khai `can` khong. Quan tri di duoc ca duong dich vu. */
    duoc(yc, can) {
      if (can === "cong-khai") return true;
      const n = ai(yc);
      const qua = can === "quan-tri" ? n.vai === "quan-tri"
        : can === "dich-vu" ? (n.vai === "dich-vu" || n.vai === "quan-tri")
          : false;
      if (qua && n.bang === "khoa-dai-han") {
        // Con ai dung khoa dai han thi ghi lai — de biet khi nao tat duoc duong do.
        ky.tin(`[quyen] "${n.ten}" goi bang KHOA DAI HAN (chua doi sang ve)`);
      }
      return qua;
    },

    /** Doi khoa dai han lay ve. Tra `null` neu ma khong hop le. */
    phatVe(yc) {
      if (!boVe) return null;
      const n = ai(yc);
      if (n.vai === "khach-vang-lai") return null;
      const { ve, hetSauMs } = boVe.phat({ vai: n.vai, ten: n.ten });
      ky.tin(`[quyen] phat ve cho "${n.ten}" (${n.vai}), song ${Math.round(hetSauMs / 60000)} phut`);
      return { ve, vai: n.vai, ten: n.ten, hetSauMs };
    },

    /** Giu lai cho cho nao con goi truc tiep; duong moi thi khai `quyen` trong to khai. */
    laQuanTri: (yc) => ai(yc).vai === "quan-tri"
  };
}

module.exports = { taoCongQuyen, maTrongYeuCau, bangNhau };
