// LUONG 2 — Zalo / Facebook ca nhan qua OMI (anh Dung chot 14/09/2026).
//
// OMI boc tin -> /api/hop-thu/tin-vao -> hop thu -> bo nao. Bo nao tra loi -> hang cho gui ->
// OMI may truc keo ve -> go -> bao xong. Tin cu hon nguong thi khong tu tra loi.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { taoKhung } = require("../loi/khung");
const { taoKhoTep } = require("../loi/cong/kho-tep");
const { taoNhatKyGia, taoGioGia, taoHttpNgoaiGia } = require("../loi/cong/co-ban");
const { taoCongQuyen } = require("../loi/cong/quyen");
const { taoBoDemGoi } = require("../loi/cong/han-goi");
const mHopThu = require("../modules/hop-thu/module");
const choGui = require("../modules/hop-thu/cho-gui");
const { SU_KIEN } = require("../../hop-dong");
const { kyVe } = require("../../bo-nao/license/ve-may");
const { sinhKhoaKy } = require("../../bo-nao/license/khoa-ky");

const MA_QT = "ma-quan-tri-thu";
const MA_BO_NAO = "ma-bo-nao-thu";
const SHOP = "toprun";
const T0 = "2026-09-14T08:00:00.000Z";

function dungThu() {
  const nhatKy = taoNhatKyGia();
  const gio = taoGioGia(new Date(T0));
  const httpNgoai = taoHttpNgoaiGia(() => ({ ok: true, status: 200, json: async () => ({ ok: true }), text: async () => "" }));
  const kho = taoKhoTep({ thuMuc: fs.mkdtempSync(path.join(os.tmpdir(), "hop-thu-omi-")), nhatKy });
  const khoaKy = sinhKhoaKy();
  const quyen = taoCongQuyen({ maQuanTri: MA_QT, maDichVu: MA_BO_NAO, xeon: { keyId: khoaKy.keyId, khoaCongPem: khoaKy.khoaCongPem, shop: SHOP }, gio, nhatKy });
  const khung = taoKhung({
    cong: { kho, nhatKy, gio, httpNgoai, quyen, hanGoi: taoBoDemGoi({ gio }) },
    nhatKy, toKhais: [mHopThu],
    cauHinh: { "hop-thu": { verifyToken: "v", appSecret: "s", tokenTrang: "tk", boNao: { diaChi: "https://xeon.test", ma: "nt-thu", tenant: SHOP } } }
  });
  const suKien = [];
  khung.bus.nghe(SU_KIEN.tin_nhan_den, "thu", (d) => suKien.push({ ten: "den", d }));
  khung.bus.nghe(SU_KIEN.tin_nhan_di, "thu", (d) => suKien.push({ ten: "di", d }));
  const ve = ({ truc = true, tenMay = "may 1", manh = ["hop-thu"] } = {}) => {
    const t = gio.bayGio().getTime();
    return kyVe({ vai: "quan-tri", shop: SHOP, tenShop: "TopRun", maMay: `may-${tenMay}-xxxxxxxxxxxxxxx`, tenMay, manh, truc, phatLuc: t, hetLuc: t + 7 * 3600 * 1000 }, khoaKy);
  };
  const goi = (method, duong, { ma = MA_QT, than, truyVan = {} } = {}) => khung.xuLy({
    method, duong, truyVan, ip: "1.1.1.1", tieuDe: { authorization: `Bearer ${ma}` }, doc: async () => than ?? {}
  });
  const cho = () => new Promise((r) => setTimeout(r, 15));
  const daDayXeon = () => httpNgoai.daGoi.filter((g) => g.url.endsWith("/tin-den")).map((g) => JSON.parse(g.tuyChon.body));
  return { khung, goi, gio, nhatKy, httpNgoai, kho, suKien, ve, cho, daDayXeon };
}

const TIN = (n = 1, them = {}) => ({ kenh: "zalo", nguoi: "zalo-khach-1", tenNguoi: "Anh Nam", chu: `con size 42 khong ${n}`, maTin: `z-${n}`, luc: T0, ...them });

test("OMI day tin Zalo vao: ghi so, phat su kien, day sang bo nao; trung ma tin bo qua; sai hinh dang dem rieng; kenh la tu choi", async () => {
  const { goi, cho, suKien, daDayXeon } = dungThu();
  const r1 = await goi("POST", "/api/hop-thu/tin-vao", { than: { tin: [TIN(1), TIN(2), TIN(1), { kenh: "zalo", nguoi: "x" }, TIN(3, { kenh: "telegram" })] } });
  assert.equal(r1.ma, 200);
  assert.deepEqual({ daNhan: r1.than.daNhan, trung: r1.than.trung, saiHinhDang: r1.than.saiHinhDang }, { daNhan: 2, trung: 1, saiHinhDang: 2 });
  await cho();
  assert.equal(suKien.filter((s) => s.ten === "den").length, 2);
  assert.equal(daDayXeon().length, 2);
  assert.equal(daDayXeon()[0].kenh, "zalo");
  assert.equal(daDayXeon()[0].maHoiThoai, "zalo:zalo-khach-1");
  assert.equal(daDayXeon()[0].tenant, SHOP);

  // Quet lai man hinh, gui lai cung tin: khong ghi hai lan.
  const r2 = await goi("POST", "/api/hop-thu/tin-vao", { than: TIN(2) });
  assert.equal(r2.than.daNhan, 0);
  assert.equal(r2.than.trung, 1);

  // Hop thu tra ca tin OMI lan tin Meta o cung mot hinh dang.
  const hop = await goi("GET", "/api/facebook/webhook-inbox");
  assert.equal(hop.than.tin.length, 2);
  assert.equal(hop.than.tin[0].kenh, "zalo");
  assert.equal(hop.than.tin[0].tenNguoi, "Anh Nam");
  assert.equal(hop.than.tin[0].daXacMinh, true);
});

test("tin cu hon nguong (mac dinh 24 gio) khong day sang bo nao, van nam trong hop thu; shop chinh nguong duoc", async () => {
  const { goi, cho, gio, nhatKy, daDayXeon } = dungThu();
  gio.troi(30 * 3600 * 1000);
  const r = await goi("POST", "/api/hop-thu/tin-vao", { than: { tin: [TIN(1), TIN(2, { luc: gio.bayGio().toISOString() })] } });
  assert.equal(r.than.daNhan, 2);
  assert.equal(r.than.dayBoNao, 1, "chi tin moi duoc day");
  await cho();
  assert.equal(daDayXeon().length, 1);
  assert.equal(daDayXeon()[0].maTin, "z-2");
  assert.ok(nhatKy.dong.some((d) => /cu 30 gio — khong tu tra loi/.test(d.noiDung)));
  assert.equal((await goi("GET", "/api/facebook/webhook-inbox")).than.tin.length, 2, "tin cu van o hop thu");

  assert.equal((await goi("GET", "/api/hop-thu/cau-hinh")).than.cauHinh.nguongTinCuGio, 24);
  assert.equal((await goi("POST", "/api/hop-thu/cau-hinh", { than: { nguongTinCuGio: 0 } })).ma, 400);
  assert.equal((await goi("POST", "/api/hop-thu/cau-hinh", { than: { nguongTinCuGio: 48 } })).than.cauHinh.nguongTinCuGio, 48);
  const r2 = await goi("POST", "/api/hop-thu/tin-vao", { than: TIN(3) });
  assert.equal(r2.than.dayBoNao, 1, "nguong 48 gio thi tin 30 gio van duoc tra loi");
});

test("bo nao tra loi kenh zalo -> xep hang cho, khong goi ra ngoai; kenh facebook van gui ngay qua Graph", async () => {
  const { goi, httpNgoai, kho } = dungThu();
  const z = await goi("POST", "/api/hop-thu/gui", { ma: MA_BO_NAO, than: { kenh: "zalo", nguoi: "zalo-khach-1", chu: "Dạ còn size 42 ạ" } });
  assert.equal(z.ma, 200, JSON.stringify(z.than));
  assert.equal(z.than.ketQua.xepHang, true);
  assert.match(z.than.ketQua.id, /^cg_/);
  assert.equal(httpNgoai.daGoi.length, 0, "khong goi Graph cho kenh zalo");
  const so = await kho.so(mHopThu.SO_CHO_GUI).doc();
  assert.equal(so.muc.length, 1);
  assert.equal(so.muc[0].nguon, "bo-nao");

  const f = await goi("POST", "/api/hop-thu/gui", { ma: MA_BO_NAO, than: { kenh: "facebook", nguoi: "psid-1", chu: "Dạ" } });
  assert.equal(f.than.ketQua.guiNgay, true);
  assert.equal(httpNgoai.daGoi.length, 1);

  assert.equal((await goi("POST", "/api/hop-thu/gui", { ma: MA_BO_NAO, than: { kenh: "telegram", nguoi: "x", chu: "y" } })).ma, 502);
  assert.equal((await goi("POST", "/api/hop-thu/gui", { ma: MA_BO_NAO, than: { kenh: "zalo", nguoi: "", chu: "y" } })).ma, 502);
});

test("hang cho: chi MAY TRUC keo duoc; nhan la doc quyen 3 phut; bao xong -> da-gui + su kien tin-di; gui hong thu lai 3 lan roi hong", async () => {
  const { goi, gio, ve, suKien } = dungThu();
  for (let i = 1; i <= 3; i += 1) await goi("POST", "/api/hop-thu/gui", { ma: MA_BO_NAO, than: { kenh: "zalo", nguoi: `k${i}`, chu: `tra loi ${i}` } });
  await goi("POST", "/api/hop-thu/gui", { ma: MA_BO_NAO, than: { kenh: "fb-ca-nhan", nguoi: "fb-1", chu: "tra loi fb" } });

  const khongTruc = await goi("POST", "/api/hop-thu/cho-gui/nhan", { ma: ve({ truc: false, tenMay: "may 2" }), than: { kenh: "zalo" } });
  assert.equal(khongTruc.ma, 403);
  assert.equal(khongTruc.than.error, "khong_phai_may_truc");

  const sai = await goi("POST", "/api/hop-thu/cho-gui/nhan", { ma: ve(), than: { kenh: "telegram" } });
  assert.equal(sai.ma, 400);

  const n1 = await goi("POST", "/api/hop-thu/cho-gui/nhan", { ma: ve(), than: { kenh: "zalo", gioiHan: 2 } });
  assert.equal(n1.ma, 200);
  assert.equal(n1.than.tin.length, 2);
  assert.equal(n1.than.nhanSongGiay, 180);
  assert.ok(!("boi" in n1.than.tin[0]));

  // May thu hai (gia su vua duoc dat truc) khong nhan duoc 2 tin do trong 3 phut, chi nhan tin con lai.
  const n2 = await goi("POST", "/api/hop-thu/cho-gui/nhan", { ma: ve({ tenMay: "may 3" }), than: { kenh: "zalo", gioiHan: 10 } });
  assert.equal(n2.than.tin.length, 1);
  assert.equal(n2.than.tin[0].nguoi, "k3");
  assert.equal((await goi("POST", "/api/hop-thu/cho-gui/xong", { ma: ve({ tenMay: "may 3" }), than: { id: n2.than.tin[0].id, ok: true } })).than.trangThai, "da-gui");

  // Bao xong tin 1; tin 2 im lang qua 3 phut thi tro lai hang cho.
  const x1 = await goi("POST", "/api/hop-thu/cho-gui/xong", { ma: ve(), than: { id: n1.than.tin[0].id, ok: true } });
  assert.equal(x1.than.trangThai, "da-gui");
  assert.ok(suKien.some((s) => s.ten === "di" && s.d.nguoi === "k1" && s.d.boi === "toprun:may 1"));
  assert.equal((await goi("POST", "/api/hop-thu/cho-gui/xong", { ma: ve(), than: { id: n1.than.tin[0].id, ok: true } })).ma, 404, "xong hai lan");
  gio.troi(3 * 60 * 1000 + 1000);
  const n3 = await goi("POST", "/api/hop-thu/cho-gui/nhan", { ma: MA_QT, than: { kenh: "zalo" } });
  assert.deepEqual(n3.than.tin.map((t) => t.nguoi), ["k2"], "tin 2 tro lai hang cho; khoa dai han cung keo duoc");

  // Gui hong: thu lai 3 lan roi hong.
  let id = n3.than.tin[0].id;
  for (let lan = 1; lan <= 3; lan += 1) {
    const x = await goi("POST", "/api/hop-thu/cho-gui/xong", { ma: ve(), than: { id, ok: false, loi: `selector truot ${lan}` } });
    assert.equal(x.than.thuLai, lan);
    assert.equal(x.than.trangThai, lan < 3 ? "cho" : "hong");
    if (lan < 3) {
      const n = await goi("POST", "/api/hop-thu/cho-gui/nhan", { ma: ve(), than: { kenh: "zalo" } });
      assert.equal(n.than.tin[0].id, id);
    }
  }
  const ds = await goi("GET", "/api/hop-thu/cho-gui");
  assert.equal(ds.than.tomTat["da-gui"], 2);
  assert.equal(ds.than.tomTat.hong, 1);
  assert.equal(ds.than.tomTat.cho, 1, "tin fb-ca-nhan van cho");
  assert.equal(ds.than.muc.find((m) => m.trangThai === "hong").loi, "selector truot 3");
});

test("cho-gui (ham thuan): qua 12 gio la qua-han; so chi giu 500 muc da xong", () => {
  const so = choGui.soMacDinh();
  const t0 = new Date(T0);
  choGui.xepVao(so, { kenh: "zalo", nguoi: "a", chu: "x" }, t0);
  const sau = new Date(t0.getTime() + 12 * 3600 * 1000 + 1);
  assert.equal(choGui.nhan(so, { kenh: "zalo", boi: "m" }, sau).length, 0);
  assert.equal(choGui.tomTat(so)["qua-han"], 1);

  for (let i = 0; i < 600; i += 1) {
    const m = choGui.xepVao(so, { kenh: "zalo", nguoi: `n${i}`, chu: "x" }, sau);
    choGui.nhan(so, { kenh: "zalo", boi: "m", gioiHan: 1 }, sau);
    choGui.xong(so, { id: m.id, ok: true }, sau);
  }
  choGui.xepVao(so, { kenh: "zalo", nguoi: "cuoi", chu: "x" }, sau);
  assert.equal(so.muc.filter((m) => m.trangThai === "da-gui").length, 500);
  assert.equal(so.muc.filter((m) => m.trangThai === "cho").length, 1, "muc dang cho khong bao gio bi cat");
});

test("nguoi that trong OMI tra loi qua /api/hop-thu/gui thi nguon ghi la omi", async () => {
  const { goi, ve, kho } = dungThu();
  await goi("POST", "/api/hop-thu/gui", { ma: ve(), than: { kenh: "zalo", nguoi: "k1", chu: "nguoi that tra loi" } });
  const so = await kho.so(mHopThu.SO_CHO_GUI).doc();
  assert.equal(so.muc[0].nguon, "omi");
});
