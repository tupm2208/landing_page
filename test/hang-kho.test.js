// Module Hang hoa & kho — tu dot 2b chay tren BANG MySQL that.
//
//   TOPRUN_MYSQL_URL=mysql://root:...@127.0.0.1:3307/toprun_modules_test \
//     node --test test/hang-kho.test.js
//
// Trong tam: KHONG bao gio lo gia von / ton that / ten kho ra ban cong khai; giu cho khong
// bao gio giu qua so hang dang co; va ba nguon hang (hang nha, chien dich, hang co san)
// dong bo doc lap — dong bo mot nguon khong duoc dung toi nguon kia.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { taoKhung } = require("../loi/khung");
const { taoKhoMysql } = require("../loi/cong/kho-mysql");
const { taoNhatKyGia, taoGioGia, taoHttpNgoaiGia } = require("../loi/cong/co-ban");
const { taoCongQuyen } = require("../loi/cong/quyen");
const { taoBoDemGoi } = require("../loi/cong/han-goi");
const toKhai = require("../modules/hang-kho/module");
const { chuanHoaMon, banCongKhai, nhanKho } = require("../modules/hang-kho/chuan-hoa");

const MA_QT = "ma-quan-tri";
const MA_DV = "ma-bo-nao";
const DUONG = String(process.env.TOPRUN_MYSQL_URL || "").trim();
const boQua = DUONG ? {} : { skip: "chưa đặt TOPRUN_MYSQL_URL — bỏ qua bài hàng hoá" };
if (DUONG && /:3306\//.test(DUONG)) throw new Error("Cổng 3306 là dữ liệu thật của landing. Dùng 3307.");

const MON = {
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

// ---------- phan khong can MySQL: chuan hoa thuan tuy ----------

test("gia ban cua mon = gia NHO NHAT trong cac size (khach thay 'từ ... đ')", () => {
  const m = chuanHoaMon({ ...MON, sizes: [{ size: "42", price: 3200000 }, { size: "43", price: 2890000 }] });
  assert.equal(m.price, 2890000);
});

test("gia ban cao hon gia niem yet la du lieu sai — tu an mon di", () => {
  const m = chuanHoaMon({ code: "X1", name: "Món lỗi giá", listPrice: 1000000, sizes: [{ size: "40", price: 1500000 }] });
  assert.equal(m.status, "hidden");
  assert.equal(m.hiddenReason, "invalid_price_sale_gt_list");
});

test("mon thieu ma hoac thieu ten thi bi bo", () => {
  assert.equal(chuanHoaMon({ name: "Không có mã" }), null);
  assert.equal(chuanHoaMon({ code: "A1" }), null);
});

test("anh nhap lieu noi bo khong duoc lot ra ban cong khai", () => {
  const m = chuanHoaMon({ ...MON, thumbnailImage: "/assets/thumbnails/x.jpg", galleryImages: ["/assets/thumbnails/y.jpg", "/anh/that.jpg"] });
  assert.equal(m.thumbnailImage, "");
  assert.deepEqual(m.galleryImages, ["/anh/that.jpg"]);
});

test("ten kho duoc rut thanh nhan ngan — khong noi ten kho voi khach", () => {
  assert.equal(nhanKho("wh_cau_dien", "Cầu Diễn"), "CD");
  assert.equal(nhanKho("wh_toprun_ha_noi", ""), "TR");
});

test("het sach moi size thi mon la het hang, du ho so ghi 'orderable'", () => {
  const ck = banCongKhai(chuanHoaMon({ ...MON, status: "orderable", sizes: [{ size: "42", qty: 0, price: 100000 }] }));
  assert.equal(ck.status, "hidden");
});

// ---------- phan chay tren bang that ----------

test("Hàng hoá trên MySQL thật", { ...boQua }, async (t) => {
  const nhatKy = taoNhatKyGia();
  const gio = taoGioGia();
  const kho = await taoKhoMysql({ duongKetNoi: DUONG, nhatKy });
  await kho.chayLuocDo("hang-kho", toKhai.luocDo);

  // Don giua hai bai. `gio.troi` la CO Y: duong day danh muc co han 20 lan / 10 phut, va bo
  // bai nay goi gan 20 lan — khong buoc qua mot cua so thi cuoi bo bi chan that (chan dung,
  // bai sai). Buoc qua cung lam het han moi phieu giu cho con sot.
  const donDep = async () => {
    gio.troi(11 * 60 * 1000);
    // Xoa ca so `revision` cua hang co san: no la trang thai giua hai lan chay, va bai
    // "goi cu khong duoc de len goi moi" phu thuoc vao no.
    try { await kho.cauLenh("DELETE FROM so_du_lieu WHERE ten = ?", ["hang-kho-hang-co-san"]); } catch { /* chua co bang */ }
    for (const b of ["hang_kho_giu_cho", "hang_kho_bien_the", "hang_kho_mon", "hang_kho_ma_chan"]) {
      await kho.cauLenh(`DELETE FROM \`${b}\``, []);
    }
  };
  await donDep();
  t.after(async () => { await donDep(); await kho.dong(); });

  const khung = taoKhung({
    cong: { kho, nhatKy, gio, httpNgoai: taoHttpNgoaiGia(), quyen: taoCongQuyen({ maQuanTri: MA_QT, maDichVu: MA_DV }), hanGoi: taoBoDemGoi({ gio }) },
    nhatKy, toKhais: [toKhai, MODULE_THU], cauHinh: { "hang-kho": {} }
  });

  const quanTri = { authorization: `Bearer ${MA_QT}` };
  const nap = (mon = [MON], duong = "/api/products") =>
    khung.xuLy({ method: "POST", duong, truyVan: {}, tieuDe: quanTri, ip: "1.1.1.1", doc: async () => mon });
  const docCongKhai = (truyVan = {}) => khung.xuLy({ method: "GET", duong: "/api/products", truyVan, tieuDe: {}, ip: "1.1.1.1" });
  const docTrongNha = () => khung.xuLy({ method: "GET", duong: "/api/admin/products", truyVan: {}, tieuDe: quanTri, ip: "1.1.1.1" });
  const hoiTon = (ma, size) => khung.xuLy({
    method: "GET", duong: `/api/hang-kho/ton/${ma}`, truyVan: size ? { size } : {},
    tieuDe: { authorization: `Bearer ${MA_DV}` }, ip: "1.1.1.1"
  });
  const goiGiu = (than) => khung.xuLy({ method: "POST", duong: "/thu/giu", truyVan: {}, tieuDe: quanTri, ip: "1.1.1.1", doc: async () => than });
  const goiTra = (than) => khung.xuLy({ method: "POST", duong: "/thu/tra", truyVan: {}, tieuDe: quanTri, ip: "1.1.1.1", doc: async () => than });

  await t.test("mot mon thanh mot dong mon + nhieu dong bien the", async () => {
    await donDep();
    const ra = await nap();
    assert.equal(ra.ma, 200, JSON.stringify(ra.than));
    assert.equal(ra.than.soMon, 1);
    assert.equal(ra.than.soBienThe, 3);
    assert.equal(await kho.bang("hang_kho_mon").dem(), 1);
    assert.equal(await kho.bang("hang_kho_bien_the").dem(), 3);
  });

  await t.test("OMI ghi/sua/xoa TUNG mon (PUT/DELETE /api/hang-kho/mon/:ma) — khong dung toi mon khac", async () => {
    await donDep();
    await nap([MON, { ...MON, code: "KHAC01", name: "Giày khác", sizes: [{ size: "40", qty: 2, price: 1000000 }] }]);
    const ghi = (ma, than) => khung.xuLy({ method: "PUT", duong: `/api/hang-kho/mon/${ma}`, truyVan: {}, tieuDe: quanTri, ip: "1.1.1.1", doc: async () => than });
    const xoa = (ma) => khung.xuLy({ method: "DELETE", duong: `/api/hang-kho/mon/${ma}`, truyVan: {}, tieuDe: quanTri, ip: "1.1.1.1" });

    // Them mot mon moi.
    const ra = await ghi("MOI01", { code: "MOI01", name: "Giày mới nhập tay", brand: "Asics", listPrice: 2000000, sizes: [{ size: "41", qty: 1, price: 1500000 }, { size: "42", qty: 0, price: 1500000 }] });
    assert.equal(ra.ma, 200, JSON.stringify(ra.than));
    assert.equal(ra.than.mon.code, "MOI01");
    assert.equal(ra.than.soBienThe, 2);
    assert.equal(await kho.bang("hang_kho_mon").dem(), 3, "hai mon cu con nguyen");

    // Sua: doi ten, bot size -> bien the cu cua mon do bi thay, mon khac khong doi.
    const sua = await ghi("MOI01", { name: "Giày mới (đã sửa)", sizes: [{ size: "41", qty: 4, price: 1400000 }] });
    assert.equal(sua.ma, 200);
    assert.equal(sua.than.mon.name, "Giày mới (đã sửa)");
    assert.equal(sua.than.mon.sizes.length, 1);
    assert.equal((await hoiTon("DV1234", "42")).than.co, true, "mon cu van con");

    // Ma tren duong dan phai khop ma trong than; thieu ten thi bao ro.
    assert.equal((await ghi("MOI01", { code: "KHAC", name: "x" })).ma, 400);
    assert.equal((await ghi("MOI02", { sizes: [] })).than.error, "mon_bi_bo");
    assert.equal((await khung.xuLy({ method: "PUT", duong: "/api/hang-kho/mon/MOI01", truyVan: {}, tieuDe: {}, ip: "1.1.1.1", doc: async () => ({}) })).ma, 401, "phai co ma quan tri");

    // Xoa: mon mat, mon khac con; xoa lai thi 404.
    assert.equal((await xoa("MOI01")).ma, 200);
    assert.equal(await kho.bang("hang_kho_mon").dem(), 2);
    assert.equal((await xoa("MOI01")).ma, 404);

    // Xoa mon dang co bien the cua nguon khac (hang co san): chi bo phan hang nha, dong mon giu lai.
    await kho.bang("hang_kho_bien_the").them({ ma_bien_the: "bt-ready-dv1234", ma_mon: "DV1234", size: "42", ma_kho: "wh_ready", ton: 1, gia: 2500000, gia_niem_yet: 0, thu_tu_kho: 1, nguon: "ready", ma_chien_dich: "", ma_dong_doi_tac: "", sua_luc: new Date() });
    const x2 = await xoa("DV1234");
    assert.equal(x2.ma, 200);
    assert.equal(x2.than.conNguonKhac, true);
    assert.equal(await kho.bang("hang_kho_mon").dem({ ma: "DV1234" }), 1, "dong mon giu lai vi con hang co san");
    assert.equal(await kho.bang("hang_kho_bien_the").dem({ ma_mon: "DV1234" }), 1, "chi con dong hang co san");
  });

  await t.test("OMI nap them tu Excel (POST /api/hang-kho/nap-them): them vao, khong xoa mon dang co; cung ma thi dong sau thang", async () => {
    await donDep();
    await nap();
    const ra = await khung.xuLy({ method: "POST", duong: "/api/hang-kho/nap-them", truyVan: {}, tieuDe: quanTri, ip: "1.1.1.1", doc: async () => [
      { code: "EX01", name: "Excel 1", sizes: [{ size: "40", qty: 1, price: 900000 }] },
      { code: "EX02", name: "Excel 2", sizes: [{ size: "40", qty: 1, price: 900000 }] },
      { code: "EX02", name: "Excel 2 (dòng sau)", sizes: [{ size: "41", qty: 2, price: 950000 }] },
      { code: "", name: "thiếu mã" }
    ] });
    assert.equal(ra.ma, 200, JSON.stringify(ra.than));
    assert.equal(ra.than.soMon, 2);
    assert.equal(ra.than.biBo, 1);
    assert.equal(await kho.bang("hang_kho_mon").dem(), 3, "mon cu DV1234 con nguyen");
    const ex2 = (await docTrongNha()).than.find((m) => m.code === "EX02");
    assert.equal(ex2.name, "Excel 2 (dòng sau)");
    assert.deepEqual(ex2.sizes.map((d) => d.size), ["41"]);
    assert.equal((await khung.xuLy({ method: "POST", duong: "/api/hang-kho/nap-them", truyVan: {}, tieuDe: quanTri, ip: "1.1.1.1", doc: async () => ({ x: 1 }) })).ma, 400);
  });

  await t.test("ban cong khai khong mang gia von, ton that hay uu tien kho", async () => {
    await donDep();
    await nap([{ ...MON, costPrice: 1500000, warehouseStocks: { wh_yen: 5 } }]);
    const chu = JSON.stringify((await docCongKhai()).than);
    assert.ok(!chu.includes("costPrice"), "lo gia von");
    assert.ok(!chu.includes("warehouseStocks"), "lo ton tung kho");
    assert.ok(!/Cầu Diễn|"Yên"/.test(chu), "lo ten kho");
  });

  await t.test("ban cong khai chi noi con hay het, KHONG noi con may doi", async () => {
    await donDep(); await nap();
    const mon = (await docCongKhai()).than[0];
    for (const d of mon.sizes.filter((x) => x.size === "42")) assert.equal(d.qty, 1);
    assert.equal(mon.sizes.find((x) => x.size === "43").available, false);
  });

  await t.test("ban trong nha CO ton that, va phai co ma quan tri", async () => {
    await donDep(); await nap();
    assert.equal((await khung.xuLy({ method: "GET", duong: "/api/admin/products", truyVan: {}, tieuDe: {}, ip: "1.1.1.1" })).ma, 401);
    const mon = (await docTrongNha()).than[0];
    assert.equal(mon.sizes.filter((d) => d.size === "42").reduce((t2, d) => t2 + d.qty, 0), 5);
  });

  await t.test("mo mot mon theo ma hoac theo duong dan deu ra", async () => {
    await donDep(); await nap();
    const theoMa = await khung.xuLy({ method: "GET", duong: "/api/products/DV1234", truyVan: {}, tieuDe: {}, ip: "1.1.1.1" });
    assert.equal(theoMa.ma, 200);
    const theoDuong = await khung.xuLy({ method: "GET", duong: `/api/products/${theoMa.than.slug}`, truyVan: {}, tieuDe: {}, ip: "1.1.1.1" });
    assert.equal(theoDuong.than.code, "DV1234");
    assert.equal((await khung.xuLy({ method: "GET", duong: "/api/products/khong-co", truyVan: {}, tieuDe: {}, ip: "1.1.1.1" })).ma, 404);
  });

  await t.test("tim theo ten: ma dung truoc, ten khop sau", async () => {
    await donDep();
    await nap([MON, { ...MON, code: "PEG40", name: "Dép Nike" }]);
    const ra = await docCongKhai({ q: "pegasus" });
    assert.equal(ra.than.length, 1);
    assert.equal(ra.than[0].code, "DV1234");
  });

  // ---------- ba nguon hang ----------

  await t.test("dong bo HANG CO SAN khong dung toi hang nha", async () => {
    await donDep();
    await nap();                                     // hang nha: 3 bien the
    // Kho hang co san phai nam trong danh sach khai truoc (wh_toprun* / wh_partner_dasbui) —
    // xem LUAT 1 trong goi-desk.js. Kho la thi dong do bi bo.
    await nap([{ code: "RS01", name: "Hàng có sẵn A", sizes: [{ size: "41", qty: 2, price: 1000000, warehouseId: "wh_toprun_yen" }] }],
      "/api/ready-stock/sync");
    assert.equal(await kho.bang("hang_kho_bien_the").dem({ nguon: "own" }), 3, "hang nha phai con nguyen");
    assert.equal(await kho.bang("hang_kho_bien_the").dem({ nguon: "ready" }), 1);

    // Dong bo lai hang co san lan hai: chi thay dong cua chinh no.
    await nap([{ code: "RS02", name: "Hàng có sẵn B", sizes: [{ size: "40", qty: 1, price: 900000, warehouseId: "wh_toprun_cau_dien" }] }],
      "/api/ready-stock/sync");
    assert.equal(await kho.bang("hang_kho_bien_the").dem({ nguon: "own" }), 3, "dong bo hang co san khong duoc dung toi hang nha");
    assert.equal(await kho.bang("hang_kho_bien_the").dem({ nguon: "ready" }), 1);
    assert.equal((await kho.bang("hang_kho_mon").mot({ ma: "RS01" })), null, "hang co san cu phai bi thay");
  });

  await t.test("goi hang co san CU khong duoc de len goi moi", async () => {
    await donDep();
    const goi = (revision, ma, size) => ({
      revision,
      branches: [{ id: "wh_toprun_yen", name: "TopRun - Yến", active: true }],
      products: [{ code: ma, name: "Hàng có sẵn " + ma, imageUrl: "a.jpg", variants: [{ size, branchId: "wh_toprun_yen", qty: 3, salePrice: 1000000 }] }]
    });

    const moi = await nap(goi(10, "RS10", "41"), "/api/ready-stock/sync");
    assert.equal(moi.ma, 200, JSON.stringify(moi.than));
    assert.equal(moi.than.revision, 10);

    const cu = await nap(goi(9, "RS09", "42"), "/api/ready-stock/sync");
    assert.equal(cu.ma, 409, "goi revision 9 gui sau goi revision 10 phai bi tu choi");
    assert.equal(cu.than.error, "goi_hang_co_san_cu");
    assert.equal(cu.than.revisionHienTai, 10);

    assert.ok(await kho.bang("hang_kho_mon").mot({ ma: "RS10" }), "hang cua goi moi phai con nguyen");
    assert.equal(await kho.bang("hang_kho_mon").mot({ ma: "RS09" }), null);

    // Cung revision thi cho qua (Desk gui lai dung goi do) — khong lam mat du lieu.
    assert.equal((await nap(goi(10, "RS10", "41"), "/api/ready-stock/sync")).ma, 200);
  });

  await t.test("chien dich doi tac cung la mot nguon rieng", async () => {
    await donDep();
    await nap();
    await nap([{ code: "CD01", name: "Hàng chiến dịch", campaignId: "sup-01", sizes: [{ size: "42", qty: 5, price: 2000000, warehouseId: "wh_sup" }] }],
      "/api/partner-campaigns");
    assert.equal(await kho.bang("hang_kho_bien_the").dem({ nguon: "campaign" }), 1);
    assert.equal(await kho.bang("hang_kho_bien_the").dem({ nguon: "own" }), 3);

    const ck = (await docCongKhai()).than;
    assert.equal(ck.length, 2, "ca hai nguon deu hien tren web");
  });

  await t.test("day len thu khong phai mang thi tu choi, khong xoa danh muc cu", async () => {
    await donDep(); await nap();
    assert.equal((await nap({ linh: "tinh" })).ma, 400);
    assert.equal(await kho.bang("hang_kho_mon").dem(), 1, "danh muc cu phai con nguyen");
  });

  // ---------- chan ma ----------

  await t.test("ma bi chan khong lot ra web VA khong duoc ghi vao bang", async () => {
    await donDep();
    await kho.bang("hang_kho_ma_chan").them({ ma: "cam01", vi_sao: "bai kiem tra", them_luc: "2026-09-12 00:00:00.000" });
    await nap([MON, { ...MON, code: "CAM01", name: "Món cấm bán" }]);

    assert.deepEqual((await docCongKhai()).than.map((m) => m.code), ["DV1234"]);
    assert.equal(await kho.bang("hang_kho_mon").dem({ ma: "CAM01" }), 0, "chan o dau GHI, khong chi o dau doc");
  });

  await t.test("chan ma SAU khi da nap thi mon bien khoi web ngay", async () => {
    await donDep(); await nap();
    await kho.bang("hang_kho_ma_chan").them({ ma: "dv1234", vi_sao: "", them_luc: "2026-09-12 00:00:00.000" });
    assert.equal((await docCongKhai()).than.length, 0);
  });

  // ---------- hoi ton ----------

  await t.test("bo nao hoi ton: dung size con, dung size het", async () => {
    await donDep(); await nap();
    assert.equal((await hoiTon("DV1234", "42")).than.co, true);
    assert.equal((await hoiTon("DV1234", "43")).than.co, false);
    assert.equal((await hoiTon("DV1234")).than.cacDong.length, 2);
    assert.equal((await hoiTon("KHONGCO")).than.viSao, "khong_co_ma");
  });

  await t.test("cac dong ton sap theo gia re truoc, bang gia thi theo uu tien kho", async () => {
    await donDep();
    await nap([{
      ...MON,
      warehousePriorityIds: ["wh_yen", "wh_cau_dien"],
      // Ba kho khac nhau: mot bo ba (mon + size + kho) la MOT bien the.
      sizes: [
        { size: "42", qty: 1, price: 2890000, warehouseId: "wh_cau_dien" },
        { size: "42", qty: 1, price: 2890000, warehouseId: "wh_yen" },
        { size: "42", qty: 1, price: 2500000, warehouseId: "wh_hang_td" }
      ]
    }]);
    const dong = (await hoiTon("DV1234")).than.cacDong;
    assert.equal(dong[0].gia, 2500000, "re nhat di truoc");
    assert.equal(dong[1].maKho, "wh_yen", "bang gia thi kho uu tien cao hon di truoc");
  });

  await t.test("hai dong TRUNG (cung mon + size + kho) khong duoc giet ca dot day danh muc", async () => {
    await donDep();
    const ra = await nap([{
      ...MON,
      sizes: [
        { size: "42", qty: 1, price: 2890000, warehouseId: "wh_yen" },
        { size: "42", qty: 1, price: 2500000, warehouseId: "wh_yen" },   // trung bo ba
        { size: "43", qty: 2, price: 2890000, warehouseId: "wh_yen" }
      ]
    }]);
    assert.equal(ra.ma, 200, "mot dong xau khong duoc lam hong ca danh muc");
    assert.equal(ra.than.soBienThe, 2, "hai dong trung gop lai con mot");

    const dong = (await hoiTon("DV1234", "42")).than.cacDong;
    assert.equal(dong.length, 1);
    assert.equal(dong[0].gia, 2500000, "giu dong gia thap hon");
    assert.ok(
      nhatKy.dong.some((d) => /bi trung/.test(d.noiDung)),
      "phai ghi canh bao de nguoi van hanh biet ma sua nguon"
    );
  });

  await t.test("duong hoi ton khong mo cho khach", async () => {
    assert.equal((await khung.xuLy({ method: "GET", duong: "/api/hang-kho/ton/DV1234", truyVan: {}, tieuDe: {}, ip: "1.1.1.1" })).ma, 401);
  });

  // ---------- giu cho ----------

  await t.test("giu cho xong thi khach sau khong thay con hang nua", async () => {
    await donDep();
    await nap([{ ...MON, sizes: [{ size: "42", qty: 1, price: 100000, warehouseId: "wh_yen" }] }]);
    assert.equal((await goiGiu({ ma: "DV1234", size: "42", soLuong: 1 })).than.ok, true);
    assert.equal((await docCongKhai()).than[0].sizes[0].available, false);
  });

  await t.test("KHONG bao gio giu qua so hang dang co", async () => {
    await donDep();
    await nap([{ ...MON, sizes: [{ size: "42", qty: 1, price: 100000, warehouseId: "wh_yen" }] }]);
    assert.equal((await goiGiu({ ma: "DV1234", size: "42", soLuong: 2 })).than.ok, false, "xin 2 ma chi co 1");
    assert.equal((await goiGiu({ ma: "DV1234", size: "42", soLuong: 1 })).than.ok, true);
    const hai = await goiGiu({ ma: "DV1234", size: "42", soLuong: 1 });
    assert.equal(hai.than.ok, false);
    assert.equal(hai.than.viSao, "khong_du_hang");
  });

  await t.test("hai nguoi xin doi CUOI CUNG cung luc: dung mot nguoi duoc", async () => {
    await donDep();
    await nap([{ ...MON, sizes: [{ size: "42", qty: 1, price: 100000, warehouseId: "wh_yen" }] }]);
    const [a, b] = await Promise.all([
      goiGiu({ ma: "DV1234", size: "42", soLuong: 1 }),
      goiGiu({ ma: "DV1234", size: "42", soLuong: 1 })
    ]);
    const duoc = [a, b].filter((x) => x.than.ok).length;
    assert.equal(duoc, 1, "khoa dong phai cho dung mot nguoi giu duoc doi cuoi");
  });

  await t.test("giu het doi cuoi thi phat su kien het hang", async () => {
    await donDep();
    await nap([{ ...MON, sizes: [{ size: "42", qty: 1, price: 100000, warehouseId: "wh_yen" }] }]);
    const nghe = [];
    khung.bus.nghe("hang-kho.het-hang", "bai-thu", (d) => nghe.push(d));
    await goiGiu({ ma: "DV1234", size: "42", soLuong: 1 });
    await new Promise((r) => setImmediate(r));
    assert.equal(nghe.length, 1);
    assert.equal(nghe[0].size, "42");
  });

  await t.test("tra cho thi hang con lai ngay", async () => {
    await donDep();
    await nap([{ ...MON, sizes: [{ size: "42", qty: 1, price: 100000, warehouseId: "wh_yen" }] }]);
    const giu = await goiGiu({ ma: "DV1234", size: "42", soLuong: 1 });
    assert.equal((await docCongKhai()).than[0].sizes[0].available, false);
    assert.equal((await goiTra({ maPhieu: giu.than.maPhieu })).than.ok, true);
    assert.equal((await docCongKhai()).than[0].sizes[0].available, true);
  });

  await t.test("phieu giu cho het han thi tu tra lai hang", async () => {
    await donDep();
    await nap([{ ...MON, sizes: [{ size: "42", qty: 1, price: 100000, warehouseId: "wh_yen" }] }]);
    await goiGiu({ ma: "DV1234", size: "42", soLuong: 1 });
    assert.equal((await docCongKhai()).than[0].sizes[0].available, false);

    gio.troi(30 * 60 * 1000 + 1000);
    assert.equal((await docCongKhai()).than[0].sizes[0].available, true, "qua 30 phut phai tra lai hang");
  });
});

// Module THU: goi dich vu that cua hang-kho qua dung duong khung noi.
const MODULE_THU = {
  id: "thu-giu-cho", ten: "Thu giu cho", mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1",
  canDichVu: ["hang-kho.giuCho", "hang-kho.traCho"],
  duong: [
    {
      method: "POST", path: "/thu/giu", quyen: "quan-tri",
      tay: async (ctx, yc) => ({ ma: 200, than: await ctx.dichVu["hang-kho"].giuCho(await yc.doc()) })
    },
    {
      method: "POST", path: "/thu/tra", quyen: "quan-tri",
      tay: async (ctx, yc) => ({ ma: 200, than: await ctx.dichVu["hang-kho"].traCho(await yc.doc()) })
    }
  ]
};
