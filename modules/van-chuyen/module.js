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
