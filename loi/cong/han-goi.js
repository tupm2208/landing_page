// CHAN GOI DON — mot nguoi khong duoc goi mot duong qua nhieu lan trong mot khoang.
//
// Ban dang chay co viec nay (`rateLimitFor` + `consumeRateLimit`); ban tach lam MAT no khi
// cat module ra. Mat mot tinh nang an toan la LOI, khong phai no de sau — nen no quay lai
// o day, va lan nay chat hon mot bac: duong CONG KHAI bat buoc phai khai han, quen la
// khong nap duoc module (xem `hop-dong`).
//
// Vi sao dem theo IP: duong cong khai khong co ma nao de nhan ra nguoi goi. IP la thu duy
// nhat co san. No khong hoan hao (ca mot cong ty sau mot IP) nen han phai dat rong rai —
// muc dich la chan goi don, khong phai chan nguoi dung that.
//
// Ban trong bo nho, cho MOT tien trinh. Chay nhieu tien trinh thi moi tien trinh dem rieng,
// tuc la han thuc te nhan len so tien trinh — ghi ro o day de sau khong ai ngac nhien.

"use strict";

/**
 * Cua so co dinh: het khoang thi dem lai tu dau. Don gian va du cho viec chan goi don.
 * (Cua so truot chinh xac hon nhung ton bo nho gap nhieu lan cho mot loi ich rat nho.)
 */
function taoBoDemGoi({ gio, toiDaKhoa = 20000 } = {}) {
  const xo = new Map();

  function don(bayGio) {
    if (xo.size < toiDaKhoa) return;
    for (const [k, x] of xo) if (x.hetLuc <= bayGio) xo.delete(k);
    // Van day sau khi don (toan khoa con song): bo cai cu nhat de khong phinh vo han.
    if (xo.size >= toiDaKhoa) {
      const bo = Math.ceil(toiDaKhoa * 0.1);
      let i = 0;
      for (const k of xo.keys()) { xo.delete(k); i += 1; if (i >= bo) break; }
    }
  }

  return {
    /**
     * Tra `{ duoc, conLai, choLaiSauMs }`. `duoc = false` thi nguoi goi bi tu choi.
     */
    dem(khoa, soLan, trongMs) {
      const bayGio = gio.bayGio().getTime();
      const cu = xo.get(khoa);
      if (!cu || cu.hetLuc <= bayGio) {
        xo.set(khoa, { so: 1, hetLuc: bayGio + trongMs });
        don(bayGio);
        return { duoc: true, conLai: Math.max(0, soLan - 1), choLaiSauMs: trongMs };
      }
      cu.so += 1;
      const duoc = cu.so <= soLan;
      return { duoc, conLai: Math.max(0, soLan - cu.so), choLaiSauMs: Math.max(0, cu.hetLuc - bayGio) };
    },

    soKhoa: () => xo.size,
    xoaHet: () => xo.clear()
  };
}

/**
 * Dia chi nguoi goi that. Tren hosting va sau Cloudflare, `remoteAddress` la dia chi cua
 * lop proxy — moi nguoi chung mot IP thi chan nguoi nay la chan ca lang.
 *
 * CHI tin cac tieu de nay khi `tinProxy` bat. Bat no khi khong co proxy la de nguoi ta tu
 * khai IP cua minh va lach han goi.
 */
function diaChiNguoiGoi(yc, { tinProxy = false } = {}) {
  const td = yc?.tieuDe ?? {};
  if (tinProxy) {
    const ungVien = [
      td["cf-connecting-ip"], td["true-client-ip"], td["x-real-ip"], td["x-client-ip"],
      String(td["x-forwarded-for"] || "").split(",")[0]
    ];
    for (const x of ungVien) {
      const s = String(x || "").trim();
      if (s) return s;
    }
  }
  return String(yc?.ip || "").trim() || "khong-ro";
}

module.exports = { taoBoDemGoi, diaChiNguoiGoi };
