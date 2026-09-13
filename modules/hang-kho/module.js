// MODULE HANG HOA & KHO — mang "van-hanh", chay tren server cua khach.
//
// Day la GOC cua ca he: moi manh khac deu hoi no "con hang khong". Vi vay no khai nhieu
// dich vu hon cac module khac, va la module duy nhat duoc GHI vao bang hang hoa.
//
// Ba cua ra vao, khong co cua thu tu:
//   1. Image Tool day danh muc len        -> POST /api/products          (quan tri)
//   2. Desk day hang co san / chien dich  -> POST /api/ready-stock/sync  (quan tri)
//                                            POST /api/partner-campaigns (quan tri)
//   3. Web va bot doc                     -> GET /api/products (cong khai) + dich vu
//
// BA NGUON HANG NAM CHUNG MOT BANG (`hang_kho_bien_the`, khac nhau o cot `nguon`), nen
// khong con ham "gop" nao chay moi luot doc — va khong con ba ban su that de lech nhau.
// Dong bo mot nguon chi dung toi dong cua chinh nguon do.
//
// CHAN MA (v-block): ap o CA HAI dau — luc GHI va luc DOC. Chi chan mot dau thi mot duong
// vong nao do se lot; thuc te da tung xay ra nen ban dang chay cung chan hai dau.

"use strict";

const { SU_KIEN } = require("../../../hop-dong");
const { banCongKhai } = require("./chuan-hoa");
const { LUOC_DO } = require("./luoc-do");
const { taoKhoHang, NGUON } = require("./kho-bang");
const { doiGoiHangCoSan, doiGoiChienDich, KHO_CO_SAN_MAC_DINH } = require("./goi-desk");

const GIU_CHO_SONG_MS = 30 * 60 * 1000;   // giu 30 phut roi tra lai neu khong chot don
const PHUT10 = 10 * 60 * 1000;

function gioMySQL(d) {
  return new Date(d).toISOString().slice(0, 23).replace("T", " ");
}

// ---------- dich vu ----------

async function tim(ctx, { tuKhoa = "", gioiHan = 10 } = {}) {
  const mon = await taoKhoHang(ctx).timMon(tuKhoa, gioiHan);
  return mon.map(banCongKhai).filter(Boolean);
}

async function tonKho(ctx, { ma = "", size = "" } = {}) {
  const kq = await taoKhoHang(ctx).tonCuaMon(ma, size);
  if (!kq) return { co: false, viSao: "khong_co_ma", cacDong: [] };
  return { co: kq.cacDong.length > 0, ma: kq.ma, ten: kq.ten, cacDong: kq.cacDong };
}

/**
 * Giu cho mot bien the trong 30 phut.
 *
 * Doc ton roi ghi phieu la co khe: hai nguoi cung xin doi cuoi thi ca hai deu thay "con 1".
 * Vi vay ca hai viec nam trong MOT giao dich, va dong bien the bi KHOA (`FOR UPDATE`) —
 * nguoi thu hai phai doi, va khi doc lai thi thay da het.
 */
async function giuCho(ctx, { ma = "", size = "", soLuong = 1, cuaAi = "" } = {}) {
  const K = taoKhoHang(ctx);
  const can = Math.max(1, Math.trunc(Number(soLuong) || 1));
  const ton = await K.tonCuaMon(ma, size);
  if (!ton || ton.cacDong.length === 0) return { ok: false, viSao: "khong_du_hang" };

  const dong = ton.cacDong[0];
  const luc = ctx.cong.gio.bayGio();
  const maPhieu = `giu_${luc.getTime()}_${Math.random().toString(36).slice(2, 8)}`;

  const xong = await ctx.cong.kho.giaoDich(async (trong) => {
    const [khoaDong] = await trong.cauLenh(
      "SELECT ton FROM hang_kho_bien_the WHERE ma_bien_the = ? FOR UPDATE", [dong.maBienThe]
    );
    if (khoaDong.length === 0) return { ok: false, viSao: "khong_du_hang" };

    const [daGiu] = await trong.cauLenh(
      "SELECT COALESCE(SUM(so_luong), 0) AS n FROM hang_kho_giu_cho WHERE ma_bien_the = ? AND het_han_luc > ?",
      [dong.maBienThe, K.bayGio()]
    );
    const conLai = Number(khoaDong[0].ton || 0) - Number(daGiu[0].n || 0);
    if (conLai < can) return { ok: false, viSao: "khong_du_hang" };

    await trong.bang("hang_kho_giu_cho").them({
      ma_phieu: maPhieu, ma_bien_the: dong.maBienThe, ma_mon: ton.ma, size: dong.size,
      so_luong: can, cua_ai: String(cuaAi || ""),
      giu_luc: K.bayGio(),
      het_han_luc: gioMySQL(luc.getTime() + GIU_CHO_SONG_MS)
    });
    return { ok: true, conLaiSau: conLai - can };
  });

  if (!xong.ok) return xong;
  if (xong.conLaiSau <= 0) {
    ctx.bus.phat(SU_KIEN.hang_het, { ma: ton.ma, size: dong.size, maBienThe: dong.maBienThe });
  }
  return { ok: true, maPhieu, maBienThe: dong.maBienThe, size: dong.size, gia: dong.gia, maKho: dong.maKho };
}

async function traCho(ctx, { maPhieu = "" } = {}) {
  const so = await ctx.cong.kho.bang("hang_kho_giu_cho").xoa({ ma_phieu: String(maPhieu || "") });
  return { ok: so > 0 };
}

// ---------- ghi ----------

async function napNguon(ctx, nguon, than, tenNguon) {
  const vao = Array.isArray(than) ? than
    : (Array.isArray(than?.products) ? than.products : (Array.isArray(than?.items) ? than.items : null));
  if (!vao) return { ma: 400, than: { ok: false, error: "can_mot_mang_san_pham" } };

  const kq = await taoKhoHang(ctx).thayNguon(nguon, vao);
  ctx.cong.nhatKy.tin(
    `[hang-kho] nap ${tenNguon}: ${kq.soMon} mon / ${kq.soBienThe} bien the` +
    (kq.biBo > 0 ? `, bo ${kq.biBo} (ma bi chan hoac thieu ma/ten)` : "")
  );
  return { ma: 200, than: { ok: true, ...kq } };
}

module.exports = {
  id: "hang-kho",
  ten: "Hàng hoá & kho",
  mang: "van-hanh",
  chay: "server-khach",
  manh: "hang-kho",
  phienBan: "0.2.0",
  canCong: ["kho", "nhatKy", "gio", "bus", "cauHinh"],
  luocDo: LUOC_DO,

  suKien: { phat: [SU_KIEN.hang_het, SU_KIEN.hang_ve_lai], nghe: {} },

  capDichVu: {
    "hang-kho.tim": tim,
    "hang-kho.tonKho": tonKho,
    "hang-kho.giuCho": giuCho,
    "hang-kho.traCho": traCho,
    "hang-kho.doc": async (ctx, ma) => {
      const mon = await taoKhoHang(ctx).docMon(ma);
      return mon ? banCongKhai(mon) : null;
    }
  },

  duong: [
    {
      method: "GET", path: "/api/products", quyen: "cong-khai",
      viSaoCongKhai: "Danh muc de web ban hang hien thi. Ban tra ra da bo gia von va ton that.",
      hanGoi: { soLan: 600, trongMs: PHUT10 },
      tay: async (ctx, yc) => {
        const mon = await taoKhoHang(ctx).timMon(String(yc.truyVan.q || ""), Number(yc.truyVan.limit || 0));
        return {
          ma: 200,
          tieuDe: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" },
          than: mon.map(banCongKhai).filter(Boolean)
        };
      }
    },
    {
      method: "GET", path: "/api/products/:khoa", quyen: "cong-khai",
      viSaoCongKhai: "Trang san pham cong khai. Cung ban da bo gia von nhu danh muc.",
      hanGoi: { soLan: 600, trongMs: PHUT10 },
      tay: async (ctx, yc) => {
        const mon = await taoKhoHang(ctx).docMon(yc.tham.khoa);
        if (!mon) return { ma: 404, than: { ok: false, error: "khong_thay" } };
        return { ma: 200, tieuDe: { "Cache-Control": "public, max-age=300" }, than: banCongKhai(mon) };
      }
    },
    {
      // Image Tool day ca danh muc hang nha len.
      method: "POST", path: "/api/products", quyen: "quan-tri",
      hanGoi: { soLan: 20, trongMs: PHUT10 },
      // DO THAT 12/09/2026: ca danh muc 4.834 mon cua anh Dung nang 10,2 MB khi gui lai. Ban
      // dang chay dat han 10 MB — tuc la no dang sat mep, danh muc lon them chut la bi chan.
      // Ban tach de 16 MB cho co cho tho.
      hanThan: 16 * 1024 * 1024,
      tay: async (ctx, yc) => napNguon(ctx, NGUON.nha, await yc.doc(), "danh muc")
    },
    {
      // Sales Desk day hang co san (ready-stock). CHI dung toi dong `nguon = ready`.
      //
      // Goi that cua Desk KHONG dung `sizes` ma dung `variants` + `branches` + `policy` +
      // `pendingSales`, nen phai di qua lop dich `goi-desk.js`. Truoc 12/09/2026 duong nay
      // doc thang `sizes` — ca 80 mon hang co san bi bo sach ma khong bao mot loi nao.
      method: "POST", path: "/api/ready-stock/sync", quyen: "quan-tri",
      hanGoi: { soLan: 120, trongMs: PHUT10 },
      hanThan: 2 * 1024 * 1024,
      tay: async (ctx, yc) => {
        const goi = await yc.doc();
        if (!goi || typeof goi !== "object") return { ma: 400, than: { ok: false, error: "can_mot_goi_hang_co_san" } };

        // GOI CU KHONG DUOC DE LEN GOI MOI. Desk gui kem `revision` tang dan; mot lan gui lai
        // goi cu (mang chap chon, bam lai) se xoa mat ton vua dong bo. Tu choi thang.
        const so = ctx.cong.kho.so("hang-kho-hang-co-san");
        const revMoi = Number(goi.revision);
        const coRev = Number.isFinite(revMoi) && revMoi > 0;
        if (coRev) {
          const cu = await so.doc();
          if (cu && Number(cu.revision || 0) > revMoi) {
            ctx.cong.nhatKy.canhBao(`[hang-kho] tu choi goi hang co san cu: revision ${revMoi} < ${cu.revision}`);
            return { ma: 409, than: { ok: false, error: "goi_hang_co_san_cu", revisionHienTai: Number(cu.revision || 0) } };
          }
        }

        const khoChoPhep = Array.isArray(ctx.cauHinh.khoHangCoSan) && ctx.cauHinh.khoHangCoSan.length
          ? ctx.cauHinh.khoHangCoSan
          : KHO_CO_SAN_MAC_DINH;
        const mon = doiGoiHangCoSan(Array.isArray(goi) ? { products: goi } : goi, { khoChoPhep });
        const ra = await napNguon(ctx, NGUON.coSan, mon, "hang co san");
        if (coRev && ra.ma === 200) {
          await so.ghi({ revision: revMoi, luc: ctx.cong.gio.bayGio().toISOString() });
          ra.than.revision = revMoi;
        }
        return ra;
      }
    },
    {
      // Chien dich doi tac (Supersports/MaxxSport). CHI dung toi dong `nguon = campaign`.
      //
      // Lop dich bo chien dich da tat / da het han, va gan MA DONG cho tung size — bao het
      // hang khoa theo ma dong, khong theo vi tri (su co 10/09).
      method: "POST", path: "/api/partner-campaigns", quyen: "quan-tri",
      hanGoi: { soLan: 20, trongMs: PHUT10 },
      hanThan: 5 * 1024 * 1024,
      tay: async (ctx, yc) => {
        const goi = await yc.doc();
        if (!goi || typeof goi !== "object") return { ma: 400, than: { ok: false, error: "can_mot_goi_chien_dich" } };
        const mon = doiGoiChienDich(Array.isArray(goi) ? { products: goi } : goi, { bayGio: ctx.cong.gio.bayGio() });
        return napNguon(ctx, NGUON.chienDich, mon, "chien dich doi tac");
      }
    },
    {
      // Ban trong nha cho man quan tri — CO ton that.
      method: "GET", path: "/api/admin/products", quyen: "quan-tri",
      tay: async (ctx, yc) => ({
        ma: 200,
        tieuDe: { "Cache-Control": "no-store" },
        than: await taoKhoHang(ctx).timMon(String(yc.truyVan.q || ""), Number(yc.truyVan.limit || 0))
      })
    },
    {
      // Bo nao hoi ton de tra loi khach.
      method: "GET", path: "/api/hang-kho/ton/:ma", quyen: "dich-vu",
      tay: async (ctx, yc) => ({
        ma: 200, tieuDe: { "Cache-Control": "no-store" },
        than: await tonKho(ctx, { ma: yc.tham.ma, size: yc.truyVan.size })
      })
    }
  ],

  congCuBot: [
    { ten: "tim_hang", moTa: "Tìm món hàng theo mã hoặc tên", hieuUng: "doc" },
    { ten: "tra_ton", moTa: "Còn hàng không, size nào còn", hieuUng: "doc" },
    { ten: "giu_cho", moTa: "Giữ chỗ một size trong 30 phút khi khách chốt", hieuUng: "ghi" }
  ]
};
