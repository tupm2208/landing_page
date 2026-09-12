// MANH CONG TAC VIEN — dang nhap, duyet thiet bi, tai anh.
//
// Phan lon bo bai nay la BAI CHAN: day la mot cua dang nhap cho NGUOI NGOAI shop, nen cho de
// mat nhat la cho nay.
//
// Can MySQL thu o cong 3307. CONG 3306 LA DU LIEU THAT CUA LANDING, CAM DUNG.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { taoKhung } = require("../loi/khung");
const { taoKhoMysql } = require("../loi/cong/kho-mysql");
const { taoBoDemGoi } = require("../loi/cong/han-goi");
const { taoNhatKyGia, taoGioGia } = require("../loi/cong/co-ban");
const { taoCongQuyen } = require("../loi/cong/quyen");
const { bam, soi } = require("../modules/ctv/mat-khau");
const toKhaiCtv = require("../modules/ctv/module");
const toKhaiKho = require("../modules/hang-kho/module");

const MA_QT = "ma-quan-tri";
const BI_MAT = "bi-mat-phien-ctv-that-dai";
const DUONG = String(process.env.TOPRUN_MYSQL_URL || "").trim();
const boQua = DUONG ? {} : { skip: "chua dat TOPRUN_MYSQL_URL — bo qua bo bai CTV" };
if (DUONG && /:3306\//.test(DUONG)) throw new Error("Cong 3306 la du lieu that cua landing. Dung 3307.");

const MON = {
  code: "CTV001", name: "Giày cho CTV bán", brand: "Nike",
  thumbnailImage: "/assets/products/ctv001.jpg",
  highImage: "/assets/products/ctv001-lon.jpg",
  galleryImages: ["/assets/products/ctv001-2.jpg", "/assets/products/ctv001-2.jpg", "/assets/products/ctv001-3.jpg"],
  sizes: [{ size: "42", qty: 3, price: 2000000, warehouseId: "wh_yen", warehouse: "Yên" }]
};

// ---------- phan khong can MySQL ----------

test("bam mat khau: hinh dang GIU Y NGUYEN cua ban dang chay", async () => {
  const b = await bam("mat-khau-that-dai");
  const [cach, soVong, muoi, khoa] = b.split("$");
  assert.equal(cach, "pbkdf2");
  assert.equal(soVong, "210000", "doi so vong = 6 tai khoan CTV that phai dat lai mat khau");
  assert.ok(muoi.length >= 20);
  assert.ok(khoa.length >= 40);
  assert.equal(await soi("mat-khau-that-dai", b), true);
  assert.equal(await soi("mat-khau-khac", b), false);
});

test("ban bam la rac thi soi tra FALSE, khong nem", async () => {
  for (const rac of ["", "abc", "pbkdf2$", "pbkdf2$0$x$y", "scrypt$1$a$b", null, undefined]) {
    assert.equal(await soi("gi cung duoc", rac), false, `"${rac}" phai ra false`);
  }
});

test("hai lan bam cung mot mat khau ra hai ban khac nhau (co muoi rieng)", async () => {
  const a = await bam("cung-mot-mat-khau");
  const b = await bam("cung-mot-mat-khau");
  assert.notEqual(a, b);
  assert.equal(await soi("cung-mot-mat-khau", a), true);
  assert.equal(await soi("cung-mot-mat-khau", b), true);
});

// ---------- phan can MySQL that ----------

test("Cong tac vien tren MySQL thật", { ...boQua }, async (t) => {
  const nhatKy = taoNhatKyGia();
  const gio = taoGioGia();
  const kho = await taoKhoMysql({ duongKetNoi: DUONG, nhatKy });

  await kho.chayLuocDo("ctv", toKhaiCtv.luocDo);
  await kho.chayLuocDo("hang-kho", toKhaiKho.luocDo);

  const donDep = async () => {
    for (const b of ["ctv_nhat_ky_tai", "ctv_phien", "ctv_thiet_bi", "ctv_tai_khoan",
                     "hang_kho_giu_cho", "hang_kho_bien_the", "hang_kho_mon", "hang_kho_ma_chan"]) {
      await kho.cauLenh(`DELETE FROM \`${b}\``, []);
    }
    gio.troi(16 * 60 * 1000);   // khong dinh han goi 20 lan / 15 phut
  };
  await donDep();
  t.after(async () => { await donDep(); await kho.dong(); });

  const khung = taoKhung({
    cong: { kho, nhatKy, gio, quyen: taoCongQuyen({ maQuanTri: MA_QT }), hanGoi: taoBoDemGoi({ gio }) },
    nhatKy, toKhais: [toKhaiCtv, toKhaiKho],
    cauHinh: { ctv: { biMatPhien: BI_MAT }, "hang-kho": {} }
  });

  const quanTri = { authorization: `Bearer ${MA_QT}` };
  const themCtv = (than) => khung.xuLy({ method: "POST", duong: "/api/admin/ctv", truyVan: {}, tieuDe: quanTri, ip: "1.1.1.1", doc: async () => than });
  const dangNhap = (than, cookie = "") => khung.xuLy({
    method: "POST", duong: "/api/ctv/login", truyVan: {}, ip: "2.2.2.2",
    tieuDe: cookie ? { cookie, "user-agent": "May cua CTV" } : { "user-agent": "May cua CTV" },
    doc: async () => than
  });
  const cookieTu = (ra, ten) => {
    const chu = String(ra.tieuDe?.["Set-Cookie"] || "");
    const m = chu.match(new RegExp(`${ten}=([^;]*)`));
    return m ? `${ten}=${m[1]}` : "";
  };
  const goiCtv = (duong, cookie, truyVan = {}) => khung.xuLy({
    method: "GET", duong, truyVan, ip: "2.2.2.2", tieuDe: cookie ? { cookie } : {}
  });

  await t.test("them CTV: thieu mat khau thi tu choi, mat khau ngan cung tu choi", async () => {
    await donDep();
    assert.equal((await themCtv({ ten: "Đặng Mai", dienThoai: "0356095310" })).than.error, "thieu_mat_khau");
    assert.equal((await themCtv({ ten: "Đặng Mai", dienThoai: "0356095310", matKhau: "ngan" })).than.error, "mat_khau_qua_ngan");
    assert.equal((await themCtv({ ten: "Đặng Mai", dienThoai: "123" })).than.error, "thieu_ten_hoac_dien_thoai");
  });

  await t.test("BAN BAM MAT KHAU khong bao gio ra khoi may", async () => {
    await donDep();
    const ra = await themCtv({ ten: "Đặng Mai", dienThoai: "0356095310", matKhau: "mat-khau-cua-mai" });
    assert.equal(ra.ma, 200);
    const chu = JSON.stringify(ra.than);
    assert.ok(!chu.includes("pbkdf2"), "ban bam lot ra ngoai");
    assert.ok(!chu.includes("mat-khau-cua-mai"), "mat khau ban ro lot ra ngoai");
    assert.equal(ra.than.ctv.coMatKhau, true, "chi noi CO mat khau, khong noi no la gi");

    const ds = await khung.xuLy({ method: "GET", duong: "/api/admin/ctv", truyVan: {}, tieuDe: quanTri });
    assert.ok(!JSON.stringify(ds.than).includes("pbkdf2"), "danh sach cho quan tri cung khong duoc kem ban bam");
  });

  await t.test("MAY LA phai duoc chu shop duyet moi vao duoc", async () => {
    await donDep();
    const them = await themCtv({ ten: "Đặng Mai", dienThoai: "0356095310", matKhau: "mat-khau-cua-mai" });
    const maCtv = them.than.ctv.ma;

    // Lan dau: dung mat khau nhung may la -> 403, va nhan mot ma may de lan sau nhan ra.
    const lan1 = await dangNhap({ login: "0356095310", password: "mat-khau-cua-mai" });
    assert.equal(lan1.ma, 403);
    assert.equal(lan1.than.error, "thiet_bi_cho_duyet");
    const cookieMay = cookieTu(lan1, "toprun_ctv_may");
    assert.ok(cookieMay, "phai tra ve ma may de lan sau doi chieu");

    // Chua duyet thi dang nhap lai van 403 — va KHONG tao them don xin moi.
    const lan2 = await dangNhap({ login: "0356095310", password: "mat-khau-cua-mai" }, cookieMay);
    assert.equal(lan2.ma, 403);
    const dsTb = (await khung.xuLy({ method: "GET", duong: "/api/admin/ctv", truyVan: {}, tieuDe: quanTri })).than.thietBi;
    assert.equal(dsTb.length, 1, "khong duoc sinh mot don xin moi moi lan bam");
    assert.equal(dsTb[0].trangThai, "cho-duyet");
    assert.equal(dsTb[0].maCtv, maCtv);

    // Chu shop duyet -> vao duoc.
    const duyet = await khung.xuLy({
      method: "POST", duong: "/api/admin/ctv/thiet-bi", truyVan: {}, tieuDe: quanTri,
      doc: async () => ({ ma: dsTb[0].ma, viec: "duyet" })
    });
    assert.equal(duyet.ma, 200);
    const lan3 = await dangNhap({ login: "0356095310", password: "mat-khau-cua-mai" }, cookieMay);
    assert.equal(lan3.ma, 200, JSON.stringify(lan3.than));
    assert.equal(lan3.than.ctv.ten, "Đặng Mai");
  });

  await t.test("mat khau sai: cau tu choi GIONG HET truong hop khong co tai khoan", async () => {
    await donDep();
    await themCtv({ ten: "Đặng Mai", dienThoai: "0356095310", matKhau: "mat-khau-cua-mai" });
    const sai = await dangNhap({ login: "0356095310", password: "mat-khau-khac" });
    const khongCo = await dangNhap({ login: "0999999999", password: "mat-khau-nao-do" });
    assert.equal(sai.ma, 401);
    assert.deepEqual(sai.than, khongCo.than, "hai cau tu choi phai giong nhau, keo do duoc danh sach CTV");
  });

  /** Dung mot CTV da duyet may, tra ve cookie phien. */
  async function ctvDaVao() {
    await donDep();
    await themCtv({ ten: "Đặng Mai", dienThoai: "0356095310", matKhau: "mat-khau-cua-mai", choBoLogo: true });
    const lan1 = await dangNhap({ login: "0356095310", password: "mat-khau-cua-mai" });
    const cookieMay = cookieTu(lan1, "toprun_ctv_may");
    const tb = (await khung.xuLy({ method: "GET", duong: "/api/admin/ctv", truyVan: {}, tieuDe: quanTri })).than.thietBi[0];
    await khung.xuLy({ method: "POST", duong: "/api/admin/ctv/thiet-bi", truyVan: {}, tieuDe: quanTri, doc: async () => ({ ma: tb.ma, viec: "duyet" }) });
    const vao = await dangNhap({ login: "0356095310", password: "mat-khau-cua-mai" }, cookieMay);
    return { cookie: `${cookieTu(vao, "toprun_ctv_phien")}; ${cookieMay}`, maCtv: vao.than.ctv.ma, maThietBi: tb.ma };
  }

  await t.test("chua dang nhap thi khong doc duoc gi", async () => {
    await donDep();
    assert.equal((await goiCtv("/api/ctv/me", "")).ma, 401);
    assert.equal((await goiCtv("/api/ctv/anh", "", { ma: "CTV001" })).ma, 401);
    // Cookie tu bia (chu ky sai) cung khong vao duoc.
    assert.equal((await goiCtv("/api/ctv/me", "toprun_ctv_phien=bia.dat")).ma, 401);
  });

  await t.test("CTV tai anh: CHI anh, khong ton kho, khong gia, khong ten kho", async () => {
    const { cookie } = await ctvDaVao();
    await khung.xuLy({ method: "POST", duong: "/api/products", truyVan: {}, tieuDe: quanTri, ip: "1.1.1.1", doc: async () => [MON] });

    const ra = await goiCtv("/api/ctv/anh", cookie, { ma: "CTV001" });
    assert.equal(ra.ma, 200, JSON.stringify(ra.than));
    assert.equal(ra.than.ma, "CTV001");
    assert.ok(ra.than.anh.length >= 3);
    assert.equal(new Set(ra.than.anh).size, ra.than.anh.length, "anh trung phai bi bo");
    assert.equal(ra.than.choBoLogo, true);

    const chu = JSON.stringify(ra.than);
    assert.ok(!chu.includes("wh_yen"), "khong duoc lo ma kho");
    assert.ok(!chu.includes("Yên"), "khong duoc lo ten kho");
    assert.ok(!chu.includes("2000000"), "khong duoc lo gia");
    assert.equal(ra.than.ton, undefined);
  });

  await t.test("moi lan tai anh deu vao NHAT KY (de sau doi chieu duoc)", async () => {
    const { cookie, maCtv } = await ctvDaVao();
    await khung.xuLy({ method: "POST", duong: "/api/products", truyVan: {}, tieuDe: quanTri, ip: "1.1.1.1", doc: async () => [MON] });
    await goiCtv("/api/ctv/anh", cookie, { ma: "CTV001" });
    await goiCtv("/api/ctv/anh", cookie, { ma: "CTV001" });

    const nk = (await khung.xuLy({ method: "GET", duong: "/api/admin/ctv/nhat-ky", truyVan: {}, tieuDe: quanTri })).than.dong;
    assert.equal(nk.length, 2);
    assert.equal(nk[0].maCtv, maCtv);
    assert.equal(nk[0].maHang, "CTV001");
    assert.ok(nk[0].soAnh >= 3);
  });

  await t.test("TAT tai khoan thi phien dang mo HET tac dung ngay", async () => {
    const { cookie, maCtv } = await ctvDaVao();
    assert.equal((await goiCtv("/api/ctv/me", cookie)).ma, 200);

    await themCtv({ ma: maCtv, ten: "Đặng Mai", dienThoai: "0356095310", dangBat: false });
    assert.equal((await goiCtv("/api/ctv/me", cookie)).ma, 401, "tat tai khoan ma ho van vao duoc la mot lo");
  });

  await t.test("CHAN thiet bi thi phien tren chinh may do het tac dung", async () => {
    const { cookie, maThietBi } = await ctvDaVao();
    assert.equal((await goiCtv("/api/ctv/me", cookie)).ma, 200);

    await khung.xuLy({
      method: "POST", duong: "/api/admin/ctv/thiet-bi", truyVan: {}, tieuDe: quanTri,
      doc: async () => ({ ma: maThietBi, viec: "chan" })
    });
    assert.equal((await goiCtv("/api/ctv/me", cookie)).ma, 401);
  });

  await t.test("dang xuat thi phien khong dung lai duoc", async () => {
    const { cookie } = await ctvDaVao();
    const ra = await khung.xuLy({ method: "POST", duong: "/api/ctv/logout", truyVan: {}, ip: "2.2.2.2", tieuDe: { cookie }, doc: async () => ({}) });
    assert.equal(ra.ma, 200);
    assert.match(String(ra.tieuDe["Set-Cookie"]), /Max-Age=0/);
    assert.equal((await goiCtv("/api/ctv/me", cookie)).ma, 401, "phien da xoa thi khong dung lai duoc");
  });

  await t.test("duong quan tri CTV khong mo cho nguoi ngoai", async () => {
    await donDep();
    assert.equal((await khung.xuLy({ method: "GET", duong: "/api/admin/ctv", truyVan: {}, tieuDe: {} })).ma, 401);
    assert.equal((await khung.xuLy({ method: "POST", duong: "/api/admin/ctv", truyVan: {}, tieuDe: {}, doc: async () => ({}) })).ma, 401);
    assert.equal((await khung.xuLy({ method: "GET", duong: "/api/admin/ctv/nhat-ky", truyVan: {}, tieuDe: {} })).ma, 401);
  });

  await t.test("khong co manh Hang hoa thi duong tai anh noi ro, khong nem", async () => {
    // Dung mot khung chi co manh CTV.
    const khungLe = taoKhung({
      cong: { kho, nhatKy, gio, quyen: taoCongQuyen({ maQuanTri: MA_QT }), hanGoi: taoBoDemGoi({ gio }) },
      nhatKy, toKhais: [toKhaiCtv], cauHinh: { ctv: { biMatPhien: BI_MAT } }
    });
    await donDep();
    const them = await khungLe.xuLy({ method: "POST", duong: "/api/admin/ctv", truyVan: {}, tieuDe: quanTri, ip: "1.1.1.1", doc: async () => ({ ten: "Mai", dienThoai: "0356095310", matKhau: "mat-khau-cua-mai" }) });
    assert.equal(them.ma, 200);
    const lan1 = await khungLe.xuLy({ method: "POST", duong: "/api/ctv/login", truyVan: {}, ip: "2.2.2.2", tieuDe: {}, doc: async () => ({ login: "0356095310", password: "mat-khau-cua-mai" }) });
    const cookieMay = cookieTu(lan1, "toprun_ctv_may");
    const tb = (await khungLe.xuLy({ method: "GET", duong: "/api/admin/ctv", truyVan: {}, tieuDe: quanTri })).than.thietBi[0];
    await khungLe.xuLy({ method: "POST", duong: "/api/admin/ctv/thiet-bi", truyVan: {}, tieuDe: quanTri, doc: async () => ({ ma: tb.ma, viec: "duyet" }) });
    const vao = await khungLe.xuLy({ method: "POST", duong: "/api/ctv/login", truyVan: {}, ip: "2.2.2.2", tieuDe: { cookie: cookieMay }, doc: async () => ({ login: "0356095310", password: "mat-khau-cua-mai" }) });
    const cookie = `${cookieTu(vao, "toprun_ctv_phien")}; ${cookieMay}`;

    const ra = await khungLe.xuLy({ method: "GET", duong: "/api/ctv/anh", truyVan: { ma: "CTV001" }, ip: "2.2.2.2", tieuDe: { cookie } });
    assert.equal(ra.ma, 503);
    assert.equal(ra.than.error, "chua_bat_manh_hang_hoa");
  });
});
