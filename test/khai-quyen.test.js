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
const { taoCongTepTinhGia } = require("../loi/cong/tep-tinh");

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
      httpNgoai: taoHttpNgoaiGia(), quyen: taoCongQuyen({ maQuanTri: MA_QT }),
      tepTinh: taoCongTepTinhGia({})
    },
    toKhais: napToKhais(path.join(__dirname, "..", "modules")),
    cauHinh: { "hop-thu": { verifyToken: "v", appSecret: "s", tokenTrang: "t" }, "hang-kho": {}, "don-khach": {}, "khung-nen-tang": {}, "mua-ho": { biMatPhien: "bi-mat-phien-doi-tac-dai" }, "ctv": { biMatPhien: "bi-mat-phien-ctv-dai" } }
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
  //   - ba duong don cua khach (xem / sua / huy): cung mot cach tu bao ve — dung ma don kem
  //     ma tra cuu. Sua va huy chi mo trong 15 phut dau, va SUA CHI SUA HO SO nguoi nhan:
  //     mon va gia lay tu don da ghi, khong nhan tu than yeu cau.
  //   - phien ban dang chay: chi tra deployId, khong doc du lieu shop; Image Tool doc sau deploy
  //   - noi dung trang: chu tren trang + so tai khoan de khach chuyen tien. Ban nay CHI chua
  //     nhung truong da khai trong khung-nen-tang/noi-dung.js, nen khong the lan ma Telegram
  //     hay khoa nao vao. Ma Telegram doc thang tu cau hinh may, khong qua duong nay.
  //   - mat web (trang chu, ban mobile, trang san pham, link chia se, va duong "/*" bat moi
  //     tep con lai): khach vao web thi chua co ma nao. Chung KHONG doc du lieu khach, chi tra
  //     tep trong `goc/` cua module Gian hang — va cong tep tinh CHO QUA THEO DANH SACH duoi
  //     tep, nen mot tep la lot vao thu muc web cung khong ra duoc. Trang san pham co doc mot
  //     mon, nhung qua dich vu `hang-kho.doc` tra ban cong khai (da bo gia von va ton that).
  //   - bon duong cong tac vien (dang nhap / dang xuat / toi la ai / tai anh): CTV la NGUOI,
  //     ho khong co ma may. Chung tu bao ve bang phien cookie tu ky + mat khau PBKDF2 + luat
  //     "may la phai duoc chu shop duyet". Duong tai anh CHI tra danh sach anh — khong ton kho,
  //     khong gia von, khong ten kho.
  //   - nam duong cong doi tac: doi tac dang nhap bang PHIEN COOKIE chu khong cam ma Bearer,
  //     ma cong quyen hien chi hieu Bearer. Nen chung phai la "cong-khai" va TU kiem phien —
  //     chua co phien la 401 truoc khi doc bat cu gi. Khoang trong nay se dong khi them vai
  //     "doi-tac" va "nhan-vien" vao cong quyen (xem muc no trong KE-HOACH-TACH.md).
  const moCongKhai = ban.filter((d) => d.quyen === "cong-khai").map((d) => `${d.method} ${d.path}`);
  assert.deepEqual(moCongKhai.sort(), [
    "GET /",
    "GET /*",
    "GET /api/content",
    "GET /api/ctv/anh",
    "GET /api/ctv/me",
    "GET /api/facebook/webhook",
    "GET /api/orders/public",
    "GET /api/partner-portal",
    "GET /api/products",
    "GET /api/products/:khoa",
    "GET /api/runtime-version",
    "GET /l/:token",
    "GET /mobile",
    "GET /product.html",
    "GET /product/:khoa",
    "PATCH /api/orders/public",
    "POST /api/ctv/login",
    "POST /api/ctv/logout",
    "POST /api/facebook/webhook",
    "POST /api/orders",
    "POST /api/orders/lookup",
    "POST /api/orders/public/cancel",
    "POST /api/orders/public/payment-choice",
    "POST /api/partner-portal/login",
    "POST /api/partner-portal/logout",
    "POST /api/partner-portal/out-of-stock",
    "POST /api/partner-portal/purchases"
  ]);
});
