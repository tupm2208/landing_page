// GIAN HANG — mat web. Bo bai nay giu hai loi hua:
//
//   1. Duong "/*" bat moi thu con lai KHONG duoc nuot duong API cua module khac.
//   2. Cong tep tinh chi tra ra tep DA KHAI DUOI, trong dung thu muc cua module — moi duong
//      "..", moi tep an, moi ma may chu lot vao thu muc web deu khong ra duoc.
//
// Phuc vu tep tinh la cho de lo tep nhat, nen phan lon bai o day la bai chan.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { taoKhung } = require("../loi/khung");
const { taoNhatKyGia, taoGioGia } = require("../loi/cong/co-ban");
const { taoBoDemGoi } = require("../loi/cong/han-goi");
const { taoCongTepTinh, taoCongTepTinhGia, docDuong } = require("../loi/cong/tep-tinh");
const { tayNgheHttp } = require("../loi/may-chu");
const mGianHang = require("../modules/gian-hang/module");
const { nhetThe, khoaTuDuong } = require("../modules/gian-hang/og");

const MAT_WEB = {
  "index.html": "<!doctype html><title>TopRun</title><h1>May tinh</h1>",
  "mobile.html": "<!doctype html><title>TopRun mobile</title><h1>Dien thoai</h1>",
  "product.html": "<!doctype html><head><title>San pham</title></head><body>khung</body>",
  "styles.css": "body{color:#111}",
  "app.js": "console.log('web')",
  "assets/toprun-product-1.png": Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  // hai tep KHONG duoc ra: mot ma may chu lot vao thu muc web, va mot ghi chu noi bo
  "server.js": "const biMat = 1;",
  "ghi-chu.md": "# noi bo"
};

function dungKhung({ matWeb = MAT_WEB, cauHinh = {}, monHang = null, themToKhai = [] } = {}) {
  const nhatKy = taoNhatKyGia();
  const tepTinh = taoCongTepTinhGia(
    Object.fromEntries(Object.entries(matWeb).map(([k, v]) => [`gian-hang/goc/${k}`, v]))
  );
  const toKhais = [mGianHang, ...themToKhai];
  if (monHang) {
    toKhais.push({
      id: "hang-kho", ten: "Hang kho gia", mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1",
      capDichVu: { "hang-kho.doc": async () => monHang }
    });
  }
  const khung = taoKhung({
    cong: { tepTinh, nhatKy, gio: taoGioGia(), hanGoi: taoBoDemGoi({ gio: taoGioGia() }) },
    nhatKy, toKhais, cauHinh: { "gian-hang": cauHinh }
  });
  return { khung, nhatKy };
}

const xin = (duong, { ua = "Mozilla/5.0 (Windows NT 10.0)", truyVan = {} } = {}) =>
  ({ method: "GET", duong, truyVan, tieuDe: { "user-agent": ua }, ip: "1.2.3.4" });

// ---------- tra dung trang ----------

test("may tinh vao / thi thay trang chu, dien thoai thi bi day sang /mobile", async () => {
  const { khung } = dungKhung();

  const mayTinh = await khung.xuLy(xin("/"));
  assert.equal(mayTinh.ma, 200);
  assert.equal(mayTinh.tep.kieu, "text/html; charset=utf-8");
  assert.match(mayTinh.tep.duLieu.toString(), /May tinh/);

  const dienThoai = await khung.xuLy(xin("/", { ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile Safari" }));
  assert.equal(dienThoai.ma, 302);
  assert.equal(dienThoai.chuyenHuong, "/mobile");
});

test("dien thoai vao / kem bo loc thi bo loc theo sang /mobile", async () => {
  const { khung } = dungKhung();
  const ra = await khung.xuLy(xin("/", { ua: "Android 14; Mobile Safari", truyVan: { brand: "Nike", size: "42" } }));
  assert.equal(ra.chuyenHuong, "/mobile?brand=Nike&size=42");
});

test("tra tep tinh kem kieu noi dung va han nho dem", async () => {
  const { khung } = dungKhung();

  const css = await khung.xuLy(xin("/styles.css"));
  assert.equal(css.ma, 200);
  assert.equal(css.tep.kieu, "text/css; charset=utf-8");
  assert.match(css.tieuDe["Cache-Control"], /max-age=3600/);

  const anh = await khung.xuLy(xin("/assets/toprun-product-1.png"));
  assert.equal(anh.ma, 200);
  assert.equal(anh.tep.kieu, "image/png");
  assert.match(anh.tieuDe["Cache-Control"], /max-age=604800/);

  const html = await khung.xuLy(xin("/mobile"));
  assert.equal(html.tieuDe["Cache-Control"], "no-cache", "HTML phai hoi lai moi lan, keo deploy xong khach van thay ban cu");
});

// ---------- bai chan ----------

test("CHAN ma may chu du no nam ngay trong thu muc web", async () => {
  const { khung } = dungKhung();
  const ra = await khung.xuLy(xin("/server.js"));
  assert.equal(ra.ma, 404, "server.js co trong thu muc web ma van khong duoc tra ra");
});

test("CHAN duoi tep khong khai — chan theo mac dinh", async () => {
  const { khung } = dungKhung();
  assert.equal((await khung.xuLy(xin("/ghi-chu.md"))).ma, 404);
});

test("CHAN duong di ra ngoai thu muc: .., duong ma hoa, tep an", () => {
  for (const duong of [
    "/../chay.js", "/goc/../../chay.js", "/%2e%2e/%2e%2e/chay.js",
    "/.env", "/a/.env", "/data/khach.json", "/node_modules/x/index.js"
  ]) {
    assert.equal(docDuong(duong), null, `duong "${duong}" phai bi tu choi`);
  }
});

test("cong tep tinh THAT: doc duoc tep trong khu, khong ra duoc ngoai khu", async () => {
  const tam = fs.mkdtempSync(path.join(os.tmpdir(), "tep-tinh-"));
  fs.mkdirSync(path.join(tam, "gian-hang", "goc"), { recursive: true });
  fs.writeFileSync(path.join(tam, "gian-hang", "goc", "index.html"), "<title>that</title>");
  fs.writeFileSync(path.join(tam, "bi-mat.js"), "const token = 1;");

  const khu = taoCongTepTinh({ thuMucGoc: tam }).mo("gian-hang/goc");
  assert.match((await khu.doc("/index.html")).duLieu.toString(), /that/);
  assert.equal(await khu.doc("/../../bi-mat.js"), null);
  assert.equal(await khu.co("/index.html"), true);
  assert.equal(await khu.co("/khong-co.html"), false);

  assert.throws(() => taoCongTepTinh({ thuMucGoc: tam }).mo("../.."), /nam ngoai thu muc goc/);
});

// ---------- duong "*" khong duoc nuot duong API ----------

test("duong bat-tat-ca KHONG nuot duong API cua module khac, du nap truoc", async () => {
  const apiGia = {
    id: "hang-kho-api", ten: "API gia", mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1",
    duong: [{
      method: "GET", path: "/api/products", quyen: "cong-khai",
      viSaoCongKhai: "Bai kiem tra: duong gia de xem ai nhan duoc yeu cau nay.",
      hanGoi: { soLan: 100, trongMs: 60000 },
      tay: async () => ({ ma: 200, than: { ok: true, tu: "hang-kho" } })
    }]
  };
  // Gian hang nap TRUOC — neu bo dinh tuyen xet theo thu tu nap thi no se thang.
  const { khung } = dungKhung({ themToKhai: [apiGia] });
  const ra = await khung.xuLy(xin("/api/products"));
  assert.equal(ra.ma, 200);
  assert.deepEqual(ra.than, { ok: true, tu: "hang-kho" }, "duong API phai ve tay module API, khong phai mat web");
});

test("duong API khong ai nhan thi ra 404, khong tra ve mot tep nao", async () => {
  const { khung } = dungKhung();
  const ra = await khung.xuLy(xin("/api/khong-co"));
  assert.equal(ra.ma, 404);
  assert.equal(ra.tep, undefined);
});

// ---------- the Open Graph ----------

test("trang san pham co san the OG: ten, gia, anh — crawler khong chay JS", async () => {
  const { khung } = dungKhung({
    cauHinh: { gocSite: "https://thu.toprun.site" },
    monHang: {
      code: "JP9192", name: "Nike Pegasus 41", brand: "Nike", slug: "nike-pegasus-41",
      price: 3290000, suggestedPrice: 3290000, status: "active",
      highImage: "assets/toprun-product-1.png", shortDescription: "Giay chay bo em chan"
    }
  });
  const ra = await khung.xuLy(xin("/product/nike-pegasus-41"));
  assert.equal(ra.ma, 200);
  const html = ra.tep.duLieu.toString();
  assert.match(html, /<meta property="og:title" content="Nike Nike Pegasus 41 JP9192 - TopRun">/);
  assert.match(html, /<meta property="product:price:amount" content="3290000">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/thu\.toprun\.site\/assets\/toprun-product-1\.png">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/thu\.toprun\.site\/product\/nike-pegasus-41">/);
  assert.equal(ra.tieuDe["X-Robots-Tag"], undefined);
});

test("khong tim thay mon thi van tra trang nhung dan noindex", async () => {
  const { khung } = dungKhung({
    monHang: null,
    themToKhai: [{
      id: "hang-kho", ten: "Hang kho gia", mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1",
      capDichVu: { "hang-kho.doc": async () => null }
    }]
  });
  const ra = await khung.xuLy(xin("/product/khong-co-ma-nay"));
  assert.equal(ra.ma, 200, "khach bam link cu van phai thay trang, khong phai 404");
  assert.match(ra.tieuDe["X-Robots-Tag"], /noindex/);
});

test("hong duong doc mon thi van tra trang san pham, chi mat the OG", async () => {
  const nhatKy = taoNhatKyGia();
  const tepTinh = taoCongTepTinhGia({ "gian-hang/goc/product.html": "<head><title>San pham</title></head>" });
  const khung = taoKhung({
    cong: { tepTinh, nhatKy, gio: taoGioGia(), hanGoi: taoBoDemGoi({ gio: taoGioGia() }) },
    nhatKy,
    toKhais: [mGianHang, {
      id: "hang-kho", ten: "Hang kho gia", mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1",
      capDichVu: { "hang-kho.doc": async () => { throw new Error("MySQL chet"); } }
    }],
    cauHinh: {}
  });
  const ra = await khung.xuLy(xin("/product/JP9192"));
  assert.equal(ra.ma, 200);
  assert.ok(nhatKy.dong.some((d) => /khong doc duoc mon/.test(d.noiDung)), "phai ghi nhat ky, khong im lang");
});

test("khong co module Hang kho thi trang san pham van chay (mat the OG)", async () => {
  const { khung } = dungKhung();   // khong nap hang-kho
  const ra = await khung.xuLy(xin("/product.html", { truyVan: { p: "JP9192" } }));
  assert.equal(ra.ma, 200);
  assert.match(ra.tep.duLieu.toString(), /og:site_name/);
});

test("khoa tra cuu mon doc duoc ca tu duong dan dep va tu ?p=", () => {
  assert.equal(khoaTuDuong({ duong: "/product/nike-pegasus-41" }), "nike-pegasus-41");
  assert.equal(khoaTuDuong({ duong: "/product.html", truyVan: { p: "JP9192" } }), "JP9192");
  assert.equal(khoaTuDuong({ duong: "/product.html", truyVan: {} }), "");
});

test("the OG phai thoat dau nhay va the HTML trong ten mon", async () => {
  const { html } = await nhetThe({
    mau: "<head><title>x</title></head>",
    mon: { code: "A1", name: 'Giay "xin" <b>nhat</b>', price: 100000, status: "active" },
    khoa: "A1", gocSite: "https://thu.vn", coTep: async () => false
  });
  assert.ok(!/<b>nhat<\/b>/.test(html), "the HTML trong ten mon phai bi thoat");
  assert.match(html, /&quot;xin&quot;/);
});

// ---------- anh o site that ----------

test("anh thieu: khai gocAnhThat thi 302 sang site that, khong khai thi 404", async () => {
  const coKhai = dungKhung({ cauHinh: { gocAnhThat: "https://toprun.site" } });
  const ra = await coKhai.khung.xuLy(xin("/assets/products/JP9192/1.webp"));
  assert.equal(ra.ma, 302);
  assert.equal(ra.chuyenHuong, "https://toprun.site/assets/products/JP9192/1.webp");

  const khongKhai = dungKhung();
  assert.equal((await khongKhai.khung.xuLy(xin("/assets/products/JP9192/1.webp"))).ma, 404);
});

test("KHONG duoc thanh cua chuyen huong mo: chi duong anh trong /assets/ moi duoc day di", async () => {
  const { khung } = dungKhung({ cauHinh: { gocAnhThat: "https://toprun.site" } });
  for (const duong of ["/khong-phai-anh.html", "/assets/../bi-mat.js", "/assets/x.md", "/data/khach.json"]) {
    const ra = await khung.xuLy(xin(duong));
    assert.notEqual(ra.ma, 302, `duong "${duong}" khong duoc chuyen huong di dau ca`);
  }
});

// ---------- HEAD ----------

test("HEAD tra dung tieu de cua GET nhung khong tra than", async () => {
  const { khung } = dungKhung();
  const tay = tayNgheHttp(khung);
  const daGhi = { ma: 0, tieuDe: null, than: [] };
  const traLoiGia = {
    writeHead(ma, tieuDe) { daGhi.ma = ma; daGhi.tieuDe = tieuDe; },
    end(than) { if (than) daGhi.than.push(than); }
  };
  await tay(
    { method: "HEAD", url: "/styles.css", headers: { host: "localhost" }, socket: { remoteAddress: "1.2.3.4" }, on() {} },
    traLoiGia
  );
  assert.equal(daGhi.ma, 200);
  assert.equal(daGhi.tieuDe["Content-Type"], "text/css; charset=utf-8");
  assert.equal(daGhi.tieuDe["Content-Length"], String(Buffer.byteLength("body{color:#111}")));
  assert.equal(daGhi.than.length, 0, "HEAD khong duoc tra than");
});

// ---------- link chia se ----------

test("link chia se /l/<token> 302 ve bo loc, token rac thi ve trang chu", async () => {
  const { khung } = dungKhung();
  const token = Buffer.from("brand=Nike&size=42&khoa_la=x").toString("base64url");
  const ra = await khung.xuLy(xin(`/l/${token}`));
  assert.equal(ra.ma, 302);
  assert.equal(ra.chuyenHuong, "/?brand=Nike&size=42");
  assert.equal((await khung.xuLy(xin("/l/khong-phai-base64-@@@"))).chuyenHuong, "/");
});
