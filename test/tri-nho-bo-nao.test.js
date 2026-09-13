// TRI NHO HOI THOAI cua bot nam tren landing (anh Dung chot 14/09/2026). Bo nao doc/ghi qua API.

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

const MA_BO_NAO = "ma-bo-nao";
const MA_QT = "ma-quan-tri";

function dungThu() {
  const nhatKy = taoNhatKyGia();
  const gio = taoGioGia();
  const kho = taoKhoTep({ thuMuc: fs.mkdtempSync(path.join(os.tmpdir(), "tri-nho-")), nhatKy });
  // Cong bo nao can hang-kho; dung mot module gia cap dung hai dich vu do.
  const hangKhoGia = {
    id: "hang-kho", ten: "Hang kho gia", mang: "van-hanh", chay: "server-khach", phienBan: "0", duong: [],
    capDichVu: { "hang-kho.tim": async () => [], "hang-kho.tonKho": async () => ({ cacDong: [] }) }
  };
  const khung = taoKhung({
    cong: { kho, nhatKy, gio, quyen: taoCongQuyen({ maQuanTri: MA_QT, maDichVu: MA_BO_NAO }), hanGoi: taoBoDemGoi({ gio }) },
    nhatKy, toKhais: [hangKhoGia, mCongBoNao], cauHinh: { "cong-bo-nao": { diaChiWeb: "https://shop.vn" } }
  });
  const goi = (method, duong, { ma = MA_BO_NAO, than } = {}) => khung.xuLy({
    method, duong, truyVan: {}, ip: "1.1.1.1", tieuDe: { authorization: `Bearer ${ma}` }, tham: {}, doc: async () => than ?? {}
  });
  return { goi, gio, kho };
}

test("doc chua co -> null; ghi roi doc lai; ma sai / than sai / qua lon bi tu choi; khong ma dich vu thi 401", async () => {
  const { goi } = dungThu();
  const ma = "facebook:khach-1";
  const trong = await goi("GET", `/api/bo-nao/tri-nho/${encodeURIComponent(ma)}`);
  assert.equal(trong.ma, 200);
  assert.equal(trong.than.trangThai, null);

  const trangThai = { tenant: "toprun", conversationId: ma, turns: [{ role: "customer", text: "con size 42", at: "2026-09-14T08:00:00.000Z" }] };
  const ghi = await goi("PUT", `/api/bo-nao/tri-nho/${encodeURIComponent(ma)}`, { than: { trangThai } });
  assert.equal(ghi.ma, 200, JSON.stringify(ghi.than));
  const doc = await goi("GET", `/api/bo-nao/tri-nho/${encodeURIComponent(ma)}`);
  assert.deepEqual(doc.than.trangThai, trangThai);
  assert.equal(doc.than.capNhatLuc, ghi.than.capNhatLuc);

  assert.equal((await goi("GET", "/api/bo-nao/tri-nho/co%20cach")).ma, 400);
  assert.equal((await goi("PUT", `/api/bo-nao/tri-nho/${ma}`, { than: { trangThai: "chuoi" } })).ma, 400);
  assert.equal((await goi("PUT", `/api/bo-nao/tri-nho/${ma}`, { than: { trangThai: { to: "x".repeat(100 * 1024) } } })).ma, 413);
  assert.equal((await goi("GET", `/api/bo-nao/tri-nho/${ma}`, { ma: "la" })).ma, 401);
  assert.equal((await goi("GET", `/api/bo-nao/tri-nho/${ma}`, { ma: MA_QT })).ma, 200, "quan tri cung doc duoc");
});

test("giu toi da 2000 hoi thoai, bo cai cu nhat", async () => {
  const { goi, gio, kho } = dungThu();
  for (let i = 0; i < 2001; i += 1) {
    gio.troi(1000);
    await goi("PUT", `/api/bo-nao/tri-nho/h${i}`, { than: { trangThai: { i } } });
  }
  const so = await kho.so("cong-bo-nao-tri-nho").doc();
  assert.equal(Object.keys(so.hoiThoai).length, 2000);
  assert.equal(so.hoiThoai.h0, undefined, "cu nhat bi bo");
  assert.ok(so.hoiThoai.h2000);
});
