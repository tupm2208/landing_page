// Module Tien & doi soat — chay tren MySQL that (don hang nam o bang).
//
// Trong tam:
//   - moi con so tien di qua order-money-kit, khong tu suy dien
//   - so tien do SERVER tinh, khong nhan tu khach
//   - ghi nhan tien la viec cua NGUOI THAT; bot chi doc
//   - Telegram la cau hinh cua TUNG KHACH; shop chua khai thi tat, khong bao bua

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { taoKhung } = require("../loi/khung");
const { taoKhoMysql } = require("../loi/cong/kho-mysql");
const { taoNhatKyGia, taoGioGia } = require("../loi/cong/co-ban");
const { taoCongQuyen } = require("../loi/cong/quyen");
const { taoBoDemGoi } = require("../loi/cong/han-goi");
const mHangKho = require("../modules/hang-kho/module");
const mDon = require("../modules/don-khach/module");
const mTien = require("../modules/tien-doi-soat/module");
const { tienPhaiTra, phiShip, maChuyenKhoan, theoPhanTram } = require("../modules/tien-doi-soat/cong-thuc");

const MA_QT = "ma-quan-tri";
const MA_DV = "ma-bo-nao";
const DUONG = String(process.env.TOPRUN_MYSQL_URL || "").trim();
const boQua = DUONG ? {} : { skip: "chưa đặt TOPRUN_MYSQL_URL — bỏ qua bài tiền" };
if (DUONG && /:3306\//.test(DUONG)) throw new Error("Cổng 3306 là dữ liệu thật của landing. Dùng 3307.");

const MON = {
  code: "DV1234", name: "Giày chạy Nike Pegasus 40", listPrice: 3500000,
  sizes: [{ size: "42", qty: 5, price: 2890000, warehouseId: "wh_yen" }]
};
const DON_MAU = {
  customerName: "Nguyễn Văn A", phone: "0911111111",
  province: "Hà Nội", district: "Quận Ba Đình", ward: "Phường Giảng Võ", addressDetail: "12 Đội Cấn",
  items: [{ productCode: "DV1234", size: "42", qty: 1 }]
};

// ---------- cong thuc: khong can MySQL ----------

test("tra truoc 100% thi MIEN PHI SHIP, cac cach khac thi khong", () => {
  assert.equal(phiShip("full", 30000), 0);
  assert.equal(phiShip("deposit", 30000), 30000);
  assert.equal(phiShip("deposit_hold", 30000), 30000);
  assert.equal(phiShip("confirm_first", 30000), 30000);
});

test("so tien lam tron ve hang chuc nghin, toi thieu 10.000d, khong vuot tong don", () => {
  assert.equal(theoPhanTram(2890000, 50), 1450000);
  assert.equal(theoPhanTram(15000, 20), 10000, "toi thieu 10.000d");
  assert.equal(theoPhanTram(8000, 50), 8000, "khong bao gio vuot tong don");
  assert.equal(theoPhanTram(0, 50), 0);
});

test("giu don la 20%, khong theo % coc cua shop", () => {
  assert.equal(tienPhaiTra("deposit_hold", 2890000, 100), theoPhanTram(2890000, 20));
  assert.equal(tienPhaiTra("deposit", 2890000, 50), theoPhanTram(2890000, 50));
  assert.equal(tienPhaiTra("full", 2890000, 50), 2890000, "tra 100% la tra het");
});

test("ma chuyen khoan mang tien to CUA TUNG SHOP — hai shop khong doc nham tien nhau", () => {
  assert.equal(maChuyenKhoan("ORD-1789000000123", "TR"), "TR-00000123");
  assert.equal(maChuyenKhoan("ORD-1789000000123", "DB"), "DB-00000123");
  // Tien to bi loc sach ky tu la (khoang trang, $) — noi dung chuyen khoan phai go tay duoc.
  assert.equal(maChuyenKhoan("ORD-1", "ma ba$$"), "maba-ORD1");
  // Lay 8 ky tu CUOI cua ma don, va bo dau gach: ORD-1789000000123 -> 00000123.
  assert.equal(maChuyenKhoan("ORD-1789000000123", ""), "TR-00000123", "khong khai tien to thi mac dinh TR");
});

// ---------- chay tren bang that ----------

test("Tiền & đối soát trên MySQL thật", { ...boQua }, async (t) => {
  const nhatKy = taoNhatKyGia();
  const gio = taoGioGia();
  const kho = await taoKhoMysql({ duongKetNoi: DUONG, nhatKy });
  await kho.chayLuocDo("hang-kho", mHangKho.luocDo);

  const daGoi = [];
  const httpNgoai = {
    async goi(url, tuyChon = {}) {
      daGoi.push({ url: String(url), than: JSON.parse(String(tuyChon.body || "{}")) });
      return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => "" };
    }
  };

  const donDep = async () => {
    gio.troi(11 * 60 * 1000);
    daGoi.length = 0;
    for (const b of ["order_status_logs", "order_items", "orders",
                     "hang_kho_giu_cho", "hang_kho_bien_the", "hang_kho_mon", "hang_kho_ma_chan"]) {
      await kho.cauLenh(`DELETE FROM \`${b}\``, []);
    }
  };
  await donDep();
  t.after(async () => { await donDep(); await kho.dong(); });

  const dungKhung = (cauHinhTien = {}) => taoKhung({
    cong: {
      kho, nhatKy, gio, httpNgoai,
      quyen: taoCongQuyen({ maQuanTri: MA_QT, maDichVu: MA_DV }), hanGoi: taoBoDemGoi({ gio })
    },
    nhatKy, toKhais: [mHangKho, mDon, mTien],
    cauHinh: { "hang-kho": {}, "don-khach": {}, "tien-doi-soat": cauHinhTien }
  });

  const quanTri = { authorization: `Bearer ${MA_QT}` };
  const dungDon = async (khung) => {
    await khung.xuLy({ method: "POST", duong: "/api/products", truyVan: {}, tieuDe: quanTri, ip: "1.1.1.1", doc: async () => [MON] });
    const ra = await khung.xuLy({ method: "POST", duong: "/api/orders", truyVan: {}, tieuDe: {}, ip: "1.1.1.1", doc: async () => DON_MAU });
    assert.equal(ra.ma, 200, JSON.stringify(ra.than));
    return ra.than;   // { id, token, total }
  };
  const chon = (khung, than) => khung.xuLy({
    method: "POST", duong: "/api/orders/public/payment-choice", truyVan: {}, tieuDe: {}, ip: "1.1.1.1", doc: async () => than
  });
  const ghiTra = (khung, than, tieuDe = quanTri) => khung.xuLy({
    method: "POST", duong: "/api/tien/da-tra", truyVan: {}, tieuDe, ip: "1.1.1.1", doc: async () => than
  });
  const hoiTien = (khung, maDon, ma = MA_DV) => khung.xuLy({
    method: "GET", duong: `/api/tien/don/${maDon}`, truyVan: {}, tieuDe: { authorization: `Bearer ${ma}` }, ip: "1.1.1.1"
  });

  await t.test("khach chon cach tra: server tinh so tien, khong nhan tu khach", async () => {
    await donDep();
    const khung = dungKhung({ phanTramCoc: 50, telegram: {} });
    const don = await dungDon(khung);

    const ra = await chon(khung, { orderId: don.id, token: don.token, choice: "deposit", soPhaiTra: 1 });
    assert.equal(ra.ma, 200, JSON.stringify(ra.than));
    assert.equal(ra.than.soPhaiTra, theoPhanTram(2890000, 50), "so tien do server tinh, khong theo than yeu cau");
    assert.equal(ra.than.phuongThuc, "bank_deposit");
  });

  await t.test("doi lua chon thi GHI LAI so tien (quirk 04/09)", async () => {
    await donDep();
    const khung = dungKhung({ phanTramCoc: 100, telegram: {} });
    const don = await dungDon(khung);

    await chon(khung, { orderId: don.id, token: don.token, choice: "full" });
    const sauFull = (await hoiTien(khung, don.id)).than;
    assert.equal(sauFull.daTra, 0, "chon cach tra chua phai la da tra");

    const doiY = await chon(khung, { orderId: don.id, token: don.token, choice: "deposit_hold" });
    assert.equal(doiY.than.soPhaiTra, theoPhanTram(2890000, 20), "doi y thi so tien phai doi theo");
    const dong = await kho.bang("orders").mot({ id: don.id });
    assert.equal(Number(dong.payment_amount), theoPhanTram(2890000, 20), "so tien tren don phai duoc ghi lai");
  });

  await t.test("sai ma tra cuu thi khong doi duoc cach tra", async () => {
    await donDep();
    const khung = dungKhung({ telegram: {} });
    const don = await dungDon(khung);
    const ra = await chon(khung, { orderId: don.id, token: "sai", choice: "full" });
    assert.equal(ra.ma, 400);
    assert.equal(ra.than.error, "khong_thay_don");
  });

  await t.test("lua chon la thi tu choi", async () => {
    await donDep();
    const khung = dungKhung({ telegram: {} });
    const don = await dungDon(khung);
    const ra = await chon(khung, { orderId: don.id, token: don.token, choice: "tra_bang_niem_tin" });
    assert.equal(ra.than.error, "lua_chon_khong_hop_le");
  });

  await t.test("ghi nhan da tra: tien di qua kit, tra du thi bao du", async () => {
    await donDep();
    const khung = dungKhung({ telegram: {} });
    const don = await dungDon(khung);

    const mot = await ghiTra(khung, { maDon: don.id, soTien: 1000000 });
    assert.equal(mot.ma, 200);
    assert.equal(mot.than.daTra, 1000000);
    assert.equal(mot.than.conPhaiTra, 1890000);
    assert.equal(mot.than.traDu, false);

    const hai = await ghiTra(khung, { maDon: don.id, soTien: 1890000 });
    assert.equal(hai.than.traDu, true);
    assert.equal(hai.than.conPhaiTra, 0);

    const tien = (await hoiTien(khung, don.id)).than;
    assert.equal(tien.daTra, 2890000);
    assert.equal(tien.conPhaiTra, 0);
    assert.equal(tien.cod, 0, "tra du roi thi khong con COD");
  });

  await t.test("ghi nhan tien la viec NGUOI THAT — bo nao khong ghi duoc", async () => {
    await donDep();
    const khung = dungKhung({ telegram: {} });
    const don = await dungDon(khung);
    const ra = await ghiTra(khung, { maDon: don.id, soTien: 100000 }, { authorization: `Bearer ${MA_DV}` });
    assert.equal(ra.ma, 401, "ma dich vu khong duoc ghi tien");
    assert.equal((await hoiTien(khung, don.id)).than.daTra, 0);
  });

  await t.test("khong cong cu nao mo cho bot mang hieu ung tien", () => {
    for (const cc of mTien.congCuBot ?? []) assert.notEqual(cc.hieuUng, "tien");
  });

  await t.test("ghi nhan tien xong thi phat len bang tin", async () => {
    await donDep();
    const khung = dungKhung({ telegram: {} });
    const don = await dungDon(khung);
    const nghe = [];
    khung.bus.nghe("tien-doi-soat.da-nhan", "bai-thu", (d) => nghe.push(d));

    await ghiTra(khung, { maDon: don.id, soTien: 2890000 });
    await new Promise((r) => setImmediate(r));
    assert.equal(nghe.length, 1);
    assert.equal(nghe[0].traDu, true);
  });

  // ---------- Telegram theo tung khach ----------

  await t.test("shop CHUA khai Telegram thi khong bao gi ca", async () => {
    await donDep();
    const khung = dungKhung({ telegram: {} });
    const don = await dungDon(khung);
    await ghiTra(khung, { maDon: don.id, soTien: 100000 });
    await new Promise((r) => setImmediate(r));
    assert.equal(daGoi.filter((g) => g.url.includes("telegram")).length, 0, "chua khai thi TAT, khong bao bua");
  });

  await t.test("shop da khai thi bao dung nhom CUA SHOP DO", async () => {
    await donDep();
    const khung = dungKhung({ telegram: { token: "token-cua-shop-A", nhom: "-100111" } });
    const don = await dungDon(khung);
    await ghiTra(khung, { maDon: don.id, soTien: 2890000 });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const tin = daGoi.find((g) => g.url.includes("telegram"));
    assert.ok(tin, `phai bao Telegram: ${JSON.stringify(daGoi.map((g) => g.url))}`);
    assert.match(tin.url, /bottoken-cua-shop-A/, "phai dung token cua chinh shop do");
    assert.equal(tin.than.chat_id, "-100111");
    assert.match(tin.than.text, /2\.890\.000/);
  });

  await t.test("Telegram chet thi ghi nhan tien VAN thanh cong", async () => {
    await donDep();
    const khungHong = taoKhung({
      cong: {
        kho, nhatKy, gio,
        httpNgoai: { async goi() { throw new Error("Telegram chet"); } },
        quyen: taoCongQuyen({ maQuanTri: MA_QT }), hanGoi: taoBoDemGoi({ gio })
      },
      nhatKy, toKhais: [mHangKho, mDon, mTien],
      cauHinh: { "hang-kho": {}, "don-khach": {}, "tien-doi-soat": { telegram: { token: "t", nhom: "-1" } } }
    });
    const don = await dungDon(khungHong);
    const ra = await ghiTra(khungHong, { maDon: don.id, soTien: 500000 });
    assert.equal(ra.ma, 200, "bao tin hong khong duoc chan viec ghi tien");
    assert.equal(ra.than.daTra, 500000);
  });
});
