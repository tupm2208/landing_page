// Module Hop thu — chay het duong tu Meta goi vao toi luc gui tin tra loi,
// khong cham Internet mot lan nao.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { taoKhung } = require("../loi/khung");
const { taoKhoTep } = require("../loi/cong/kho-tep");
const { taoNhatKyGia, taoGioGia, taoHttpNgoaiGia } = require("../loi/cong/co-ban");
const { taoCongQuyen } = require("../loi/cong/quyen");
const toKhaiHopThu = require("../modules/hop-thu/module");
const { bocTinNhan, chuKyDung } = require("../modules/hop-thu/graph");
const { SU_KIEN } = require("../../hop-dong");

const MA_QUAN_TRI = "ma-quan-tri-thu";
const APP_SECRET = "bi-mat-ung-dung";
const VERIFY = "verify-thu";

function dungThu({ appSecret = APP_SECRET, tokenTrang = "token-trang", banTraLoi } = {}) {
  const thuMuc = fs.mkdtempSync(path.join(os.tmpdir(), "hop-thu-"));
  const nhatKy = taoNhatKyGia();
  const httpNgoai = taoHttpNgoaiGia(banTraLoi ?? (() => ({
    ok: true, status: 200, json: async () => ({ message_id: "m.1" }), text: async () => "" })));
  const kho = taoKhoTep({ thuMuc, nhatKy });
  const khung = taoKhung({
    cong: { kho, nhatKy, gio: taoGioGia(), httpNgoai, quyen: taoCongQuyen({ maQuanTri: MA_QUAN_TRI }) },
    nhatKy,
    toKhais: [toKhaiHopThu],
    cauHinh: { "hop-thu": { verifyToken: VERIFY, appSecret, tokenTrang } }
  });
  return { khung, nhatKy, httpNgoai, kho, thuMuc };
}

function goiTin(chu = "con size 42 khong shop") {
  return JSON.stringify({
    object: "page",
    entry: [{ id: "trang-1", messaging: [{ sender: { id: "khach-1" }, timestamp: 1789099200000, message: { mid: "m.abc", text: chu } }] }]
  });
}

function yeuCauWebhook(tho, { appSecret = APP_SECRET } = {}) {
  const chuKy = "sha256=" + crypto.createHmac("sha256", appSecret).update(tho).digest("hex");
  return {
    method: "POST", duong: "/api/facebook/webhook", truyVan: {},
    tieuDe: { "x-hub-signature-256": chuKy },
    tho: async () => Buffer.from(tho, "utf8")
  };
}

test("Meta xac nhan dia chi webhook: dung token thi tra lai challenge", async () => {
  const { khung } = dungThu();
  const ra = await khung.xuLy({
    method: "GET", duong: "/api/facebook/webhook",
    truyVan: { "hub.mode": "subscribe", "hub.verify_token": VERIFY, "hub.challenge": "12345" },
    tieuDe: {}
  });
  assert.equal(ra.ma, 200);
  assert.equal(ra.tep.duLieu.toString("utf8"), "12345");
});

test("sai verify token thi 403 — va khong co token cau hinh cung 403 (fail-closed)", async () => {
  const { khung } = dungThu();
  const sai = await khung.xuLy({
    method: "GET", duong: "/api/facebook/webhook",
    truyVan: { "hub.mode": "subscribe", "hub.verify_token": "bua", "hub.challenge": "x" }, tieuDe: {}
  });
  assert.equal(sai.ma, 403);
});

test("tin that: ghi vao so, phat len bang tin, tra 200 cho Meta", async () => {
  const { khung, kho } = dungThu();
  const daNghe = [];
  khung.bus.nghe(SU_KIEN.tin_nhan_den, "bai-thu", (t) => daNghe.push(t));

  const ra = await khung.xuLy(yeuCauWebhook(goiTin()));
  assert.equal(ra.ma, 200);
  assert.equal(ra.than.daXacMinh, true);

  await kho.choXong();
  const so = await kho.so("hop-thu-den").doc();
  assert.equal(so.events.length, 1);
  assert.equal(so.events[0].daXacMinh, true);

  await new Promise((r) => setImmediate(r));
  assert.equal(daNghe.length, 1);
  assert.equal(daNghe[0].chu, "con size 42 khong shop");
  assert.equal(daNghe[0].nguoi, "khach-1");
});

test("chu ky sai thi tu choi 401 va KHONG phat len bang tin", async () => {
  const { khung, kho } = dungThu();
  const daNghe = [];
  khung.bus.nghe(SU_KIEN.tin_nhan_den, "bai-thu", (t) => daNghe.push(t));

  const yc = yeuCauWebhook(goiTin(), { appSecret: "khoa-cua-ke-gia" });
  const ra = await khung.xuLy(yc);
  assert.equal(ra.ma, 401);

  await new Promise((r) => setImmediate(r));
  assert.equal(daNghe.length, 0, "goi khong xac minh duoc thi khong duoc phat cho bo nao");
  await kho.choXong();
  assert.equal((await kho.so("hop-thu-den").doc({ events: [] })).events.length, 0);
});

test("che do trung chuyen (chua co APP_SECRET): van giu tin, nhung KHONG phat cho bo nao", async () => {
  const { khung, kho } = dungThu({ appSecret: "" });
  const daNghe = [];
  khung.bus.nghe(SU_KIEN.tin_nhan_den, "bai-thu", (t) => daNghe.push(t));

  const ra = await khung.xuLy(yeuCauWebhook(goiTin()));
  assert.equal(ra.ma, 200);
  assert.equal(ra.than.daXacMinh, false);

  await kho.choXong();
  assert.equal((await kho.so("hop-thu-den").doc()).events.length, 1, "van phai giu de Desk keo ve");
  await new Promise((r) => setImmediate(r));
  assert.equal(daNghe.length, 0, "chua chac goi tu Meta thi khong duoc tra loi khach");
});

test("goi rac (khong chu ky / khong phai trang) bi tu choi 400", async () => {
  const { khung } = dungThu();
  const khongChuKy = await khung.xuLy({
    method: "POST", duong: "/api/facebook/webhook", truyVan: {}, tieuDe: {},
    tho: async () => Buffer.from(goiTin(), "utf8")
  });
  assert.equal(khongChuKy.ma, 400);

  const khongPhaiTrang = await khung.xuLy(yeuCauWebhook(JSON.stringify({ object: "instagram", entry: [] })));
  assert.equal(khongPhaiTrang.ma, 400);
});

test("tin do chinh trang gui di (echo) khong duoc coi la khach nhan tin", () => {
  const tin = bocTinNhan({
    object: "page",
    entry: [{ id: "trang-1", messaging: [
      { sender: { id: "trang-1" }, message: { mid: "m.1", text: "shop tra loi" } },
      { sender: { id: "khach-1" }, message: { mid: "m.2", text: "em hoi", is_echo: true } },
      { sender: { id: "khach-2" }, timestamp: 1789099200000, message: { mid: "m.3", text: "con hang khong" } }
    ] }]
  });
  assert.equal(tin.length, 1);
  assert.equal(tin[0].nguoi, "khach-2");
});

test("khach chi gui anh (khong chu) van duoc tinh la mot tin", () => {
  const tin = bocTinNhan({
    object: "page",
    entry: [{ id: "t", messaging: [{ sender: { id: "k" }, timestamp: 1, message: { mid: "m", attachments: [{ type: "image" }] } }] }]
  });
  assert.equal(tin.length, 1);
  assert.equal(tin[0].soAnh, 1);
});

test("gui tin tra loi: goi dung dia chi Graph API, kem token trang", async () => {
  const { khung, httpNgoai } = dungThu();
  const ra = await khung.xuLy({
    method: "POST", duong: "/api/hop-thu/gui", truyVan: {},
    tieuDe: { authorization: `Bearer ${MA_QUAN_TRI}` },
    doc: async () => ({ nguoi: "khach-1", chu: "Da con size 42 anh nhe" })
  });
  assert.equal(ra.ma, 200);
  assert.equal(httpNgoai.daGoi.length, 1);
  assert.match(httpNgoai.daGoi[0].url, /graph\.facebook\.com\/v\d+\.\d+\/me\/messages/);
  assert.match(httpNgoai.daGoi[0].url, /access_token=token-trang/);
  assert.equal(JSON.parse(httpNgoai.daGoi[0].tuyChon.body).message.text, "Da con size 42 anh nhe");
});

test("khong co ma quan tri thi khong goi duoc duong gui tin", async () => {
  const { khung, httpNgoai } = dungThu();
  const ra = await khung.xuLy({
    method: "POST", duong: "/api/hop-thu/gui", truyVan: {}, tieuDe: {},
    doc: async () => ({ nguoi: "khach-1", chu: "xin chao" })
  });
  assert.equal(ra.ma, 401);
  assert.equal(httpNgoai.daGoi.length, 0);
});

test("Meta tu choi gui thi tra 502 va noi ro, khong nuot loi", async () => {
  const { khung } = dungThu({
    banTraLoi: () => ({ ok: false, status: 400, text: async () => '{"error":{"message":"ngoai 24h"}}', json: async () => ({}) })
  });
  const ra = await khung.xuLy({
    method: "POST", duong: "/api/hop-thu/gui", truyVan: {},
    tieuDe: { authorization: `Bearer ${MA_QUAN_TRI}` },
    doc: async () => ({ nguoi: "khach-1", chu: "tra loi muon" })
  });
  assert.equal(ra.ma, 502);
  assert.match(ra.than.message, /ngoai 24h/);
});

test("Desk keo tin ve van phai co ma quan tri", async () => {
  const { khung } = dungThu();
  await khung.xuLy(yeuCauWebhook(goiTin()));
  const khongMa = await khung.xuLy({ method: "GET", duong: "/api/facebook/webhook-inbox", truyVan: {}, tieuDe: {} });
  assert.equal(khongMa.ma, 401);

  const coMa = await khung.xuLy({
    method: "GET", duong: "/api/facebook/webhook-inbox", truyVan: {},
    tieuDe: { authorization: `Bearer ${MA_QUAN_TRI}` }
  });
  assert.equal(coMa.ma, 200);
  assert.equal(coMa.than.events.length, 1);
});

test("chu ky tinh tren RAW BYTE, khong phai tren JSON doc lai", () => {
  const tho = Buffer.from('{"object":"page",  "entry":[]}', "utf8");        // co hai dau cach
  const docLai = Buffer.from(JSON.stringify(JSON.parse(tho.toString())), "utf8");
  const chuKy = "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(tho).digest("hex");
  assert.equal(chuKyDung(tho, chuKy, APP_SECRET), true);
  assert.equal(chuKyDung(docLai, chuKy, APP_SECRET), false, "doc lai roi ky lai la doi byte — phai truot");
});
