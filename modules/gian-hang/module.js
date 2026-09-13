// MODULE GIAN HANG — mat web khach nhin thay. Mang "van-hanh", chay tren server cua khach.
//
// Module nay KHONG co nghiep vu: no khong biet gia, khong biet ton, khong ghi mot bang nao.
// Viec cua no dung ba thu:
//   1. Tra dung tep cua mat web (HTML, CSS, JS, anh) — qua cong `tepTinh`, khong tu mo `fs`.
//   2. Dat lai vai duong cho de nho: "/" -> index.html, "/mobile" -> mobile.html,
//      "/product/<slug>" -> product.html.
//   3. Nhet the Open Graph vao trang san pham, vi crawler Facebook khong chay JavaScript.
//
// GIAO DIEN O DAY LA BAN COP Y NGUYEN tu ban dang chay (thu muc `goc/`), theo dung y anh Dung
// 12/09/2026: "cu nhet cho du tinh nang de chay thu, sau se cai tien tung module". Nen `goc/`
// duoc mien tru khoi luat tach biet, va khong ai duoc coi no la code da tach.
//
// CHO DE LO TEP NHAT trong ca he la cho nay. Vi vay cong `tepTinh` CHO QUA THEO DANH SACH
// (duoi tep phai duoc khai), chu khong chan theo danh sach xau.

"use strict";

const { nhetThe, khoaTuDuong } = require("./og");
const { dichToken } = require("./chia-se");

const PHUT10 = 10 * 60 * 1000;

/** Mat web nam trong `goc/` cua chinh module nay. */
function moKhu(ctx) {
  return ctx.cong.tepTinh.mo(`${ctx.id}/goc`);
}

function laDienThoai(yc) {
  const ua = String(yc.tieuDe?.["user-agent"] || "").toLowerCase();
  return /iphone|ipod|android.*mobile|windows phone|blackberry|mobile safari/.test(ua);
}

function gocSite(ctx) {
  return String(ctx.cauHinh.gocSite || "https://toprun.site").trim().replace(/\/+$/, "");
}

/**
 * Anh san pham that nam o site that: 33.809 tep, 7,6 GB — khong cop sang ban tach.
 *
 * Nen khi mot tep trong `/assets/` khong co o day va anh da khai `gocAnhThat`, ta 302 sang
 * site that de trinh duyet tu lay. May thu KHONG goi ra ngoai (khong di qua che do thu),
 * no chi chi duong.
 *
 * Duong dich KHONG lay tu yeu cau: goc lay tu cau hinh, duong phai khop dung mau anh duoi
 * day. Nho vay day khong bao gio thanh mot cua chuyen huong mo.
 */
const MAU_ANH = /^\/assets\/[A-Za-z0-9_\-./]+\.(?:png|jpe?g|webp|gif|svg|ico|woff2?|ttf|mp4)$/i;

function anhOSiteThat(ctx, duong) {
  const goc = String(ctx.cauHinh.gocAnhThat || "").trim().replace(/\/+$/, "");
  if (!goc) return null;
  const d = String(duong || "");
  if (d.includes("..") || !MAU_ANH.test(d)) return null;
  return `${goc}${d}`;
}

async function traTep(ctx, duong, theoTieuDe = {}) {
  const tep = await moKhu(ctx).doc(duong);
  if (!tep) {
    const thay = anhOSiteThat(ctx, duong);
    if (thay) return { chuyenHuong: thay, ma: 302, tieuDe: { "Cache-Control": "public, max-age=86400" } };
    return { ma: 404, than: { ok: false, error: "khong_thay" } };
  }
  return {
    ma: 200,
    tieuDe: { "Cache-Control": tep.nhoDem, ...theoTieuDe },
    tep: { duLieu: tep.duLieu, kieu: tep.kieu }
  };
}

/** Trang san pham: doc mon roi nhet the OG. Khong co module Hang kho thi tra trang tran. */
async function trangSanPham(ctx, yc) {
  const mau = await moKhu(ctx).doc("/product.html");
  if (!mau) return { ma: 404, than: { ok: false, error: "khong_thay" } };

  const khoa = khoaTuDuong({ duong: yc.duong, truyVan: yc.truyVan });
  let mon = null;
  if (khoa && khoa.length <= 160 && ctx.dichVu["hang-kho"]?.doc) {
    try {
      const tim = await ctx.dichVu["hang-kho"].doc(khoa);
      if (tim && String(tim.status || "").trim().toLowerCase() !== "hidden") mon = tim;
    } catch (e) {
      // Hong duong doc mon thi van phai tra trang cho khach xem — chi mat the OG.
      ctx.cong.nhatKy.canhBao(`[gian-hang] khong doc duoc mon "${khoa}": ${e?.message || e}`);
    }
  }

  const khu = moKhu(ctx);
  const { html, timThay } = await nhetThe({
    mau: mau.duLieu.toString("utf8"),
    mon, khoa,
    gocSite: gocSite(ctx),
    coTep: (duong) => khu.co(duong),
    gocAnhThat: String(ctx.cauHinh.gocAnhThat || "").trim().replace(/\/+$/, "")
  });

  return {
    ma: 200,
    tieuDe: {
      "Cache-Control": "public, max-age=300",
      ...(timThay ? {} : { "X-Robots-Tag": "noindex, nofollow" })
    },
    tep: { duLieu: Buffer.from(html, "utf8"), kieu: "text/html; charset=utf-8" }
  };
}

module.exports = {
  id: "gian-hang",
  ten: "Gian hàng (mặt web)",
  mang: "van-hanh",
  chay: "server-khach",
  manh: "gian-hang",
  phienBan: "0.1.0",
  canCong: ["tepTinh", "nhatKy", "cauHinh"],

  // Co module Hang kho thi trang san pham co the OG; khong co thi van chay, chi mat the.
  canDichVuNeuCo: ["hang-kho.doc"],

  duong: [
    {
      method: "GET", path: "/", quyen: "cong-khai",
      viSaoCongKhai: "Trang chu cua web ban hang. Chi tra tep tinh, khong doc du lieu khach.",
      hanGoi: { soLan: 600, trongMs: PHUT10 },
      tay: async (ctx, yc) => {
        // Dien thoai vao "/" thi day sang ban mobile — giong ban dang chay.
        if (laDienThoai(yc)) {
          const truyVan = new URLSearchParams(yc.truyVan).toString();
          return { chuyenHuong: `/mobile${truyVan ? `?${truyVan}` : ""}`, ma: 302 };
        }
        return traTep(ctx, "/index.html");
      }
    },
    {
      method: "GET", path: "/mobile", quyen: "cong-khai",
      viSaoCongKhai: "Ban web cho dien thoai. Chi tra tep tinh, khong doc du lieu khach.",
      hanGoi: { soLan: 600, trongMs: PHUT10 },
      tay: async (ctx) => traTep(ctx, "/mobile.html")
    },
    {
      method: "GET", path: "/product.html", quyen: "cong-khai",
      viSaoCongKhai: "Trang san pham cong khai, kem the OG de share ra Facebook.",
      hanGoi: { soLan: 600, trongMs: PHUT10 },
      tay: trangSanPham
    },
    {
      method: "GET", path: "/product/:khoa", quyen: "cong-khai",
      viSaoCongKhai: "Trang san pham cong khai theo duong dan dep, kem the OG.",
      hanGoi: { soLan: 600, trongMs: PHUT10 },
      tay: trangSanPham
    },
    {
      method: "GET", path: "/l/:token", quyen: "cong-khai",
      viSaoCongKhai: "Link chia se bo loc. Chi 302 ve chinh site, khoa loc phai co trong danh sach khai.",
      hanGoi: { soLan: 300, trongMs: PHUT10 },
      tay: async (ctx, yc) => ({
        chuyenHuong: dichToken(yc.tham.token), ma: 302,
        tieuDe: { "Cache-Control": "public, max-age=300", "X-Robots-Tag": "noindex" }
      })
    },
    {
      // BAT MOI THU CON LAI. Duong nay xet SAU CUNG (bo dinh tuyen xep duong co "*" xuong
      // cuoi), nen no khong bao gio nuot duong API cua module khac.
      method: "GET", path: "/*", quyen: "cong-khai",
      viSaoCongKhai: "Tep cua mat web (CSS, JS, anh). Cong tepTinh chi tra duoi tep da khai, trong dung thu muc goc/ cua module.",
      hanGoi: { soLan: 6000, trongMs: PHUT10 },
      tay: async (ctx, yc) => traTep(ctx, yc.duong)
    }
  ]
};
