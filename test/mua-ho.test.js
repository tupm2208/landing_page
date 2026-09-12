// Module Mua ho — cong doi tac. Chay tren MySQL that.
//
// Trong tam la bon luat, va bai nao cung phai chung minh duoc chung:
//   1. chua dang nhap thi CHI thay man dang nhap — khong mot mau thong tin nao
//   2. bao het hang khoa theo MA DONG, khong theo vi tri dong (su co 10/09)
//   3. gui lai cung mot lenh thi khong ghi hai lan
//   4. gia von la cua shop

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { taoKhung } = require("../loi/khung");
const { taoKhoMysql } = require("../loi/cong/kho-mysql");
const { taoNhatKyGia, taoGioGia, taoHttpNgoaiGia } = require("../loi/cong/co-ban");
const { taoCongQuyen } = require("../loi/cong/quyen");
const { taoBoDemGoi } = require("../loi/cong/han-goi");
const { taoPhienCookie } = require("../../chung/cookie");
const mHangKho = require("../modules/hang-kho/module");
const mDon = require("../modules/don-khach/module");
const mMuaHo = require("../modules/mua-ho/module");

const MA_QT = "ma-quan-tri";
const BI_MAT = "bi-mat-phien-doi-tac-dai";
const MA_CONG = "link-rieng-cua-doi-tac-A";
const DUONG = String(process.env.TOPRUN_MYSQL_URL || "").trim();
const boQua = DUONG ? {} : { skip: "chưa đặt TOPRUN_MYSQL_URL — bỏ qua bài mua hộ" };
if (DUONG && /:3306\//.test(DUONG)) throw new Error("Cổng 3306 là dữ liệu thật của landing. Dùng 3307.");

const MON = {
  code: "DV1234", name: "Giày chạy Nike Pegasus 40", listPrice: 3500000,
  sizes: [{ size: "42", qty: 5, price: 2890000, warehouseId: "wh_yen" }]
};
const DON_MAU = {
  customerName: "Nguyễn Văn A", phone: "0911111111",
  province: "Hà Nội", district: "Quận Ba Đình", ward: "Phường Giảng Võ", addressDetail: "12 Đội Cấn",
  items: [{ productCode: "DV1234", size: "42", qty: 1 }]
};

// ---------- phien cookie: khong can MySQL ----------

test("phien het han thi khong doc duoc nua", () => {
  const gio = taoGioGia();
  const p = taoPhienCookie({ ten: "thu", biMat: BI_MAT, gio, songGio: 12 });
  const cookie = p.tao({ maCong: MA_CONG });
  const yc = { tieuDe: { cookie: `thu=${encodeURIComponent(cookie)}` } };
  assert.equal(p.doc(yc).maCong, MA_CONG);

  gio.troi(12 * 60 * 60 * 1000 + 1000);
  assert.equal(p.doc(yc), null, "qua 12 gio thi phien chet");
});

test("phien bi sua mot ky tu thi truot", () => {
  const gio = taoGioGia();
  const p = taoPhienCookie({ ten: "thu", biMat: BI_MAT, gio });
  const cookie = p.tao({ maCong: MA_CONG });
  const gia = cookie.slice(0, -1) + (cookie.endsWith("A") ? "B" : "A");
  assert.equal(p.doc({ tieuDe: { cookie: `thu=${encodeURIComponent(gia)}` } }), null);
});

test("phien ky bang bi mat KHAC thi khong doc duoc", () => {
  const gio = taoGioGia();
  const that = taoPhienCookie({ ten: "thu", biMat: BI_MAT, gio });
  const gia = taoPhienCookie({ ten: "thu", biMat: "bi-mat-cua-ke-gia-dai-hon", gio });
  const cookie = gia.tao({ maCong: MA_CONG });
  assert.equal(that.doc({ tieuDe: { cookie: `thu=${encodeURIComponent(cookie)}` } }), null);
});

test("cookie phai la HttpOnly va SameSite — khong cho mã trang doc trom", () => {
  const p = taoPhienCookie({ ten: "thu", biMat: BI_MAT, gio: taoGioGia() });
  const dat = p.tieuDeDat({ maCong: MA_CONG })["Set-Cookie"];
  assert.match(dat, /HttpOnly/);
  assert.match(dat, /SameSite=Lax/);
  assert.ok(!/Secure/.test(dat), "chay HTTP thi khong dat Secure, neu khong trinh duyet bo cookie");
  const https = taoPhienCookie({ ten: "thu", biMat: BI_MAT, gio: taoGioGia(), https: true });
  assert.match(https.tieuDeDat({})["Set-Cookie"], /Secure/);
});

test("bi mat phien qua ngan thi TU CHOI khoi dong", () => {
  assert.throws(() => taoPhienCookie({ ten: "thu", biMat: "ngan", gio: taoGioGia() }), /ít nhất 16 ký tự/);
});

// ---------- chay tren bang that ----------

test("Cổng đối tác trên MySQL thật", { ...boQua }, async (t) => {
  const nhatKy = taoNhatKyGia();
  const gio = taoGioGia();
  const kho = await taoKhoMysql({ duongKetNoi: DUONG, nhatKy });
  await kho.chayLuocDo("hang-kho", mHangKho.luocDo);
  await kho.chayLuocDo("mua-ho", mMuaHo.luocDo);

  const donDep = async () => {
    gio.troi(16 * 60 * 1000);
    for (const b of ["mua_ho_bao_het", "mua_ho_phieu_mua", "mua_ho_doi_tac",
                     "order_status_logs", "order_items", "orders",
                     "hang_kho_giu_cho", "hang_kho_bien_the", "hang_kho_mon", "hang_kho_ma_chan"]) {
      await kho.cauLenh(`DELETE FROM \`${b}\``, []);
    }
  };
  await donDep();
  t.after(async () => { await donDep(); await kho.dong(); });

  const khung = taoKhung({
    cong: {
      kho, nhatKy, gio, httpNgoai: taoHttpNgoaiGia(),
      quyen: taoCongQuyen({ maQuanTri: MA_QT }), hanGoi: taoBoDemGoi({ gio })
    },
    nhatKy, toKhais: [mHangKho, mDon, mMuaHo],
    cauHinh: { "hang-kho": {}, "don-khach": {}, "mua-ho": { biMatPhien: BI_MAT, songGio: 12 } }
  });

  const quanTri = { authorization: `Bearer ${MA_QT}` };
  const goi = (method, duong, { than, cookie, tieuDe } = {}) => khung.xuLy({
    method, duong, truyVan: {}, ip: "1.1.1.1",
    tieuDe: { ...(tieuDe || {}), ...(cookie ? { cookie } : {}) },
    doc: async () => than ?? {}
  });

  const themDoiTac = () => goi("POST", "/api/admin/partners", {
    tieuDe: quanTri, than: { ma: "dt-a", ten: "Đối tác A", maCong: MA_CONG }
  });
  const dangNhap = async () => {
    const ra = await goi("POST", "/api/partner-portal/login", { than: { token: MA_CONG } });
    assert.equal(ra.ma, 200, JSON.stringify(ra.than));
    const dat = ra.tieuDe["Set-Cookie"];
    return `toprun_partner_session=${dat.split("=")[1].split(";")[0]}`;
  };
  const taoDon = async () => {
    await goi("POST", "/api/products", { tieuDe: quanTri, than: [MON] });
    const ra = await goi("POST", "/api/orders", { than: DON_MAU });
    assert.equal(ra.ma, 200, JSON.stringify(ra.than));
    return ra.than.id;
  };

  // ---------- LUAT 1 ----------

  await t.test("CHUA dang nhap: cong khong lo mot mau thong tin nao", async () => {
    await donDep(); await themDoiTac(); await taoDon();

    const ra = await goi("GET", "/api/partner-portal");
    assert.equal(ra.ma, 401);
    const chu = JSON.stringify(ra.than);
    assert.ok(!chu.includes("Đối tác A"), "lo ten doi tac");
    assert.ok(!chu.includes("DV1234"), "lo viec can mua");
    assert.ok(!chu.includes("dt-a"), "lo ma doi tac");
  });

  await t.test("ma cong SAI thi khong vao duoc, va khong noi vi sao sai", async () => {
    await donDep(); await themDoiTac();
    const ra = await goi("POST", "/api/partner-portal/login", { than: { token: "doan-bua" } });
    assert.equal(ra.ma, 401);
    assert.ok(!JSON.stringify(ra.than).includes("Đối tác A"));
  });

  await t.test("doi tac bi TAT thi phien cu khong dung duoc nua", async () => {
    await donDep(); await themDoiTac();
    const cookie = await dangNhap();
    assert.equal((await goi("GET", "/api/partner-portal", { cookie })).ma, 200);

    await goi("POST", "/api/admin/partners", {
      tieuDe: quanTri, than: { ma: "dt-a", ten: "Đối tác A", maCong: MA_CONG, trangThai: "inactive" }
    });
    assert.equal((await goi("GET", "/api/partner-portal", { cookie })).ma, 401, "tat doi tac la cat quyen ngay");
  });

  await t.test("dang nhap roi thi thay viec can mua cua CHINH minh", async () => {
    await donDep(); await themDoiTac();
    const maDon = await taoDon();
    const cookie = await dangNhap();

    const ra = await goi("GET", "/api/partner-portal", { cookie });
    assert.equal(ra.ma, 200);
    assert.equal(ra.than.doiTac.ten, "Đối tác A");
    assert.equal(ra.than.canMua.length, 1);
    assert.equal(ra.than.canMua[0].maDon, maDon);
    assert.equal(ra.than.canMua[0].maMon, "DV1234");
  });

  await t.test("dang xuat thi cookie bi xoa", async () => {
    await donDep(); await themDoiTac();
    const ra = await goi("POST", "/api/partner-portal/logout");
    assert.match(ra.tieuDe["Set-Cookie"], /Max-Age=0/);
  });

  // ---------- LUAT 3 ----------

  await t.test("gui lai CUNG mot lenh thi khong ghi hai lan", async () => {
    await donDep(); await themDoiTac();
    await taoDon();
    const cookie = await dangNhap();
    const viec = (await goi("GET", "/api/partner-portal", { cookie })).than.canMua[0];

    const than = { maDong: viec.maDong, maMon: viec.maMon, size: viec.size, soLuong: 1, giaVon: 2000000, maLenh: "lenh-1" };
    const mot = await goi("POST", "/api/partner-portal/purchases", { cookie, than });
    const hai = await goi("POST", "/api/partner-portal/purchases", { cookie, than });

    assert.equal(mot.than.ok, true);
    assert.equal(hai.than.ok, true);
    assert.equal(hai.than.trungLenh, true, "lan hai phai nhan ra la trung lenh");
    assert.equal(await kho.bang("mua_ho_phieu_mua").dem(), 1, "chi duoc mot phieu");
  });

  await t.test("hai lan bam CUNG luc cung chi ra mot phieu", async () => {
    await donDep(); await themDoiTac(); await taoDon();
    const cookie = await dangNhap();
    const viec = (await goi("GET", "/api/partner-portal", { cookie })).than.canMua[0];
    const than = { maDong: viec.maDong, maMon: viec.maMon, size: viec.size, soLuong: 1, maLenh: "lenh-dua" };

    await Promise.all([
      goi("POST", "/api/partner-portal/purchases", { cookie, than }),
      goi("POST", "/api/partner-portal/purchases", { cookie, than })
    ]);
    assert.equal(await kho.bang("mua_ho_phieu_mua").dem(), 1, "khoa duy nhat phai chan duoc dua ghi");
  });

  await t.test("bao mua roi thi viec do bien khoi danh sach can mua", async () => {
    await donDep(); await themDoiTac(); await taoDon();
    const cookie = await dangNhap();
    const viec = (await goi("GET", "/api/partner-portal", { cookie })).than.canMua[0];
    await goi("POST", "/api/partner-portal/purchases", {
      cookie, than: { maDong: viec.maDong, maMon: viec.maMon, size: viec.size, soLuong: 1, maLenh: "l1" }
    });
    assert.equal((await goi("GET", "/api/partner-portal", { cookie })).than.canMua.length, 0);
  });

  // ---------- LUAT 2: bay 10/09 ----------

  await t.test("bao het hang khoa theo MA DONG — khong dinh sang dong khac", async () => {
    await donDep(); await themDoiTac();
    await goi("POST", "/api/products", { tieuDe: quanTri, than: [MON, { ...MON, code: "AB999", name: "Món khác" }] });
    const ra = await goi("POST", "/api/orders", {
      than: {
        ...DON_MAU,
        items: [{ productCode: "DV1234", size: "42", qty: 1 }, { productCode: "AB999", size: "42", qty: 1 }]
      }
    });
    assert.equal(ra.ma, 200, JSON.stringify(ra.than));
    const cookie = await dangNhap();

    const viec = (await goi("GET", "/api/partner-portal", { cookie })).than.canMua;
    assert.equal(viec.length, 2);

    // Bao het DONG THU HAI.
    await goi("POST", "/api/partner-portal/out-of-stock", {
      cookie, than: { maDong: viec[1].maDong, maMon: viec[1].maMon, size: viec[1].size, lyDo: "hãng hết" }
    });

    const conLai = (await goi("GET", "/api/partner-portal", { cookie })).than.canMua;
    assert.equal(conLai.length, 1);
    assert.equal(conLai[0].maDong, viec[0].maDong, "dong thu nhat KHONG duoc bi danh het");

    const daBao = await kho.bang("mua_ho_bao_het").tim({});
    assert.equal(daBao.length, 1);
    assert.equal(daBao[0].ma_dong, viec[1].maDong, "khoa theo ma dong, khong theo vi tri");
  });

  await t.test("bao het LAI cung mot dong thi cap nhat, khong tao dong thu hai", async () => {
    await donDep(); await themDoiTac(); await taoDon();
    const cookie = await dangNhap();
    const viec = (await goi("GET", "/api/partner-portal", { cookie })).than.canMua[0];

    await goi("POST", "/api/partner-portal/out-of-stock", { cookie, than: { maDong: viec.maDong, lyDo: "lan mot" } });
    await goi("POST", "/api/partner-portal/out-of-stock", { cookie, than: { maDong: viec.maDong, lyDo: "lan hai" } });

    const dong = await kho.bang("mua_ho_bao_het").tim({});
    assert.equal(dong.length, 1);
    assert.equal(dong[0].ly_do, "lan hai");
  });

  await t.test("bao het thi phat len bang tin cho manh khac biet", async () => {
    await donDep(); await themDoiTac(); await taoDon();
    const cookie = await dangNhap();
    const viec = (await goi("GET", "/api/partner-portal", { cookie })).than.canMua[0];
    const nghe = [];
    khung.bus.nghe("hang-kho.het-hang", "bai-thu", (d) => nghe.push(d));

    await goi("POST", "/api/partner-portal/out-of-stock", { cookie, than: { maDong: viec.maDong } });
    await new Promise((r) => setImmediate(r));
    assert.equal(nghe.length, 1);
    assert.equal(nghe[0].maDong, viec.maDong);
  });

  // ---------- LUAT 4 ----------

  await t.test("doi tac bao GIA VON; gia ban cho khach ho khong bao gio thay", async () => {
    await donDep(); await themDoiTac(); await taoDon();
    const cookie = await dangNhap();
    const ra = await goi("GET", "/api/partner-portal", { cookie });
    const chu = JSON.stringify(ra.than);
    assert.ok(!chu.includes("2890000"), `gia ban lot sang cong doi tac: ${chu}`);

    const viec = ra.than.canMua[0];
    await goi("POST", "/api/partner-portal/purchases", {
      cookie, than: { maDong: viec.maDong, soLuong: 1, giaVon: 2000000, maLenh: "l1" }
    });
    const phieu = await kho.bang("mua_ho_phieu_mua").mot({ ma_lenh: "l1" });
    assert.equal(Number(phieu.gia_von), 2000000);
  });

  await t.test("khong co phien thi khong bao mua hay bao het duoc", async () => {
    await donDep(); await themDoiTac(); await taoDon();
    assert.equal((await goi("POST", "/api/partner-portal/purchases", { than: { maDong: "x", soLuong: 1 } })).ma, 401);
    assert.equal((await goi("POST", "/api/partner-portal/out-of-stock", { than: { maDong: "x" } })).ma, 401);
    assert.equal(await kho.bang("mua_ho_phieu_mua").dem(), 0);
    assert.equal(await kho.bang("mua_ho_bao_het").dem(), 0);
  });

  await t.test("danh sach doi tac chi cho quan tri", async () => {
    await donDep(); await themDoiTac();
    assert.equal((await goi("GET", "/api/admin/partners")).ma, 401);
    assert.equal((await goi("GET", "/api/admin/partners", { tieuDe: quanTri })).than.length, 1);
  });
});
