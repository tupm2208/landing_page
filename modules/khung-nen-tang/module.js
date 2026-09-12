// KHUNG NEN TANG — phan ha tang chung, KHONG ban rieng va khong tat duoc.
//
// Ban dac ta goi day la "Khung nen tang, 12 duong, khong thuoc manh nao": tai khoan quan tri,
// thiet bi, thao tac nhanh, cau hinh ban dau, phien ban dang chay. Dot nay moi co mot duong —
// doi khoa dai han lay VE 15 phut (anh Dung duyet 12/09/2026).

"use strict";

const { noiDungMacDinh, chuanHoa, soCuaTien } = require("./noi-dung");

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
  phienBan: "0.2.0",
  canCong: ["quyen", "nhatKy", "cauHinh", "kho", "gio"],

  capDichVu: {
    // Module Tien doc phan tram coc / phi ship / tien to chuyen khoan tu day, de chu shop sua
    // mot cho trong man quan tri la ca he doi theo.
    "khung-nen-tang.noiDung": async (ctx) => docNoiDung(ctx),
    "khung-nen-tang.soCuaTien": async (ctx) => soCuaTien(await docNoiDung(ctx))
  },

  duong: [
    {
      // Doi khoa dai han lay ve ngan han. Duong nay CHINH la cho de do ma, nen han chat.
      method: "POST", path: "/api/ve", quyen: "dich-vu",
      hanGoi: { soLan: 60, trongMs: 10 * 60 * 1000 },
      tay: async (ctx, yc) => {
        const cap = ctx.cong.quyen.phatVe(yc);
        if (!cap) {
          return { ma: 503, than: { ok: false, error: "chua_bat_ve", message: "Máy chủ chưa bật vé ngắn hạn." } };
        }
        return {
          ma: 200,
          tieuDe: { "Cache-Control": "no-store" },
          than: { ok: true, ve: cap.ve, vai: cap.vai, ten: cap.ten, hetSauGiay: Math.round(cap.hetSauMs / 1000) }
        };
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
