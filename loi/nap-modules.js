// NAP MODULE TU THU MUC — va cho phep TAT tung module bang cau hinh.
//
// Khach mua goi nao thi bat module do. Tat mot module KHONG duoc lam gay module khac:
// neu gay, luat "chi noi chuyen qua cong" da bi pha o dau do, va khung se noi ro module
// nao dang dua vao module vua tat (loi tu `canDichVu`).

"use strict";

const fs = require("fs");
const path = require("path");

/**
 * @param thuMuc  duong toi `modules/`
 * @param bat     danh sach id duoc bat; bo trong = bat tat ca tim thay
 */
function napToKhais(thuMuc, { bat = null } = {}) {
  const ra = [];
  for (const m of fs.readdirSync(thuMuc, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!m.isDirectory()) continue;
    const tep = path.join(thuMuc, m.name, "module.js");
    if (!fs.existsSync(tep)) continue;           // module chua tach xong: chi co `goc/`
    if (bat && !bat.includes(m.name)) continue;
    const toKhai = require(tep);
    if (toKhai.id !== m.name) {
      throw new Error(`Module o thu muc "${m.name}" khai id "${toKhai.id}" — hai ten phai giong nhau.`);
    }
    ra.push(toKhai);
  }
  return ra;
}

/** Module nao co thu muc nhung chua co to khai — tuc chua tach. */
function moduleChuaTach(thuMuc) {
  return fs.readdirSync(thuMuc, { withFileTypes: true })
    .filter((m) => m.isDirectory() && !fs.existsSync(path.join(thuMuc, m.name, "module.js")))
    .map((m) => m.name);
}

module.exports = { napToKhais, moduleChuaTach };
