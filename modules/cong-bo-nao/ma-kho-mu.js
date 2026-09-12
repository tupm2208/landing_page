// MA KHO GUI SANG BO NAO la mot ma mu, khong phai ma that.
//
// Ma kho that mang ten nguoi ("wh_yen", "wh_phuong_thu") va ten doi tac
// ("supersports_supersports_com_vn"). Bo nao chi dung ma nay de DEM co may nguon hang ("tong
// ton 3 tai 2 kho"), khong bao gio doc noi dung ma — nen bam no di la vua du viec, vua khong
// mang ten nguoi hay ten doi tac ra khoi may cua nha ban hang.
//
// Bam phai ON DINH: cung mot kho luon ra cung mot ma, khac kho ra khac ma. Neu khong, bo nao
// dem sai so nguon va noi voi khach "tai 3 kho" trong khi chi co mot.

"use strict";

const crypto = require("crypto");

function maKhoMu(maThat) {
  const chu = String(maThat || "").trim();
  if (!chu) return "";
  return `kho_${crypto.createHash("sha1").update(chu).digest("hex").slice(0, 8)}`;
}

module.exports = { maKhoMu };
