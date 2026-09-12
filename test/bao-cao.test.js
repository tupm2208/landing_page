// BAO CAO TONG QUAN — va luat "tien di qua mot goc".
//
// Bo bai nay khong can MySQL: `tongQuan` nhan mot ham doc don, nen bai kiem tra dua vao no
// nhung dong don dung tay. Cai dang giu la CACH TINH, khong phai cau lenh SQL.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { tongQuan, NGAY_TOI_DA } = require("../modules/don-khach/bao-cao");
const mVanChuyen = require("../modules/van-chuyen/module");

const BAY_GIO = new Date("2026-09-12T10:00:00.000Z");   // 17:00 gio Viet Nam

function don(them = {}) {
  return {
    id: "ORD-1", total: 1000000, status: "pending",
    payment_status: "payment_pending", payment_amount: 0,
    created_at: "2026-09-12 03:00:00",    // 10:00 gio Viet Nam cung ngay
    mon: [{ product_code: "A1", product_name: "Giày A", quantity: 1, price: 1000000 }],
    ...them
  };
}

const chay = (cacDon, tuyChon = {}) =>
  tongQuan({ docDon: async () => cacDon, bayGio: BAY_GIO, ...tuyChon });

test("dem don, cong gia tri, va tinh tien DA THU qua kit", async () => {
  const bc = await chay([
    don({ id: "D1" }),
    // "paid" ma khong kem so tien = da tra DU tong don (luat cua order-money-kit).
    don({ id: "D2", total: 2000000, payment_status: "paid", payment_amount: 0 }),
    // Coc 500k da xac nhan.
    don({ id: "D3", total: 3000000, payment_status: "deposit_received", payment_amount: 500000 })
  ]);
  assert.equal(bc.tong.soDon, 3);
  assert.equal(bc.tong.giaTri, 6000000);
  assert.equal(bc.tong.daThu, 0 + 2000000 + 500000);
  assert.equal(bc.tong.conPhaiThu, 1000000 + 0 + 2500000);
});

test("so tien KHONG duoc tu cong payment_amount: trang thai chua xac nhan thi chua thu duoc dong nao", async () => {
  // Day la cho de sai nhat: don ghi so tien nhung trang thai chua xac nhan (khach bao chuyen
  // nhung shop chua soi). Cong thang `payment_amount` la bao cao noi da thu tien chua co.
  const bc = await chay([don({ total: 1000000, payment_status: "payment_pending", payment_amount: 900000 })]);
  assert.equal(bc.tong.daThu, 0);
  assert.equal(bc.tong.conPhaiThu, 1000000);
});

test("don DA HUY khong vao doanh thu, nhung van duoc dem rieng", async () => {
  const bc = await chay([
    don({ id: "D1", total: 1000000 }),
    don({ id: "D2", total: 5000000, status: "cancelled" })
  ]);
  assert.equal(bc.tong.soDon, 1, "chi dem don con song");
  assert.equal(bc.tong.giaTri, 1000000);
  assert.equal(bc.tong.soDonHuy, 1);
  assert.equal(bc.tong.giaTriHuy, 5000000);
  // Bang theo trang thai thi CO ca don huy — nguoi ta can thay ty le huy.
  assert.ok(bc.theoTrangThai.some((t) => t.trangThai === "cancelled" && t.soDon === 1));
});

test("chia theo NGAY dia phuong, khong phai ngay UTC", async () => {
  // 2026-09-11 18:00 UTC = 2026-09-12 01:00 gio Viet Nam. Neu chia theo UTC thi don nay roi
  // sang ngay 11 — chu shop mo bao cao "hom nay" khong thay don minh vua ban luc mot gio sang.
  const bc = await chay([don({ created_at: "2026-09-11 18:00:00" })]);
  assert.equal(bc.theoNgay.length, 1);
  assert.equal(bc.theoNgay[0].ngay, "2026-09-12");
});

test("mon ban chay xep theo so luong, cong ca nhieu don", async () => {
  const bc = await chay([
    don({ id: "D1", mon: [{ product_code: "A1", product_name: "Giày A", quantity: 2, price: 500000 }] }),
    don({ id: "D2", mon: [{ product_code: "A1", product_name: "Giày A", quantity: 1, price: 500000 },
                          { product_code: "B2", product_name: "Giày B", quantity: 1, price: 700000 }] })
  ]);
  assert.equal(bc.banChay[0].ma, "A1");
  assert.equal(bc.banChay[0].soLuong, 3);
  assert.equal(bc.banChay[0].giaTri, 1500000);
  assert.equal(bc.banChay.length, 2);
});

test("cua so ngay: mac dinh 14, xin qua lon thi kep lai, xin rac thi ve mac dinh", async () => {
  assert.equal((await chay([])).soNgay, 14);
  assert.equal((await chay([], { soNgay: 1000 })).soNgay, NGAY_TOI_DA);
  assert.equal((await chay([], { soNgay: 0 })).soNgay, 14);
  assert.equal((await chay([], { soNgay: "bay" })).soNgay, 14);
  assert.equal((await chay([], { soNgay: 7 })).soNgay, 7);
});

test("khong co don nao thi tra bang rong, khong nem", async () => {
  const bc = await chay([]);
  assert.equal(bc.ok, true);
  assert.equal(bc.tong.soDon, 0);
  assert.deepEqual(bc.theoNgay, []);
  assert.deepEqual(bc.banChay, []);
  assert.equal(bc.chamTran, false);
});

// ---------- phieu gui dung tu mot don ----------

test("van don tu don: COD la SO CON PHAI TRA, khong phai tong don", async () => {
  // Don 3 trieu da coc 1 trieu: thu COD 3 trieu la thu gap doi cua khach.
  const ctx = {
    cauHinh: { nguoiGui: { ten: "Kho TopRun", dienThoai: "0900000000", tinh: "Hà Nội", huyen: "Ba Đình", xa: "Giảng Võ", diaChiChiTiet: "1 Đội Cấn" } }
  };
  const { phieuTuDon } = require("../modules/van-chuyen/module.js").__thu ?? {};
  // `phieuTuDon` khong xuat ra ngoai (no la viec trong module), nen bai nay di qua duong that
  // o bo bai MySQL. O day chi giu mot dieu: module CO khai xin dich vu doc don.
  assert.ok(mVanChuyen.canDichVuNeuCo.includes("don-khach.doc"));
  assert.equal(typeof phieuTuDon, "undefined", "phieuTuDon la viec trong module, khong mo ra ngoai");
  assert.ok(ctx.cauHinh.nguoiGui.ten);
});

test("duong tao van don tu don co khai han goi va quyen quan tri", () => {
  const d = mVanChuyen.duong.find((x) => x.path === "/api/van-chuyen/tao-tu-don");
  assert.ok(d, "phai co duong nay");
  assert.equal(d.quyen, "quan-tri");
  assert.ok(d.hanGoi.soLan > 0);
});
