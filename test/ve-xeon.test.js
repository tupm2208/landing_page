// VE MAY KY TU XEON — anh Dung chot 14/09/2026: bo ve 15 phut + ghep may, landing soi ve bang
// khoa cong Xeon, va tu chan duong thuoc manh chua mua.
//
// Ve duoc KY bang chinh ham cua Xeon (bo-nao/license/ve-may.js) va SOI bang chung/ve-may.js
// qua cong quyen cua landing — de hai dau khong bao gio lech hinh dang.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { taoKhung } = require("../loi/khung");
const { taoCongQuyen } = require("../loi/cong/quyen");
const { taoBoDemGoi } = require("../loi/cong/han-goi");
const { taoKhoTep } = require("../loi/cong/kho-tep");
const { taoNhatKyGia, taoGioGia, taoHttpNgoaiGia } = require("../loi/cong/co-ban");
const { kiemToKhai } = require("../../hop-dong");
const { kyVe } = require("../../bo-nao/license/ve-may");
const { sinhKhoaKy } = require("../../bo-nao/license/khoa-ky");

const MA_DESK = "ma-cua-sales-desk";
const SHOP = "toprun";
const tam = () => fs.mkdtempSync(path.join(os.tmpdir(), "ve-xeon-"));

function dungThu({ xeonDaDangKy = true } = {}) {
  const gio = taoGioGia();
  const nhatKy = taoNhatKyGia();
  const khoaKy = sinhKhoaKy();
  const quyen = taoCongQuyen({
    cacKhoa: [{ ma: MA_DESK, ten: "sales-desk", vai: "quan-tri" }],
    xeon: xeonDaDangKy ? { keyId: khoaKy.keyId, khoaCongPem: khoaKy.khoaCongPem, shop: SHOP } : null,
    gio, nhatKy
  });
  const khung = taoKhung({
    cong: { kho: taoKhoTep({ thuMuc: tam() }), nhatKy, gio, httpNgoai: taoHttpNgoaiGia(), quyen, hanGoi: taoBoDemGoi({ gio }) },
    nhatKy,
    toKhais: [
      {
        id: "van-chuyen-thu", ten: "Thu VC", mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1", manh: "van-chuyen",
        duong: [
          { method: "GET", path: "/api/vc/rieng", quyen: "quan-tri", tay: () => ({ ma: 200, than: { ok: true } }) },
          { method: "GET", path: "/api/vc/dich-vu", quyen: "dich-vu", tay: () => ({ ma: 200, than: { ok: true } }) },
          { method: "GET", path: "/api/vc/mien", quyen: "quan-tri", manh: false, tay: () => ({ ma: 200, than: { ok: true } }) },
          { method: "GET", path: "/api/vc/ghi-de", quyen: "quan-tri", manh: "mua-ho", tay: () => ({ ma: 200, than: { ok: true } }) }
        ]
      },
      {
        id: "khong-manh", ten: "Khong manh", mang: "khung", chay: "server-khach", phienBan: "0.0.1",
        duong: [{ method: "GET", path: "/api/khung/toi", quyen: "quan-tri", tay: (ctx, yc) => ({ ma: 200, than: { ok: true, toi: ctx.cong.quyen.ai(yc) } }), }],
        canCong: ["quyen"]
      }
    ]
  });
  const goi = (duong, ma) => khung.xuLy({ method: "GET", duong, truyVan: {}, tieuDe: ma ? { authorization: `Bearer ${ma}` } : {}, ip: "1.1.1.1" });
  const ve = (than = {}) => {
    const t = gio.bayGio().getTime();
    return kyVe({
      vai: "quan-tri", shop: SHOP, tenShop: "TopRun", maMay: "may-1-xxxxxxxxxxxxxxxxxx", tenMay: "may ban hang", manh: ["hang-kho", "van-chuyen"], truc: true,
      phatLuc: t, hetLuc: t + 7 * 3600 * 1000, ...than
    }, khoaKy);
  };
  return { khung, goi, ve, gio, nhatKy, quyen, khoaKy };
}

test("to khai: manh cua module va cua duong phai la ma manh; `manh: false` duoc", () => {
  const goc = { id: "t", ten: "T", mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1" };
  const tay = () => ({ ma: 200, than: {} });
  assert.throws(() => kiemToKhai({ ...goc, manh: "Sai Manh" }, "t"), /`manh` cua module/);
  assert.throws(() => kiemToKhai({ ...goc, duong: [{ method: "GET", path: "/x", quyen: "quan-tri", manh: 5, tay }] }, "t"), /`manh` phai la ma manh hoac false/);
  assert.doesNotThrow(() => kiemToKhai({ ...goc, manh: "van-chuyen", duong: [{ method: "GET", path: "/x", quyen: "quan-tri", manh: false, tay }] }, "t"));
});

test("ve quan-tri hop le: vao duong quan-tri; nhat ky ghi shop:ten may; ban duong ghi manh ke thua tu module", async () => {
  const { khung, goi, ve } = dungThu();
  const kq = await goi("/api/vc/rieng", ve());
  assert.equal(kq.ma, 200);
  const toi = (await goi("/api/khung/toi", ve())).than.toi;
  assert.equal(toi.vai, "quan-tri");
  assert.equal(toi.ten, "toprun:may ban hang");
  assert.equal(toi.bang, "ve-xeon");
  assert.equal(toi.truc, true);
  assert.deepEqual(toi.manh, ["hang-kho", "van-chuyen"]);
  const ban = khung.banDuong();
  assert.equal(ban.find((d) => d.path === "/api/vc/rieng").manh, "van-chuyen", "duong ke thua manh cua module");
  assert.equal(ban.find((d) => d.path === "/api/vc/mien").manh, null, "manh: false = mien");
  assert.equal(ban.find((d) => d.path === "/api/vc/ghi-de").manh, "mua-ho", "duong ghi de manh");
  assert.equal(ban.find((d) => d.path === "/api/khung/toi").manh, null);
});

test("chan theo manh: ve thieu manh -> 403 chua_mua_manh noi ro manh nao; duong mien thi qua; khoa dai han Desk khong bi chan", async () => {
  const { goi, ve, nhatKy } = dungThu();
  const thieu = ve({ manh: ["hang-kho"] });
  const kq = await goi("/api/vc/rieng", thieu);
  assert.equal(kq.ma, 403);
  assert.equal(kq.than.error, "chua_mua_manh");
  assert.equal(kq.than.manh, "van-chuyen");
  assert.ok(nhatKy.dong.some((d) => /chua mua manh "van-chuyen"/.test(d.noiDung)));
  assert.equal((await goi("/api/vc/mien", thieu)).ma, 200, "manh: false");
  assert.equal((await goi("/api/vc/ghi-de", ve({ manh: ["hang-kho", "mua-ho"] }))).ma, 200);
  assert.equal((await goi("/api/vc/ghi-de", ve({ manh: ["hang-kho", "van-chuyen"] }))).ma, 403, "duong ghi de manh mua-ho");
  assert.equal((await goi("/api/vc/rieng", MA_DESK)).ma, 200, "Desk khong bi chan theo manh");
});

test("ve dich-vu: vao duong dich-vu, KHONG vao duong quan-tri; ve quan-tri vao ca hai", async () => {
  const { goi, ve } = dungThu();
  const dv = ve({ vai: "dich-vu", maMay: "xeon", tenMay: "bo-nao", truc: false });
  assert.equal((await goi("/api/vc/dich-vu", dv)).ma, 200);
  assert.equal((await goi("/api/vc/rieng", dv)).ma, 401);
  assert.equal((await goi("/api/vc/dich-vu", ve())).ma, 200);
});

test("ve shop khac, ve het han, ve sai chu ky, khoa la: deu 401 va nhat ky noi ro vi sao", async () => {
  const { goi, ve, gio, quyen, nhatKy } = dungThu();
  const yc = (ma) => ({ method: "GET", duong: "/x", truyVan: {}, tieuDe: { authorization: `Bearer ${ma}` } });
  assert.equal((await goi("/api/vc/rieng", ve({ shop: "shop-b" }))).ma, 401);
  assert.equal(quyen.ai(yc(ve({ shop: "shop-b" }))).bang, "ve-shop-khac");

  const v = ve();
  gio.troi(7 * 3600 * 1000 + 1000);
  assert.equal((await goi("/api/vc/rieng", v)).ma, 401);
  assert.equal(quyen.ai(yc(v)).bang, "ve-het_han");
  gio.troi(-7 * 3600 * 1000);

  const hong = `${v.slice(0, -4)}AAAA`;
  assert.equal(quyen.ai(yc(hong)).bang, "ve-chu_ky_sai");

  const khac = sinhKhoaKy();
  const veKhac = kyVe({ vai: "quan-tri", shop: SHOP, maMay: "m", tenMay: "m", manh: [], truc: false, phatLuc: gio.bayGio().getTime(), hetLuc: gio.bayGio().getTime() + 1000 }, khac);
  assert.equal(quyen.ai(yc(veKhac)).bang, "ve-khong_biet_khoa");
  assert.equal((await goi("/api/vc/rieng", veKhac)).ma, 401);
  assert.ok(nhatKy.dong.some((d) => /tu choi GET \/api\/vc\/rieng/.test(d.noiDung)));
});

test("chua dang ky Xeon thi MOI ve deu bi tu choi (fail-closed); dang ky luc dang chay bang datXeon thi ve vao duoc", async () => {
  const { goi, ve, quyen, khoaKy } = dungThu({ xeonDaDangKy: false });
  assert.equal(quyen.daDangKyXeon(), false);
  const yc = { method: "GET", duong: "/x", truyVan: {}, tieuDe: { authorization: `Bearer ${ve()}` } };
  assert.equal(quyen.ai(yc).bang, "chua-dang-ky-xeon");
  assert.equal((await goi("/api/vc/rieng", ve())).ma, 401);
  assert.equal((await goi("/api/vc/rieng", MA_DESK)).ma, 200, "khoa dai han van vao");

  quyen.datXeon({ keyId: khoaKy.keyId, khoaCongPem: khoaKy.khoaCongPem, shop: SHOP });
  assert.equal((await goi("/api/vc/rieng", ve())).ma, 200);
  assert.equal(quyen.shop(), SHOP);
  assert.throws(() => quyen.datXeon({ keyId: "x" }), /datXeon can/);
});

test("xoay khoa: landing giu hai khoa cong, ve ky bang khoa cu van vao toi khi het han", async () => {
  const { goi, ve, quyen } = dungThu();
  const moi = sinhKhoaKy();
  quyen.datXeon({ keyId: moi.keyId, khoaCongPem: moi.khoaCongPem, shop: SHOP });
  assert.equal((await goi("/api/vc/rieng", ve())).ma, 200, "khoa cu");
  const t = Date.parse("2026-09-12T00:00:00.000Z");
  const veMoi = kyVe({ vai: "quan-tri", shop: SHOP, maMay: "m", tenMay: "m", manh: ["van-chuyen"], truc: false, phatLuc: t, hetLuc: t + 3600 * 1000 }, moi);
  assert.equal((await goi("/api/vc/rieng", veMoi)).ma, 200, "khoa moi");
});
