// MODULE DON HANG & KHACH — mang "van-hanh", chay tren server cua khach.
//
// No LAM CHU ba bang co san tu ban dang chay: `orders`, `order_items`, `order_status_logs`.
// Ba bang nay khong doi ten duoc (Sales Desk va Image Tool dang goc vao do), nen chung duoc
// khai la `bangKeThua` — van mot chu duy nhat, chi la khong theo luat tien to.
//
// BA LUAT KHONG DUOC PHA:
//
// 1. DAT DON PHAI GIU CHO TON TRUOC. Ghi don ma khong giu cho la ban mot doi giay cho hai
//    nguoi. Giu cho di qua dich vu cua Hang hoa — module nay KHONG tu dung vao ton.
//
// 2. GHI DON LA MOT GIAO DICH. Don + dong don + nhat ky trang thai vao cung mot lan; hong
//    giua chung thi khong con don nua doi. Truoc day ba tep JSON rieng, mat dien giua chung
//    la don co dong ma khong co dau.
//
// 3. MOI CON SO TIEN DI QUA `order-money-kit`. Tep do giong Y HET o ba repo va co bai so
//    tung byte. Server annotate `paidAmount`/`remainingAmount` TRUOC khi tra don ra ngoai;
//    khong noi nao duoc tu suy ra tu `paymentStatus`.

"use strict";

const crypto = require("crypto");
const { SU_KIEN } = require("../../../hop-dong");
const tienKit = require("../../../chung/order-money-kit.js");
const { gioMySQL, isoTuMySQL } = require("../../../chung/gio-mysql.js");
const { banChiTiet, banBiMat, banChiTrangThai, suaDuoc } = require("./cong-khai");
const { LUOC_DO } = require("./luoc-do");
const { tongQuan, TRAN_DON } = require("./bao-cao");

const BANG_DON = "orders";
const BANG_DONG = "order_items";
const BANG_NHAT_KY = "order_status_logs";

/** Mot dong don da chuan hoa. Bo dong khong co ma hang hoac so luong <= 0. */
function chuanHoaDong(dong = {}) {
  const ma = String(dong.productCode || dong.ma || "").trim();
  const soLuong = Math.max(0, Math.trunc(Number(dong.qty ?? dong.quantity ?? dong.soLuong ?? 1)));
  if (!ma || soLuong <= 0) return null;
  return {
    ma,
    maBienThe: String(dong.variantId || dong.maBienThe || "").trim(),
    ten: String(dong.productName || dong.ten || "").trim(),
    size: String(dong.size || "").trim(),
    soLuong,
    donGia: Math.max(0, Number(dong.price || dong.donGia || 0)),
    giaGoc: Math.max(0, Number(dong.saleFilePrice || dong.originalSalePrice || 0)),
    nguon: String(dong.source || "").trim(),
    tenNguon: String(dong.sourceName || "").trim(),
    maKho: String(dong.warehouseId || "").trim(),
    tenKho: String(dong.warehouse || dong.warehouseName || "").trim(),
    anh: String(dong.imageUrl || "").trim()
  };
}

/** Ma tra cuu cua khach: bam ra de KHONG luu ban ro trong so. */
function bamMaTra(ma) {
  return crypto.createHash("sha256").update(String(ma || ""), "utf8").digest("hex");
}

function donTuDong(dongDon, cacDong, nhatKy = []) {
  const don = {
    id: dongDon.id,
    createdAt: isoTuMySQL(dongDon.created_at),
    updatedAt: isoTuMySQL(dongDon.updated_at),
    customerName: dongDon.customer_name || "",
    phone: dongDon.phone || "",
    email: dongDon.email || "",
    address: dongDon.address || "",
    province: dongDon.province || "",
    district: dongDon.district || "",
    ward: dongDon.ward || "",
    addressDetail: dongDon.address_detail || "",
    note: dongDon.note || "",
    total: Number(dongDon.total || 0),
    status: dongDon.status || "",
    paymentStatus: dongDon.payment_status || "",
    paymentMethod: dongDon.payment_method || "",
    paymentProvider: dongDon.payment_provider || "",
    paymentReference: dongDon.payment_reference || "",
    paymentAmount: Number(dongDon.payment_amount || 0),
    fulfillmentStatus: dongDon.fulfillment_status || "",
    // Bang cua ban dang chay co cot nay; bang thu chua co thi de rong, lop cong khai se tinh
    // tu `createdAt` + 15 phut — dung bang nhau vi ban dang chay cung ghi dung nhu vay.
    canCancelUntil: isoTuMySQL(dongDon.can_cancel_until),
    shippingProvider: dongDon.shipping_provider || "",
    trackingCode: dongDon.tracking_code || "",
    items: cacDong.map((d) => ({
      productCode: d.product_code || "",
      variantId: d.variant_id || "",
      productName: d.product_name || "",
      size: d.size || "",
      qty: Number(d.quantity || 1),
      quantity: Number(d.quantity || 1),
      price: Number(d.price || 0),
      saleFilePrice: Number(d.sale_file_price || 0),
      source: d.source || "",
      sourceName: d.source_name || "",
      warehouseId: d.warehouse_id || "",
      warehouse: d.warehouse_name || "",
      warehouseName: d.warehouse_name || "",
      imageUrl: d.image_url || ""
    })),
    statusLogs: nhatKy.map((n) => ({
      status: n.status || "",
      actorType: n.actor_type || "",
      note: n.note || "",
      createdAt: isoTuMySQL(n.created_at)
    }))
  };
  // LUAT 3: annotate truoc khi ra khoi day. Client chi doc field.
  return tienKit.annotateOrderMoneyFields(don);
}

async function docDon(ctx, maDon) {
  const dongDon = await ctx.cong.kho.bang(BANG_DON).mot({ id: String(maDon || "") });
  if (!dongDon) return null;
  const [cacDong, nhatKy] = await Promise.all([
    ctx.cong.kho.bang(BANG_DONG).tim({ dieuKien: { order_id: dongDon.id }, sapXep: "line_no asc" }),
    ctx.cong.kho.bang(BANG_NHAT_KY).tim({ dieuKien: { order_id: dongDon.id }, sapXep: "created_at asc" })
  ]);
  return donTuDong(dongDon, cacDong, nhatKy);
}

async function timDon(ctx, { trangThai = null, dienThoai = null, tuNgay = null, gioiHan = 50 } = {}) {
  const dieuKien = {};
  if (trangThai) dieuKien.status = trangThai;
  if (dienThoai) dieuKien.phone = String(dienThoai).trim();
  if (tuNgay) dieuKien.created_at = { ">": gioMySQL(tuNgay) };
  const cacDon = await ctx.cong.kho.bang(BANG_DON).tim({
    dieuKien, sapXep: "created_at desc", gioiHan: Math.min(Math.max(1, Number(gioiHan) || 50), 500)
  });
  return Promise.all(cacDon.map(async (d) => {
    const cacDong = await ctx.cong.kho.bang(BANG_DONG).tim({ dieuKien: { order_id: d.id }, sapXep: "line_no asc" });
    return donTuDong(d, cacDong, []);
  }));
}

/**
 * Dat don. Giu cho ton TRUOC, roi ghi ca don trong MOT giao dich.
 * Giu cho duoc ma ghi don hong thi tra cho lai — khong de hang bi treo.
 */
async function datDon(ctx, than = {}) {
  const cacDong = (Array.isArray(than.items) ? than.items : []).map(chuanHoaDong).filter(Boolean);
  if (cacDong.length === 0) return { ok: false, viSao: "don_khong_co_mon" };
  if (!String(than.customerName || "").trim()) return { ok: false, viSao: "thieu_ten_khach" };
  if (!String(than.phone || "").trim()) return { ok: false, viSao: "thieu_dien_thoai" };

  // LUAT 1: giu cho truoc khi ghi don.
  // VA: GIA LAY TU KHO, KHONG LAY TU KHACH. Duong dat hang la duong cong khai — khach sua
  // duoc moi thu ho gui len. Tin `price` cua client la ban duoc mot doi giay gia 1 dong.
  // Gia dung la gia cua chinh dong ton vua giu cho, do Hang hoa tra ve.
  const daGiu = [];
  for (const d of cacDong) {
    const giu = await ctx.dichVu["hang-kho"].giuCho({ ma: d.ma, size: d.size, soLuong: d.soLuong, cuaAi: "dat-don" });
    if (!giu.ok) {
      for (const g of daGiu) await ctx.dichVu["hang-kho"].traCho({ maPhieu: g.maPhieu });
      return { ok: false, viSao: "het_hang", mon: d.ma, size: d.size };
    }
    d.donGia = Math.max(0, Number(giu.gia || 0));
    if (!d.maBienThe) d.maBienThe = giu.maBienThe || "";
    if (!d.maKho) d.maKho = giu.maKho || "";
    if (!d.size) d.size = giu.size || "";
    daGiu.push(giu);
  }

  const luc = ctx.cong.gio.bayGio();
  const maTra = crypto.randomBytes(16).toString("hex");
  const tong = cacDong.reduce((t, d) => t + d.donGia * d.soLuong, 0);

  // MA DON theo moc thoi gian (`ORD-<mili giay>`) — giu dung hinh dang ban dang chay vi
  // Sales Desk va Image Tool doc no. Nhung hai khach dat trong CUNG mot mili giay thi trung
  // ma: don thu hai bi tu choi ghi. Hiem nhung co that, va khi xay ra la mat mot don ma
  // khong ai biet. Cach vá: dung ma da co thi day moc len 1 mili giay roi ghi lai — hinh
  // dang khong doi, va van dung duoi dua ghi that vi loi trung khoa do CHINH MySQL bao.
  let maDon = "";
  let lanCuoi = null;
  for (let buoc = 0; buoc < 50; buoc += 1) {
    maDon = `ORD-${luc.getTime() + buoc}`;
    try {
      await ghiDonVaoKho(ctx, { maDon, maTra, tong, cacDong, than, luc });
      lanCuoi = null;
      break;
    } catch (e) {
      if (!laLoiTrungKhoa(e)) { lanCuoi = e; break; }
      lanCuoi = e;
    }
  }
  if (lanCuoi) {
    for (const g of daGiu) await ctx.dichVu["hang-kho"].traCho({ maPhieu: g.maPhieu });
    ctx.cong.nhatKy.canhBao(`[don-khach] ghi don hong, da tra lai cho giu: ${lanCuoi.message}`);
    throw lanCuoi;
  }

  ctx.bus.phat(SU_KIEN.don_da_tao, { maDon, tong, soMon: cacDong.length, dienThoai: String(than.phone || "").trim() });
  return { ok: true, maDon, maTra, tong };
}

function laLoiTrungKhoa(e) {
  return e?.code === "ER_DUP_ENTRY" || /duplicate entry/i.test(String(e?.message || ""));
}

/** Ghi ca don trong MOT giao dich (LUAT 2). Nem khi trung ma don — nguoi goi day moc len. */
async function ghiDonVaoKho(ctx, { maDon, maTra, tong, cacDong, than, luc }) {
  await ctx.cong.kho.giaoDich(async (trong) => {
      await trong.bang(BANG_DON).them({
        id: maDon,
        customer_name: String(than.customerName || "").trim(),
        phone: String(than.phone || "").trim(),
        email: String(than.email || "").trim(),
        address: String(than.address || [than.addressDetail, than.ward, than.district, than.province].filter(Boolean).join(", ")).trim(),
        province: String(than.province || "").trim(),
        district: String(than.district || "").trim(),
        ward: String(than.ward || "").trim(),
        address_detail: String(than.addressDetail || "").trim(),
        note: String(than.note || "").trim(),
        total: tong,
        status: "pending",
        payment_status: "payment_pending",
        payment_method: String(than.paymentMethod || "").trim(),
        payment_amount: 0,
        order_lookup_token_hash: bamMaTra(maTra),
        fulfillment_status: "not_assigned",
        created_at: gioMySQL(luc),
        updated_at: gioMySQL(luc)
      });
      let so = 0;
      for (const d of cacDong) {
        so += 1;
        await trong.bang(BANG_DONG).them({
          order_id: maDon, line_no: so,
          product_code: d.ma, variant_id: d.maBienThe, product_name: d.ten, size: d.size,
          quantity: d.soLuong, price: d.donGia, sale_file_price: d.giaGoc,
          source: d.nguon, source_name: d.tenNguon,
          warehouse_id: d.maKho, warehouse_name: d.tenKho, image_url: d.anh
        });
      }
      await trong.bang(BANG_NHAT_KY).them({
        order_id: maDon, status: "pending", actor_type: "khach", note: "Khách đặt hàng", created_at: gioMySQL(luc)
      });
  });
}

async function doiTrangThai(ctx, { maDon, trangThai, ghiChu = "", boi = "he-thong" } = {}) {
  const luc = ctx.cong.gio.bayGio();
  const doi = await ctx.cong.kho.giaoDich(async (trong) => {
    const so = await trong.bang(BANG_DON).thay({ id: String(maDon || "") }, {
      status: String(trangThai || ""), updated_at: gioMySQL(luc)
    });
    if (so === 0) return 0;
    await trong.bang(BANG_NHAT_KY).them({
      order_id: maDon, status: String(trangThai || ""), actor_type: String(boi),
      note: String(ghiChu || ""), created_at: gioMySQL(luc)
    });
    return so;
  });
  if (doi === 0) return { ok: false, viSao: "khong_co_don" };
  ctx.bus.phat(SU_KIEN.don_doi_trang_thai, { maDon, trangThai, boi });
  return { ok: true };
}

/** Doc don bang ma don + ma tra cuu cua khach — dung cho duong cong khai. */
async function docTheoMaTra(ctx, { maDon = "", maTra = "" } = {}) {
  if (!maDon || !maTra) return null;
  const dong = await ctx.cong.kho.bang(BANG_DON).mot({
    id: String(maDon), order_lookup_token_hash: bamMaTra(maTra)
  });
  if (!dong) return null;
  return docDon(ctx, dong.id);
}

/**
 * Ghi cac truong TIEN len don. Chi module Don hang duoc ghi vao so don — moi manh khac
 * (ke ca Tien & doi soat) di qua cua nay, nen khong bao gio co hai noi cung sua mot don.
 * Moi lan ghi deu them mot dong nhat ky, de sau con truy duoc ai doi gi.
 */
async function ghiTien(ctx, { maDon = "", phuongThuc = null, trangThaiTien = null, soTien = null, maChuyenKhoan = null, ghiChu = "" } = {}) {
  const ma = String(maDon || "");
  if (!ma) return { ok: false, viSao: "thieu_ma_don" };

  const doi = {};
  if (phuongThuc !== null) doi.payment_method = String(phuongThuc);
  if (trangThaiTien !== null) doi.payment_status = String(trangThaiTien);
  if (soTien !== null) doi.payment_amount = Math.max(0, Math.round(Number(soTien) || 0));
  if (maChuyenKhoan !== null) doi.payment_reference = String(maChuyenKhoan);
  if (Object.keys(doi).length === 0) return { ok: false, viSao: "khong_co_gi_de_ghi" };

  const luc = ctx.cong.gio.bayGio();
  doi.updated_at = gioMySQL(luc);

  const so = await ctx.cong.kho.giaoDich(async (trong) => {
    const n = await trong.bang(BANG_DON).thay({ id: ma }, doi);
    if (n === 0) return 0;
    await trong.bang(BANG_NHAT_KY).them({
      order_id: ma, status: String(trangThaiTien || phuongThuc || "tien"),
      actor_type: "tien", note: String(ghiChu || ""), created_at: gioMySQL(luc)
    });
    return n;
  });
  return so > 0 ? { ok: true } : { ok: false, viSao: "khong_co_don" };
}

// ---------- bao cao ----------

/**
 * Doc don trong cua so ngay, kem dong hang, de dung bao cao.
 *
 * HAI cau lenh chu khong phai N+1: mot cau lay don, mot cau lay het dong hang cua nhung don do.
 * Bao cao 14 ngay cua mot shop dong khach van chi la hai lan hoi kho.
 */
async function donChoBaoCao(ctx, tuNgay) {
  const [cacDon] = await ctx.cong.kho.cauLenh(
    `SELECT id, total, status, payment_status, payment_amount, created_at
       FROM ${BANG_DON} WHERE created_at >= ? ORDER BY created_at DESC LIMIT ${TRAN_DON}`,
    [tuNgay]
  );
  if (cacDon.length === 0) return [];
  const cho = cacDon.map(() => "?").join(", ");
  const [cacDong] = await ctx.cong.kho.cauLenh(
    `SELECT order_id, product_code, product_name, quantity, price
       FROM ${BANG_DONG} WHERE order_id IN (${cho})`,
    cacDon.map((d) => d.id)
  );
  const theoDon = new Map();
  for (const d of cacDong) {
    if (!theoDon.has(d.order_id)) theoDon.set(d.order_id, []);
    theoDon.get(d.order_id).push(d);
  }
  return cacDon.map((d) => ({ ...d, mon: theoDon.get(d.id) ?? [] }));
}

// ---------- khach tu xem / tu sua / tu huy don cua chinh minh ----------
//
// Ba duong nay CONG KHAI (khach tren web khong co ma nao), nen tu bao ve bang dung mot thu:
// phai co DUNG ma don kem DUNG ma tra cuu. Sai mot trong hai la khong thay gi — va khong
// bao gio noi ro sai cai nao, keo do duoc ma tra cuu.

/** Chi so, de so dien thoai khach nhap sao cung khop. */
function chiSo(chu) {
  return String(chu || "").replace(/[^0-9]/g, "");
}

/** Tien tren don do module Tien tinh bang order-money-kit. Khong co module Tien thi de trong. */
async function tienCuaDon(ctx, maDon) {
  const lay = ctx.dichVu["tien-doi-soat"]?.tienTrenDon;
  if (!lay) return null;
  try {
    return await lay(String(maDon || ""));
  } catch (e) {
    // Hong duong tinh tien thi van cho khach xem don — chi khong hien so da tra.
    ctx.cong.nhatKy.canhBao(`[don-khach] khong tinh duoc tien cua don ${maDon}: ${e?.message || e}`);
    return null;
  }
}

/** Khach mo link tu email / popup dat hang: ma don + ma tra cuu -> ban chi tiet. */
async function xemDonBangMaTra(ctx, { maDon = "", maTra = "" } = {}) {
  if (!maDon || !maTra) return { ma: 422, than: { ok: false, error: "thieu_ma_tra_cuu", message: "Thiếu mã đơn hoặc link không hợp lệ." } };
  const don = await docTheoMaTra(ctx, { maDon, maTra });
  if (!don) return { ma: 404, than: { ok: false, error: "khong_thay_don", message: "Không tìm thấy đơn hàng phù hợp." } };
  return {
    ma: 200, tieuDe: { "Cache-Control": "no-store" },
    than: { ok: true, order: banChiTiet(don, { bayGio: ctx.cong.gio.bayGio(), tien: await tienCuaDon(ctx, don.id) }) }
  };
}

/**
 * Khach tu sua ho so nguoi nhan trong 15 phut dau.
 *
 * CHI sua ho so (ten, dien thoai, dia chi, ghi chu). KHONG sua duoc mon va KHONG sua duoc
 * gia — mat web co gui kem danh sach mon nhung o day bo qua han: doi mon la doi ton va doi
 * tien, viec do phai qua nguoi ban. Ban dang chay cho doi mon; cho nay ghi ro la khac.
 */
async function suaHoSoKhach(ctx, { maDon = "", maTra = "", than = {} } = {}) {
  if (!maDon || !maTra) return { ma: 422, than: { ok: false, error: "thieu_ma_tra_cuu", message: "Thiếu mã đơn hoặc link không hợp lệ." } };
  const don = await docTheoMaTra(ctx, { maDon, maTra });
  if (!don) return { ma: 404, than: { ok: false, error: "khong_thay_don", message: "Không tìm thấy đơn hàng phù hợp." } };
  if (!suaDuoc(don, ctx.cong.gio.bayGio())) {
    return { ma: 409, than: { ok: false, error: "het_gio_sua", message: "Đơn hàng đã quá thời gian tự chỉnh sửa." } };
  }

  const ten = String(than.customerName ?? don.customerName ?? "").trim();
  const dienThoai = String(than.phone ?? don.phone ?? "").trim();
  if (!ten) return { ma: 422, than: { ok: false, error: "thieu_ten_khach", message: "Vui lòng nhập tên người nhận." } };
  if (chiSo(dienThoai).length < 9) return { ma: 422, than: { ok: false, error: "sai_dien_thoai", message: "Số điện thoại chưa đúng." } };

  const tinh = String(than.province ?? don.province ?? "").trim();
  const huyen = String(than.district ?? don.district ?? "").trim();
  const xa = String(than.ward ?? don.ward ?? "").trim();
  const soNha = String(than.addressDetail ?? don.addressDetail ?? "").trim();
  const diaChi = String(than.address || [soNha, xa, huyen, tinh].filter(Boolean).join(", ")).trim();

  const luc = ctx.cong.gio.bayGio();
  await ctx.cong.kho.giaoDich(async (trong) => {
    await trong.bang(BANG_DON).thay({ id: don.id }, {
      customer_name: ten,
      phone: dienThoai,
      email: String(than.email ?? don.email ?? "").trim(),
      address: diaChi,
      province: tinh, district: huyen, ward: xa, address_detail: soNha,
      note: String(than.note ?? don.note ?? "").trim(),
      updated_at: gioMySQL(luc)
    });
    await trong.bang(BANG_NHAT_KY).them({
      order_id: don.id, status: don.status || "pending", actor_type: "khach",
      note: "Khách tự sửa thông tin người nhận", created_at: gioMySQL(luc)
    });
  });

  const moi = await docDon(ctx, don.id);
  ctx.cong.nhatKy.tin(`[don-khach] khach tu sua ho so don ${don.id}`);
  return {
    ma: 200, tieuDe: { "Cache-Control": "no-store" },
    than: { ok: true, order: banChiTiet(moi, { bayGio: luc, tien: await tienCuaDon(ctx, don.id) }) }
  };
}

/**
 * Khach tu huy don trong 15 phut dau.
 *
 * CON MOT VIEC CHUA XONG (ghi ro de khong ai tuong da xong): huy don CHUA tra lai ton kho.
 * O ban dang chay, dat don tru ton that nen huy la cong lai. O ban tach, dat don chi GIU CHO
 * 30 phut va so phieu giu khong duoc ghi len don — nen o day chi phat su kien
 * `don-khach.da-huy`; module Hang hoa se nghe su kien do de tra cho khi phan giu cho duoc
 * ghi ben vung. Xem muc "giu cho sau khi dat don" trong KIEM-KE-TINH-NANG.md.
 */
async function khachTuHuy(ctx, { maDon = "", maTra = "" } = {}) {
  if (!maDon || !maTra) return { ma: 422, than: { ok: false, error: "thieu_ma_tra_cuu", message: "Thiếu mã đơn hoặc link không hợp lệ." } };
  const don = await docTheoMaTra(ctx, { maDon, maTra });
  if (!don) return { ma: 404, than: { ok: false, error: "khong_thay_don", message: "Không tìm thấy đơn hàng phù hợp." } };
  if (String(don.status || "").toLowerCase() === "cancelled") {
    return { ma: 409, than: { ok: false, error: "da_huy_roi", message: "Đơn hàng đã được hủy." } };
  }
  if (!suaDuoc(don, ctx.cong.gio.bayGio())) {
    return { ma: 409, than: { ok: false, error: "het_gio_huy", message: "Đơn hàng đã quá thời gian tự hủy." } };
  }

  const doi = await doiTrangThai(ctx, { maDon: don.id, trangThai: "cancelled", ghiChu: "Khách tự hủy đơn", boi: "khach" });
  if (!doi.ok) return { ma: 409, than: { ok: false, error: doi.viSao, message: "Chưa hủy được đơn hàng." } };
  ctx.bus.phat(SU_KIEN.don_da_huy, { maDon: don.id, boi: "khach" });

  const moi = await docDon(ctx, don.id);
  return {
    ma: 200, tieuDe: { "Cache-Control": "no-store" },
    than: { ok: true, order: banChiTiet(moi, { bayGio: ctx.cong.gio.bayGio(), tien: await tienCuaDon(ctx, don.id) }) }
  };
}

/**
 * Tra don tu o nhap tren trang tra cuu. Ba cach khach chung minh la don cua minh:
 *   ma don + ma tra cuu            -> ban chi tiet (nhu mo link)
 *   ma don + ma bi mat             -> ban bi mat: thay mon va van don, khong thay dia chi
 *   ma don + so dien thoai / email -> chi thay don di den dau
 */
async function traDon(ctx, than = {}) {
  const maDon = String(than.orderId || than.order || than.id || "").trim();
  const maTra = String(than.token || than.orderToken || "").trim();
  const maBiMat = String(than.lookupSecret || than.secret || "").trim();
  const lienHe = String(than.contact || than.phone || than.email || "").trim();
  if (!maDon) return { ma: 422, than: { ok: false, error: "thieu_ma_don", message: "Vui lòng nhập mã đơn và mã bí mật." } };

  if (maTra) return xemDonBangMaTra(ctx, { maDon, maTra });

  if (maBiMat) {
    // Khach hay go ma bi mat co dau gach hoac chu thuong. Thu ca ban da chuan hoa va ban tho,
    // giong ban dang chay — khong de khach nhap dung ma van bao khong thay.
    const chuanHoa = maBiMat.toUpperCase().replace(/[\s-]+/g, "");
    for (const thu of new Set([maBiMat, chuanHoa])) {
      const don = await docTheoMaTra(ctx, { maDon, maTra: thu });
      if (don) {
        return { ma: 200, tieuDe: { "Cache-Control": "no-store" }, than: { ok: true, order: banBiMat(don) } };
      }
    }
    return { ma: 404, than: { ok: false, error: "khong_thay_don", message: "Không tìm thấy đơn hàng phù hợp." } };
  }

  if (lienHe) {
    const dong = await ctx.cong.kho.bang(BANG_DON).mot({ id: maDon });
    if (!dong) return { ma: 404, than: { ok: false, error: "khong_thay_don", message: "Không tìm thấy đơn hàng phù hợp." } };
    const khopDienThoai = chiSo(lienHe).length >= 9 && chiSo(dong.phone) === chiSo(lienHe);
    const khopEmail = lienHe.includes("@") && String(dong.email || "").trim().toLowerCase() === lienHe.toLowerCase();
    if (!khopDienThoai && !khopEmail) {
      return { ma: 404, than: { ok: false, error: "khong_thay_don", message: "Không tìm thấy đơn hàng phù hợp." } };
    }
    return {
      ma: 200, tieuDe: { "Cache-Control": "no-store" },
      than: { ok: true, order: banChiTrangThai(await docDon(ctx, maDon)) }
    };
  }

  return { ma: 422, than: { ok: false, error: "thieu_ma_tra_cuu", message: "Vui lòng nhập mã đơn và mã bí mật." } };
}

module.exports = {
  id: "don-khach",
  ten: "Đơn hàng & khách",
  mang: "van-hanh",
  chay: "server-khach",
  phienBan: "0.1.0",
  canCong: ["kho", "nhatKy", "gio", "bus", "cauHinh"],
  canDichVu: ["hang-kho.giuCho", "hang-kho.traCho"],

  // Ba bang co san tu ban dang chay — khong doi ten duoc vi Desk dang goc vao do.
  bangKeThua: [BANG_DON, BANG_DONG, BANG_NHAT_KY],
  // Ba bang nay module nay TAO ra (tren may moi chua co gi), voi dung cot cua ban dang chay.
  luocDo: LUOC_DO,

  // Tien tren don do module Tien tinh (LUAT 3: moi con so tien di qua order-money-kit).
  // "NEU CO" vi nha ban hang co the khong mua manh Tien — khi do trang tra don van chay,
  // chi khong hien so da tra.
  canDichVuNeuCo: ["tien-doi-soat.tienTrenDon"],

  suKien: {
    phat: [SU_KIEN.don_da_tao, SU_KIEN.don_doi_trang_thai, SU_KIEN.don_da_huy],
    nghe: {}
  },

  capDichVu: {
    "don-khach.doc": docDon,
    "don-khach.tim": timDon,
    "don-khach.datDon": datDon,
    "don-khach.doiTrangThai": doiTrangThai,
    "don-khach.docTheoMaTra": docTheoMaTra,
    "don-khach.ghiTien": ghiTien
  },

  duong: [
    {
      method: "POST", path: "/api/orders", quyen: "cong-khai",
      viSaoCongKhai: "Khách đặt hàng từ web, không có mã nào. Tự bảo vệ bằng: phải có món thật trong kho, giữ chỗ tồn trước khi ghi, và không nhận giá từ client.",
      // Dat hang GIU CHO ton that — ke goi don co the giu sach hang cua shop. Han chat.
      hanGoi: { soLan: 20, trongMs: 10 * 60 * 1000 },
      tay: async (ctx, yc) => {
        const kq = await datDon(ctx, await yc.doc());
        if (!kq.ok) return { ma: 400, than: { ok: false, error: kq.viSao, mon: kq.mon, size: kq.size } };
        return { ma: 200, than: { ok: true, id: kq.maDon, token: kq.maTra, total: kq.tong } };
      }
    },
    {
      method: "POST", path: "/api/orders/lookup", quyen: "cong-khai",
      viSaoCongKhai: "Khách tra đơn của chính mình. Tự bảo vệ bằng: phải có ĐÚNG mã đơn kèm mã tra cứu (hoặc mã bí mật, hoặc số điện thoại của chính đơn); sai một trong hai là không thấy gì.",
      // 30/10 phut nhu ban dang chay: du cho khach that, khong du de do ma tra cuu.
      hanGoi: { soLan: 30, trongMs: 10 * 60 * 1000 },
      tay: async (ctx, yc) => traDon(ctx, await yc.doc())
    },
    {
      // Khach mo link trong email / trong popup vua dat hang.
      method: "GET", path: "/api/orders/public", quyen: "cong-khai",
      viSaoCongKhai: "Khách xem đơn của chính mình qua link có mã tra cứu. Tự bảo vệ bằng: phải có ĐÚNG mã đơn kèm mã tra cứu.",
      hanGoi: { soLan: 60, trongMs: 10 * 60 * 1000 },
      tay: async (ctx, yc) => xemDonBangMaTra(ctx, {
        maDon: String(yc.truyVan.order || yc.truyVan.orderId || "").trim(),
        maTra: String(yc.truyVan.token || "").trim()
      })
    },
    {
      // Khach tu sua ho so nguoi nhan trong 15 phut dau.
      method: "PATCH", path: "/api/orders/public", quyen: "cong-khai",
      viSaoCongKhai: "Khách sửa thông tin người nhận trên đơn của chính mình. Tự bảo vệ bằng: đúng mã đơn kèm mã tra cứu, chỉ trong 15 phút đầu, và chỉ sửa hồ sơ chứ không sửa món hay giá.",
      hanGoi: { soLan: 30, trongMs: 10 * 60 * 1000 },
      tay: async (ctx, yc) => {
        const than = await yc.doc();
        return suaHoSoKhach(ctx, {
          maDon: String(than.orderId || than.id || "").trim(),
          maTra: String(than.token || than.orderToken || "").trim(),
          than
        });
      }
    },
    {
      // Khach tu huy don trong 15 phut dau.
      method: "POST", path: "/api/orders/public/cancel", quyen: "cong-khai",
      viSaoCongKhai: "Khách tự hủy đơn của chính mình. Tự bảo vệ bằng: đúng mã đơn kèm mã tra cứu, và chỉ trong 15 phút đầu.",
      hanGoi: { soLan: 20, trongMs: 10 * 60 * 1000 },
      tay: async (ctx, yc) => {
        const than = await yc.doc();
        return khachTuHuy(ctx, {
          maDon: String(than.orderId || than.id || "").trim(),
          maTra: String(than.token || than.orderToken || "").trim()
        });
      }
    },
    {
      // Chu shop mo OMI ra la thay: hom nay bao nhieu don, thu duoc bao nhieu, mon nao ban chay.
      method: "GET", path: "/api/bao-cao/tong-quan", quyen: "quan-tri",
      hanGoi: { soLan: 120, trongMs: 10 * 60 * 1000 },
      tay: async (ctx, yc) => ({
        ma: 200, tieuDe: { "Cache-Control": "no-store" },
        than: await tongQuan({
          docDon: (tuNgay) => donChoBaoCao(ctx, tuNgay),
          bayGio: ctx.cong.gio.bayGio(),
          soNgay: yc.truyVan.ngay,
          lechPhut: Number(ctx.cauHinh.lechGioPhut ?? 7 * 60)
        })
      })
    },
    {
      method: "GET", path: "/api/orders", quyen: "quan-tri",
      tay: async (ctx, yc) => ({
        ma: 200, tieuDe: { "Cache-Control": "no-store" },
        than: await timDon(ctx, {
          trangThai: yc.truyVan.status || null,
          dienThoai: yc.truyVan.phone || null,
          tuNgay: yc.truyVan.since || null,
          gioiHan: yc.truyVan.limit
        })
      })
    },
    {
      method: "GET", path: "/api/orders/:maDon", quyen: "quan-tri",
      tay: async (ctx, yc) => {
        const don = await docDon(ctx, yc.tham.maDon);
        if (!don) return { ma: 404, than: { ok: false, error: "khong_thay" } };
        return { ma: 200, tieuDe: { "Cache-Control": "no-store" }, than: don };
      }
    },
    {
      method: "PATCH", path: "/api/orders/:maDon", quyen: "quan-tri",
      tay: async (ctx, yc) => {
        const than = await yc.doc();
        const kq = await doiTrangThai(ctx, { maDon: yc.tham.maDon, trangThai: than.status, ghiChu: than.note, boi: "quan-tri" });
        return { ma: kq.ok ? 200 : 404, than: kq };
      }
    }
  ],

  congCuBot: [
    { ten: "tra_don", moTa: "Tra trạng thái một đơn theo mã", hieuUng: "doc" },
    { ten: "tao_don", moTa: "Chốt đơn cho khách trong khung chat", hieuUng: "ghi" }
  ]
};
