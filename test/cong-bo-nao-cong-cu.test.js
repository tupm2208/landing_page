// BON CONG CU them 14/09/2026 cho bo nao (+ catalog.count): policy.get, variant.chart, purchase.eta,
// customer.recognize. Truoc do bo may khai chung ma landing khong co -> moi cau hoi chinh sach
// deu roi xuong "hoi lai".

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { taoKhung } = require("../loi/khung");
const { taoKhoTep } = require("../loi/cong/kho-tep");
const { taoNhatKyGia, taoGioGia } = require("../loi/cong/co-ban");
const { taoCongQuyen } = require("../loi/cong/quyen");
const { taoBoDemGoi } = require("../loi/cong/han-goi");
const mCongBoNao = require("../modules/cong-bo-nao/module");
const { noiDungMacDinh, chuanHoa } = require("../modules/khung-nen-tang/noi-dung");

const MA_BO_NAO = "ma-bo-nao";

function dungThu({ noiDung = {}, coKhung = true } = {}) {
  const nhatKy = taoNhatKyGia();
  const gio = taoGioGia();
  const kho = taoKhoTep({ thuMuc: fs.mkdtempSync(path.join(os.tmpdir(), "cong-cu-")), nhatKy });
  const MON = { code: "DV1", name: "Pegasus 40", sizes: [{ size: "41", qty: 0 }, { size: "42", qty: 3 }, { size: "43", qty: 1 }] };
  const hangKhoGia = {
    id: "hang-kho", ten: "Hang kho gia", mang: "van-hanh", chay: "server-khach", phienBan: "0", duong: [],
    capDichVu: {
      "hang-kho.tim": async () => [MON], "hang-kho.tonKho": async () => ({ cacDong: [] }),
      "hang-kho.dem": async () => 4834, "hang-kho.doc": async (ctx, ma) => (ma === "DV1" ? MON : null)
    }
  };
  const khungGia = {
    id: "khung-nen-tang", ten: "Khung gia", mang: "khung", chay: "server-khach", phienBan: "0", duong: [],
    capDichVu: { "khung-nen-tang.noiDung": async () => chuanHoa({ ...noiDungMacDinh(), ...noiDung }, gio.bayGio()) }
  };
  const khung = taoKhung({
    cong: { kho, nhatKy, gio, quyen: taoCongQuyen({ maDichVu: MA_BO_NAO }), hanGoi: taoBoDemGoi({ gio }) },
    nhatKy, toKhais: [hangKhoGia, ...(coKhung ? [khungGia] : []), mCongBoNao], cauHinh: { "cong-bo-nao": { diaChiWeb: "https://shop.vn" } }
  });
  const congCu = (ten, input = {}) => khung.xuLy({
    method: "POST", duong: "/api/bo-nao/cong-cu", truyVan: {}, ip: "1.1.1.1", tieuDe: { authorization: `Bearer ${MA_BO_NAO}` }, doc: async () => ({ ten, input })
  });
  const danhSach = () => khung.xuLy({ method: "GET", duong: "/api/bo-nao/cong-cu", truyVan: {}, ip: "1.1.1.1", tieuDe: { authorization: `Bearer ${MA_BO_NAO}` } });
  return { congCu, danhSach };
}

test("danh sach cong cu mo gom ca bon cong cu moi + catalog.count khi co du dich vu", async () => {
  const { danhSach } = dungThu();
  const ds = (await danhSach()).than.congCu;
  for (const t of ["catalog.count", "variant.chart", "policy.get", "purchase.eta", "customer.recognize"]) assert.ok(ds.includes(t), t);
  assert.ok(!ds.includes("order.lookup"), "khong co manh Don hang thi khong mo");
});

test("catalog.count tra tong so mon; variant.chart tra bang size kem con/het", async () => {
  const { congCu } = dungThu();
  assert.deepEqual((await congCu("catalog.count")).than.data, { total: 4834 });
  const vc = (await congCu("variant.chart", { itemId: "DV1" })).than.data;
  assert.equal(vc.axis, "size");
  assert.deepEqual(vc.rows, [{ label: "41", note: "hết" }, { label: "42", note: "còn" }, { label: "43", note: "còn" }]);
  assert.deepEqual((await congCu("variant.chart", { itemId: "khong-co" })).than.data.rows, []);
});

test("policy.get: doc tu noi dung trang; trong thi found=false; chu de doi tra / ship / bao hanh", async () => {
  const { congCu } = dungThu({ noiDung: { chinhSachDoiTra: "Đổi size trong 7 ngày, còn tem mác.", chinhSachShip: "Ship 30k toàn quốc." } });
  const dt = (await congCu("policy.get", { topic: "doi_tra" })).than.data;
  assert.equal(dt.found, true);
  assert.equal(dt.text, "Đổi size trong 7 ngày, còn tem mác.");
  assert.equal((await congCu("policy.get", { topic: "phi_ship" })).than.data.text, "Ship 30k toàn quốc.");
  const bh = (await congCu("policy.get", { topic: "bao-hanh" })).than.data;
  assert.equal(bh.found, false);
  assert.equal(bh.text, "");
  assert.equal((await congCu("policy.get", { topic: "gi-do-la" })).than.data.found, false);
});

test("purchase.eta: mon co thi tra so ngay tu noi dung trang; mon khong co hay so ngay trong thi available=false", async () => {
  const { congCu } = dungThu({ noiDung: { soNgayHangOrder: "5" } });
  assert.deepEqual((await congCu("purchase.eta", { itemId: "DV1" })).than.data, { available: true, days: 5 });
  assert.deepEqual((await congCu("purchase.eta", { itemId: "khong" })).than.data, { available: false });
  const { congCu: c2 } = dungThu({ noiDung: { soNgayHangOrder: "" } });
  assert.deepEqual((await c2("purchase.eta", { itemId: "DV1" })).than.data, { available: false });
});

test("customer.recognize: landing chua doi duoc hoi thoai -> khach, tra trung thuc isReturning=false", async () => {
  const { congCu } = dungThu();
  assert.deepEqual((await congCu("customer.recognize", { conversationId: "facebook:k1" })).than.data, { isReturning: false, orderCount: 0 });
});

test("khong co Khung nen tang thi policy.get khong mo; purchase.eta van chay (khong co so ngay -> available=false)", async () => {
  const { congCu, danhSach } = dungThu({ coKhung: false });
  const ds = (await danhSach()).than.congCu;
  assert.ok(!ds.includes("policy.get"));
  assert.equal((await congCu("policy.get", { topic: "doi_tra" })).ma, 400);
  assert.deepEqual((await congCu("purchase.eta", { itemId: "DV1" })).than.data, { available: false });
});
