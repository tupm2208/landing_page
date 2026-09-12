// Module Hang hoa & kho.
//
// Trong tam: KHONG bao gio lo gia von / ton that / ten kho ra ban cong khai, va giu cho
// khong bao gio giu qua so hang dang co.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { taoKhung } = require("../loi/khung");
const { taoKhoTep } = require("../loi/cong/kho-tep");
const { taoNhatKyGia, taoGioGia, taoHttpNgoaiGia } = require("../loi/cong/co-ban");
const { taoCongQuyen } = require("../loi/cong/quyen");
const toKhai = require("../modules/hang-kho/module");
const { chuanHoaMon, banCongKhai, nhanKho } = require("../modules/hang-kho/chuan-hoa");

const MA_QT = "ma-quan-tri";
const MA_DV = "ma-bo-nao";

const MON_MAU = {
  code: "DV1234",
  name: "Giày chạy Nike Pegasus 40",
  brand: "Nike",
  listPrice: 3500000,
  warehousePriorityIds: ["wh_yen", "wh_cau_dien"],
  sizes: [
    { size: "42", qty: 3, price: 2890000, warehouseId: "wh_cau_dien", warehouse: "Cầu Diễn" },
    { size: "42", qty: 2, price: 2890000, warehouseId: "wh_yen", warehouse: "Yên" },
    { size: "43", qty: 0, price: 2890000, warehouseId: "wh_yen", warehouse: "Yên" }
  ]
};

function dungThu({ cauHinh } = {}) {
  const thuMuc = fs.mkdtempSync(path.join(os.tmpdir(), "hang-kho-"));
  const nhatKy = taoNhatKyGia();
  const kho = taoKhoTep({ thuMuc, nhatKy });
  const gio = taoGioGia();
  const khung = taoKhung({
    cong: { kho, nhatKy, gio, httpNgoai: taoHttpNgoaiGia(), quyen: taoCongQuyen({ maQuanTri: MA_QT, maDichVu: MA_DV }) },
    nhatKy,
    toKhais: [toKhai],
    cauHinh: { "hang-kho": cauHinh ?? {} }
  });
  return { khung, kho, gio, nhatKy };
}

const nap = (mon, ma = MA_QT) => ({
  method: "POST", duong: "/api/products", truyVan: {},
  tieuDe: { authorization: `Bearer ${ma}` }, doc: async () => mon
});
const docCongKhai = () => ({ method: "GET", duong: "/api/products", truyVan: {}, tieuDe: {} });
const docTrongNha = () => ({ method: "GET", duong: "/api/admin/products", truyVan: {}, tieuDe: { authorization: `Bearer ${MA_QT}` } });

async function dungVaNap(mon = [MON_MAU], tuyChon) {
  const bo = dungThu(tuyChon);
  await bo.khung.xuLy(nap(mon));
  await bo.kho.choXong();
  return bo;
}

// ---------- chuan hoa ----------

test("gia ban cua mon = gia NHO NHAT trong cac size (khach thay 'từ ... đ')", () => {
  const m = chuanHoaMon({ ...MON_MAU, sizes: [{ size: "42", price: 3200000 }, { size: "43", price: 2890000 }] });
  assert.equal(m.price, 2890000);
});

test("gia ban cao hon gia niem yet la du lieu sai — tu an mon di", () => {
  const m = chuanHoaMon({ code: "X1", name: "Món lỗi giá", listPrice: 1000000, sizes: [{ size: "40", price: 1500000 }] });
  assert.equal(m.status, "hidden");
  assert.equal(m.hiddenReason, "invalid_price_sale_gt_list");
});

test("mon thieu ma hoac thieu ten thi bi bo, khong vao so", () => {
  assert.equal(chuanHoaMon({ name: "Không có mã" }), null);
  assert.equal(chuanHoaMon({ code: "A1" }), null);
});

test("anh nhap lieu noi bo khong duoc lot ra ban cong khai", () => {
  const m = chuanHoaMon({ ...MON_MAU, thumbnailImage: "/assets/thumbnails/x.jpg", galleryImages: ["/assets/thumbnails/y.jpg", "/anh/that.jpg"] });
  assert.equal(m.thumbnailImage, "");
  assert.deepEqual(m.galleryImages, ["/anh/that.jpg"]);
});

test("ten kho duoc rut thanh nhan ngan — khong noi ten kho voi khach", () => {
  assert.equal(nhanKho("wh_cau_dien", "Cầu Diễn"), "CD");
  assert.equal(nhanKho("wh_toprun_ha_noi", ""), "TR");
  const ck = banCongKhai(chuanHoaMon(MON_MAU));
  assert.ok(ck.sizes.every((d) => !/Cầu Diễn|Yên/.test(d.warehouse)), JSON.stringify(ck.sizes));
});

test("ban cong khai KHONG noi con may doi — chi con hay het", () => {
  const ck = banCongKhai(chuanHoaMon(MON_MAU));
  const size42 = ck.sizes.filter((d) => d.size === "42");
  assert.ok(size42.length > 0);
  for (const d of size42) assert.equal(d.qty, 1, "co hang thi qty luon la 1, khong phai so ton that");
  const size43 = ck.sizes.find((d) => d.size === "43");
  assert.equal(size43.qty, 0);
  assert.equal(size43.available, false);
});

test("het sach moi size thi mon la het hang, du ho so ghi 'orderable'", () => {
  const ck = banCongKhai(chuanHoaMon({ ...MON_MAU, status: "orderable", sizes: [{ size: "42", qty: 0, price: 100000 }] }));
  assert.equal(ck.status, "hidden");
});

// ---------- duong API ----------

test("Image Tool day danh muc len, web doc duoc ngay", async () => {
  const { khung } = await dungVaNap();
  const ra = await khung.xuLy(docCongKhai());
  assert.equal(ra.ma, 200);
  assert.equal(ra.than.length, 1);
  assert.equal(ra.than[0].code, "DV1234");
});

test("ban cong khai khong mang gia von, ton that hay uu tien kho", async () => {
  const { khung } = await dungVaNap([{ ...MON_MAU, costPrice: 1500000, warehouseStocks: { wh_yen: 5 } }]);
  const chu = JSON.stringify((await khung.xuLy(docCongKhai())).than);
  assert.ok(!chu.includes("costPrice"), "lo gia von");
  assert.ok(!chu.includes("warehouseStocks"), "lo ton tung kho");
  assert.ok(!chu.includes("warehousePriority"), "lo thu tu uu tien kho");
});

test("ban trong nha thi CO du ton that — nhung phai co ma quan tri", async () => {
  const { khung } = await dungVaNap();
  assert.equal((await khung.xuLy({ ...docTrongNha(), tieuDe: {} })).ma, 401);
  const ra = await khung.xuLy(docTrongNha());
  assert.equal(ra.than[0].sizes.find((d) => d.size === "42").qty, 3);
});

test("chi quan tri moi day duoc danh muc len", async () => {
  const { khung } = dungThu();
  assert.equal((await khung.xuLy({ ...nap([MON_MAU]), tieuDe: {} })).ma, 401);
  assert.equal((await khung.xuLy(nap([MON_MAU], MA_DV))).ma, 401, "bo nao khong duoc sua danh muc");
});

test("day len thu khong phai mang thi tu choi, khong xoa so cu", async () => {
  const { khung, kho } = await dungVaNap();
  const ra = await khung.xuLy(nap({ linh: "tinh" }));
  assert.equal(ra.ma, 400);
  await kho.choXong();
  assert.equal((await khung.xuLy(docCongKhai())).than.length, 1, "so cu phai con nguyen");
});

test("mo mot mon theo ma hoac theo duong dan deu ra", async () => {
  const { khung } = await dungVaNap();
  const theoMa = await khung.xuLy({ method: "GET", duong: "/api/products/DV1234", truyVan: {}, tieuDe: {} });
  assert.equal(theoMa.ma, 200);
  const theoDuong = await khung.xuLy({ method: "GET", duong: `/api/products/${theoMa.than.slug}`, truyVan: {}, tieuDe: {} });
  assert.equal(theoDuong.than.code, "DV1234");
  assert.equal((await khung.xuLy({ method: "GET", duong: "/api/products/khong-co", truyVan: {}, tieuDe: {} })).ma, 404);
});

// ---------- chan ma ----------

test("ma bi chan khong lot ra web, VA khong duoc ghi vao so", async () => {
  const { khung, kho } = await dungVaNap(
    [MON_MAU, { ...MON_MAU, code: "CAM01", name: "Món cấm bán" }],
    { cauHinh: { maChanSan: ["cam01"] } }
  );
  await kho.choXong();
  const ck = (await khung.xuLy(docCongKhai())).than;
  assert.deepEqual(ck.map((m) => m.code), ["DV1234"]);
  const trongSo = await kho.so("hang-hoa").doc();
  assert.ok(!trongSo.mon.some((m) => m.code === "CAM01"), "chan o dau GHI, khong chi o dau doc");
});

test("ma chan them vao SO sau khi da nap thi van bien khoi web ngay", async () => {
  const { khung, kho } = await dungVaNap();
  await kho.so("ma-bi-chan").ghi(["dv1234"]);
  await kho.choXong();
  assert.equal((await khung.xuLy(docCongKhai())).than.length, 0);
});

// ---------- dich vu cho bo nao ----------

test("bo nao hoi ton: tra dung size con va size het", async () => {
  const { khung } = await dungVaNap();
  const hoi = (size) => khung.xuLy({
    method: "GET", duong: "/api/hang-kho/ton/DV1234", truyVan: size ? { size } : {},
    tieuDe: { authorization: `Bearer ${MA_DV}` }
  });
  assert.equal((await hoi("42")).than.co, true);
  assert.equal((await hoi("43")).than.co, false, "size 43 het thi phai noi la het");
  assert.equal((await hoi()).than.cacDong.length, 2, "khong noi size thi liet ke moi dong con hang");
});

test("hoi ton mot ma khong co thi noi khong co, khong doan bua", async () => {
  const { khung } = await dungVaNap();
  const ra = await khung.xuLy({ method: "GET", duong: "/api/hang-kho/ton/KHONGCO", truyVan: {}, tieuDe: { authorization: `Bearer ${MA_DV}` } });
  assert.equal(ra.than.co, false);
  assert.equal(ra.than.viSao, "khong_co_ma");
});

test("duong hoi ton chi mo cho bo nao va quan tri, khong mo cho khach", async () => {
  const { khung } = await dungVaNap();
  assert.equal((await khung.xuLy({ method: "GET", duong: "/api/hang-kho/ton/DV1234", truyVan: {}, tieuDe: {} })).ma, 401);
});

test("cac dong ton sap theo gia re truoc, bang gia thi theo thu tu uu tien kho", async () => {
  const { khung } = await dungVaNap([{
    ...MON_MAU,
    warehousePriorityIds: ["wh_yen", "wh_cau_dien"],
    sizes: [
      { size: "42", qty: 1, price: 2890000, warehouseId: "wh_cau_dien" },
      { size: "42", qty: 1, price: 2890000, warehouseId: "wh_yen" },
      { size: "42", qty: 1, price: 2500000, warehouseId: "wh_cau_dien" }
    ]
  }]);
  const ra = await khung.xuLy({ method: "GET", duong: "/api/hang-kho/ton/DV1234", truyVan: {}, tieuDe: { authorization: `Bearer ${MA_DV}` } });
  const dong = ra.than.cacDong;
  assert.equal(dong[0].gia, 2500000, "re nhat di truoc");
  assert.equal(dong[1].maKho, "wh_yen", "bang gia thi kho uu tien cao hon di truoc");
});

// ---------- giu cho ----------

// Module THU: goi dich vu that cua hang-kho qua dung duong khung noi, khong dung ctx gia.
const MODULE_THU = {
  id: "thu-giu-cho", ten: "Thu giu cho", mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1",
  canDichVu: ["hang-kho.giuCho", "hang-kho.traCho", "hang-kho.tonKho", "hang-kho.tim"],
  duong: [
    {
      method: "POST", path: "/thu/giu", quyen: "quan-tri",
      tay: async (ctx, yc) => ({ ma: 200, than: await ctx.dichVu["hang-kho"].giuCho(await yc.doc()) })
    },
    {
      method: "POST", path: "/thu/tra", quyen: "quan-tri",
      tay: async (ctx, yc) => ({ ma: 200, than: await ctx.dichVu["hang-kho"].traCho(await yc.doc()) })
    },
    {
      method: "GET", path: "/thu/tim", quyen: "quan-tri",
      tay: async (ctx, yc) => ({ ma: 200, than: await ctx.dichVu["hang-kho"].tim({ tuKhoa: yc.truyVan.q }) })
    }
  ]
};

function dungCoModuleThu(mon) {
  const thuMuc = fs.mkdtempSync(path.join(os.tmpdir(), "hang-kho-"));
  const nhatKy = taoNhatKyGia();
  const kho = taoKhoTep({ thuMuc, nhatKy });
  const khung = taoKhung({
    cong: { kho, nhatKy, gio: taoGioGia(), httpNgoai: taoHttpNgoaiGia(), quyen: taoCongQuyen({ maQuanTri: MA_QT, maDichVu: MA_DV }) },
    nhatKy, toKhais: [toKhai, MODULE_THU], cauHinh: { "hang-kho": {} }
  });
  return { khung, kho, nhatKy, daNap: khung.xuLy(nap(mon)).then(() => kho.choXong()) };
}
const MOT_DOI = [{ ...MON_MAU, sizes: [{ size: "42", qty: 1, price: 100000, warehouseId: "wh_yen" }] }];
const goiGiu = (than) => ({ method: "POST", duong: "/thu/giu", truyVan: {}, tieuDe: { authorization: `Bearer ${MA_QT}` }, doc: async () => than });
const goiTra = (than) => ({ method: "POST", duong: "/thu/tra", truyVan: {}, tieuDe: { authorization: `Bearer ${MA_QT}` }, doc: async () => than });

test("giu cho xong thi khach sau khong thay con hang nua", async () => {
  const bo = dungCoModuleThu(MOT_DOI);
  await bo.daNap;

  const giu = await bo.khung.xuLy(goiGiu({ ma: "DV1234", size: "42", soLuong: 1 }));
  assert.equal(giu.than.ok, true, JSON.stringify(giu.than));
  await bo.kho.choXong();

  const ck = await bo.khung.xuLy(docCongKhai());
  assert.equal(ck.than[0].sizes[0].available, false);
});

test("KHONG bao gio giu qua so hang dang co", async () => {
  const bo = dungCoModuleThu(MOT_DOI);
  await bo.daNap;

  assert.equal((await bo.khung.xuLy(goiGiu({ ma: "DV1234", size: "42", soLuong: 2 }))).than.ok, false, "xin 2 ma chi co 1");
  const mot = await bo.khung.xuLy(goiGiu({ ma: "DV1234", size: "42", soLuong: 1 }));
  assert.equal(mot.than.ok, true);
  await bo.kho.choXong();

  const hai = await bo.khung.xuLy(goiGiu({ ma: "DV1234", size: "42", soLuong: 1 }));
  assert.equal(hai.than.ok, false, "nguoi thu hai khong duoc giu chong len");
  assert.equal(hai.than.viSao, "khong_du_hang");
});

test("giu het doi cuoi thi phat su kien het hang len bang tin", async () => {
  const bo = dungCoModuleThu(MOT_DOI);
  await bo.daNap;
  const nghe = [];
  bo.khung.bus.nghe("hang-kho.het-hang", "bai-thu", (d) => nghe.push(d));

  await bo.khung.xuLy(goiGiu({ ma: "DV1234", size: "42", soLuong: 1 }));
  await new Promise((r) => setImmediate(r));
  assert.equal(nghe.length, 1);
  assert.equal(nghe[0].size, "42");
});

test("tra cho thi hang con lai ngay", async () => {
  const bo = dungCoModuleThu(MOT_DOI);
  await bo.daNap;

  const giu = await bo.khung.xuLy(goiGiu({ ma: "DV1234", size: "42", soLuong: 1 }));
  await bo.kho.choXong();
  assert.equal((await bo.khung.xuLy(docCongKhai())).than[0].sizes[0].available, false);

  const tra = await bo.khung.xuLy(goiTra({ maPhieu: giu.than.maPhieu }));
  assert.equal(tra.than.ok, true);
  await bo.kho.choXong();
  assert.equal((await bo.khung.xuLy(docCongKhai())).than[0].sizes[0].available, true);
});

test("tra mot phieu khong co thi bao khong co, khong nem", async () => {
  const bo = dungCoModuleThu([MON_MAU]);
  await bo.daNap;
  assert.equal((await bo.khung.xuLy(goiTra({ maPhieu: "khong-co" }))).than.ok, false);
});

test("bo nao tim hang theo ten: chi tra mon thuc su khop", async () => {
  const bo = dungCoModuleThu([MON_MAU, { ...MON_MAU, code: "PEG40", name: "Dep Nike" }]);
  await bo.daNap;
  const ra = await bo.khung.xuLy({ method: "GET", duong: "/thu/tim", truyVan: { q: "pegasus" }, tieuDe: { authorization: `Bearer ${MA_QT}` } });
  assert.equal(ra.than.length, 1);
  assert.equal(ra.than[0].code, "DV1234");
});

test("phieu giu cho het han thi tu tra lai hang", async () => {
  const { khung, kho } = await dungVaNap([{ ...MON_MAU, sizes: [{ size: "42", qty: 1, price: 100000, warehouseId: "wh_yen" }] }]);
  const { maBienThe, chuanHoaMon: ch } = require("../modules/hang-kho/chuan-hoa");
  const mon = ch({ ...MON_MAU, sizes: [{ size: "42", qty: 1, price: 100000, warehouseId: "wh_yen" }] });
  await kho.so("giu-cho").ghi({
    version: 1,
    phieu: { cu: { maBienThe: maBienThe(mon, mon.sizes[0]), ma: "DV1234", size: "42", soLuong: 1, hetHanLuc: "2020-01-01T00:00:00.000Z" } },
    updatedAt: ""
  });
  await kho.choXong();
  const ra = await khung.xuLy(docCongKhai());
  assert.equal(ra.than[0].sizes[0].available, true, "phieu qua han khong duoc giu hang nua");
});
