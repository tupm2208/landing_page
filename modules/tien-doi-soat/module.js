// MODULE TIEN & DOI SOAT — mang "van-hanh", chay tren server cua khach.
//
// Viec cua no: khach chon tra bao nhieu, shop ghi nhan da nhan tien, va bao cho nguoi ban
// hang biet co tien vao. No KHONG so huu don hang — doc va sua don qua dich vu cua module
// Don hang. Nho vay chi co MOT cho ghi vao so don.
//
// BA LUAT KHONG DUOC PHA:
//
// 1. MOI CON SO TIEN DI QUA `order-money-kit`. Tep do giong y het o ba repo (Desk + hai
//    landing) va co bai so tung byte. Module nay chi tinh phan RIENG cua landing (khach
//    chon tra bao nhieu, lam tron the nao) — khong bao gio tu tinh lai "da tra / con phai
//    tra / COD".
//
// 2. GHI NHAN TIEN LA VIEC CUA NGUOI THAT. Khong cong cu nao mo cho bot mang hieu ung
//    "tien" — giao keo chan tu luc nap module.
//
// 3. TELEGRAM LA CAU HINH CUA TUNG KHACH (anh Dung chot 12/09: "nhung cai nay cung phai
//    setup cho khach"). Token va so nhom nam trong `ctx.cauHinh`, khong hang so trong ma.
//    Shop chua khai thi phan bao tin TAT, khong phai bao sang nhom cua shop khac.

"use strict";

const { SU_KIEN } = require("../../../hop-dong");
const tienKit = require("../../../chung/order-money-kit.js");
const { PHUONG_THUC, GHI_CHU, tienPhaiTra, phiShip, maChuyenKhoan, laLuaChonHopLe } = require("./cong-thuc");

const PHUT10 = 10 * 60 * 1000;

function cauHinhTien(ctx) {
  const c = ctx.cauHinh ?? {};
  return {
    phanTramCoc: Math.max(1, Math.min(100, Number(c.phanTramCoc || 100))),
    phiShipMacDinh: Number.isFinite(Number(c.phiShipMacDinh)) ? Number(c.phiShipMacDinh) : 30000,
    tienToChuyenKhoan: String(c.tienToChuyenKhoan || "TR"),
    telegram: {
      token: String(c.telegram?.token || "").trim(),
      nhom: String(c.telegram?.nhom || "").trim()
    }
  };
}

/**
 * Bao cho nguoi ban hang. KHONG cho ket qua va loi KHONG duoc chan viec chinh — bao tin
 * hong thi khach van phai dat duoc hang.
 */
function baoNguoiBan(ctx, chu) {
  const { telegram } = cauHinhTien(ctx);
  if (!telegram.token || !telegram.nhom) return false;   // shop chua khai: tat, khong bao bua
  Promise.resolve()
    .then(() => ctx.cong.httpNgoai.goi(`https://api.telegram.org/bot${telegram.token}/sendMessage`, {
      method: "POST",
      hanMs: 8000,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: telegram.nhom, text: chu, parse_mode: "HTML" })
    }))
    .then((tl) => { if (!tl.ok) ctx.cong.nhatKy.canhBao(`[tien] Telegram tu choi: HTTP ${tl.status}`); })
    .catch((e) => ctx.cong.nhatKy.canhBao(`[tien] khong bao duoc Telegram: ${e?.message || e}`));
  return true;
}

/** Ba con so tien cua mot don — LUON doc qua kit, khong tu suy dien. */
function tienCuaDon(don) {
  const daGan = tienKit.annotateOrderMoneyFields(don);
  return {
    tong: Number(daGan.total || 0),
    daTra: Number(daGan.paidAmount || 0),
    conPhaiTra: Number(daGan.remainingAmount || 0),
    cod: tienKit.codAmountForOrder(daGan)
  };
}

// ---------- dich vu ----------

/** Khach chon cach tra. Doi lua chon thi GHI LAI so tien — quirk 04/09. */
async function chonCachTra(ctx, { maDon = "", maTra = "", luaChon = "" } = {}) {
  if (!maDon || !maTra) return { ok: false, viSao: "thieu_ma_don_hoac_ma_tra" };
  if (!laLuaChonHopLe(luaChon)) return { ok: false, viSao: "lua_chon_khong_hop_le" };

  const don = await ctx.dichVu["don-khach"].docTheoMaTra({ maDon, maTra });
  if (!don) return { ok: false, viSao: "khong_thay_don" };

  const c = cauHinhTien(ctx);
  const soPhaiTra = tienPhaiTra(luaChon, don.total, c.phanTramCoc);
  const ship = phiShip(luaChon, c.phiShipMacDinh);

  await ctx.dichVu["don-khach"].ghiTien({
    maDon,
    phuongThuc: PHUONG_THUC[luaChon],
    soTien: soPhaiTra,
    maChuyenKhoan: maChuyenKhoan(maDon, c.tienToChuyenKhoan),
    ghiChu: GHI_CHU[luaChon]
  });

  baoNguoiBan(ctx, `💰 Đơn <b>${maDon}</b>: khách chọn <b>${luaChon}</b> — cần thu <b>${soPhaiTra.toLocaleString("vi-VN")}đ</b>`);
  return {
    ok: true, maDon, luaChon, phuongThuc: PHUONG_THUC[luaChon],
    soPhaiTra, phiShip: ship, maChuyenKhoan: maChuyenKhoan(maDon, c.tienToChuyenKhoan)
  };
}

/** Nguoi that ghi nhan da nhan tien. LUAT 2: khong bao gio mo cho bot. */
async function ghiNhanDaTra(ctx, { maDon = "", soTien = 0, boi = "nguoi-that", ghiChu = "" } = {}) {
  const so = Math.max(0, Math.round(Number(soTien) || 0));
  if (!maDon || so <= 0) return { ok: false, viSao: "thieu_ma_don_hoac_so_tien" };

  const don = await ctx.dichVu["don-khach"].doc(maDon);
  if (!don) return { ok: false, viSao: "khong_thay_don" };

  const truoc = tienCuaDon(don);
  const daTraMoi = truoc.daTra + so;
  const traDu = daTraMoi >= truoc.tong;

  await ctx.dichVu["don-khach"].ghiTien({
    maDon,
    trangThaiTien: traDu ? "paid" : "partially_paid",
    soTien: daTraMoi,
    ghiChu: ghiChu || `Ghi nhận đã trả ${so.toLocaleString("vi-VN")}đ (${boi}).`
  });

  ctx.bus.phat(SU_KIEN.tien_da_nhan, { maDon, soTien: so, daTra: daTraMoi, traDu });
  baoNguoiBan(ctx, `✅ Đơn <b>${maDon}</b>: đã nhận <b>${so.toLocaleString("vi-VN")}đ</b>` +
    (traDu ? " — <b>đủ tiền</b>" : ` — còn <b>${Math.max(0, truoc.tong - daTraMoi).toLocaleString("vi-VN")}đ</b>`));

  return { ok: true, maDon, daTra: daTraMoi, conPhaiTra: Math.max(0, truoc.tong - daTraMoi), traDu };
}

async function tienTrenDon(ctx, maDon) {
  const don = await ctx.dichVu["don-khach"].doc(String(maDon || ""));
  if (!don) return null;
  return { maDon: don.id, ...tienCuaDon(don) };
}

module.exports = {
  id: "tien-doi-soat",
  ten: "Tiền & đối soát",
  mang: "van-hanh",
  chay: "server-khach",
  phienBan: "0.1.0",
  canCong: ["nhatKy", "gio", "httpNgoai", "bus", "cauHinh"],
  canDichVu: ["don-khach.doc", "don-khach.docTheoMaTra", "don-khach.ghiTien"],

  suKien: { phat: [SU_KIEN.tien_da_nhan], nghe: {} },

  capDichVu: {
    "tien-doi-soat.tienTrenDon": tienTrenDon,
    "tien-doi-soat.chonCachTra": chonCachTra,
    "tien-doi-soat.ghiNhanDaTra": ghiNhanDaTra
  },

  duong: [
    {
      method: "POST", path: "/api/orders/public/payment-choice", quyen: "cong-khai",
      viSaoCongKhai: "Khách tự chọn cách trả cho đơn của chính mình. Tự bảo vệ bằng: phải có ĐÚNG mã đơn kèm mã tra cứu, và số tiền do server tính chứ không nhận từ khách.",
      hanGoi: { soLan: 30, trongMs: PHUT10 },
      tay: async (ctx, yc) => {
        const than = await yc.doc();
        const kq = await chonCachTra(ctx, {
          maDon: String(than.orderId || than.id || ""),
          maTra: String(than.token || than.orderToken || ""),
          luaChon: String(than.choice || than.luaChon || "")
        });
        return kq.ok ? { ma: 200, than: { ok: true, ...kq } } : { ma: 400, than: { ok: false, error: kq.viSao } };
      }
    },
    {
      // Nguoi that ghi nhan da nhan tien. Chi quan tri — LUAT 2.
      method: "POST", path: "/api/tien/da-tra", quyen: "quan-tri",
      hanGoi: { soLan: 120, trongMs: PHUT10 },
      tay: async (ctx, yc) => {
        const than = await yc.doc();
        const kq = await ghiNhanDaTra(ctx, {
          maDon: String(than.maDon || than.orderId || ""),
          soTien: than.soTien ?? than.amount,
          boi: String(than.boi || "quan-tri"),
          ghiChu: String(than.ghiChu || "")
        });
        return kq.ok ? { ma: 200, than: kq } : { ma: 400, than: { ok: false, error: kq.viSao } };
      }
    },
    {
      // Bo nao tra loi "em chuyen khoan roi" — CHI doc, khong ghi.
      method: "GET", path: "/api/tien/don/:maDon", quyen: "dich-vu",
      tay: async (ctx, yc) => {
        const kq = await tienTrenDon(ctx, yc.tham.maDon);
        if (!kq) return { ma: 404, than: { ok: false, error: "khong_thay_don" } };
        return { ma: 200, tieuDe: { "Cache-Control": "no-store" }, than: { ok: true, ...kq } };
      }
    }
  ],

  // LUAT 2: bot doc duoc tinh trang tien, khong bao gio ghi. Giao keo chan hieu ung "tien".
  congCuBot: [
    { ten: "tinh_trang_tien", moTa: "Đơn này đã trả bao nhiêu, còn phải trả bao nhiêu", hieuUng: "doc" }
  ]
};
