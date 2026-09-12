// NOI DUNG TRANG — chu tren trang chu, phi ship, thong tin chuyen khoan.
//
// Hai loi hua o day:
//   1. Ban cong khai CHI chua nhung truong da khai. Ai gui thua mot truong (co tinh hay do dan
//      sai) thi truong do khong vao so — nen khong the lan mot ma Telegram hay mot khoa nao ra
//      duong cong khai.
//   2. Chu shop sua phan tram coc / phi ship / tien to chuyen khoan la module Tien doi theo,
//      vi hai ben doc cung MOT goc.

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
const { taoBoDemGoi } = require("../loi/cong/han-goi");
const { noiDungMacDinh, chuanHoa, soCuaTien } = require("../modules/khung-nen-tang/noi-dung");
const mKhung = require("../modules/khung-nen-tang/module");

const MA_QT = "ma-quan-tri";
const tam = () => fs.mkdtempSync(path.join(os.tmpdir(), "noi-dung-"));

function dung() {
  const gio = taoGioGia();
  const nhatKy = taoNhatKyGia();
  const khung = taoKhung({
    cong: {
      kho: taoKhoTep({ thuMuc: tam() }), nhatKy, gio, httpNgoai: taoHttpNgoaiGia(),
      quyen: taoCongQuyen({ maQuanTri: MA_QT }), hanGoi: taoBoDemGoi({ gio })
    },
    nhatKy, toKhais: [mKhung], cauHinh: {}
  });
  const doc = () => khung.xuLy({ method: "GET", duong: "/api/content", truyVan: {}, tieuDe: {}, ip: "1.1.1.1" });
  const ghi = (than, ma = MA_QT) => khung.xuLy({
    method: "POST", duong: "/api/content", truyVan: {},
    tieuDe: ma ? { authorization: `Bearer ${ma}` } : {}, ip: "1.1.1.1", doc: async () => than
  });
  return { khung, doc, ghi, gio };
}

test("chua sua gi thi tra ban mac dinh", async () => {
  const { doc } = dung();
  const ra = await doc();
  assert.equal(ra.ma, 200);
  assert.equal(ra.than.heroTitle, noiDungMacDinh().heroTitle);
  assert.equal(ra.than.shippingFeeDefault, "30000");
});

test("chu shop sua thi web thay ngay, truong khong sua thi giu nguyen", async () => {
  const { doc, ghi } = dung();
  const ra = await ghi({ heroTitle: "Sale tháng 9", bankAccountNumber: "0123456789" });
  assert.equal(ra.ma, 200, JSON.stringify(ra.than));

  const web = (await doc()).than;
  assert.equal(web.heroTitle, "Sale tháng 9");
  assert.equal(web.bankAccountNumber, "0123456789");
  assert.equal(web.orderNote, noiDungMacDinh().orderNote, "truong khong sua phai giu nguyen");
  assert.ok(web.updatedAt, "phai ghi lai luc sua");
});

test("CHI giu truong da khai — truong la KHONG vao so", () => {
  const ra = chuanHoa({ heroTitle: "A", telegramToken: "123:bi-mat", maQuanTri: "xxx" });
  assert.equal(ra.heroTitle, "A");
  assert.equal(ra.telegramToken, undefined, "truong la khong duoc vao so");
  assert.equal(ra.maQuanTri, undefined);
  assert.ok(!JSON.stringify(ra).includes("bi-mat"));
});

test("gui truong la qua duong ghi that thi cung khong ra duong cong khai", async () => {
  const { doc, ghi } = dung();
  await ghi({ heroTitle: "B", telegramToken: "123:bi-mat", bankPin: "9999" });
  const chu = JSON.stringify((await doc()).than);
  assert.ok(!chu.includes("bi-mat"), "ma Telegram khong duoc lo ra ban cong khai");
  assert.ok(!chu.includes("9999"));
});

test("khach thi doc duoc, nhung KHONG sua duoc", async () => {
  const { doc, ghi } = dung();
  assert.equal((await doc()).ma, 200);
  const khongMa = await ghi({ heroTitle: "khach sua" }, null);
  assert.equal(khongMa.ma, 401);
  assert.equal((await doc()).than.heroTitle, noiDungMacDinh().heroTitle, "khong duoc doi mot chu nao");
});

test("gui mot mang hay mot chuoi thi tu choi", async () => {
  const { ghi } = dung();
  assert.equal((await ghi([{ heroTitle: "x" }])).ma, 400);
  assert.equal((await ghi("heroTitle=x")).ma, 400);
});

test("so cua module Tien doc ra tu noi dung, gia tri vo ly thi tra null de ben kia dung mac dinh", () => {
  assert.deepEqual(soCuaTien({ momoDepositPercent: "20", shippingFeeDefault: "30000", momoTransferPrefix: "TR" }),
    { phanTramCoc: 20, phiShipMacDinh: 30000, tienToChuyenKhoan: "TR" });
  assert.deepEqual(soCuaTien({ momoDepositPercent: "0", shippingFeeDefault: "-5", momoTransferPrefix: "" }),
    { phanTramCoc: null, phiShipMacDinh: null, tienToChuyenKhoan: null });
  assert.deepEqual(soCuaTien({ momoDepositPercent: "abc", shippingFeeDefault: "" }),
    { phanTramCoc: null, phiShipMacDinh: null, tienToChuyenKhoan: null });
  assert.deepEqual(soCuaTien({ momoDepositPercent: "120" }).phanTramCoc, null, "tren 100% la vo ly");
});

test("dich vu noiDung mo cho module khac doc, va phi ship 0 la mot gia tri THAT", async () => {
  const { khung, ghi } = dung();
  await ghi({ shippingFeeDefault: "0", momoDepositPercent: "50", momoTransferPrefix: "TRX" });
  const dv = khung.banDichVu().map((x) => x.ten);
  assert.ok(dv.includes("khung-nen-tang.noiDung"));
  assert.ok(dv.includes("khung-nen-tang.soCuaTien"));

  // Mien phi ship la mot lua chon that cua chu shop — khong duoc coi la "chua khai" roi lang
  // le thay bang 30.000.
  const { soCuaTien: doc } = require("../modules/khung-nen-tang/noi-dung");
  assert.equal(doc({ shippingFeeDefault: "0" }).phiShipMacDinh, 0);
});
