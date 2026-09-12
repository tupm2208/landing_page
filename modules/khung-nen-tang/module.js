// KHUNG NEN TANG — phan ha tang chung, KHONG ban rieng va khong tat duoc.
//
// Ban dac ta goi day la "Khung nen tang, 12 duong, khong thuoc manh nao": tai khoan quan tri,
// thiet bi, thao tac nhanh, cau hinh ban dau, phien ban dang chay. Dot nay moi co mot duong —
// doi khoa dai han lay VE 15 phut (anh Dung duyet 12/09/2026).

"use strict";

module.exports = {
  id: "khung-nen-tang",
  ten: "Khung nền tảng",
  mang: "khung",
  chay: "server-khach",
  phienBan: "0.1.0",
  canCong: ["quyen", "nhatKy", "cauHinh"],

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
