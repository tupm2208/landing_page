// VE 15 PHUT + NHAT KY AI GOI — anh Dung duyet 12/09/2026 ("ba danh tinh + ve 15 phut").
//
// Hai thu bo bai nay phai chung minh:
//   1. Ve het han thi KHONG con vao duoc — do la ca diem cua ve.
//   2. Nhat ky ghi duoc TEN nguoi goi, khong phai "co nguoi cam ma hop le".

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { taoKhung } = require("../loi/khung");
const { taoBoVe } = require("../loi/cong/ve");
const { taoCongQuyen } = require("../loi/cong/quyen");
const { taoBoDemGoi } = require("../loi/cong/han-goi");
const { taoKhoTep } = require("../loi/cong/kho-tep");
const { taoNhatKyGia, taoGioGia, taoHttpNgoaiGia } = require("../loi/cong/co-ban");
const mKhung = require("../modules/khung-nen-tang/module");

const BI_MAT = "bi-mat-ky-ve-dai-hon-16-ky-tu";
const MA_DESK = "ma-cua-sales-desk";
const MA_BO_NAO = "ma-cua-bo-nao";
const tam = () => fs.mkdtempSync(path.join(os.tmpdir(), "ve-"));

function dungThu() {
  const gio = taoGioGia();
  const nhatKy = taoNhatKyGia();
  const boVe = taoBoVe({ biMat: BI_MAT, gio });
  const quyen = taoCongQuyen({
    cacKhoa: [
      { ma: MA_DESK, ten: "sales-desk", vai: "quan-tri" },
      { ma: MA_BO_NAO, ten: "bo-nao", vai: "dich-vu" }
    ],
    boVe, nhatKy
  });
  const khung = taoKhung({
    cong: {
      kho: taoKhoTep({ thuMuc: tam() }), nhatKy, gio, httpNgoai: taoHttpNgoaiGia(),
      quyen, hanGoi: taoBoDemGoi({ gio })
    },
    nhatKy,
    toKhais: [mKhung, {
      id: "thu", ten: "Thu", mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1",
      duong: [
        { method: "GET", path: "/api/rieng", quyen: "quan-tri", tay: () => ({ ma: 200, than: { ok: true } }) },
        { method: "GET", path: "/api/bo-nao-duoc", quyen: "dich-vu", tay: () => ({ ma: 200, than: { ok: true } }) }
      ]
    }],
    cauHinh: { "khung-nen-tang": { deployId: "thu" } }
  });

  const xinVe = (ma) => khung.xuLy({
    method: "POST", duong: "/api/ve", truyVan: {},
    tieuDe: ma ? { authorization: `Bearer ${ma}` } : {}, ip: "1.1.1.1", doc: async () => ({})
  });
  const goi = (duong, ma) => khung.xuLy({
    method: "GET", duong, truyVan: {},
    tieuDe: ma ? { authorization: `Bearer ${ma}` } : {}, ip: "1.1.1.1"
  });
  return { khung, gio, nhatKy, boVe, quyen, xinVe, goi };
}

test("doi khoa dai han lay duoc ve, ve vao duoc dung duong cua vai do", async () => {
  const { xinVe, goi } = dungThu();
  const cap = await xinVe(MA_DESK);
  assert.equal(cap.ma, 200);
  assert.equal(cap.than.vai, "quan-tri");
  assert.equal(cap.than.ten, "sales-desk");
  assert.equal(cap.than.hetSauGiay, 900, "ve song 15 phut");

  assert.equal((await goi("/api/rieng", cap.than.ve)).ma, 200);
});

test("VE HET HAN thi khong vao duoc nua — ca diem cua ve", async () => {
  const { xinVe, goi, gio } = dungThu();
  const ve = (await xinVe(MA_DESK)).than.ve;
  assert.equal((await goi("/api/rieng", ve)).ma, 200);

  gio.troi(15 * 60 * 1000 + 1);
  assert.equal((await goi("/api/rieng", ve)).ma, 401, "ve qua 15 phut phai chet");
});

test("ve cua bo nao KHONG vao duoc duong quan tri", async () => {
  const { xinVe, goi } = dungThu();
  const ve = (await xinVe(MA_BO_NAO)).than.ve;
  assert.equal(ve.length > 0, true);
  assert.equal((await goi("/api/bo-nao-duoc", ve)).ma, 200);
  assert.equal((await goi("/api/rieng", ve)).ma, 401, "dich vu khong duoc leo len quan tri");
});

test("ve bi sua mot ky tu thi truot", async () => {
  const { xinVe, goi } = dungThu();
  const ve = (await xinVe(MA_DESK)).than.ve;
  const [than, chuKy] = ve.split(".");
  const gia = `${than}.${chuKy.slice(0, -1)}${chuKy.endsWith("A") ? "B" : "A"}`;
  assert.equal((await goi("/api/rieng", gia)).ma, 401);
});

test("ve ky bang bi mat KHAC thi khong vao duoc", async () => {
  const gio = taoGioGia();
  const boVeLa = taoBoVe({ biMat: "bi-mat-cua-ke-gia-dai-hon-16", gio });
  const veLa = boVeLa.phat({ vai: "quan-tri", ten: "ke-gia" }).ve;
  const { goi } = dungThu();
  assert.equal((await goi("/api/rieng", veLa)).ma, 401);
});

test("khong co ma thi khong xin duoc ve", async () => {
  const { xinVe } = dungThu();
  assert.equal((await xinVe()).ma, 401);
  assert.equal((await xinVe("ma-bua")).ma, 401);
});

test("KHOA DAI HAN van goi thang duoc — Desk va Image Tool chua doi sang ve", async () => {
  const { goi } = dungThu();
  assert.equal((await goi("/api/rieng", MA_DESK)).ma, 200, "cat ngay la gay he dang ban hang");
});

test("nhat ky ghi TEN nguoi con dung khoa dai han, de biet khi nao tat duoc duong do", async () => {
  const { goi, nhatKy } = dungThu();
  await goi("/api/rieng", MA_DESK);
  assert.ok(
    nhatKy.dong.some((d) => /sales-desk/.test(d.noiDung) && /KHOA DAI HAN/.test(d.noiDung)),
    `nhat ky: ${JSON.stringify(nhatKy.dong.map((d) => d.noiDung))}`
  );
});

test("dung ve thi KHONG bi ghi la con dung khoa dai han", async () => {
  const { xinVe, goi, nhatKy } = dungThu();
  const ve = (await xinVe(MA_BO_NAO)).than.ve;
  const truoc = nhatKy.dong.length;
  await goi("/api/bo-nao-duoc", ve);
  const sau = nhatKy.dong.slice(truoc);
  assert.ok(!sau.some((d) => /KHOA DAI HAN/.test(d.noiDung)), "da doi sang ve roi thi khong con nhac nua");
});

test("bi tu choi thi nhat ky ghi AI bi tu choi, khong phai 'co nguoi bi tu choi'", async () => {
  const { goi, nhatKy } = dungThu();
  await goi("/api/rieng", MA_BO_NAO);
  assert.ok(
    nhatKy.dong.some((d) => /tu choi/.test(d.noiDung) && /bo-nao/.test(d.noiDung)),
    `nhat ky: ${JSON.stringify(nhatKy.dong.map((d) => d.noiDung))}`
  );
});

test("bi mat ky ve qua ngan thi TU CHOI khoi dong", () => {
  assert.throws(() => taoBoVe({ biMat: "ngan", gio: taoGioGia() }), /ít nhất 16 ký tự/);
});

test("chua bat ve thi duong xin ve noi ro, khong im lang", async () => {
  const gio = taoGioGia();
  const khung = taoKhung({
    cong: {
      kho: taoKhoTep({ thuMuc: tam() }), nhatKy: taoNhatKyGia(), gio, httpNgoai: taoHttpNgoaiGia(),
      quyen: taoCongQuyen({ maQuanTri: MA_DESK }), hanGoi: taoBoDemGoi({ gio })
    },
    toKhais: [mKhung], cauHinh: { "khung-nen-tang": {} }
  });
  const ra = await khung.xuLy({
    method: "POST", duong: "/api/ve", truyVan: {},
    tieuDe: { authorization: `Bearer ${MA_DESK}` }, ip: "1.1.1.1", doc: async () => ({})
  });
  assert.equal(ra.ma, 503);
  assert.equal(ra.than.error, "chua_bat_ve");
});

test("khong cau hinh khoa nao thi tu choi tat ca (fail-closed)", async () => {
  const gio = taoGioGia();
  const khung = taoKhung({
    cong: {
      kho: taoKhoTep({ thuMuc: tam() }), nhatKy: taoNhatKyGia(), gio, httpNgoai: taoHttpNgoaiGia(),
      quyen: taoCongQuyen({}), hanGoi: taoBoDemGoi({ gio })
    },
    toKhais: [{
      id: "thu", ten: "Thu", mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1",
      duong: [{ method: "GET", path: "/api/rieng", quyen: "quan-tri", tay: () => ({ ma: 200, than: {} }) }]
    }]
  });
  const ra = await khung.xuLy({ method: "GET", duong: "/api/rieng", truyVan: {}, tieuDe: { authorization: "Bearer bat-ky" } });
  assert.equal(ra.ma, 401);
});
