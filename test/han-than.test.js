// HAN THAN YEU CAU THEO TUNG DUONG.
//
// Cua nhan ca danh muc 4.800 mon phai rong (10 MB, dung nhu ban dang chay); cua nhan mot don
// hang thi 1 MB la du. Mot han chung cho ca hai thi hoac chan mat danh muc, hoac mo mot cua
// rong hoac cho moi duong con lai — ke goi don gui mot than 10 MB vao duong dat hang.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("stream");

const { kiemToKhai } = require("../../hop-dong");
const { taoKhung } = require("../loi/khung");
const { taoNhatKyGia, taoGioGia } = require("../loi/cong/co-ban");
const { tayNgheHttp, HAN_THAN_MAC_DINH } = require("../loi/may-chu");

function moduleThu() {
  const daNhan = [];
  return {
    daNhan,
    toKhai: {
      id: "thu", ten: "Thu", mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1",
      duong: [
        {
          method: "POST", path: "/api/nho", quyen: "cong-khai",
          viSaoCongKhai: "Bai kiem tra: cua hep, khong khai han than rieng.",
          hanGoi: { soLan: 100, trongMs: 60000 },
          tay: async (ctx, yc) => { daNhan.push((await yc.doc()).chu.length); return { ma: 200, than: { ok: true } }; }
        },
        {
          method: "POST", path: "/api/to", quyen: "cong-khai",
          viSaoCongKhai: "Bai kiem tra: cua rong, khai han than rieng.",
          hanGoi: { soLan: 100, trongMs: 60000 },
          hanThan: 4 * 1024 * 1024,
          tay: async (ctx, yc) => { daNhan.push((await yc.doc()).chu.length); return { ma: 200, than: { ok: true } }; }
        }
      ]
    }
  };
}

/** Goi that qua lop http, vi han than nam o lop do. */
async function goi(khung, duong, soByte) {
  const than = JSON.stringify({ chu: "x".repeat(soByte) });
  const yeuCau = Readable.from([Buffer.from(than, "utf8")]);
  yeuCau.method = "POST";
  yeuCau.url = duong;
  yeuCau.headers = { host: "localhost", "content-type": "application/json" };
  yeuCau.socket = { remoteAddress: "1.2.3.4" };

  const ghi = { ma: 0, than: "" };
  const traLoi = {
    writeHead(ma) { ghi.ma = ma; },
    end(t) { if (t) ghi.than = String(t); }
  };
  await tayNgheHttp(khung)(yeuCau, traLoi);
  return ghi;
}

function dungKhung(toKhai) {
  return taoKhung({
    cong: { nhatKy: taoNhatKyGia(), gio: taoGioGia() },
    nhatKy: taoNhatKyGia(), toKhais: [toKhai]
  });
}

test("han mac dinh la 1 MB", () => {
  assert.equal(HAN_THAN_MAC_DINH, 1024 * 1024);
});

test("cua hep: than 2 MB bi tra 413, va module KHONG he duoc goi", async () => {
  const m = moduleThu();
  const ra = await goi(dungKhung(m.toKhai), "/api/nho", 2 * 1024 * 1024);
  assert.equal(ra.ma, 413);
  assert.equal(m.daNhan.length, 0, "than qua lon thi khong duoc doc vao bo nho roi moi bao");
});

test("cua rong: chinh than 2 MB do lai di qua duoc", async () => {
  const m = moduleThu();
  const ra = await goi(dungKhung(m.toKhai), "/api/to", 2 * 1024 * 1024);
  assert.equal(ra.ma, 200, ra.than);
  assert.equal(m.daNhan[0], 2 * 1024 * 1024);
});

test("cua rong van co han cua no: 5 MB vao cua 4 MB thi bi tra 413", async () => {
  const m = moduleThu();
  const ra = await goi(dungKhung(m.toKhai), "/api/to", 5 * 1024 * 1024);
  assert.equal(ra.ma, 413);
  assert.equal(m.daNhan.length, 0);
});

test("khai han than sai thi KHONG nap duoc module", () => {
  const co = (hanThan) => () => kiemToKhai({
    id: "thu", ten: "Thu", mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1",
    duong: [{
      method: "POST", path: "/api/x", quyen: "quan-tri", hanThan,
      tay: () => ({ ma: 200, than: {} })
    }]
  }, "thu");
  assert.throws(co(0), /hanThan/);
  assert.throws(co(-1), /hanThan/);
  assert.throws(co(1.5), /hanThan/);
  assert.throws(co("10MB"), /hanThan/);
  assert.doesNotThrow(co(10 * 1024 * 1024));
});

test("ba cua nhan du lieu lon cua Hang hoa khai du han cho goi that", () => {
  const tk = require("../modules/hang-kho/module");
  const han = new Map(tk.duong.map((d) => [`${d.method} ${d.path}`, d.hanThan]));
  // Danh muc that do duoc 10,2 MB (4.834 mon) — ban dang chay dat 10 MB nen dang sat mep.
  assert.ok(han.get("POST /api/products") >= 11 * 1024 * 1024, "cua danh muc phai rong hon goi that do duoc");
  assert.equal(han.get("POST /api/partner-campaigns"), 5 * 1024 * 1024);
  assert.equal(han.get("POST /api/ready-stock/sync"), 2 * 1024 * 1024);
});
