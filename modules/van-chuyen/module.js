// MODULE VAN CHUYEN — mang "van-hanh", chay tren server cua khach.
//
// Viec cua no: nhan mot PHIEU GUI da chuan hoa, tao van don o hang van chuyen, giu lai ma
// van don, va tra loi duoc cau hoi "don em toi dau roi".
//
// No KHONG biet don hang cua shop trong nhu the nao. Module Don hang (va Mua ho) dung phieu
// gui roi goi dich vu o day. Nho vay doi hinh dang don hang khong dung toi van chuyen, va
// doi hang van chuyen khong dung toi don hang.
//
// PHIEU GUI:
//   {
//     maPhieu,                                   -> ma doi tac van chuyen tham chieu
//     nguoiGui:  { ten, dienThoai, tinh, huyen, xa, diaChiChiTiet },
//     nguoiNhan: { ten, dienThoai, tinh, huyen, xa, diaChiChiTiet, diaChiDayDu, heDiaChi },
//     mon: [{ ten, soLuong, donGia, canNangKg }],
//     cod, giaTriHang, canNangKg, aiTraShip, danDo, tenGoiHang
//   }

"use strict";

const { SU_KIEN } = require("../../../hop-dong");
const spx = require("./spx");
const vtp = require("./vtp");

const SO_VAN_DON = "van-don";

function soMacDinh() { return { version: 1, vanDon: {}, updatedAt: "" }; }

function hangVanChuyen(ctx, ten) {
  const chon = String(ten || ctx.cauHinh.hangMacDinh || "spx").toLowerCase();
  if (chon === "spx") return { ten: "spx", ban: spx, cua: { httpNgoai: ctx.cong.httpNgoai, gio: ctx.cong.gio, cauHinh: ctx.cauHinh.spx ?? {} } };
  if (chon === "vtp" || chon === "viettelpost") return { ten: "vtp", ban: vtp, cua: { httpNgoai: ctx.cong.httpNgoai, gio: ctx.cong.gio, cauHinh: ctx.cauHinh.vtp ?? {} } };
  throw new Error(`Chua co hang van chuyen "${chon}".`);
}

/**
 * Dung PHIEU GUI tu mot don hang.
 *
 * Vi sao o day chu khong o OMI: OMI la man hinh, no khong duoc biet dia chi kho cua shop, khong
 * duoc tu tinh COD, khong duoc tu doan can nang. Man hinh chi noi "tao van don cho don nay".
 *
 * NGUOI GUI lay tu cau hinh cua may chu (dia chi shop) — thieu thi tra ve `thieu` de man hinh
 * bao nguoi ta phai khai, chu khong goi hang van chuyen voi dia chi rong.
 *
 * COD lay tu SO CON PHAI TRA cua don (do `order-money-kit` tinh, module Don hang annotate san).
 * Cam tu lay `total`: don da coc 20% ma thu COD ca tong la thu gap doi cua khach.
 */
function phieuTuDon(ctx, don, { hang = "", canNangKg = 0, danDo = "" } = {}) {
  const g = ctx.cauHinh.nguoiGui ?? {};
  const nguoiGui = {
    ten: String(g.ten || "").trim(),
    dienThoai: String(g.dienThoai || "").trim(),
    tinh: String(g.tinh || "").trim(),
    huyen: String(g.huyen || "").trim(),
    xa: String(g.xa || "").trim(),
    diaChiChiTiet: String(g.diaChiChiTiet || "").trim()
  };
  const thieu = Object.entries(nguoiGui).filter(([, v]) => v === "").map(([k]) => `nguoiGui.${k}`);

  const mon = (Array.isArray(don.items) ? don.items : []).map((m) => ({
    ten: String(m.productName || m.productCode || "Hàng").trim(),
    soLuong: Math.max(1, Math.trunc(Number(m.qty ?? m.quantity ?? 1))),
    donGia: Math.max(0, Math.round(Number(m.price || 0))),
    canNangKg: 0
  }));
  if (mon.length === 0) thieu.push("don khong co mon nao");
  if (!String(don.phone || "").trim()) thieu.push("dien thoai nguoi nhan");

  const phieu = {
    maPhieu: String(don.id || "").trim(),
    hang: String(hang || "").trim() || undefined,
    nguoiGui,
    nguoiNhan: {
      ten: String(don.customerName || "").trim(),
      dienThoai: String(don.phone || "").trim(),
      tinh: String(don.province || "").trim(),
      huyen: String(don.district || "").trim(),
      xa: String(don.ward || "").trim(),
      diaChiChiTiet: String(don.addressDetail || "").trim(),
      diaChiDayDu: String(don.address || "").trim()
    },
    mon,
    // COD = so con phai tra, KHONG phai tong don.
    cod: Math.max(0, Math.round(Number(don.remainingAmount ?? don.total ?? 0))),
    giaTriHang: Math.max(0, Math.round(Number(don.total || 0))),
    canNangKg: Number(canNangKg) > 0 ? Number(canNangKg) : undefined,
    danDo: String(danDo || "").trim() || undefined
  };
  return { phieu, thieu };
}

/** Luu ma van don theo ma phieu, de tra cuu lai ma khong phai goi ra ngoai. */
async function ghiNho(ctx, maPhieu, ban) {
  const luc = ctx.cong.gio.bayGio().toISOString();
  await ctx.cong.kho.so(SO_VAN_DON).capNhat((cu) => {
    const so = cu ?? soMacDinh();
    return {
      version: 1,
      vanDon: { ...(so.vanDon ?? {}), [maPhieu]: { ...ban, luc } },
      updatedAt: luc
    };
  }, soMacDinh());
}

async function taoVanDon(ctx, phieu = {}) {
  if (!String(phieu.maPhieu || "").trim()) throw new Error("Phieu gui thieu `maPhieu`.");
  const hang = hangVanChuyen(ctx, phieu.hang);
  const kq = await hang.ban.taoVanDon(hang.cua, phieu);

  if (kq.daGoi && kq.ok) {
    await ghiNho(ctx, phieu.maPhieu, { hang: hang.ten, maVanDon: kq.maVanDon, duongTra: kq.duongTra, cod: kq.cod ?? 0 });
    ctx.bus.phat(SU_KIEN.van_don_da_tao, {
      maPhieu: phieu.maPhieu, hang: hang.ten, maVanDon: kq.maVanDon, duongTra: kq.duongTra
    });
  } else if (kq.daGoi) {
    ctx.cong.nhatKy.canhBao(`[van-chuyen] ${hang.ten} tu choi ${phieu.maPhieu}: ${kq.loiNhan}`);
  }
  return { ...kq, hang: hang.ten };
}

/**
 * Tra cuu: doc so truoc. Chua co trong so thi moi hoi hang van chuyen — bot hoi "don em toi
 * dau roi" rat nhieu lan cho cung mot don, khong the moi lan deu goi ra ngoai.
 */
async function traCuu(ctx, { maPhieu, maVanDon, hang } = {}) {
  const so = (await ctx.cong.kho.so(SO_VAN_DON).doc(soMacDinh())) ?? soMacDinh();
  const daBiet = maPhieu ? (so.vanDon ?? {})[maPhieu] : null;
  const ma = String(maVanDon || daBiet?.maVanDon || "").trim();
  if (!ma) return { ok: false, loiNhan: "Chưa có mã vận đơn cho đơn này." };

  const h = hangVanChuyen(ctx, hang || daBiet?.hang);
  const kq = await h.ban.traCuu(h.cua, ma);
  return { ...kq, maVanDon: ma, hang: h.ten, duongTra: kq.duongTra || daBiet?.duongTra || "" };
}

module.exports = {
  id: "van-chuyen",
  ten: "Vận chuyển",
  mang: "van-hanh",
  chay: "server-khach",
  phienBan: "0.1.0",
  canCong: ["kho", "nhatKy", "gio", "httpNgoai", "bus", "cauHinh"],
  // Tao van don TU MOT DON can doc don do. "NEU CO" vi nha ban hang co the khong mua manh Don
  // hang — khi do van chuyen van chay, chi khong co duong "tao van don tu don".
  canDichVuNeuCo: ["don-khach.doc"],

  suKien: {
    phat: [SU_KIEN.van_don_da_tao, SU_KIEN.van_don_doi_trang_thai],
    nghe: {}
  },

  capDichVu: {
    "van-chuyen.taoVanDon": taoVanDon,
    "van-chuyen.traCuu": traCuu,
    /** Kiem truoc khi tao that: phieu con thieu gi. Man hinh dung de bao nguoi ban sua. */
    "van-chuyen.kiemPhieu": (ctx, phieu = {}) => {
      const hang = hangVanChuyen(ctx, phieu.hang);
      if (hang.ten !== "spx") return { thieu: [], luuY: "Chỉ SPX kiểm trước được ở bản này." };
      return { thieu: spx.dungPayload({ phieu, cauHinh: hang.cua.cauHinh }).thieu };
    }
  },

  duong: [
    {
      method: "POST", path: "/api/van-chuyen/tao", quyen: "quan-tri",
      tay: async (ctx, yc) => {
        const kq = await taoVanDon(ctx, await yc.doc());
        if (kq.daGoi && kq.ok) return { ma: 200, than: { ok: true, ...kq } };
        if (!kq.daGoi) return { ma: 400, than: { ok: false, error: kq.viSao, thieu: kq.thieu ?? [] } };
        return { ma: 502, than: { ok: false, error: "hang_tu_choi", message: kq.loiNhan } };
      }
    },
    {
      // Mot nut tren man quan tri: tao van don cho don nay. Man hinh khong phai biet dia chi kho,
      // khong phai tu tinh COD — cho nay dung phieu gui ho.
      method: "POST", path: "/api/van-chuyen/tao-tu-don", quyen: "quan-tri",
      hanGoi: { soLan: 120, trongMs: 10 * 60 * 1000 },
      tay: async (ctx, yc) => {
        const than = await yc.doc();
        const maDon = String(than.maDon || than.orderId || "").trim();
        if (!maDon) return { ma: 400, than: { ok: false, error: "thieu_ma_don" } };

        const docDon = ctx.dichVu["don-khach"]?.doc;
        if (!docDon) {
          return { ma: 503, than: { ok: false, error: "chua_bat_manh_don_hang", message: "Chưa bật mảnh Đơn hàng nên không đọc được đơn." } };
        }
        const don = await docDon(maDon);
        if (!don) return { ma: 404, than: { ok: false, error: "khong_thay_don" } };

        const { phieu, thieu } = phieuTuDon(ctx, don, {
          hang: than.hang, canNangKg: than.canNangKg, danDo: than.danDo
        });
        if (thieu.length > 0) {
          return {
            ma: 400,
            than: {
              ok: false, error: "thieu_thong_tin", thieu,
              message: `Chưa tạo được vận đơn: thiếu ${thieu.join(", ")}.`
            }
          };
        }

        const kq = await taoVanDon(ctx, phieu);
        if (kq.daGoi && kq.ok) return { ma: 200, than: { ok: true, maDon, ...kq } };
        if (!kq.daGoi) return { ma: 400, than: { ok: false, error: kq.viSao, thieu: kq.thieu ?? [] } };
        return { ma: 502, than: { ok: false, error: "hang_tu_choi", message: kq.loiNhan } };
      }
    },
    {
      // Bo nao goi duong nay khi khach hoi "don em toi dau roi".
      method: "GET", path: "/api/van-chuyen/tra-cuu/:maPhieu", quyen: "dich-vu",
      tay: async (ctx, yc) => {
        const kq = await traCuu(ctx, { maPhieu: yc.tham.maPhieu });
        return { ma: kq.ok ? 200 : 404, tieuDe: { "Cache-Control": "no-store" }, than: { ok: kq.ok, ...kq } };
      }
    }
  ],

  congCuBot: [
    { ten: "tra_van_don", moTa: "Tra trạng thái vận đơn của một đơn", hieuUng: "doc" }
  ]
};
