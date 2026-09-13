// KHUNG NEN TANG — phan ha tang chung, KHONG ban rieng va khong tat duoc.
//
// Ban dac ta goi day la "Khung nen tang, 12 duong, khong thuoc manh nao": tai khoan quan tri,
// thiet bi, cau hinh ban dau, phien ban dang chay. Tu 14/09/2026 (anh Dung chot) phan "thiet bi"
// khong con o day: may nao duoc vao la viec cua Xeon (license 3 may), landing chi giu khoa cong
// Xeon de soi ve. O day con: dang ky voi Xeon, noi dung trang, phien ban.

"use strict";

const { noiDungMacDinh, chuanHoa, soCuaTien } = require("./noi-dung");
const { dangKyXeon, docXeon, luuXeon, xeonGon } = require("./dang-ky-xeon");

const SO_NOI_DUNG = "khung-nen-tang-noi-dung";

async function docNoiDung(ctx) {
  const co = await ctx.cong.kho.so(SO_NOI_DUNG).doc();
  return co ? chuanHoa(co, co.updatedAt || ctx.cong.gio.bayGio()) : noiDungMacDinh();
}

module.exports = {
  id: "khung-nen-tang",
  ten: "Khung nền tảng",
  mang: "khung",
  chay: "server-khach",
  phienBan: "0.3.0",
  canCong: ["quyen", "nhatKy", "cauHinh", "kho", "gio", "httpNgoai"],

  capDichVu: {
    // Module Tien doc phan tram coc / phi ship / tien to chuyen khoan tu day, de chu shop sua
    // mot cho trong man quan tri la ca he doi theo.
    "khung-nen-tang.noiDung": async (ctx) => docNoiDung(ctx),
    "khung-nen-tang.soCuaTien": async (ctx) => soCuaTien(await docNoiDung(ctx)),
    // Hop thu doc o day de biet day tin sang Xeon nao, bang ma nao. Chua dang ky = null.
    "khung-nen-tang.xeon": async (ctx) => {
      const so = await docXeon(ctx.cong.kho);
      return so ? { shop: so.shop, diaChiXeon: so.diaChiXeon, maNhanTin: so.maNhanTin } : null;
    }
  },

  duong: [
    {
      // Man quan tri xem: landing nay la shop nao tren Xeon, dang ky luc nao. Khong lo ma nhan tin.
      method: "GET", path: "/api/admin/xeon", quyen: "quan-tri",
      hanGoi: { soLan: 120, trongMs: 10 * 60 * 1000 },
      tay: async (ctx, yc) => {
        const so = await docXeon(ctx.cong.kho);
        const toi = ctx.cong.quyen.ai(yc);
        return {
          ma: 200, tieuDe: { "Cache-Control": "no-store" },
          than: { ok: true, xeon: xeonGon(so), toi: { ten: toi.ten, vai: toi.vai, bang: toi.bang, manh: toi.manh ?? null, truc: toi.truc ?? null } }
        };
      }
    },
    {
      // Dang ky (lai) voi Xeon ngay luc dang chay — khi doi key, doi Xeon, hay cai lai.
      // Chi khoa dai han (Desk) hoac mot may da vao bang ve moi goi duoc: quan-tri.
      method: "POST", path: "/api/admin/xeon/dang-ky", quyen: "quan-tri",
      hanGoi: { soLan: 10, trongMs: 15 * 60 * 1000 },
      hanThan: 4 * 1024,
      tay: async (ctx, yc) => {
        const than = await yc.doc();
        const cu = await docXeon(ctx.cong.kho);
        try {
          const ban = await dangKyXeon({
            httpNgoai: ctx.cong.httpNgoai,
            diaChiXeon: than.diaChiXeon || cu?.diaChiXeon || ctx.cauHinh.diaChiXeon,
            key: than.key || cu?.key,
            diaChiLanding: than.diaChiLanding || cu?.diaChiLanding || ctx.cauHinh.diaChiLanding
          });
          await luuXeon(ctx.cong.kho, ban, ctx.cong.gio.bayGio());
          ctx.cong.quyen.datXeon({ keyId: ban.keyId, khoaCongPem: ban.khoaCongPem, shop: ban.shop });
          ctx.cong.nhatKy.tin(`[khung-nen-tang] dang ky voi Xeon ${ban.diaChiXeon}: shop "${ban.shop}"`);
          return { ma: 200, tieuDe: { "Cache-Control": "no-store" }, than: { ok: true, xeon: xeonGon({ ...ban, dangKyLuc: ctx.cong.gio.bayGio().toISOString() }) } };
        } catch (e) {
          ctx.cong.nhatKy.canhBao(`[khung-nen-tang] dang ky Xeon that bai: ${e.message}`);
          return { ma: 502, than: { ok: false, error: "dang_ky_that_bai", message: e.message } };
        }
      }
    },
    {
      // Mat web doc chu trang chu, phi ship, va thong tin chuyen khoan tu day.
      //
      // CONG KHAI co y: khach phai doc duoc so tai khoan de chuyen tien. Vi vay ban nay chi
      // chua nhung truong da khai trong `noi-dung.js` — khong bao gio co ma Telegram hay khoa.
      method: "GET", path: "/api/content", quyen: "cong-khai",
      viSaoCongKhai: "Chữ trên trang và thông tin chuyển khoản — thứ khách phải đọc được. Chỉ trả các trường đã khai, không có khoá nào.",
      hanGoi: { soLan: 600, trongMs: 10 * 60 * 1000 },
      tay: async (ctx) => ({
        ma: 200,
        tieuDe: { "Cache-Control": "public, max-age=60" },
        than: await docNoiDung(ctx)
      })
    },
    {
      // Chu shop sua noi dung trang.
      method: "POST", path: "/api/content", quyen: "quan-tri",
      hanGoi: { soLan: 60, trongMs: 10 * 60 * 1000 },
      hanThan: 256 * 1024,
      tay: async (ctx, yc) => {
        const than = await yc.doc();
        if (!than || typeof than !== "object" || Array.isArray(than)) {
          return { ma: 400, than: { ok: false, error: "can_mot_doi_tuong" } };
        }
        const cu = await docNoiDung(ctx);
        const moi = chuanHoa({ ...cu, ...than }, ctx.cong.gio.bayGio());
        await ctx.cong.kho.so(SO_NOI_DUNG).ghi(moi);
        ctx.cong.nhatKy.tin("[khung-nen-tang] noi dung trang da doi");
        return { ma: 200, tieuDe: { "Cache-Control": "no-store" }, than: { ok: true, noiDung: moi } };
      }
    },
    {
      // Ban dang chay co duong nay va Image Tool doc no sau moi lan deploy.
      method: "GET", path: "/api/runtime-version", quyen: "cong-khai",
      viSaoCongKhai: "Chỉ trả phiên bản đang chạy — không đọc dữ liệu của shop. Image Tool gọi sau mỗi lần deploy.",
      hanGoi: { soLan: 120, trongMs: 10 * 60 * 1000 },
      tay: async (ctx) => ({
        ma: 200,
        tieuDe: { "Cache-Control": "no-store" },
        than: { ok: true, deployId: String(ctx.cauHinh.deployId || "chua-dat"), runtimeRoot: "toprunvn-modules" }
      })
    }
  ],

  congCuBot: []
};
