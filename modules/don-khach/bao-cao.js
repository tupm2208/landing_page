// BAO CAO TONG QUAN — chu shop mo OMI ra la thay hom nay ban duoc bao nhieu.
//
// Ba luat cua tep nay:
//
// 1. TIEN DI QUA `order-money-kit`. Bao cao khong duoc tu cong `payment_amount` roi goi do la
//    "da thu": mot don ghi `paid` ma khong kem so tien la da tra DU tong don (luat cua kit).
//    Vi vay phan tien duoc tinh bang cach doc tung don roi dua qua kit — KHONG bang SUM() cua
//    MySQL. Cham hon, nhung khong bao gio lech voi con so khach thay tren man tra don.
//
// 2. CO CUA SO NGAY, va co tran. Mot shop chay ba nam co hang chuc nghin don; bao cao khong duoc
//    la mot cau lenh quet ca bang.
//
// 3. KHONG DEM DON DA HUY vao doanh thu. Don huy van duoc dem rieng de nguoi ta biet ty le huy.

"use strict";

const tienKit = require("../../../chung/order-money-kit.js");
const { gioMySQL, isoTuMySQL } = require("../../../chung/gio-mysql.js");

const NGAY_MAC_DINH = 14;
const NGAY_TOI_DA = 365;
const TRAN_DON = 20000;

const DA_HUY = new Set(["cancelled", "canceled"]);

/** Ngay theo gio dia phuong cua nguoi ban hang (mac dinh +07:00 — Viet Nam). */
function ngayDiaPhuong(iso, lechPhut) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  const doi = new Date(t.getTime() + lechPhut * 60 * 1000);
  return doi.toISOString().slice(0, 10);
}

/**
 * @param docDon ham doc cac dong don trong cua so ngay: (tuNgay) => dong[]
 */
async function tongQuan({ docDon, bayGio, soNgay = NGAY_MAC_DINH, lechPhut = 7 * 60 } = {}) {
  const ngay = Math.min(Math.max(1, Math.trunc(Number(soNgay) || NGAY_MAC_DINH)), NGAY_TOI_DA);
  const den = bayGio instanceof Date ? bayGio : new Date();
  const tu = new Date(den.getTime() - (ngay - 1) * 24 * 60 * 60 * 1000);
  // Cat ve dau ngay dia phuong, keo don sang nay 8 gio bi rot khoi cua so.
  const tuDauNgay = new Date(`${ngayDiaPhuong(tu.toISOString(), lechPhut)}T00:00:00.000Z`);
  tuDauNgay.setTime(tuDauNgay.getTime() - lechPhut * 60 * 1000);

  const dong = await docDon(gioMySQL(tuDauNgay));

  const tong = { soDon: 0, giaTri: 0, daThu: 0, conPhaiThu: 0, soDonHuy: 0, giaTriHuy: 0 };
  const theoTrangThai = new Map();
  const theoNgay = new Map();
  const banChay = new Map();

  for (const d of dong) {
    const don = {
      total: Number(d.total || 0),
      paymentStatus: String(d.payment_status || ""),
      paymentAmount: Number(d.payment_amount || 0)
    };
    const daThu = tienKit.paidAmountForOrder(don);
    const conPhai = tienKit.remainingAmountForOrder(don);
    const trangThai = String(d.status || "").toLowerCase();
    const huy = DA_HUY.has(trangThai);

    const tt = theoTrangThai.get(trangThai) ?? { trangThai, soDon: 0, giaTri: 0 };
    tt.soDon += 1;
    tt.giaTri += don.total;
    theoTrangThai.set(trangThai, tt);

    if (huy) {
      tong.soDonHuy += 1;
      tong.giaTriHuy += don.total;
      continue;                      // LUAT 3: khong dem vao doanh thu
    }

    tong.soDon += 1;
    tong.giaTri += don.total;
    tong.daThu += daThu;
    tong.conPhaiThu += conPhai;

    const n = ngayDiaPhuong(isoTuMySQL(d.created_at), lechPhut);
    const mn = theoNgay.get(n) ?? { ngay: n, soDon: 0, giaTri: 0, daThu: 0 };
    mn.soDon += 1;
    mn.giaTri += don.total;
    mn.daThu += daThu;
    theoNgay.set(n, mn);

    for (const m of Array.isArray(d.mon) ? d.mon : []) {
      const ma = String(m.product_code || "").trim() || "(không mã)";
      const b = banChay.get(ma) ?? { ma, ten: String(m.product_name || ""), soLuong: 0, giaTri: 0 };
      b.soLuong += Math.max(0, Math.trunc(Number(m.quantity || 0)));
      b.giaTri += Math.max(0, Number(m.price || 0)) * Math.max(0, Math.trunc(Number(m.quantity || 0)));
      banChay.set(ma, b);
    }
  }

  return {
    ok: true,
    soNgay: ngay,
    tuNgay: ngayDiaPhuong(tuDauNgay.toISOString(), lechPhut),
    denNgay: ngayDiaPhuong(den.toISOString(), lechPhut),
    chamTran: dong.length >= TRAN_DON,
    tong,
    theoTrangThai: [...theoTrangThai.values()].sort((a, b) => b.soDon - a.soDon),
    theoNgay: [...theoNgay.values()].sort((a, b) => (a.ngay < b.ngay ? 1 : -1)),
    banChay: [...banChay.values()].sort((a, b) => b.soLuong - a.soLuong).slice(0, 10)
  };
}

module.exports = { tongQuan, NGAY_MAC_DINH, NGAY_TOI_DA, TRAN_DON };
