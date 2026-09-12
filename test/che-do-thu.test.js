// Che do thu — ban thu KHONG duoc lam gi that ra ngoai.
//
// Anh Dung chot 12/09/2026: chay thu bang du lieu that, duoc doc realtime tu Graph API,
// NHUNG khong duoc tra loi khach. Bo bai nay la thu giu loi hua do.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { bocCheDoThu, BiChanOCheDoThu } = require("../loi/cong/che-do-thu");
const { taoKhung } = require("../loi/khung");
const { taoKhoTep } = require("../loi/cong/kho-tep");
const { taoNhatKyGia, taoGioGia } = require("../loi/cong/co-ban");
const { taoCongQuyen } = require("../loi/cong/quyen");
const { taoBoDemGoi } = require("../loi/cong/han-goi");
const mHopThu = require("../modules/hop-thu/module");
const mVanChuyen = require("../modules/van-chuyen/module");

const MA_QT = "ma-quan-tri";
const tam = () => fs.mkdtempSync(path.join(os.tmpdir(), "thu-"));

function dungCong({ traLoiThat } = {}) {
  const nhatKy = taoNhatKyGia();
  const daGoiThat = [];
  const that = {
    async goi(url, tuyChon = {}) {
      daGoiThat.push({ url: String(url), tuyChon });
      return traLoiThat ?? { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => "" };
    }
  };
  return { cong: bocCheDoThu({ httpNgoaiThat: that, nhatKy }), nhatKy, daGoiThat };
}

test("CHAN gui tin cho khach — day la loi hua quan trong nhat", async () => {
  const { cong, daGoiThat } = dungCong();
  await assert.rejects(
    () => cong.goi("https://graph.facebook.com/v21.0/me/messages?access_token=x", {
      method: "POST", body: JSON.stringify({ recipient: { id: "khach-1" }, message: { text: "xin chào" } })
    }),
    (e) => e instanceof BiChanOCheDoThu && /gui tin cho khach/.test(e.viec)
  );
  assert.equal(daGoiThat.length, 0, "khong duoc goi ra ngoai mot lan nao");
});

test("CHO QUA doc du lieu tu Meta — anh cho phep lay realtime", async () => {
  const { cong, daGoiThat } = dungCong();
  const tl = await cong.goi("https://graph.facebook.com/v21.0/me?fields=id,name&access_token=x");
  assert.equal(tl.ok, true);
  assert.equal(daGoiThat.length, 1, "doc thi duoc di that");
});

test("CHAN gui Telegram, CHAN tao van don SPX va Viettel Post", async () => {
  const { cong, daGoiThat } = dungCong();
  for (const url of [
    "https://api.telegram.org/bot123/sendMessage",
    "https://spx.vn/open/api/v1/order/create_order",
    "https://partner.viettelpost.vn/v2/order/createOrderNlp"
  ]) {
    await assert.rejects(() => cong.goi(url, { method: "POST", body: "{}" }), (e) => e.cheDoThu === true);
  }
  assert.equal(daGoiThat.length, 0);
});

test("CHAN THEO MAC DINH: dich la hoan toan moi cung bi chan", async () => {
  const { cong, daGoiThat } = dungCong();
  await assert.rejects(
    () => cong.goi("https://mot-doi-tac-moi-nao-do.vn/api/gui", { method: "POST" }),
    (e) => e.cheDoThu === true && /mot-doi-tac-moi-nao-do\.vn/.test(e.viec)
  );
  assert.equal(daGoiThat.length, 0, "them doi tac moi ma quen khai thi bi chan, khong lo ra ngoai");
});

test("POST toi Graph API (khong phai gui tin) cung bi chan — chan theo mac dinh", async () => {
  const { cong } = dungCong();
  await assert.rejects(() => cong.goi("https://graph.facebook.com/v21.0/me/photos", { method: "POST" }),
    (e) => e.cheDoThu === true);
});

test("KHONG BAO GIO IM LANG: bi chan thi nem, khong tra ve ok", async () => {
  const { cong } = dungCong();
  let tl = null;
  try { tl = await cong.goi("https://api.telegram.org/bot1/sendMessage", { method: "POST" }); } catch { /* dung */ }
  assert.equal(tl, null, "tra ve ok la bo nao tuong da gui duoc — nhat ky thanh ra noi doi");
});

test("ghi lai DA CHAN nhung gi, de doi chieu voi ban that", async () => {
  const { cong, nhatKy } = dungCong();
  await assert.rejects(() => cong.goi("https://api.telegram.org/bot1/sendMessage", { method: "POST", body: '{"text":"co tien"}' }));
  assert.equal(cong.daChan.length, 1);
  assert.match(cong.daChan[0].viec, /Telegram/);
  assert.match(cong.daChan[0].than, /co tien/);
  assert.ok(nhatKy.dong.some((d) => /CHAN/.test(d.noiDung)), "phai ghi nhat ky");
});

// ---------- cam vao khung that ----------

test("bo nao nho gui tin: o che do thu thi tra 502 va KHONG gui", async () => {
  const gio = taoGioGia();
  const nhatKy = taoNhatKyGia();
  const daGoiThat = [];
  const cong = bocCheDoThu({
    httpNgoaiThat: { async goi(url, t) { daGoiThat.push(String(url)); return { ok: true, status: 200, json: async () => ({}), text: async () => "" }; } },
    nhatKy
  });

  const khung = taoKhung({
    cong: {
      kho: taoKhoTep({ thuMuc: tam() }), nhatKy, gio, httpNgoai: cong,
      quyen: taoCongQuyen({ maQuanTri: MA_QT }), hanGoi: taoBoDemGoi({ gio })
    },
    nhatKy, toKhais: [mHopThu],
    cauHinh: { "hop-thu": { verifyToken: "v", appSecret: "s", tokenTrang: "tk" } }
  });

  const ra = await khung.xuLy({
    method: "POST", duong: "/api/hop-thu/gui", truyVan: {}, ip: "1.1.1.1",
    tieuDe: { authorization: `Bearer ${MA_QT}` },
    doc: async () => ({ nguoi: "khach-1", chu: "Dạ còn size 42 anh nhé" })
  });

  assert.equal(ra.ma, 502, "khong gui duoc thi phai noi ro, khong bao thanh cong");
  assert.match(ra.than.message, /Chế độ thử/);
  assert.equal(daGoiThat.length, 0, "KHONG mot loi goi that nao toi Meta");
});

test("tao van don: o che do thu thi khong tao that", async () => {
  const gio = taoGioGia();
  const nhatKy = taoNhatKyGia();
  const daGoiThat = [];
  const cong = bocCheDoThu({
    httpNgoaiThat: { async goi(url) { daGoiThat.push(String(url)); return { ok: true, status: 200, json: async () => ({ ret_code: 0 }), text: async () => "" }; } },
    nhatKy
  });

  const khung = taoKhung({
    cong: {
      kho: taoKhoTep({ thuMuc: tam() }), nhatKy, gio, httpNgoai: cong,
      quyen: taoCongQuyen({ maQuanTri: MA_QT }), hanGoi: taoBoDemGoi({ gio })
    },
    nhatKy, toKhais: [mVanChuyen],
    cauHinh: { "van-chuyen": { hangMacDinh: "spx", spx: { appId: "a", appSecret: "b", userId: "1", userSecret: "c" } } }
  });

  const ra = await khung.xuLy({
    method: "POST", duong: "/api/van-chuyen/tao", truyVan: {}, ip: "1.1.1.1",
    tieuDe: { authorization: `Bearer ${MA_QT}` },
    doc: async () => ({
      maPhieu: "ORD-thu",
      nguoiGui: { ten: "Shop", dienThoai: "0900000000", tinh: "Hà Nội", huyen: "Quận Ba Đình", xa: "Phường Giảng Võ", diaChiChiTiet: "1" },
      nguoiNhan: { ten: "Khách", dienThoai: "0911111111", tinh: "Hà Nội", huyen: "Quận Ba Đình", xa: "Phường Điện Biên", diaChiChiTiet: "2" },
      mon: [{ ten: "Giày", soLuong: 1, donGia: 100000, canNangKg: 0.75 }]
    })
  });

  assert.notEqual(ra.ma, 200, "khong duoc tao van don that o che do thu");
  assert.equal(daGoiThat.length, 0);
});
