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

function gioMySQL(d) {
  return new Date(d).toISOString().slice(0, 19).replace("T", " ");
}

/** Ma tra cuu cua khach: bam ra de KHONG luu ban ro trong so. */
function bamMaTra(ma) {
  return crypto.createHash("sha256").update(String(ma || ""), "utf8").digest("hex");
}

function donTuDong(dongDon, cacDong, nhatKy = []) {
  const don = {
    id: dongDon.id,
    createdAt: dongDon.created_at ? new Date(dongDon.created_at).toISOString() : "",
    updatedAt: dongDon.updated_at ? new Date(dongDon.updated_at).toISOString() : "",
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
      createdAt: n.created_at ? new Date(n.created_at).toISOString() : ""
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
      viSaoCongKhai: "Khách tra đơn của chính mình. Tự bảo vệ bằng: phải có ĐÚNG mã đơn kèm mã tra cứu; sai một trong hai là không thấy gì.",
      // 30/10 phut nhu ban dang chay: du cho khach that, khong du de do ma tra cuu.
      hanGoi: { soLan: 30, trongMs: 10 * 60 * 1000 },
      tay: async (ctx, yc) => {
        const than = await yc.doc();
        const maDon = String(than.order || than.id || "").trim();
        const maTra = String(than.token || "").trim();
        if (!maDon || !maTra) return { ma: 400, than: { ok: false, error: "thieu_ma_don_hoac_ma_tra" } };
        const dong = await ctx.cong.kho.bang(BANG_DON).mot({ id: maDon, order_lookup_token_hash: bamMaTra(maTra) });
        if (!dong) return { ma: 404, than: { ok: false, error: "khong_thay" } };
        return { ma: 200, tieuDe: { "Cache-Control": "no-store" }, than: { ok: true, don: await docDon(ctx, maDon) } };
      }
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
