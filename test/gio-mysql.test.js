// GIO GIUA JS VA MYSQL — bai giu mot loi that da xay ra.
//
// Cot DATETIME khong mang mui gio. Doc "2026-09-12 10:00:00" bang `new Date(...)` thi Node
// hieu la gio may (UTC+7 o day), tuc lech BAY TIENG so voi luc that su ghi. Hau qua: don vua
// dat xong thanh dat cach day bay tieng, cua so "khach tu sua trong 15 phut" dong ngay, va
// `createdAt` tra ra cho Sales Desk cung lech.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { gioMySQL, docGio, isoTuMySQL } = require("../../chung/gio-mysql.js");

test("ghi ra chuoi MySQL theo gio UTC", () => {
  const t = new Date("2026-09-12T10:00:00.000Z");
  assert.equal(gioMySQL(t), "2026-09-12 10:00:00");
  assert.equal(gioMySQL(t, { ms: true }), "2026-09-12 10:00:00.000");
});

test("GHI ROI DOC LAI phai ra dung moc ban dau — day la ca bo bai", () => {
  const t = new Date("2026-09-12T10:00:00.000Z");
  const trongSo = gioMySQL(t);              // cai MySQL giu
  const docLai = docGio(trongSo);           // cai JS hieu
  assert.equal(docLai.getTime(), t.getTime(), "lech mot chut la cua so 15 phut sai, don lech gio");
  assert.equal(isoTuMySQL(trongSo), "2026-09-12T10:00:00.000Z");
});

test("chuoi khong mui gio duoc hieu la UTC, KHONG phai gio may", () => {
  // Neu tep nay hieu sai, bai nay do tren may dat gio Viet Nam.
  assert.equal(isoTuMySQL("2026-09-12 10:00:00"), "2026-09-12T10:00:00.000Z");
  assert.equal(isoTuMySQL("2026-09-12 10:00:00.123"), "2026-09-12T10:00:00.123Z");
});

test("chuoi da co mui gio thi de nguyen, khong gan them", () => {
  assert.equal(isoTuMySQL("2026-09-12T10:00:00.000Z"), "2026-09-12T10:00:00.000Z");
  assert.equal(isoTuMySQL("2026-09-12T17:00:00+07:00"), "2026-09-12T10:00:00.000Z");
});

test("Date tu cong du lieu tra ve thi dung luon", () => {
  const t = new Date("2026-09-12T10:00:00.000Z");
  assert.equal(docGio(t).getTime(), t.getTime());
});

test("khong doc duoc thi tra rong, khong nem va khong tra Invalid Date", () => {
  for (const xau of ["", null, undefined, 0, "khong-phai-gio", "0000-00-00 00:00:00"]) {
    assert.equal(docGio(xau), null, `"${xau}" phai ra null`);
    assert.equal(isoTuMySQL(xau), "");
  }
});
