// Luat "moi duong phai khai ai duoc goi" — va bai lam no GAY.
//
// Anh Dung chot 12/09/2026. Cai gia phai tra cua luat nay la mot dong thua trong moi to khai;
// cai duoc la KHONG BAO GIO quen kiem quyen nua, va nhin mot bang la thay het cua nao mo cho ai.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { kiemToKhai } = require("../../hop-dong");
const { taoKhung } = require("../loi/khung");
const { napToKhais } = require("../loi/nap-modules");
const { taoKhoTep } = require("../loi/cong/kho-tep");
const { taoNhatKyGia, taoGioGia, taoHttpNgoaiGia } = require("../loi/cong/co-ban");
const { taoCongQuyen } = require("../loi/cong/quyen");

const MA_QT = "ma-quan-tri";
const MA_DV = "ma-dich-vu";

function tam() { return fs.mkdtempSync(path.join(os.tmpdir(), "khai-quyen-")); }

function khungThu(duong) {
  return taoKhung({
    cong: {
      kho: taoKhoTep({ thuMuc: tam() }), nhatKy: taoNhatKyGia(), gio: taoGioGia(),
      httpNgoai: taoHttpNgoaiGia(), quyen: taoCongQuyen({ maQuanTri: MA_QT, maDichVu: MA_DV })
    },
    toKhais: [{ id: "thu", ten: "Thu", mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1", duong }]
  });
}
const veTay = () => ({ ma: 200, than: { ok: true } });
const goi = (duong, ma) => ({ method: "GET", duong, truyVan: {}, tieuDe: ma ? { authorization: `Bearer ${ma}` } : {} });

test("GAY khi mot duong quen khai quyen", () => {
  assert.throws(
    () => kiemToKhai({
      id: "thu", ten: "Thu", mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1",
      duong: [{ method: "GET", path: "/api/quen", tay: veTay }]
    }, "thu"),
    /phai khai `quyen`/
  );
});

test("GAY khi mo cong khai ma khong noi duoc vi sao", () => {
  assert.throws(
    () => kiemToKhai({
      id: "thu", ten: "Thu", mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1",
      duong: [{ method: "GET", path: "/api/mo", quyen: "cong-khai", tay: veTay }]
    }, "thu"),
    /phai co `viSaoCongKhai`/
  );
});

test("GAY khi mo cong khai ma khong khai han goi", () => {
  assert.throws(
    () => kiemToKhai({
      id: "thu", ten: "Thu", mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1",
      duong: [{
        method: "GET", path: "/api/mo", quyen: "cong-khai",
        viSaoCongKhai: "Bai kiem tra: duong gia, khong doc du lieu that.", tay: veTay
      }]
    }, "thu"),
    /PHAI khai `hanGoi`/
  );
});

test("GAY khi han goi khai sai hinh dang", () => {
  const dung = (hanGoi) => kiemToKhai({
    id: "thu", ten: "Thu", mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1",
    duong: [{ method: "GET", path: "/api/rieng", quyen: "quan-tri", hanGoi, tay: veTay }]
  }, "thu");
  assert.throws(() => dung({ soLan: 0, trongMs: 1000 }), /soLan phai la so nguyen duong/);
  assert.throws(() => dung({ soLan: 10 }), /trongMs phai la so nguyen duong/);
  assert.throws(() => dung({ soLan: 1.5, trongMs: 1000 }), /soLan phai la so nguyen duong/);
  assert.doesNotThrow(() => dung({ soLan: 10, trongMs: 1000 }));
});

test("GAY khi khai mot quyen khong co trong giao keo", () => {
  assert.throws(
    () => kiemToKhai({
      id: "thu", ten: "Thu", mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1",
      duong: [{ method: "GET", path: "/api/la", quyen: "ai-cung-duoc", tay: veTay }]
    }, "thu"),
    /phai khai `quyen`/
  );
});

test("duong quan-tri: khong ma thi 401, ma dich vu cung 401, ma quan tri moi qua", async () => {
  const k = khungThu([{ method: "GET", path: "/api/rieng", quyen: "quan-tri", tay: veTay }]);
  assert.equal((await k.xuLy(goi("/api/rieng"))).ma, 401);
  assert.equal((await k.xuLy(goi("/api/rieng", MA_DV))).ma, 401, "bo nao khong duoc vao duong quan tri");
  assert.equal((await k.xuLy(goi("/api/rieng", MA_QT))).ma, 200);
});

test("duong dich-vu: bo nao vao duoc, quan tri cung vao duoc, khong ma thi khong", async () => {
  const k = khungThu([{ method: "GET", path: "/api/bo-nao", quyen: "dich-vu", tay: veTay }]);
  assert.equal((await k.xuLy(goi("/api/bo-nao"))).ma, 401);
  assert.equal((await k.xuLy(goi("/api/bo-nao", MA_DV))).ma, 200);
  assert.equal((await k.xuLy(goi("/api/bo-nao", MA_QT))).ma, 200, "quan tri la cap cao hon");
});

test("ma sai thi khong qua, du dai bang ma that", async () => {
  const k = khungThu([{ method: "GET", path: "/api/rieng", quyen: "quan-tri", tay: veTay }]);
  assert.equal((await k.xuLy(goi("/api/rieng", "ma-quan-TRI"))).ma, 401);
  assert.equal((await k.xuLy(goi("/api/rieng", "x".repeat(MA_QT.length)))).ma, 401);
});

test("ba cach dua ma deu duoc (Desk va Image Tool dang dung ca ba)", async () => {
  const k = khungThu([{ method: "GET", path: "/api/rieng", quyen: "quan-tri", tay: veTay }]);
  const nen = { method: "GET", duong: "/api/rieng", truyVan: {}, tieuDe: {} };
  assert.equal((await k.xuLy({ ...nen, tieuDe: { authorization: `Bearer ${MA_QT}` } })).ma, 200);
  assert.equal((await k.xuLy({ ...nen, tieuDe: { "x-landing-token": MA_QT } })).ma, 200);
  assert.equal((await k.xuLy({ ...nen, truyVan: { token: MA_QT } })).ma, 200);
});

test("khong cau hinh ma nao thi tu choi tat ca (fail-closed)", async () => {
  const khung = taoKhung({
    cong: {
      kho: taoKhoTep({ thuMuc: tam() }), nhatKy: taoNhatKyGia(), gio: taoGioGia(),
      httpNgoai: taoHttpNgoaiGia(), quyen: taoCongQuyen({})
    },
    toKhais: [{
      id: "thu", ten: "Thu", mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1",
      duong: [{ method: "GET", path: "/api/rieng", quyen: "quan-tri", tay: veTay }]
    }]
  });
  assert.equal((await khung.xuLy(goi("/api/rieng", MA_QT))).ma, 401);
});

test("duong cong-khai van vao duoc khi khong co ma", async () => {
  const k = khungThu([{
    method: "GET", path: "/api/mo", quyen: "cong-khai", hanGoi: { soLan: 100, trongMs: 60000 }, 
    viSaoCongKhai: "Bai kiem tra: duong nay khong doc du lieu cua shop.", tay: veTay
  }]);
  assert.equal((await k.xuLy(goi("/api/mo"))).ma, 200);
});

test("bang cua: moi duong that trong repo deu noi ro ai duoc goi", () => {
  const khung = taoKhung({
    cong: {
      kho: taoKhoTep({ thuMuc: tam() }), nhatKy: taoNhatKyGia(), gio: taoGioGia(),
      httpNgoai: taoHttpNgoaiGia(), quyen: taoCongQuyen({ maQuanTri: MA_QT })
    },
    toKhais: napToKhais(path.join(__dirname, "..", "modules")),
    cauHinh: { "hop-thu": { verifyToken: "v", appSecret: "s", tokenTrang: "t" }, "hang-kho": {}, "don-khach": {}, "khung-nen-tang": {} }
  });
  const ban = khung.banDuong();
  assert.ok(ban.length >= 4);
  for (const d of ban) {
    assert.ok(["cong-khai", "dich-vu", "quan-tri"].includes(d.quyen), `${d.method} ${d.path} thieu quyen`);
  }
  // DANH SACH CUA MO — bai nay do moi khi co nguoi mo them mot cua cong khai. Do la CO Y:
  // them mot dong vao day phai la mot quyet dinh co nguoi nhin, khong phai chuyen lang le.
  // Bon cua dang mo, va vi sao:
  //   - hai duong webhook Meta: Meta goi tu may cua ho, tu bao ve bang verify token + chu ky
  //   - hai duong danh muc: web ban hang phai doc duoc; ban tra ra da bo gia von va ton that
  //   - dat hang: khach tren web khong co ma nao; gia lay tu kho chu khong tu than yeu cau,
  //     va phai giu duoc cho ton moi ghi don
  //   - tra don: phai co DUNG ma don kem ma tra cuu; sai mot trong hai la khong thay gi
  //   - phien ban dang chay: chi tra deployId, khong doc du lieu shop; Image Tool doc sau deploy
  const moCongKhai = ban.filter((d) => d.quyen === "cong-khai").map((d) => `${d.method} ${d.path}`);
  assert.deepEqual(moCongKhai.sort(), [
    "GET /api/facebook/webhook",
    "GET /api/products",
    "GET /api/products/:khoa",
    "GET /api/runtime-version",
    "POST /api/facebook/webhook",
    "POST /api/orders",
    "POST /api/orders/lookup"
  ]);
});
