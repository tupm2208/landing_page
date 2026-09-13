// CHE DO THU — boc cong `httpNgoai` lai de ban thu KHONG lam gi that ra ngoai.
//
// Anh Dung chot 12/09/2026: chay thu bang du lieu that, luong Graph API duoc lay du lieu
// realtime, NHUNG "phan tra loi khach hang, hien tai khong duoc tra loi, tranh anh huong
// toi he thong dang chay".
//
// Vi vay che do thu lam dung mot viec: CHAN MOI LOI GOI CO TAC DUNG PHU THAT.
//
// Ba nguyen tac:
//
// 1. CHAN THEO MAC DINH. Khong phai "chan mot danh sach xau" ma "chi cho qua mot danh sach
//    da khai". Them mot doi tac moi ma quen khai thi no bi chan — chu khong phai lo ra
//    ngoai roi moi phat hien.
//
// 2. KHONG BAO GIO IM LANG. Bi chan thi NEM loi ro rang, khong tra ve "ok". Tra ve ok la
//    bo nao tuong da gui tin cho khach, va nhat ky thanh ra noi doi.
//
// 3. GHI LAI DA CHAN NHUNG GI. De sau doi chieu: o ban that, dung nhung loi goi nay se xay
//    ra — xem lai duoc la biet ban thu co dinh dung duong khong.

"use strict";

/** Loi goi nao duoc di that o che do thu. Chi DOC, khong bao gio ghi. */
const CHO_QUA = [
  // Doc du lieu tu Meta (thong tin trang, tin nhan, anh khach gui) — khong doi gi ben ho.
  { chu: "chi doc du lieu tu Meta", khop: (url, tuyChon) =>
    /^https:\/\/graph\.facebook\.com\//.test(url) && (tuyChon.method || "GET").toUpperCase() === "GET" }
];

/** Loi goi bi chan, kem cau giai thich cho nguoi doc nhat ky. */
const CHAN = [
  { chu: "gui tin cho khach qua Graph API", khop: (url) => /graph\.facebook\.com\/.*\/me\/messages/.test(url) },
  { chu: "gui tin Telegram cho nguoi ban hang", khop: (url) => /api\.telegram\.org/.test(url) },
  { chu: "tao van don SPX that", khop: (url) => /spx\.vn/.test(url) },
  { chu: "tao van don Viettel Post that", khop: (url) => /viettelpost\.vn/.test(url) }
];

class BiChanOCheDoThu extends Error {
  constructor(viec, url) {
    super(`Chế độ thử: chặn "${viec}". Bản thử không được làm việc này ra ngoài.`);
    this.name = "BiChanOCheDoThu";
    this.cheDoThu = true;
    this.viec = viec;
    this.dich = url;
  }
}

/**
 * @param httpNgoaiThat cong that (chi duoc goi cho nhung gi trong CHO_QUA)
 * @param choQuaThem  them dich duoc di that — vi du Xeon cua minh (day tin cho bo nao, dang ky
 *                    license): do la may cua MINH, khong phai khach hay doi tac.
 */
function bocCheDoThu({ httpNgoaiThat, nhatKy, choQuaThem = [] } = {}) {
  const ky = nhatKy ?? { tin: () => {}, canhBao: () => {} };
  const daChan = [];
  const danhSachChoQua = [...CHO_QUA, ...choQuaThem];

  return {
    daChan,
    async goi(url, tuyChon = {}) {
      const u = String(url);

      const choQua = danhSachChoQua.find((x) => x.khop(u, tuyChon));
      if (choQua) {
        ky.tin(`[thu] cho qua (${choQua.chu}): ${u.split("?")[0]}`);
        return httpNgoaiThat.goi(url, tuyChon);
      }

      // NGUYEN TAC 1: khong khop danh sach cho qua thi chan, du co ten trong CHAN hay khong.
      const biet = CHAN.find((x) => x.khop(u, tuyChon));
      const viec = biet ? biet.chu : `goi ra ngoai toi ${u.split("/")[2] || u}`;
      daChan.push({ viec, dich: u.split("?")[0], luc: new Date().toISOString(), than: tuyChon.body ? String(tuyChon.body).slice(0, 500) : "" });
      ky.canhBao(`[thu] CHAN: ${viec} -> ${u.split("?")[0]}`);

      // NGUYEN TAC 2: nem, khong tra ve ok.
      throw new BiChanOCheDoThu(viec, u);
    }
  };
}

module.exports = { bocCheDoThu, BiChanOCheDoThu, CHO_QUA, CHAN };
