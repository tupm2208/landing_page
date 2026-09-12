// MODULE HANG HOA & KHO — mang "van-hanh", chay tren server cua khach.
//
// Day la GOC cua ca he: moi manh khac deu hoi no "con hang khong". Vi vay no khai nhieu
// dich vu hon cac module khac, va la module duy nhat duoc GHI vao so hang hoa.
//
// Ba cua ra vao, khong co cua thu tu:
//   1. Image Tool day danh muc len  -> POST /api/products (quan tri)
//   2. Web va bot doc danh muc      -> GET  /api/products (cong khai, ban da bo gia von)
//   3. Manh khac hoi ton / giu cho  -> dich vu `hang-kho.*`
//
// CHAN MA (v-block): danh sach ma cam hien tren web duoc ap o CA HAI dau — luc GHI (Image
// Tool day len) va luc DOC (truoc khi tra ra ngoai). Chi chan mot dau thi mot duong vong
// nao do se lot: thuc te da tung xay ra nen ban dang chay cung chan hai dau.

"use strict";

const { SU_KIEN } = require("../../../hop-dong");
const { chuanHoaMon, banCongKhai, timTheoKhoa, khoaKho, soDuongDauTien, maBienThe, thuTuKho } = require("./chuan-hoa");

const SO_HANG = "hang-hoa";
const SO_CHAN = "ma-bi-chan";
const SO_GIU_CHO = "giu-cho";
const GIU_CHO_SONG_MS = 30 * 60 * 1000;   // giu cho 30 phut roi tra lai neu khong chot don

function soRong() { return { version: 1, mon: [], updatedAt: "" }; }
function giuChoRong() { return { version: 1, phieu: {}, updatedAt: "" }; }

// ---------- ma bi chan ----------

const chuanMa = (g) => String(g || "").trim().toLowerCase();

async function maBiChan(ctx) {
  const tuCauHinh = [
    ...(Array.isArray(ctx.cauHinh.maChanSan) ? ctx.cauHinh.maChanSan : []),
    ...String(ctx.cauHinh.maChanThem || "").split(",")
  ].map(chuanMa).filter(Boolean);
  const tuSo = await ctx.cong.kho.so(SO_CHAN).doc([]);
  const ds = Array.isArray(tuSo) ? tuSo : (Array.isArray(tuSo?.codes) ? tuSo.codes : []);
  return new Set([...tuCauHinh, ...ds.map(chuanMa).filter(Boolean)]);
}

function biChan(mon, cacMa) {
  if (!mon || !cacMa || cacMa.size === 0) return false;
  return cacMa.has(chuanMa(mon.code)) || cacMa.has(chuanMa(mon.originalCode));
}

// ---------- giu cho ton ----------

async function donPhieuHetHan(ctx) {
  const bayGio = ctx.cong.gio.bayGio().getTime();
  const so = (await ctx.cong.kho.so(SO_GIU_CHO).doc(giuChoRong())) ?? giuChoRong();
  const con = Object.fromEntries(Object.entries(so.phieu ?? {})
    .filter(([, p]) => Date.parse(p.hetHanLuc || "") > bayGio));
  return con;
}

/** Tong so dang bi giu cho cua mot bien the. */
function dangGiu(phieu, maBt) {
  return Object.values(phieu ?? {})
    .filter((p) => p.maBienThe === maBt)
    .reduce((t, p) => t + Math.max(0, Number(p.soLuong || 0)), 0);
}

// ---------- doc so ----------

/** Ban trong nha: da chuan hoa, da tru so dang giu cho, da bo ma bi chan. */
async function danhMucTrongNha(ctx) {
  const so = (await ctx.cong.kho.so(SO_HANG).doc(soRong())) ?? soRong();
  const cacMaChan = await maBiChan(ctx);
  const phieu = await donPhieuHetHan(ctx);

  return (Array.isArray(so.mon) ? so.mon : [])
    .map(chuanHoaMon).filter(Boolean)
    .filter((m) => !biChan(m, cacMaChan))
    .map((m) => ({
      ...m,
      sizes: (Array.isArray(m.sizes) ? m.sizes : []).map((d) => {
        const giu = dangGiu(phieu, maBienThe(m, d));
        if (giu <= 0) return d;
        const con = Math.max(0, Number(d.qty ?? d.available ?? d.stockQty ?? 0) - giu);
        return { ...d, qty: con };
      })
    }));
}

async function danhMucCongKhai(ctx) {
  return (await danhMucTrongNha(ctx)).map(banCongKhai).filter(Boolean);
}

// ---------- dich vu ----------

/** Tim mon theo ma hoac ten. Bo nao goi ham nay de tra loi "con mau nay khong". */
async function tim(ctx, { tuKhoa = "", gioiHan = 10 } = {}) {
  const chu = String(tuKhoa || "").trim().toLowerCase();
  if (!chu) return [];
  const cacMon = await danhMucCongKhai(ctx);
  const diem = (m) => {
    const ma = String(m.code || "").toLowerCase();
    const ten = String(m.name || "").toLowerCase();
    if (ma === chu) return 100;
    if (ma.startsWith(chu)) return 80;
    if (ten.includes(chu)) return 60;
    if (chu.split(/\s+/).every((t) => ten.includes(t))) return 40;
    return 0;
  };
  return cacMon
    .map((m, i) => ({ m, i, d: diem(m) }))
    .filter((x) => x.d > 0)
    // Bang diem thi giu THU TU SO — bai kiem tra khong duoc de hon ban dang chay.
    .sort((a, b) => b.d - a.d || a.i - b.i)
    .slice(0, Math.max(1, Number(gioiHan) || 10))
    .map((x) => x.m);
}

/**
 * Con hang khong, va neu con thi lay o kho nao truoc.
 * Tra ve `{ co, cacDong }` — `cacDong` da sap theo gia roi toi thu tu uu tien kho.
 */
async function tonKho(ctx, { ma = "", size = "" } = {}) {
  const mon = timTheoKhoa(await danhMucTrongNha(ctx), ma);
  if (!mon) return { co: false, viSao: "khong_co_ma", cacDong: [] };

  const muon = String(size || "").trim().toLowerCase();
  const cacDong = (Array.isArray(mon.sizes) ? mon.sizes : [])
    .filter((d) => Number(d.qty ?? d.available ?? d.stockQty ?? 0) > 0)
    .filter((d) => !muon || String(d.size || "").trim().toLowerCase() === muon)
    .map((d) => ({
      maBienThe: maBienThe(mon, d),
      size: String(d.size || "").trim(),
      soLuong: Math.max(0, Number(d.qty ?? d.available ?? d.stockQty ?? 0)),
      gia: soDuongDauTien(d.suggestedPrice, d.salePrice, d.sellPrice, d.price),
      maKho: String(d.warehouseId || "").trim() || khoaKho(d.warehouse || d.warehouseName),
      thuTu: thuTuKho(mon, d)
    }))
    .sort((a, b) => (a.gia || Number.MAX_SAFE_INTEGER) - (b.gia || Number.MAX_SAFE_INTEGER) || a.thuTu - b.thuTu);

  return { co: cacDong.length > 0, ma: mon.code, ten: mon.name, cacDong };
}

/**
 * Giu cho mot bien the trong 30 phut. Tra `{ ok, maPhieu }`.
 * Khong du hang thi TU CHOI — khong bao gio giu qua so ton.
 */
async function giuCho(ctx, { ma = "", size = "", soLuong = 1, cuaAi = "" } = {}) {
  const ton = await tonKho(ctx, { ma, size });
  const dong = ton.cacDong[0];
  const can = Math.max(1, Number(soLuong) || 1);
  if (!dong || dong.soLuong < can) return { ok: false, viSao: "khong_du_hang" };

  const luc = ctx.cong.gio.bayGio();
  const maPhieu = `giu_${luc.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
  await ctx.cong.kho.so(SO_GIU_CHO).capNhat((cu) => {
    const so = cu ?? giuChoRong();
    return {
      version: 1,
      phieu: {
        ...(so.phieu ?? {}),
        [maPhieu]: {
          maBienThe: dong.maBienThe, ma: ton.ma, size: dong.size, soLuong: can, cuaAi,
          luc: luc.toISOString(),
          hetHanLuc: new Date(luc.getTime() + GIU_CHO_SONG_MS).toISOString()
        }
      },
      updatedAt: luc.toISOString()
    };
  }, giuChoRong());

  if (dong.soLuong - can <= 0) {
    ctx.bus.phat(SU_KIEN.hang_het, { ma: ton.ma, size: dong.size, maBienThe: dong.maBienThe });
  }
  return { ok: true, maPhieu, maBienThe: dong.maBienThe, size: dong.size, gia: dong.gia, maKho: dong.maKho };
}

/** Tra lai cho da giu (khach huy, hay qua han). */
async function traCho(ctx, { maPhieu = "" } = {}) {
  let coKhong = false;
  await ctx.cong.kho.so(SO_GIU_CHO).capNhat((cu) => {
    const so = cu ?? giuChoRong();
    const phieu = { ...(so.phieu ?? {}) };
    coKhong = Boolean(phieu[maPhieu]);
    delete phieu[maPhieu];
    return { version: 1, phieu, updatedAt: ctx.cong.gio.bayGio().toISOString() };
  }, giuChoRong());
  return { ok: coKhong };
}

// ---------- ghi so ----------

/** Image Tool day ca danh muc len. Chan ma o dau GHI, khong chi o dau doc. */
async function napDanhMuc(ctx, than) {
  const vao = Array.isArray(than) ? than : (Array.isArray(than?.products) ? than.products : null);
  if (!vao) return { ma: 400, than: { ok: false, error: "can_mot_mang_san_pham" } };

  const cacMaChan = await maBiChan(ctx);
  const sach = vao.map(chuanHoaMon).filter(Boolean).filter((m) => !biChan(m, cacMaChan));
  const biBo = vao.length - sach.length;
  const luc = ctx.cong.gio.bayGio().toISOString();

  await ctx.cong.kho.so(SO_HANG).ghi({ version: 1, mon: sach, updatedAt: luc });
  ctx.cong.nhatKy.tin(`[hang-kho] nạp ${sach.length} món${biBo > 0 ? `, bỏ ${biBo} món (mã bị chặn hoặc thiếu mã/tên)` : ""}`);
  return { ma: 200, than: { ok: true, soMon: sach.length, biBo } };
}

module.exports = {
  id: "hang-kho",
  ten: "Hàng hoá & kho",
  mang: "van-hanh",
  chay: "server-khach",
  phienBan: "0.1.0",
  canCong: ["kho", "nhatKy", "gio", "bus", "cauHinh"],

  suKien: { phat: [SU_KIEN.hang_het, SU_KIEN.hang_ve_lai], nghe: {} },

  capDichVu: {
    "hang-kho.tim": tim,
    "hang-kho.tonKho": tonKho,
    "hang-kho.giuCho": giuCho,
    "hang-kho.traCho": traCho,
    /** Ban cong khai cua mot mon — dung khi can gui link mon hang cho khach. */
    "hang-kho.doc": async (ctx, ma) => timTheoKhoa(await danhMucCongKhai(ctx), ma)
  },

  duong: [
    {
      method: "GET", path: "/api/products", quyen: "cong-khai",
      viSaoCongKhai: "Danh mục để web bán hàng hiển thị. Bản trả ra đã bỏ giá vốn và tồn thật.",
      // Rong rai: mot nguoi mo web that co the tai danh muc nhieu lan trong mot phien.
      hanGoi: { soLan: 600, trongMs: 10 * 60 * 1000 },
      tay: async (ctx) => ({
        ma: 200,
        tieuDe: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" },
        than: await danhMucCongKhai(ctx)
      })
    },
    {
      method: "GET", path: "/api/products/:khoa", quyen: "cong-khai",
      viSaoCongKhai: "Trang sản phẩm công khai. Cùng bản đã bỏ giá vốn như danh mục.",
      hanGoi: { soLan: 600, trongMs: 10 * 60 * 1000 },
      tay: async (ctx, yc) => {
        const mon = timTheoKhoa(await danhMucCongKhai(ctx), yc.tham.khoa);
        if (!mon) return { ma: 404, than: { ok: false, error: "khong_thay" } };
        return { ma: 200, tieuDe: { "Cache-Control": "public, max-age=300" }, than: mon };
      }
    },
    {
      // Image Tool day danh muc len.
      method: "POST", path: "/api/products", quyen: "quan-tri",
      hanGoi: { soLan: 20, trongMs: 10 * 60 * 1000 },
      tay: async (ctx, yc) => napDanhMuc(ctx, await yc.doc())
    },
    {
      // Ban trong nha cho man quan tri — CO gia von va ton that.
      method: "GET", path: "/api/admin/products", quyen: "quan-tri",
      tay: async (ctx) => ({ ma: 200, tieuDe: { "Cache-Control": "no-store" }, than: await danhMucTrongNha(ctx) })
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
