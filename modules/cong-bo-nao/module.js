// CONG CHO BO NAO — mang "chatbot", chay tren server cua khach.
//
// Bo nao tren Xeon va server cua khach co HAI bo tu vung khac nhau: bo nao goi
// `stock.lookup`, module Hang hoa goi `tonKho`. Tep nay la CHO DUY NHAT dich giua hai ben.
// Khong co no thi moi module phai biet tu vung cua bo nao — va doi mot ten la sua bay noi.
//
// Ba luat cua cua nay:
//
// 1. CHI MO DUNG NHUNG GI GIAO KEO CHO. Cong cu la mot danh sach dong ben duoi; goi ten la
//    thi tu choi. Khong co duong "chay cau lenh tuy y".
//
// 2. TRA DON CHI KHOP SO KHACH TU GO. `order.lookup` bat buoc mang so dien thoai ma khach
//    da tu go TRONG hoi thoai do. Bot doan ra ma don cung khong tra don nguoi khac.
//
// 3. TIEN DI QUA MOT GOC. Truong tien tra ve lay tu don da annotate cua module Don hang,
//    khong tu tinh lai o day.

"use strict";

const { LOI } = require("../../../hop-dong");
const { maKhoMu } = require("./ma-kho-mu");

/** Mot mon o ban rut gon ma bo nao doi (`CatalogItemLite`). */
function monGon(mon = {}) {
  const gia = Number(mon.price || mon.suggestedPrice || 0);
  return {
    id: String(mon.code || ""),
    code: String(mon.code || ""),
    name: String(mon.name || ""),
    brand: String(mon.brand || "") || undefined,
    priceFrom: gia,
    variantCount: (Array.isArray(mon.sizes) ? mon.sizes : []).length,
    url: String(mon.slug || "") ? `/product.html?code=${encodeURIComponent(mon.code)}` : undefined
  };
}

/** Mot dong ton o hinh dang bo nao doi (`StockRow`). */
function dongTon(ma, d = {}) {
  return {
    itemId: String(ma || ""),
    variantId: String(d.maBienThe || ""),
    variantLabel: String(d.size || ""),
    // Ma kho bam di, ten kho de rong: cau tra loi gui khach cam kem ten kho hay ten doi tac
    // (anh Dung nhac 10/09). Bo nao chi can biet co MAY nguon, khong can biet nguon nao.
    warehouseId: maKhoMu(d.maKho),
    warehouseName: "",
    qty: Number(d.soLuong || 0),
    price: Number(d.gia || 0)
  };
}

function tienTrenDon(don = {}) {
  const tong = Number(don.total || 0);
  const daTra = Number(don.paidAmount || 0);          // LUAT 3: doc field da annotate
  const conLai = Number(don.remainingAmount ?? Math.max(0, tong - daTra));
  return { total: tong, paid: daTra, remaining: conLai, cod: conLai };
}

function donGon(don = {}) {
  return {
    orderId: String(don.id || ""),
    status: String(don.status || ""),
    createdAt: String(don.createdAt || ""),
    money: tienTrenDon(don),
    lines: (Array.isArray(don.items) ? don.items : []).map((d) => ({
      name: String(d.productName || d.productCode || ""),
      variantLabel: String(d.size || ""),
      qty: Number(d.qty || d.quantity || 1)
    }))
  };
}

/**
 * Bang cong cu. Moi dong: ten theo giao keo bo nao -> ham lam that.
 * Them cong cu moi = them mot dong o day, va no hien ngay trong `GET /api/bo-nao/cong-cu`.
 */
const CONG_CU = {
  "catalog.search": async (ctx, vao = {}) => {
    const mon = await ctx.dichVu["hang-kho"].tim({ tuKhoa: vao.q, gioiHan: Number(vao.limit || 10) });
    return { items: mon.map(monGon), truncated: mon.length >= Number(vao.limit || 10) };
  },

  "stock.lookup": async (ctx, vao = {}) => {
    const ma = String(vao.code || vao.itemId || "");
    const ton = await ctx.dichVu["hang-kho"].tonKho({ ma, size: vao.variantLabel });
    return {
      rows: (ton.cacDong ?? []).map((d) => dongTon(ton.ma ?? ma, d)),
      asOf: ctx.cong.gio.bayGio().toISOString(),
      truncated: false
    };
  },

  "order.lookup": async (ctx, vao = {}) => {
    // LUAT 2: khong co so khach tu go thi khong tra don nao.
    const soKhachTuGo = String(vao.phoneGivenInConversation || "").trim();
    if (!soKhachTuGo) return { orders: [] };
    const don = await ctx.dichVu["don-khach"].tim({ dienThoai: soKhachTuGo, gioiHan: 10 });
    return { orders: don.map(donGon) };
  },

  "payment.status": async (ctx, vao = {}) => {
    const don = await ctx.dichVu["don-khach"].doc(String(vao.orderId || ""));
    if (!don) return { money: { total: 0, paid: 0, remaining: 0, cod: 0 } };
    return { money: tienTrenDon(don) };
  },

  "shipment.track": async (ctx, vao = {}) => {
    const kq = await ctx.dichVu["van-chuyen"].traCuu({ maPhieu: String(vao.orderId || "") });
    if (!kq.ok) return { carrier: "", tracking: "", status: "chua_co_van_don", history: [] };
    return {
      carrier: String(kq.hang || ""),
      tracking: String(kq.maVanDon || ""),
      status: String(kq.don?.status || ""),
      history: []
    };
  },

  "storefront.link": async (ctx, vao = {}) => {
    const goc = String(ctx.cauHinh.diaChiWeb || "").replace(/\/+$/, "");
    const hoi = String(vao.q || "").trim();
    return { url: hoi ? `${goc}/?q=${encodeURIComponent(hoi)}` : `${goc}/` };
  }
};

/** Cong cu nao can dich vu nao moi mo duoc. Thieu dich vu = cong cu khong xuat hien. */
const CAN_DICH_VU = {
  "catalog.search": ["hang-kho", "tim"],
  "stock.lookup": ["hang-kho", "tonKho"],
  "order.lookup": ["don-khach", "tim"],
  "payment.status": ["don-khach", "doc"],
  "shipment.track": ["van-chuyen", "traCuu"],
  "storefront.link": null
};

/** Danh sach cong cu DANG MO voi ban cai nay — tuy khach mua nhung manh nao. */
function congCuDangMo(ctx) {
  return Object.keys(CONG_CU).filter((ten) => {
    const can = CAN_DICH_VU[ten];
    if (!can) return true;
    return typeof ctx.dichVu?.[can[0]]?.[can[1]] === "function";
  });
}

module.exports = {
  id: "cong-bo-nao",
  ten: "Cổng cho bộ não",
  mang: "chatbot",
  chay: "server-khach",
  manh: "chatbot-cskh",
  phienBan: "0.1.0",
  canCong: ["nhatKy", "gio", "cauHinh"],
  // Hang hoa la BAT BUOC: khong tra duoc ton thi bot khong co viec gi de lam.
  canDichVu: ["hang-kho.tim", "hang-kho.tonKho"],
  // Don hang va Van chuyen la TUY CHON: khach mua goi khong co hai manh nay thi cong cu
  // tuong ung bien mat khoi danh sach, bot khong bao gio goi toi — chu khong phai ca bot chet.
  canDichVuNeuCo: ["don-khach.doc", "don-khach.tim", "van-chuyen.traCuu"],

  duong: [
    {
      // Bo nao goi mot cong cu. Mot duong cho tat ca — de nhin mot cho la thay het.
      method: "POST", path: "/api/bo-nao/cong-cu", quyen: "dich-vu",
      tay: async (ctx, yc) => {
        const than = await yc.doc();
        const ten = String(than.ten || than.tool || "");
        const dangMo = congCuDangMo(ctx);
        const lam = dangMo.includes(ten) ? CONG_CU[ten] : null;
        if (!lam) {
          // LUAT 1: ten la (hoac manh chua mua) thi tu choi, va noi ro cai gi dang mo.
          return { ma: 400, than: { ok: false, error: "cong_cu_khong_co", dangMo } };
        }
        try {
          return { ma: 200, tieuDe: { "Cache-Control": "no-store" }, than: { ok: true, data: await lam(ctx, than.input ?? {}) } };
        } catch (e) {
          ctx.cong.nhatKy.canhBao(`[cong-bo-nao] "${ten}" loi: ${e.message}`);
          return { ma: 500, than: { ok: false, error: LOI.loi_he_thong, message: e.message } };
        }
      }
    },
    {
      method: "GET", path: "/api/bo-nao/cong-cu", quyen: "dich-vu",
      tay: async (ctx) => ({ ma: 200, than: { ok: true, congCu: congCuDangMo(ctx) } })
    }
  ],

  congCuBot: []
};
