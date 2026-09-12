// Luat kien truc — va bai lam no GAY.
//
// Moi bai o day deu co hai nua: nua "dung thi khong nem" va nua "pha thi phai nem".
// Bai chi kiem nua dau la bai vo dung: no van xanh ca khi ham kiem tra tra ve true mu quang.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { kiemTachBiet, demChuaTach } = require("../loi/luat");
const { napToKhais } = require("../loi/nap-modules");
const { taoKhung } = require("../loi/khung");
const { kiemToKhai } = require("../../hop-dong");
const { taoKhoTep } = require("../loi/cong/kho-tep");
const { taoNhatKyGia, taoGioGia, taoHttpNgoaiGia } = require("../loi/cong/co-ban");
const { taoCongQuyen } = require("../loi/cong/quyen");

const THU_MUC_MODULES = path.join(__dirname, "..", "modules");

function congGia(thuMuc) {
  return {
    kho: taoKhoTep({ thuMuc }),
    nhatKy: taoNhatKyGia(),
    gio: taoGioGia(),
    httpNgoai: taoHttpNgoaiGia(),
    quyen: taoCongQuyen({ maQuanTri: "ma-thu" })
  };
}

function thuMucTam() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "toprun-modules-"));
}

test("module that trong repo khong vi pham luat tach biet", () => {
  const kq = kiemTachBiet(THU_MUC_MODULES);
  assert.ok(kq.soModule >= 1, "phai co it nhat mot module");
});

test("GAY khi mot module require thang module khac", () => {
  const tam = thuMucTam();
  fs.mkdirSync(path.join(tam, "mot"), { recursive: true });
  fs.mkdirSync(path.join(tam, "hai"), { recursive: true });
  fs.writeFileSync(path.join(tam, "hai", "viec.js"), "module.exports = 1;\n");
  fs.writeFileSync(path.join(tam, "mot", "module.js"), 'const x = require("../hai/viec");\n');

  assert.throws(() => kiemTachBiet(tam), /goi thang sang module "hai"/);
});

test("GAY khi module tu mo cua ra ngoai thay vi di qua cong", () => {
  const tam = thuMucTam();
  fs.mkdirSync(path.join(tam, "mot"), { recursive: true });
  fs.writeFileSync(path.join(tam, "mot", "module.js"), 'const fs = require("fs");\n');

  assert.throws(() => kiemTachBiet(tam), /mo cua ra ngoai phai di qua cong/);
});

test("GAY khi module goi thang loi cua khung", () => {
  const tam = thuMucTam();
  fs.mkdirSync(path.join(tam, "modules", "mot"), { recursive: true });
  fs.mkdirSync(path.join(tam, "loi"), { recursive: true });
  fs.writeFileSync(path.join(tam, "loi", "khung.js"), "module.exports = {};\n");
  fs.writeFileSync(path.join(tam, "modules", "mot", "module.js"), 'require("../../loi/khung");\n');

  assert.throws(() => kiemTachBiet(path.join(tam, "modules")), /moi thu nhan qua ctx/);
});

test("ban chep chua tach trong goc\\ duoc mien tru", () => {
  const tam = thuMucTam();
  fs.mkdirSync(path.join(tam, "mot", "goc"), { recursive: true });
  fs.writeFileSync(path.join(tam, "mot", "goc", "cu.js"), 'const fs = require("fs");\n');

  assert.doesNotThrow(() => kiemTachBiet(tam));
});

test("moi to khai trong repo deu hop le", () => {
  const ds = napToKhais(THU_MUC_MODULES);
  assert.ok(ds.length >= 1);
  for (const tk of ds) assert.doesNotThrow(() => kiemToKhai(tk, tk.id));
});

test("GAY khi cong cu mo cho bot mang hieu ung tien", () => {
  assert.throws(
    () => kiemToKhai({
      id: "thu", ten: "Thu", mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1",
      congCuBot: [{ ten: "chuyen_khoan", hieuUng: "tien" }]
    }, "thu"),
    /bot khong duoc chi tien/
  );
});

test("GAY khi hai module khai cung mot duong", () => {
  const tam = thuMucTam();
  const chung = { mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1", canCong: [] };
  const duong = [{ method: "GET", path: "/api/thu", tay: () => ({ ma: 200, than: {} }) }];
  assert.throws(
    () => taoKhung({
      cong: congGia(tam), toKhais: [
        { ...chung, id: "mot", ten: "Mot", duong },
        { ...chung, id: "hai", ten: "Hai", duong }
      ]
    }),
    /bi khai hai lan/
  );
});

test("GAY khi module xin cong ma khung khong co", () => {
  assert.throws(
    () => taoKhung({
      cong: { nhatKy: taoNhatKyGia() },
      toKhais: [{ id: "mot", ten: "Mot", mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1", canCong: ["kho"] }]
    }),
    /xin cong "kho" nhung khung khong co/
  );
});

test("GAY khi module phat su kien no khong khai", () => {
  const tam = thuMucTam();
  let batDuoc = null;
  const khung = taoKhung({
    cong: congGia(tam),
    toKhais: [{
      id: "mot", ten: "Mot", mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1",
      canCong: ["bus"],
      suKien: { phat: ["mot.viec-a"] },
      duong: [{
        method: "GET", path: "/api/phat-bua",
        tay: (ctx) => { try { ctx.bus.phat("mot.viec-la", {}); } catch (e) { batDuoc = e.message; } return { ma: 200, than: {} }; }
      }]
    }]
  });
  return khung.xuLy({ method: "GET", duong: "/api/phat-bua", truyVan: {}, tieuDe: {} }).then(() => {
    assert.match(batDuoc ?? "", /khong khai trong suKien\.phat/);
  });
});

test("GAY khi module xin dich vu cua module dang tat", () => {
  const tam = thuMucTam();
  assert.throws(
    () => taoKhung({
      cong: congGia(tam),
      toKhais: [{
        id: "mot", ten: "Mot", mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1",
        canDichVu: ["hai.docDon"]
      }]
    }),
    /xin dich vu "hai\.docDon"/
  );
});

test("dich vu noi duoc ca khi nguoi cap nap SAU nguoi xin", async () => {
  const tam = thuMucTam();
  const khung = taoKhung({
    cong: congGia(tam),
    toKhais: [
      {
        id: "mot", ten: "Mot", mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1",
        canDichVu: ["hai.docDon"],
        duong: [{ method: "GET", path: "/api/hoi", tay: async (ctx) => ({ ma: 200, than: await ctx.dichVu.hai.docDon("D1") }) }]
      },
      {
        id: "hai", ten: "Hai", mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1",
        capDichVu: { "hai.docDon": (ctx, ma) => ({ ma, chu: `don ${ma} cua ${ctx.id}` }) }
      }
    ]
  });
  const ra = await khung.xuLy({ method: "GET", duong: "/api/hoi", truyVan: {}, tieuDe: {} });
  assert.deepEqual(ra.than, { ma: "D1", chu: "don D1 cua hai" });
});

test("khung tra 404 cho duong la, 405 khi sai phuong thuc", async () => {
  const tam = thuMucTam();
  const khung = taoKhung({
    cong: congGia(tam),
    toKhais: [{
      id: "mot", ten: "Mot", mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1",
      duong: [{ method: "GET", path: "/api/co", tay: () => ({ ma: 200, than: { ok: true } }) }]
    }]
  });
  assert.equal((await khung.xuLy({ method: "GET", duong: "/api/khong", truyVan: {}, tieuDe: {} })).ma, 404);
  assert.equal((await khung.xuLy({ method: "POST", duong: "/api/co", truyVan: {}, tieuDe: {} })).ma, 405);
});

test("module hong khong keo sap khung — tra 500, ghi nhat ky", async () => {
  const tam = thuMucTam();
  const nhatKy = taoNhatKyGia();
  const khung = taoKhung({
    cong: { ...congGia(tam), nhatKy }, nhatKy,
    toKhais: [{
      id: "mot", ten: "Mot", mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1",
      duong: [{ method: "GET", path: "/api/no", tay: () => { throw new Error("vo"); } }]
    }]
  });
  const ra = await khung.xuLy({ method: "GET", duong: "/api/no", truyVan: {}, tieuDe: {} });
  assert.equal(ra.ma, 500);
  assert.ok(nhatKy.dong.some((d) => d.noiDung.includes("vo")));
});

test("dem duoc con bao nhieu tep chua tach", () => {
  const con = demChuaTach(THU_MUC_MODULES);
  assert.ok(Object.keys(con).length >= 1);
  for (const [id, so] of Object.entries(con)) assert.ok(Number.isInteger(so), `${id} phai dem duoc`);
});
