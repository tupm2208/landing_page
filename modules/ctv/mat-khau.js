// MAT KHAU CUA CONG TAC VIEN — bam va soi.
//
// Hinh dang ban bam GIU Y NGUYEN cua ban dang chay: `pbkdf2$<so vong>$<muoi>$<khoa>`, PBKDF2-
// SHA256, 210.000 vong, muoi 16 byte, khoa 32 byte, base64url. Nho vay 6 tai khoan CTV that
// nhap sang ban tach la dang nhap duoc NGAY bang dung mat khau cu — khong phai dat lai cho ai.
//
// Doi hinh dang nay = moi CTV phai dat lai mat khau. Neu sau nay muon doi (vi du sang scrypt),
// phai doc duoc CA HAI dang mot thoi gian, va nang len khi ho dang nhap thanh cong.
//
// HAI DIEU KHONG DUOC PHA:
//
// 1. SO SANH BANG `timingSafeEqual`. So sanh bang `===` la do duoc mat khau tung byte theo thoi
//    gian tra loi. Cham hon mot chut, nhung khong cho ai do gi.
// 2. SOI KHONG BAO GIO NEM. Ban bam trong so co the la rac (nhap tay, tep hong); nem o day thi
//    duong dang nhap tra 500 va nguoi ta khong biet vi sao. Rac = khong dung duoc, het.

"use strict";

const crypto = require("crypto");

const SO_VONG = 210000;
const DAI_MUOI = 16;
const DAI_KHOA = 32;

function bam(matKhau) {
  return new Promise((xong, hong) => {
    const muoi = crypto.randomBytes(DAI_MUOI).toString("base64url");
    crypto.pbkdf2(String(matKhau), muoi, SO_VONG, DAI_KHOA, "sha256", (e, khoa) => {
      if (e) return hong(e);
      xong(`pbkdf2$${SO_VONG}$${muoi}$${khoa.toString("base64url")}`);
    });
  });
}

function soi(matKhau, daBam) {
  return new Promise((xong) => {
    const [cach, soVongChu, muoi, khoaChu] = String(daBam || "").split("$");
    const soVong = Number(soVongChu);
    if (cach !== "pbkdf2" || !Number.isFinite(soVong) || soVong <= 0 || !muoi || !khoaChu) return xong(false);
    let mong;
    try { mong = Buffer.from(khoaChu, "base64url"); } catch { return xong(false); }
    crypto.pbkdf2(String(matKhau), muoi, soVong, mong.length, "sha256", (e, khoa) => {
      if (e) return xong(false);
      xong(mong.length === khoa.length && crypto.timingSafeEqual(mong, khoa));
    });
  });
}

/** Bam mot ma (ma thiet bi, ma phien) de KHONG luu ban ro trong so. */
function bamMa(ma) {
  return crypto.createHash("sha256").update(String(ma || "")).digest("hex");
}

module.exports = { bam, soi, bamMa, SO_VONG };
