// Chan goi don — va bai lam no GAY.
//
// Ban dang chay co viec nay; ban tach lam mat khi cat module ra. Bo bai nay la de no khong
// bao gio mat lan nua.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { taoKhung } = require("../loi/khung");
const { taoBoDemGoi, diaChiNguoiGoi } = require("../loi/cong/han-goi");
const { taoKhoTep } = require("../loi/cong/kho-tep");
const { taoNhatKyGia, taoGioGia, taoHttpNgoaiGia } = require("../loi/cong/co-ban");
const { taoCongQuyen } = require("../loi/cong/quyen");
const { napToKhais } = require("../loi/nap-modules");

const MA_QT = "ma-quan-tri";
const tam = () => fs.mkdtempSync(path.join(os.tmpdir(), "han-goi-"));

// `khongHan: true` = duong khong khai han. KHONG dung `hanGoi: undefined` — gia tri mac dinh
// cua tham so se nhay vao va bai thanh ra thu mot thu khac han.
function dungThu({ hanGoi = { soLan: 3, trongMs: 60000 }, khongHan = false, quyen = "cong-khai", tinProxy = false } = {}) {
  const gio = taoGioGia();
  const nhatKy = taoNhatKyGia();
  const boDem = taoBoDemGoi({ gio });
  const khung = taoKhung({
    cong: {
      kho: taoKhoTep({ thuMuc: tam() }), nhatKy, gio, httpNgoai: taoHttpNgoaiGia(),
      quyen: taoCongQuyen({ maQuanTri: MA_QT }), hanGoi: boDem
    },
    nhatKy, tinProxy,
    toKhais: [{
      id: "thu", ten: "Thu", mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1",
      duong: [{
        method: "POST", path: "/api/thu", quyen, ...(khongHan ? {} : { hanGoi }),
        viSaoCongKhai: "Bai kiem tra: duong gia, khong doc du lieu that.",
        tay: () => ({ ma: 200, than: { ok: true } })
      }]
    }]
  });
  const goi = (ip = "1.2.3.4", tieuDe = {}) => khung.xuLy({
    method: "POST", duong: "/api/thu", truyVan: {}, tieuDe, ip, doc: async () => ({})
  });
  return { khung, goi, gio, nhatKy, boDem };
}

test("qua han thi tra 429 kem Retry-After, khong goi vao module nua", async () => {
  const { goi } = dungThu({ hanGoi: { soLan: 3, trongMs: 60000 } });
  for (let i = 0; i < 3; i += 1) assert.equal((await goi()).ma, 200, `lan ${i + 1} phai qua`);

  const lanBon = await goi();
  assert.equal(lanBon.ma, 429);
  assert.equal(lanBon.than.error, "qua_nhieu");
  assert.ok(Number(lanBon.tieuDe["Retry-After"]) > 0, "phai noi cho bao lau moi goi lai duoc");
});

test("het khoang thi dem lai tu dau", async () => {
  const { goi, gio } = dungThu({ hanGoi: { soLan: 2, trongMs: 60000 } });
  await goi(); await goi();
  assert.equal((await goi()).ma, 429);

  gio.troi(60001);
  assert.equal((await goi()).ma, 200, "qua khoang thi duoc goi lai");
});

test("dem RIENG tung nguoi — mot ke goi don khong chan duoc khach that", async () => {
  const { goi } = dungThu({ hanGoi: { soLan: 2, trongMs: 60000 } });
  await goi("9.9.9.9"); await goi("9.9.9.9");
  assert.equal((await goi("9.9.9.9")).ma, 429, "ke goi don bi chan");
  assert.equal((await goi("1.1.1.1")).ma, 200, "nguoi khac van vao binh thuong");
});

test("dem RIENG tung duong — chan duong nay khong chan duong kia", async () => {
  const gio = taoGioGia();
  const boDem = taoBoDemGoi({ gio });
  const chung = { quyen: "cong-khai", hanGoi: { soLan: 1, trongMs: 60000 }, viSaoCongKhai: "Bai kiem tra: duong gia." };
  const khung = taoKhung({
    cong: {
      kho: taoKhoTep({ thuMuc: tam() }), nhatKy: taoNhatKyGia(), gio,
      httpNgoai: taoHttpNgoaiGia(), quyen: taoCongQuyen({ maQuanTri: MA_QT }), hanGoi: boDem
    },
    toKhais: [{
      id: "thu", ten: "Thu", mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1",
      duong: [
        { method: "GET", path: "/api/mot", ...chung, tay: () => ({ ma: 200, than: {} }) },
        { method: "GET", path: "/api/hai", ...chung, tay: () => ({ ma: 200, than: {} }) }
      ]
    }]
  });
  const goi = (duong) => khung.xuLy({ method: "GET", duong, truyVan: {}, tieuDe: {}, ip: "5.5.5.5" });
  assert.equal((await goi("/api/mot")).ma, 200);
  assert.equal((await goi("/api/mot")).ma, 429);
  assert.equal((await goi("/api/hai")).ma, 200, "duong khac phai con nguyen han cua no");
});

test("chan goi don chay TRUOC khi kiem quyen — ke do ma cung bi chan", async () => {
  const { goi } = dungThu({ quyen: "quan-tri", hanGoi: { soLan: 2, trongMs: 60000 } });
  assert.equal((await goi("7.7.7.7")).ma, 401, "khong co ma thi 401");
  assert.equal((await goi("7.7.7.7")).ma, 401);
  assert.equal((await goi("7.7.7.7")).ma, 429, "goi don de do ma thi bi chan, khong con duoc thu nua");
});

test("duong khong khai han thi khong bi chan", async () => {
  const { goi } = dungThu({ quyen: "quan-tri", khongHan: true });
  for (let i = 0; i < 20; i += 1) {
    assert.notEqual((await goi("8.8.8.8", { authorization: `Bearer ${MA_QT}` })).ma, 429);
  }
});

test("sau proxy: chi tin tieu de khi da BAT tinProxy", () => {
  const yc = { ip: "10.0.0.1", tieuDe: { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "203.0.113.9, 10.0.0.1" } };
  assert.equal(diaChiNguoiGoi(yc, { tinProxy: false }), "10.0.0.1", "chua bat thi KHONG tin tieu de — nguoi ta tu khai IP la lach duoc han");
  assert.equal(diaChiNguoiGoi(yc, { tinProxy: true }), "203.0.113.9");
});

test("x-forwarded-for nhieu chang thi lay chang DAU (nguoi goi that)", () => {
  const yc = { ip: "10.0.0.1", tieuDe: { "x-forwarded-for": " 203.0.113.9 , 70.41.3.18 , 10.0.0.1 " } };
  assert.equal(diaChiNguoiGoi(yc, { tinProxy: true }), "203.0.113.9");
});

test("khong biet nguoi goi la ai thi van dem, khong bo qua", () => {
  assert.equal(diaChiNguoiGoi({ tieuDe: {} }, { tinProxy: true }), "khong-ro");
});

test("bo dem khong phinh vo han", () => {
  const gio = taoGioGia();
  const boDem = taoBoDemGoi({ gio, toiDaKhoa: 100 });
  for (let i = 0; i < 500; i += 1) boDem.dem(`khoa-${i}`, 10, 60000);
  assert.ok(boDem.soKhoa() <= 100, `so khoa phinh len ${boDem.soKhoa()}`);
});

test("moi duong cong khai that trong repo DEU co han goi", () => {
  const ds = napToKhais(path.join(__dirname, "..", "modules"));
  const thieu = [];
  for (const tk of ds) {
    for (const d of tk.duong ?? []) {
      if (d.quyen === "cong-khai" && !d.hanGoi) thieu.push(`${tk.id}: ${d.method} ${d.path}`);
    }
  }
  assert.deepEqual(thieu, [], `duong cong khai chua co han goi: ${thieu.join(", ")}`);
});
