// Module Don hang & khach — chay tren MySQL THAT, vi don hang that nam o MySQL.
//
//   TOPRUN_MYSQL_URL=mysql://root:thu-nghiem-chi-may-nay@127.0.0.1:3307/toprun_modules_test \
//     node --test test/don-khach.test.js
//
// Trong tam: dat don phai GIU CHO ton truoc, ghi don la MOT giao dich, va moi con so tien
// di qua order-money-kit.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { taoKhung } = require("../loi/khung");
const { taoKhoMysql } = require("../loi/cong/kho-mysql");
const { taoNhatKyGia, taoGioGia, taoHttpNgoaiGia } = require("../loi/cong/co-ban");
const { taoBoDemGoi } = require("../loi/cong/han-goi");
const { taoCongQuyen } = require("../loi/cong/quyen");
const toKhaiDon = require("../modules/don-khach/module");
const toKhaiKho = require("../modules/hang-kho/module");

const MA_QT = "ma-quan-tri";
const DUONG = String(process.env.TOPRUN_MYSQL_URL || "").trim();
const boQua = DUONG ? {} : { skip: "chưa đặt TOPRUN_MYSQL_URL — bỏ qua bài đơn hàng" };
if (DUONG && /:3306\//.test(DUONG)) throw new Error("Cổng 3306 là dữ liệu thật của landing. Dùng 3307.");

const MON = {
  code: "DV1234", name: "Giày chạy Nike Pegasus 40", brand: "Nike", listPrice: 3500000,
  sizes: [{ size: "42", qty: 2, price: 2890000, warehouseId: "wh_yen" }]
};

const LUOC_DO_THU = `
CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(64) NOT NULL,
  customer_name VARCHAR(190) NOT NULL DEFAULT '',
  phone VARCHAR(32) NOT NULL DEFAULT '',
  email VARCHAR(190) NOT NULL DEFAULT '',
  address VARCHAR(500) NOT NULL DEFAULT '',
  province VARCHAR(190) NOT NULL DEFAULT '',
  district VARCHAR(190) NOT NULL DEFAULT '',
  ward VARCHAR(190) NOT NULL DEFAULT '',
  address_detail VARCHAR(255) NOT NULL DEFAULT '',
  note TEXT NULL,
  total DECIMAL(14,2) NOT NULL DEFAULT 0,
  status VARCHAR(48) NOT NULL DEFAULT 'pending',
  payment_status VARCHAR(48) NOT NULL DEFAULT 'payment_pending',
  payment_method VARCHAR(64) NOT NULL DEFAULT '',
  payment_provider VARCHAR(64) NOT NULL DEFAULT '',
  payment_reference VARCHAR(128) NOT NULL DEFAULT '',
  payment_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  order_lookup_token_hash VARCHAR(128) NULL,
  fulfillment_status VARCHAR(48) NOT NULL DEFAULT 'not_assigned',
  shipping_provider VARCHAR(100) NOT NULL DEFAULT '',
  tracking_code VARCHAR(100) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id), KEY idx_orders_created_at (created_at), KEY idx_orders_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const LUOC_DO_DONG = `
CREATE TABLE IF NOT EXISTS order_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id VARCHAR(64) NOT NULL, line_no INT NOT NULL DEFAULT 1,
  product_code VARCHAR(128) NOT NULL DEFAULT '', variant_id VARCHAR(128) NOT NULL DEFAULT '',
  product_name VARCHAR(255) NOT NULL DEFAULT '', size VARCHAR(64) NOT NULL DEFAULT '',
  quantity INT NOT NULL DEFAULT 1, price DECIMAL(14,2) NOT NULL DEFAULT 0,
  sale_file_price DECIMAL(14,2) NOT NULL DEFAULT 0,
  source VARCHAR(64) NOT NULL DEFAULT '', source_name VARCHAR(190) NOT NULL DEFAULT '',
  warehouse_id VARCHAR(128) NOT NULL DEFAULT '', warehouse_name VARCHAR(190) NOT NULL DEFAULT '',
  image_url VARCHAR(500) NOT NULL DEFAULT '',
  PRIMARY KEY (id), KEY idx_order_items_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const LUOC_DO_NHAT_KY = `
CREATE TABLE IF NOT EXISTS order_status_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id VARCHAR(64) NOT NULL, status VARCHAR(48) NOT NULL,
  actor_type VARCHAR(32) NOT NULL DEFAULT 'system', actor_id VARCHAR(128) NOT NULL DEFAULT '',
  note TEXT NULL, created_at DATETIME NOT NULL,
  PRIMARY KEY (id), KEY idx_order_status_logs_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

test("Đơn hàng trên MySQL thật", { ...boQua }, async (t) => {
  const nhatKy = taoNhatKyGia();
  const gio = taoGioGia();
  const kho = await taoKhoMysql({ duongKetNoi: DUONG, nhatKy });

  for (const sql of [LUOC_DO_THU, LUOC_DO_DONG, LUOC_DO_NHAT_KY]) await kho.cauLenh(sql, []);
  // Tu dot 2b, hang hoa cung nam tren bang — bai nay chay ca hai module tren cung mot kho.
  await kho.chayLuocDo("hang-kho", toKhaiKho.luocDo);
  // Don giua hai bai: xoa don VA tra lai moi cho dang giu. Quen ve thu hai thi bai sau luon
  // thay het hang — loi cua bai, khong phai cua module. `gio.troi` de khong dinh han goi
  // (duong day danh muc 20 lan / 10 phut).
  const donDep = async () => {
    gio.troi(11 * 60 * 1000);
    for (const b of ["order_status_logs", "order_items", "orders",
                     "hang_kho_giu_cho", "hang_kho_bien_the", "hang_kho_mon", "hang_kho_ma_chan"]) {
      await kho.cauLenh(`DELETE FROM \`${b}\``, []);
    }
  };
  await donDep();
  t.after(async () => { await donDep(); await kho.dong(); });

  const khung = taoKhung({
    cong: {
      kho, nhatKy, gio, httpNgoai: taoHttpNgoaiGia(),
      quyen: taoCongQuyen({ maQuanTri: MA_QT }), hanGoi: taoBoDemGoi({ gio })
    },
    nhatKy, toKhais: [toKhaiKho, toKhaiDon], cauHinh: { "hang-kho": {}, "don-khach": {} }
  });

  const quanTri = { authorization: `Bearer ${MA_QT}` };
  const napHang = (mon = [MON]) => khung.xuLy({ method: "POST", duong: "/api/products", truyVan: {}, tieuDe: quanTri, ip: "1.1.1.1", doc: async () => mon });
  const dat = (than) => khung.xuLy({ method: "POST", duong: "/api/orders", truyVan: {}, tieuDe: {}, ip: "1.1.1.1", doc: async () => than });
  const DON_MAU = {
    customerName: "Nguyễn Văn A", phone: "0911111111", province: "Hà Nội", district: "Quận Ba Đình",
    ward: "Phường Giảng Võ", addressDetail: "12 Đội Cấn",
    items: [{ productCode: "DV1234", productName: MON.name, size: "42", price: 2890000, qty: 1 }]
  };

  await t.test("mot bang chi duoc MOT module lam chu", () => {
    const bang = khung.banBang();
    for (const b of ["orders", "order_items", "order_status_logs"]) {
      assert.equal(bang.find((x) => x.bang === b)?.module, "don-khach");
    }
  });

  await t.test("dat don: ghi don, dong don va nhat ky trong cung mot lan", async () => {
    await napHang(); 
    const ra = await dat(DON_MAU);
    assert.equal(ra.ma, 200, JSON.stringify(ra.than));
    assert.match(ra.than.id, /^ORD-\d+$/);
    assert.equal(ra.than.total, 2890000);

    assert.equal(await kho.bang("orders").dem({ id: ra.than.id }), 1);
    assert.equal(await kho.bang("order_items").dem({ order_id: ra.than.id }), 1);
    assert.equal(await kho.bang("order_status_logs").dem({ order_id: ra.than.id }), 1);
  });

  await t.test("dat don GIU CHO ton — khach sau khong mua duoc doi da ban", async () => {
    await donDep(); await napHang([{ ...MON, sizes: [{ size: "42", qty: 1, price: 2890000, warehouseId: "wh_yen" }] }]);
    

    assert.equal((await dat(DON_MAU)).ma, 200);
    

    const lanHai = await dat(DON_MAU);
    assert.equal(lanHai.ma, 400);
    assert.equal(lanHai.than.error, "het_hang");
  });

  await t.test("het hang thi KHONG ghi don nao ca", async () => {
    await donDep(); await napHang([{ ...MON, sizes: [{ size: "42", qty: 0, price: 2890000, warehouseId: "wh_yen" }] }]);
    
    assert.equal((await dat(DON_MAU)).than.error, "het_hang");
    assert.equal(await kho.bang("orders").dem(), 0, "khong duoc de lai don rong");
  });

  await t.test("don thieu ten hay dien thoai thi tu choi", async () => {
    await donDep(); await napHang(); 
    assert.equal((await dat({ ...DON_MAU, customerName: "" })).than.error, "thieu_ten_khach");
    assert.equal((await dat({ ...DON_MAU, phone: "" })).than.error, "thieu_dien_thoai");
    assert.equal((await dat({ ...DON_MAU, items: [] })).than.error, "don_khong_co_mon");
    assert.equal(await kho.bang("orders").dem(), 0);
  });

  await t.test("dat don xong thi phat len bang tin", async () => {
    await donDep(); await napHang(); 
    const nghe = [];
    khung.bus.nghe("don-khach.da-tao", "bai-thu", (d) => nghe.push(d));
    const ra = await dat(DON_MAU);
    await new Promise((r) => setImmediate(r));
    assert.equal(nghe.length, 1);
    assert.equal(nghe[0].maDon, ra.than.id);
  });

  await t.test("khach tra don: dung ma don + ma tra thi thay, sai mot trong hai thi khong", async () => {
    await donDep(); await napHang(); 
    const ra = await dat(DON_MAU);
    const tra = (than) => khung.xuLy({ method: "POST", duong: "/api/orders/lookup", truyVan: {}, tieuDe: {}, doc: async () => than });

    const dung = await tra({ order: ra.than.id, token: ra.than.token });
    assert.equal(dung.ma, 200);
    assert.equal(dung.than.don.customerName, "Nguyễn Văn A");

    assert.equal((await tra({ order: ra.than.id, token: "sai" })).ma, 404);
    assert.equal((await tra({ order: "ORD-khong-co", token: ra.than.token })).ma, 404);
    assert.equal((await tra({ order: ra.than.id })).ma, 400);
  });

  await t.test("ma tra cuu KHONG duoc luu ban ro trong so", async () => {
    await donDep(); await napHang(); 
    const ra = await dat(DON_MAU);
    const dong = await kho.bang("orders").mot({ id: ra.than.id });
    assert.notEqual(dong.order_lookup_token_hash, ra.than.token);
    assert.equal(dong.order_lookup_token_hash.length, 64, "phai la ban bam sha256");
  });

  await t.test("tien tren don di qua order-money-kit, khong tu suy dien", async () => {
    await donDep(); await napHang(); 
    const ra = await dat(DON_MAU);

    const doc = async () => (await khung.xuLy({ method: "GET", duong: `/api/orders/${ra.than.id}`, truyVan: {}, tieuDe: quanTri })).than;
    const chuaTra = await doc();
    assert.equal(chuaTra.paidAmount, 0);
    assert.equal(chuaTra.remainingAmount, 2890000);

    await kho.bang("orders").thay({ id: ra.than.id }, { payment_status: "paid" });
    const daTra = await doc();
    assert.equal(daTra.paidAmount, 2890000, "trang thai paid khong kem so tien = da tra du");
    assert.equal(daTra.remainingAmount, 0);
  });

  await t.test("doi trang thai: ghi them mot dong nhat ky, phat len bang tin", async () => {
    await donDep(); await napHang(); 
    const ra = await dat(DON_MAU);
    const nghe = [];
    khung.bus.nghe("don-khach.doi-trang-thai", "bai-thu", (d) => nghe.push(d));

    const doi = await khung.xuLy({
      method: "PATCH", duong: `/api/orders/${ra.than.id}`, truyVan: {}, tieuDe: quanTri,
      doc: async () => ({ status: "confirmed", note: "Gọi khách xác nhận" })
    });
    assert.equal(doi.ma, 200);
    assert.equal(await kho.bang("order_status_logs").dem({ order_id: ra.than.id }), 2);

    const don = (await khung.xuLy({ method: "GET", duong: `/api/orders/${ra.than.id}`, truyVan: {}, tieuDe: quanTri })).than;
    assert.equal(don.status, "confirmed");
    assert.equal(don.statusLogs.length, 2);

    await new Promise((r) => setImmediate(r));
    assert.equal(nghe.length, 1);
  });

  await t.test("doi trang thai mot don khong co thi bao khong co", async () => {
    const ra = await khung.xuLy({
      method: "PATCH", duong: "/api/orders/ORD-khong-co", truyVan: {}, tieuDe: quanTri,
      doc: async () => ({ status: "confirmed" })
    });
    assert.equal(ra.ma, 404);
  });

  await t.test("danh sach don chi cho quan tri, loc duoc theo trang thai va dien thoai", async () => {
    await donDep(); await napHang([{ ...MON, sizes: [{ size: "42", qty: 9, price: 2890000, warehouseId: "wh_yen" }] }]);
    
    // Dong ho gia KHONG chay, nen hai don nay sinh cung mot moc — dung canh bat loi trung ma.
    assert.equal((await dat(DON_MAU)).ma, 200);
    assert.equal((await dat({ ...DON_MAU, phone: "0922222222" })).ma, 200, "don thu hai khong duoc mat vi trung ma");

    assert.equal((await khung.xuLy({ method: "GET", duong: "/api/orders", truyVan: {}, tieuDe: {} })).ma, 401);

    const tatCa = await khung.xuLy({ method: "GET", duong: "/api/orders", truyVan: {}, tieuDe: quanTri });
    assert.equal(tatCa.than.length, 2);

    const mot = await khung.xuLy({ method: "GET", duong: "/api/orders", truyVan: { phone: "0922222222" }, tieuDe: quanTri });
    assert.equal(mot.than.length, 1);
    assert.equal(mot.than[0].phone, "0922222222");
  });

  await t.test("GIA lay tu kho, KHONG lay tu khach — khach gui 1 dong van tinh dung gia", async () => {
    await donDep(); await napHang(); 
    const ra = await dat({ ...DON_MAU, items: [{ productCode: "DV1234", size: "42", price: 1, qty: 1 }] });
    assert.equal(ra.ma, 200, JSON.stringify(ra.than));
    assert.equal(ra.than.total, 2890000, "tong phai theo gia trong kho, khong theo gia khach gui");

    const don = (await khung.xuLy({ method: "GET", duong: `/api/orders/${ra.than.id}`, truyVan: {}, tieuDe: quanTri })).than;
    assert.equal(don.items[0].price, 2890000);
  });

  await t.test("hai don trong CUNG mot mili giay van ra hai ma khac nhau", async () => {
    await donDep(); await napHang([{ ...MON, sizes: [{ size: "42", qty: 5, price: 2890000, warehouseId: "wh_yen" }] }]);
    

    const cacMa = [];
    for (let i = 0; i < 3; i += 1) {
      const ra = await dat(DON_MAU);
      assert.equal(ra.ma, 200, `don thu ${i + 1}: ${JSON.stringify(ra.than)}`);
      cacMa.push(ra.than.id);
    }
    assert.equal(new Set(cacMa).size, 3, `ba don phai ra ba ma: ${cacMa.join(", ")}`);
    assert.ok(cacMa.every((m) => /^ORD-\d+$/.test(m)), "hinh dang ma don khong duoc doi — Desk doc no");
    assert.equal(await kho.bang("orders").dem(), 3);
  });

  await t.test("don tra ra ngoai mang du dong hang va so tien da tinh san", async () => {
    await donDep(); await napHang(); 
    const ra = await dat(DON_MAU);
    const don = (await khung.xuLy({ method: "GET", duong: `/api/orders/${ra.than.id}`, truyVan: {}, tieuDe: quanTri })).than;
    assert.equal(don.items.length, 1);
    assert.equal(don.items[0].productCode, "DV1234");
    assert.equal(don.items[0].size, "42");
    assert.ok("paidAmount" in don && "remainingAmount" in don, "client chi doc field, khong tu suy dien");
  });
});
