// BAN CONG KHAI CUA DON — khach thay gi, va KHONG duoc thay gi.
//
// Bo bai nay khong can MySQL: lop cong khai la ham thuan. Nhung day la lop quyet dinh xem
// nguoi la thay duoc gi tren don cua nguoi khac, nen phan lon bai la bai chan.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  nhanTrangThai, ghiChuTrangThai, duongTraVanDon,
  hanTuSua, suaDuoc, banChiTiet, banBiMat, banChiTrangThai, PHUT_TU_SUA
} = require("../modules/don-khach/cong-khai");
const mDonKhach = require("../modules/don-khach/module");

const LUC_DAT = "2026-09-12T10:00:00.000Z";

function donThu(them = {}) {
  return {
    id: "ORD-1",
    createdAt: LUC_DAT,
    updatedAt: LUC_DAT,
    customerName: "Nguyễn Văn A",
    phone: "0912345678",
    email: "a@vd.vn",
    address: "12 Hàng Bài, Phường Hàng Bài, Quận Hoàn Kiếm, Hà Nội",
    province: "Hà Nội", district: "Quận Hoàn Kiếm", ward: "Phường Hàng Bài",
    addressDetail: "12 Hàng Bài",
    note: "Giao giờ hành chính",
    total: 3290000,
    status: "pending",
    paymentStatus: "payment_pending",
    paymentAmount: 0,
    fulfillmentStatus: "not_assigned",
    items: [{
      productCode: "JP9192", productName: "Nike Pegasus 41", size: "42", qty: 1, price: 3290000,
      warehouseId: "wh_partner_x", warehouseName: "Kho đối tác Supersports", sourceName: "Supersports",
      imageUrl: "/assets/products/JP9192/1.webp"
    }],
    ...them
  };
}

// ---------- cua so 15 phut ----------

test("trong 15 phut dau thi sua duoc, sau do thi khong", () => {
  const don = donThu();
  const trong = new Date("2026-09-12T10:14:59.000Z");
  const ngoai = new Date("2026-09-12T10:15:01.000Z");
  assert.equal(suaDuoc(don, trong), true);
  assert.equal(suaDuoc(don, ngoai), false);
  assert.equal(hanTuSua(don).toISOString(), "2026-09-12T10:15:00.000Z");
  assert.equal(PHUT_TU_SUA, 15);
});

test("don da huy thi khong sua duoc nua, du van trong 15 phut", () => {
  assert.equal(suaDuoc(donThu({ status: "cancelled" }), new Date("2026-09-12T10:01:00.000Z")), false);
  assert.equal(suaDuoc(donThu({ status: "canceled" }), new Date("2026-09-12T10:01:00.000Z")), false);
});

test("don co cot han rieng thi theo cot do, khong tu tinh lai", () => {
  const don = donThu({ canCancelUntil: "2026-09-12T11:00:00.000Z" });
  assert.equal(hanTuSua(don).toISOString(), "2026-09-12T11:00:00.000Z");
  assert.equal(suaDuoc(don, new Date("2026-09-12T10:50:00.000Z")), true);
});

test("don khong ro luc dat thi coi nhu KHONG sua duoc — chan theo mac dinh", () => {
  assert.equal(hanTuSua({ id: "ORD-x" }), null);
  assert.equal(suaDuoc({ id: "ORD-x" }, new Date()), false);
});

// ---------- ban chi tiet ----------

test("het 15 phut thi ban chi tiet AN ho so nguoi nhan", () => {
  const con = banChiTiet(donThu(), { bayGio: new Date("2026-09-12T10:05:00.000Z") });
  assert.equal(con.canEdit, true);
  assert.equal(con.customer.phone, "0912345678");

  const het = banChiTiet(donThu(), { bayGio: new Date("2026-09-12T11:00:00.000Z") });
  assert.equal(het.canEdit, false);
  assert.equal(het.canCancel, false);
  assert.equal(het.customer, null, "qua gio thi khong tra ho so nguoi nhan nua");
  assert.match(het.privacyNote, /đã được ẩn/);
});

test("tien tren don LAY TU module Tien, khong tu suy dien", () => {
  const co = banChiTiet(donThu(), { bayGio: new Date(LUC_DAT), tien: { daTra: 658000, conPhaiTra: 2632000 } });
  assert.equal(co.paidAmount, 658000);
  assert.equal(co.remainingAmount, 2632000);

  // Khong co module Tien: KHONG duoc doan la da tra het hay chua tra gi theo paymentStatus.
  const khong = banChiTiet(donThu(), { bayGio: new Date(LUC_DAT), tien: null });
  assert.equal(khong.paidAmount, 0);
  assert.equal(khong.remainingAmount, 3290000);
});

// ---------- ban bi mat: KHONG lo dia chi, KHONG lo trang thai noi bo ----------

test("ban bi mat khong lo dia chi, khong lo trang thai noi bo, khong lo gia", () => {
  const b = banBiMat(donThu({ status: "waiting_partner_confirm", fulfillmentStatus: "stock_reserved" }));
  const chu = JSON.stringify(b);
  assert.equal(b.view, "secret");
  assert.equal(b.status, undefined, "khong duoc tra trang thai noi bo");
  assert.equal(b.fulfillmentStatus, undefined);
  assert.ok(b.statusLabel, "van phai co nhan cho khach doc");
  assert.ok(!chu.includes("Hàng Bài"), "khong duoc lo dia chi");
  assert.ok(!chu.includes("0912345678"), "khong duoc lo so dien thoai");
  assert.ok(!chu.includes("3290000"), "khong duoc lo gia");
  assert.equal(b.items[0].price, undefined);
});

test("KHONG noi ten kho / ten doi tac trong ban bi mat va ban trang thai", () => {
  // Anh Dung nhac 10/09/2026: cau gui khach cam kem ten kho hay ten doi tac.
  for (const ban of [banBiMat(donThu()), banChiTrangThai(donThu())]) {
    const chu = JSON.stringify(ban);
    assert.ok(!/Supersports/.test(chu), `ban "${ban.view}" lo ten doi tac`);
    assert.ok(!/wh_partner/.test(chu), `ban "${ban.view}" lo ma kho`);
    assert.ok(!/Kho /.test(chu), `ban "${ban.view}" lo ten kho`);
  }
});

test("ban chi trang thai khong mang mon, khong mang tien", () => {
  const b = banChiTrangThai(donThu());
  assert.equal(b.view, "status");
  assert.equal(b.items, undefined);
  assert.equal(b.total, undefined);
  assert.equal(b.customer, undefined);
  assert.ok(b.statusLabel);
});

// ---------- nhan trang thai cho khach doc ----------

test("nhan trang thai: huy, hoan tat, co van don, moi dat", () => {
  assert.equal(nhanTrangThai("cancelled"), "Đơn đã hủy");
  assert.equal(nhanTrangThai("completed"), "Đơn đã hoàn tất");
  assert.equal(nhanTrangThai("pending", "", "SPX123456"), "Đơn đã có vận đơn");
  assert.equal(nhanTrangThai("pending"), "TopRun đã nhận đơn");
  assert.equal(nhanTrangThai("payment_pending"), "Đã xác nhận có hàng");
  assert.equal(nhanTrangThai("waiting_partner_confirm"), "TopRun đang xác nhận hàng");
  assert.match(ghiChuTrangThai("cancelled"), /đã được hủy/);
  assert.match(ghiChuTrangThai("pending"), /kiểm tra tồn kho/);
});

test("duong tra van don: SPX thi co link, hang khac thi de trong chu khong doan", () => {
  assert.equal(duongTraVanDon({ trackingCode: "SPXVN123", shippingProvider: "spx" }), "https://spx.vn/track?SPXVN123");
  assert.equal(duongTraVanDon({ trackingCode: "VTP123", shippingProvider: "viettelpost" }), "");
  assert.equal(duongTraVanDon({}), "");
  assert.equal(duongTraVanDon({ trackingUrl: "https://vd.vn/x", trackingCode: "A" }), "https://vd.vn/x");
});

// ---------- thu tu duong ----------

test("duong /api/orders/public phai dung TRUOC /api/orders/:maDon", () => {
  // Neu de nguoc, GET /api/orders/public roi vao duong quan tri va khach nhan 401 — hoac
  // nguy hon: duong quan tri nhan "public" lam ma don.
  const duong = mDonKhach.duong.map((d) => `${d.method} ${d.path}`);
  const viTriPublic = duong.indexOf("GET /api/orders/public");
  const viTriMaDon = duong.indexOf("GET /api/orders/:maDon");
  assert.ok(viTriPublic >= 0 && viTriMaDon >= 0);
  assert.ok(viTriPublic < viTriMaDon, "duong cua khach phai khai truoc duong co tham so");

  const patchPublic = duong.indexOf("PATCH /api/orders/public");
  const patchMaDon = duong.indexOf("PATCH /api/orders/:maDon");
  assert.ok(patchPublic < patchMaDon, "PATCH cua khach phai khai truoc PATCH cua quan tri");
});
