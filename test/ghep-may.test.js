// GHEP MAY — cach OMI duoc CAP khoa rieng, khong ai phai be ma quan tri sang.
//
// Anh Dung nhac 13/09/2026: "thiet ke ma phai tu mo file gi do de app moi chay duoc thi vo ly".
// Dung. Bo bai nay giu cai cua thay the viec do — va vi no la cua duy nhat CONG KHAI ma cap ra
// mot khoa quan tri, gan het bo bai la BAI CHAN.

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
const { sinhMaGhep, sinhKhoaMay, tenKhoaCuaMay, taoSoGhep, ghep, SO_LAN_SAI_TOI_DA } = require("../modules/khung-nen-tang/ghep-may");
const mKhung = require("../modules/khung-nen-tang/module");

const MA_QT = "ma-quan-tri";
const MA_GHEP = "123456";
const tam = () => fs.mkdtempSync(path.join(os.tmpdir(), "ghep-may-"));

function dung({ maGhep = MA_GHEP, hetSauMs = 15 * 60 * 1000 } = {}) {
  const gio = taoGioGia();
  const nhatKy = taoNhatKyGia();
  const kho = taoKhoTep({ thuMuc: tam(), nhatKy });
  const quyen = taoCongQuyen({ maQuanTri: MA_QT, nhatKy });
  mKhung.__quenSoGhep();
  const khung = taoKhung({
    cong: { kho, nhatKy, gio, quyen, hanGoi: taoBoDemGoi({ gio }) },
    nhatKy, toKhais: [mKhung],
    cauHinh: { "khung-nen-tang": { maGhep, maGhepHetLuc: gio.bayGio().getTime() + hetSauMs } }
  });
  const goiGhep = (than, ip = "1.2.3.4") => khung.xuLy({
    method: "POST", duong: "/api/ghep-may", truyVan: {}, tieuDe: {}, ip, doc: async () => than
  });
  return { khung, kho, quyen, gio, nhatKy, goiGhep };
}

// ---------- phan thuan, khong can khung ----------

test("ma ghep la 6 chu so", () => {
  for (let i = 0; i < 50; i += 1) assert.match(sinhMaGhep(), /^\d{6}$/);
});

test("khoa may dai va ngau nhien; ten khoa mang ten may", () => {
  const a = sinhKhoaMay();
  const b = sinhKhoaMay();
  assert.notEqual(a, b);
  assert.ok(a.length >= 28, `khoa qua ngan: ${a.length}`);
  assert.equal(tenKhoaCuaMay("may-ban-hang-1"), "omi:may-ban-hang-1");
  assert.equal(tenKhoaCuaMay(""), "omi:khong-ten");
  // Ten may la chu tu nguoi ta go: cat ky tu la, cat do dai.
  assert.equal(tenKhoaCuaMay("may\n<script>"), "omi:mayscript");
  assert.ok(tenKhoaCuaMay("x".repeat(200)).length <= 64);
});

test("ma ghep DUNG MOT LAN", () => {
  const so = taoSoGhep({ ma: MA_GHEP, hetLuc: Date.now() + 60000 });
  const lan1 = ghep(so, new Date(), { maGhep: MA_GHEP, tenMay: "may-1" });
  assert.equal(lan1.ok, true);
  const lan2 = ghep(so, new Date(), { maGhep: MA_GHEP, tenMay: "may-2" });
  assert.equal(lan2.ok, false);
  assert.equal(lan2.viSao, "ma_da_dung");
});

test("het gio thi khong ghep duoc nua", () => {
  const so = taoSoGhep({ ma: MA_GHEP, hetLuc: Date.now() - 1 });
  const kq = ghep(so, new Date(), { maGhep: MA_GHEP, tenMay: "may-1" });
  assert.equal(kq.ok, false);
  assert.equal(kq.viSao, "ma_het_han");
});

test("SAI 10 LAN thi ma do CHET, khong phai cho het gio", () => {
  const so = taoSoGhep({ ma: MA_GHEP, hetLuc: Date.now() + 60000 });
  for (let i = 0; i < SO_LAN_SAI_TOI_DA; i += 1) {
    const kq = ghep(so, new Date(), { maGhep: "000000", tenMay: "ke-do-ma" });
    assert.equal(kq.viSao, "ma_sai");
  }
  // Den luc nay du co go DUNG ma cung khong ghep duoc.
  const dung = ghep(so, new Date(), { maGhep: MA_GHEP, tenMay: "chu-shop" });
  assert.equal(dung.ok, false);
  assert.equal(dung.viSao, "sai_qua_nhieu");
});

test("chua bat ghep may thi tu choi", () => {
  const so = taoSoGhep({ ma: "", hetLuc: 0 });
  assert.equal(ghep(so, new Date(), { maGhep: "123456" }).viSao, "chua_bat_ghep_may");
});

// ---------- qua khung that ----------

test("ghep xong: may co KHOA RIENG, vao duoc duong quan tri", async () => {
  const { goiGhep, khung, quyen } = dung();

  // Truoc khi ghep: khong co ma thi khong vao duoc duong quan tri.
  const truoc = await khung.xuLy({ method: "GET", duong: "/api/admin/may", truyVan: {}, tieuDe: {}, ip: "1.2.3.4" });
  assert.equal(truoc.ma, 401);

  const ra = await goiGhep({ maGhep: MA_GHEP, tenMay: "may-cua-anh-dung" });
  assert.equal(ra.ma, 200, JSON.stringify(ra.than));
  assert.equal(ra.than.ten, "omi:may-cua-anh-dung");
  assert.ok(ra.than.ma.length >= 28);

  // Khoa vua cap dung duoc NGAY, khong phai bat lai server.
  const sau = await khung.xuLy({
    method: "GET", duong: "/api/admin/may", truyVan: {},
    tieuDe: { authorization: `Bearer ${ra.than.ma}` }, ip: "1.2.3.4"
  });
  assert.equal(sau.ma, 200);
  assert.equal(sau.than.may.length, 1);
  assert.equal(sau.than.may[0].ten, "omi:may-cua-anh-dung");

  // Va nhat ky ghi duoc TEN MAY, khong phai "co nguoi cam ma hop le".
  assert.ok(quyen.tenCacKhoa().some((k) => k.ten === "omi:may-cua-anh-dung"));
});

test("KHONG bao gio tra ban ma cua may khac ra ngoai", async () => {
  const { goiGhep, khung } = dung();
  const ra = await goiGhep({ maGhep: MA_GHEP, tenMay: "may-1" });
  const ds = await khung.xuLy({
    method: "GET", duong: "/api/admin/may", truyVan: {},
    tieuDe: { authorization: `Bearer ${ra.than.ma}` }
  });
  const chu = JSON.stringify(ds.than);
  assert.ok(!chu.includes(ra.than.ma), "danh sach may khong duoc kem ban ma");
  assert.ok(!chu.includes("may_"), "khong duoc lo ca tien to cua khoa");
});

test("BO MOT MAY: khoa cua chinh may do het tac dung ngay", async () => {
  const { goiGhep, khung } = dung();
  const ra = await goiGhep({ maGhep: MA_GHEP, tenMay: "may-cu" });
  const cuaMay = { authorization: `Bearer ${ra.than.ma}` };
  assert.equal((await khung.xuLy({ method: "GET", duong: "/api/admin/may", truyVan: {}, tieuDe: cuaMay })).ma, 200);

  const bo = await khung.xuLy({
    method: "POST", duong: "/api/admin/may/bo", truyVan: {},
    tieuDe: { authorization: `Bearer ${MA_QT}` }, doc: async () => ({ ten: "omi:may-cu" })
  });
  assert.equal(bo.ma, 200);
  assert.equal(bo.than.daBo, 1);

  assert.equal((await khung.xuLy({ method: "GET", duong: "/api/admin/may", truyVan: {}, tieuDe: cuaMay })).ma, 401,
    "bo may roi ma khoa cua no van vao duoc la mot lo");
});

test("ma ghep sai: tra 401 va noi con may lan thu; ma da dung: 409", async () => {
  const { goiGhep } = dung();
  const sai = await goiGhep({ maGhep: "999999", tenMay: "ke-do-ma" });
  assert.equal(sai.ma, 401);
  assert.equal(sai.than.error, "ma_sai");
  assert.match(sai.than.message, /Còn \d+ lần thử/);

  const dung1 = await goiGhep({ maGhep: MA_GHEP, tenMay: "may-1" });
  assert.equal(dung1.ma, 200);
  const lai = await goiGhep({ maGhep: MA_GHEP, tenMay: "may-2" });
  assert.equal(lai.ma, 409);
  assert.equal(lai.than.error, "ma_da_dung");
});

test("HAN GOI chan do ma: goi lan thu 11 trong 15 phut bi 429", async () => {
  const { goiGhep } = dung();
  for (let i = 0; i < 10; i += 1) await goiGhep({ maGhep: "000000", tenMay: "ke-do" });
  const lan11 = await goiGhep({ maGhep: "000000", tenMay: "ke-do" });
  assert.equal(lan11.ma, 429);
});

test("khoa may DA GHEP con lai trong so, de lan khoi dong sau nap lai duoc", async () => {
  const { goiGhep, kho } = dung();
  const ra = await goiGhep({ maGhep: MA_GHEP, tenMay: "may-1" });
  const so = await kho.so("khung-nen-tang-khoa-may").doc();
  assert.equal(so.khoa.length, 1);
  assert.equal(so.khoa[0].ten, "omi:may-1");
  assert.equal(so.khoa[0].ma, ra.than.ma);
  assert.equal(so.khoa[0].vai, "quan-tri");
  assert.ok(so.khoa[0].ghepLuc);
});

test("cong quyen: khoa may qua ngan hay thieu ten thi TU CHOI", () => {
  const quyen = taoCongQuyen({ maQuanTri: MA_QT });
  assert.throws(() => quyen.themKhoa({ ma: "ngan", ten: "omi:x", vai: "quan-tri" }), /it nhat 24/);
  assert.throws(() => quyen.themKhoa({ ma: sinhKhoaMay(), ten: "", vai: "quan-tri" }), /phai co ten/);
  assert.throws(() => quyen.themKhoa({ ma: sinhKhoaMay(), ten: "omi:x", vai: "khach" }), /Vai khong hop le/);
  // Them hai lan cung mot khoa thi khong nhan doi.
  const k = sinhKhoaMay();
  assert.equal(quyen.themKhoa({ ma: k, ten: "omi:x", vai: "quan-tri" }), true);
  assert.equal(quyen.themKhoa({ ma: k, ten: "omi:x", vai: "quan-tri" }), false);
});
