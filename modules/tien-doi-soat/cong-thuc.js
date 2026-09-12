// CONG THUC TIEN — port nguyen ban tu `server.js`.
//
// LUAT SO MOT cua ca ba repo (chot 08/08/2026): "truong chung mot goc". Moi cho doc
// "tien da tra / con phai tra / COD" deu phai di qua `chung/order-money-kit.js` — tep do
// giong Y HET o ba repo va co bai so tung byte. Tep nay KHONG tinh lai ba con so do;
// no chi lo phan RIENG cua landing: khach chon tra bao nhieu, va lam tron the nao.
//
// BON LUA CHON (giu dung ban dang chay):
//   confirm_first  — shop xac nhan truoc, tra sau. Coc theo % cau hinh.
//   deposit        — dat coc truoc, con lai + ship tra khi nhan. Coc theo % cau hinh.
//   deposit_hold   — "giu don 20%" (anh Dung giao 02/09). Cung `bank_deposit` voi deposit,
//                    phan biet bang ghi chu trong nhat ky de shop doi soat dung so.
//   full           — tra truoc 100%, MIEN PHI SHIP.
//
// Quirk 04/09 phai giu: doi lua chon thi GHI LAI so tien phai tra. Truoc day chi ghi
// phuong thuc + phi ship, nen khach bam 100% roi doi y sang "giu don 20%" ma Telegram va
// ma QR van hien so cu.

"use strict";

const PHAN_TRAM_GIU_DON = 20;

/** Phuong thuc ghi xuong don, theo lua chon cua khach. */
const PHUONG_THUC = {
  confirm_first: "manual_confirm",
  deposit: "bank_deposit",
  deposit_hold: "bank_deposit",
  full: "bank_full_prepaid"
};

const GHI_CHU = {
  full: "Khách chọn thanh toán trước 100%, miễn phí ship.",
  deposit_hold: `Khách chọn GIỮ ĐƠN ${PHAN_TRAM_GIU_DON}%, còn lại + phí ship thanh toán khi nhận hàng.`,
  deposit: "Khách chọn đặt cọc trước, còn lại + phí ship thanh toán khi nhận hàng.",
  confirm_first: "Khách chọn shop xác nhận trước, thanh toán sau."
};

/**
 * Lam tron so tien phai tra: ve hang chuc nghin, toi thieu 10.000d, khong vuot tong don.
 * Phai GIONG cach lam tron ben trang dat hang, neu khong so khach nhin thay khac so ghi
 * vao don — va khach se goi dien hoi.
 */
function theoPhanTram(tong, phanTram) {
  const p = Math.max(1, Math.min(100, Number(phanTram) || 100));
  const t = Math.max(0, Number(tong || 0));
  if (t <= 0) return 0;
  const lamTron = Math.max(10000, Math.round((t * p / 100) / 10000) * 10000);
  return Math.min(Math.ceil(t), lamTron);
}

/** So tien phai tra ngay, theo lua chon. `phanTramCoc` la cau hinh cua shop. */
function tienPhaiTra(luaChon, tong, phanTramCoc = 100) {
  const t = Math.max(0, Number(tong || 0));
  if (t <= 0) return 0;
  if (luaChon === "full") return Math.ceil(t);
  if (luaChon === "deposit_hold") return theoPhanTram(t, PHAN_TRAM_GIU_DON);
  return theoPhanTram(t, phanTramCoc);
}

/** Phi ship: chon tra truoc 100% thi mien phi ship. */
function phiShip(luaChon, phiMacDinh = 30000) {
  return luaChon === "full" ? 0 : Math.max(0, Math.round(Number(phiMacDinh) || 0));
}

/**
 * Ma chuyen khoan de shop doi soat: `<tien to>-<8 ky tu cuoi cua ma don>`.
 * Tien to la cua tung shop (cau hinh), nen hai shop khong bao gio doc nham tien cua nhau.
 */
function maChuyenKhoan(maDon, tienTo = "TR") {
  const t = String(tienTo || "TR").trim().replace(/[^a-z0-9_-]/gi, "").slice(0, 12) || "TR";
  const duoi = String(maDon || Date.now()).replace(/[^0-9a-z]/gi, "").slice(-8).toUpperCase();
  return `${t}-${duoi}`;
}

function laLuaChonHopLe(luaChon) {
  return Object.prototype.hasOwnProperty.call(PHUONG_THUC, String(luaChon || ""));
}

module.exports = {
  PHUONG_THUC, GHI_CHU, PHAN_TRAM_GIU_DON,
  theoPhanTram, tienPhaiTra, phiShip, maChuyenKhoan, laLuaChonHopLe
};
