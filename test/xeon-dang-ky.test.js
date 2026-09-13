// LANDING DANG KY VOI XEON — bang chinh license key, luc cai va luc dang chay.
//
// Sau khi dang ky: cong quyen soi duoc ve, hop thu day tin sang dung Xeon bang ma nhan tin rieng,
// va man quan tri xem duoc "landing nay la shop nao" ma khong thay ma nhan tin.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const { taoKhung } = require("../loi/khung");
const { taoCongQuyen } = require("../loi/cong/quyen");
const { taoBoDemGoi } = require("../loi/cong/han-goi");
const { taoKhoTep } = require("../loi/cong/kho-tep");
const { taoNhatKyGia, taoGioGia } = require("../loi/cong/co-ban");
const { bocCheDoThu } = require("../loi/cong/che-do-thu");
const { dangKyXeon, docXeon, luuXeon, SO_XEON } = require("../modules/khung-nen-tang/dang-ky-xeon");
const mKhung = require("../modules/khung-nen-tang/module");
const mHopThu = require("../modules/hop-thu/module");
const { dungHe, napTepEnv } = require("../chay");
const { kyVe } = require("../../bo-nao/license/ve-may");
const { sinhKhoaKy } = require("../../bo-nao/license/khoa-ky");

const MA_QT = "ma-quan-tri";
const KEY = "TR-ABCD-EFGH-JKLM-NPQR";
const XEON = "https://xeon.test";
const APP_SECRET = "app-secret-thu";
const tam = () => fs.mkdtempSync(path.join(os.tmpdir(), "xeon-dk-"));

/** Xeon gia: tra khoa cong + ma nhan tin; ghi lai moi loi goi. */
function xeonGia({ khoaKy = sinhKhoaKy(), tuChoi = null } = {}) {
  const daGoi = [];
  return {
    khoaKy, daGoi,
    httpNgoai: {
      async goi(url, tuyChon = {}) {
        daGoi.push({ url: String(url), tuyChon });
        if (String(url) === `${XEON}/license/landing-dang-ky`) {
          const than = JSON.parse(String(tuyChon.body || "{}"));
          if (tuChoi) return { ok: false, status: 403, json: async () => ({ ok: false, viSao: tuChoi }) };
          return { ok: true, status: 200, json: async () => ({ ok: true, shop: "toprun", tenShop: "TopRun", keyId: khoaKy.keyId, khoaCongPem: khoaKy.khoaCongPem, maNhanTin: `nt-${than.key.slice(-4)}-xxxxxxxxxxxxxxxxxxxx`, diaChiXeon: XEON }) };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => "" };
      }
    }
  };
}

test("dangKyXeon: kiem dau vao, goi dung duong, tra ban day du; Xeon tu choi thi nem ro vi sao", async () => {
  const x = xeonGia();
  await assert.rejects(() => dangKyXeon({ httpNgoai: x.httpNgoai, diaChiXeon: "ftp://x", key: KEY, diaChiLanding: "https://shop.vn" }), /Dia chi Xeon/);
  await assert.rejects(() => dangKyXeon({ httpNgoai: x.httpNgoai, diaChiXeon: XEON, key: "sai", diaChiLanding: "https://shop.vn" }), /License key/);
  await assert.rejects(() => dangKyXeon({ httpNgoai: x.httpNgoai, diaChiXeon: XEON, key: KEY, diaChiLanding: "" }), /LANDING_SITE_BASE_URL/);
  assert.equal(x.daGoi.length, 0, "sai dau vao thi khong goi mang");

  const ban = await dangKyXeon({ httpNgoai: x.httpNgoai, diaChiXeon: `${XEON}/`, key: ` ${KEY.toLowerCase()} `, diaChiLanding: "https://shop.vn/" });
  assert.equal(x.daGoi[0].url, `${XEON}/license/landing-dang-ky`);
  assert.deepEqual(JSON.parse(x.daGoi[0].tuyChon.body), { key: KEY, diaChi: "https://shop.vn" });
  assert.equal(ban.shop, "toprun");
  assert.equal(ban.keyId, x.khoaKy.keyId);
  assert.match(ban.maNhanTin, /^nt-/);
  assert.equal(ban.diaChiXeon, XEON);
  assert.equal(ban.key, KEY);

  const tc = xeonGia({ tuChoi: "key_bi_khoa" });
  await assert.rejects(() => dangKyXeon({ httpNgoai: tc.httpNgoai, diaChiXeon: XEON, key: KEY, diaChiLanding: "https://shop.vn" }), /key_bi_khoa/);
});

test("so xeon: ghi roi doc lai; ban gon khong mang ma nhan tin", async () => {
  const kho = taoKhoTep({ thuMuc: tam() });
  assert.equal(await docXeon(kho), null);
  await luuXeon(kho, { key: KEY, shop: "toprun", keyId: "ky-1", khoaCongPem: "PEM", maNhanTin: "nt-bi-mat", diaChiXeon: XEON, diaChiLanding: "https://shop.vn" }, new Date("2026-09-14T00:00:00.000Z"));
  const so = await docXeon(kho);
  assert.equal(so.maNhanTin, "nt-bi-mat");
  assert.equal(so.dangKyLuc, "2026-09-14T00:00:00.000Z");
  const { xeonGon } = require("../modules/khung-nen-tang/dang-ky-xeon");
  assert.ok(!JSON.stringify(xeonGon(so)).includes("nt-bi-mat"));
  assert.ok(!JSON.stringify(xeonGon(so)).includes(KEY));
});

function dungKhung({ httpNgoai, kho = taoKhoTep({ thuMuc: tam() }) }) {
  const gio = taoGioGia();
  const nhatKy = taoNhatKyGia();
  const quyen = taoCongQuyen({ maQuanTri: MA_QT, gio, nhatKy });
  const khung = taoKhung({
    cong: { kho, nhatKy, gio, httpNgoai, quyen, hanGoi: taoBoDemGoi({ gio }) },
    nhatKy, toKhais: [mKhung, mHopThu],
    cauHinh: {
      "khung-nen-tang": { deployId: "thu", diaChiXeon: XEON, diaChiLanding: "https://shop.vn" },
      "hop-thu": { verifyToken: "v", appSecret: APP_SECRET, tokenTrang: "tk" }
    }
  });
  const goi = (method, duong, { ma = MA_QT, than } = {}) => khung.xuLy({
    method, duong, truyVan: {}, ip: "1.1.1.1",
    tieuDe: ma ? { authorization: `Bearer ${ma}` } : {},
    doc: async () => than ?? {}
  });
  return { khung, goi, gio, nhatKy, quyen, kho };
}

function webhookMeta(chu = "còn size 42 không") {
  const goiTin = { object: "page", entry: [{ id: "trang-1", time: 1, messaging: [{ sender: { id: "khach-1" }, recipient: { id: "trang-1" }, timestamp: 1, message: { mid: "m.1", text: chu } }] }] };
  const tho = Buffer.from(JSON.stringify(goiTin), "utf8");
  const chuKy = `sha256=${crypto.createHmac("sha256", APP_SECRET).update(tho).digest("hex")}`;
  return {
    method: "POST", duong: "/api/facebook/webhook", truyVan: {}, ip: "3.3.3.3",
    tieuDe: { "x-hub-signature-256": chuKy },
    tho: async () => tho, doc: async () => goiTin
  };
}

test("vong day du: dang ky qua man quan tri -> cong quyen nhan khoa Xeon -> ve vao duoc -> hop thu day tin sang Xeon bang ma nhan tin rieng", async () => {
  const x = xeonGia();
  const { khung, goi, gio, quyen } = dungKhung({ httpNgoai: x.httpNgoai });

  const truoc = await goi("GET", "/api/admin/xeon");
  assert.equal(truoc.ma, 200);
  assert.equal(truoc.than.xeon, null);
  assert.equal(truoc.than.toi.bang, "khoa-dai-han");

  // Ve truoc khi dang ky: tu choi.
  const t = gio.bayGio().getTime();
  const ve = kyVe({ vai: "quan-tri", shop: "toprun", tenShop: "TopRun", maMay: "may-1-xxxxxxxxxxxxxxxx", tenMay: "may 1", manh: ["hop-thu"], truc: true, phatLuc: t, hetLuc: t + 3600 * 1000 }, x.khoaKy);
  assert.equal((await goi("GET", "/api/admin/xeon", { ma: ve })).ma, 401);

  // Hop thu chua co Xeon: khong day gi.
  assert.equal((await khung.xuLy(webhookMeta())).ma, 200);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(x.daGoi.filter((g) => g.url.endsWith("/tin-den")).length, 0);

  const dk = await goi("POST", "/api/admin/xeon/dang-ky", { than: { key: KEY } });
  assert.equal(dk.ma, 200, JSON.stringify(dk.than));
  assert.equal(dk.than.xeon.shop, "toprun");
  assert.ok(!JSON.stringify(dk.than).includes("nt-"), "khong tra ma nhan tin ra man hinh");
  assert.equal(quyen.daDangKyXeon(), true);

  const sau = await goi("GET", "/api/admin/xeon", { ma: ve });
  assert.equal(sau.ma, 200, "ve vao duoc sau khi dang ky");
  assert.equal(sau.than.toi.bang, "ve-xeon");
  assert.deepEqual(sau.than.toi.manh, ["hop-thu"]);
  assert.equal(sau.than.toi.truc, true);
  assert.equal(sau.than.xeon.diaChiXeon, XEON);

  assert.equal((await khung.xuLy(webhookMeta())).ma, 200);
  await new Promise((r) => setTimeout(r, 20));
  const day = x.daGoi.find((g) => g.url.endsWith("/tin-den"));
  assert.ok(day, "phai day tin sang Xeon");
  assert.equal(day.url, `${XEON}/tin-den`);
  assert.match(day.tuyChon.headers.Authorization, /^Bearer nt-/);
  assert.equal(JSON.parse(day.tuyChon.body).tenant, "toprun");

  // Dang ky lai voi key sai -> 502, ban cu giu nguyen.
  const sai = await goi("POST", "/api/admin/xeon/dang-ky", { than: { key: "sai" } });
  assert.equal(sai.ma, 502);
  assert.equal((await goi("GET", "/api/admin/xeon")).than.xeon.shop, "toprun");
});

test("che do thu: goi toi Xeon cua minh duoc cho qua, dich khac van bi chan", async () => {
  const x = xeonGia();
  const nhatKy = taoNhatKyGia();
  const boc = bocCheDoThu({ httpNgoaiThat: x.httpNgoai, nhatKy, choQuaThem: [{ chu: "Xeon", khop: (url) => String(url).startsWith(`${XEON}/`) }] });
  const tl = await boc.goi(`${XEON}/tin-den`, { method: "POST", body: "{}" });
  assert.equal(tl.ok, true);
  await assert.rejects(() => boc.goi("https://api.telegram.org/bot1/sendMessage", { method: "POST" }), /Chế độ thử/);
});

test("khoi dong that (dungHe): doc .env, dang ky voi Xeon bang LICENSE_KEY, lan sau khong dang ky lai; doi key thi dang ky lai", async () => {
  const thuMuc = tam();
  const tepEnv = path.join(thuMuc, ".env");
  fs.writeFileSync(tepEnv, `LICENSE_KEY="${KEY}"\nXEON_DIA_CHI=${XEON}\nLANDING_SITE_BASE_URL=https://shop.vn\n# ghi chu\nLANDING_ADMIN_TOKEN=${MA_QT}\n`);
  const env = {};
  assert.equal(napTepEnv(tepEnv, env), 4);
  assert.equal(env.LICENSE_KEY, KEY, "bo dau nhay");

  // dungHe dung taoHttpNgoai that de dang ky — chen fetch gia vao globalThis trong luc chay.
  const fetchCu = globalThis.fetch;
  const daGoi = [];
  const khoaKy = sinhKhoaKy();
  globalThis.fetch = async (url, tuyChon = {}) => {
    daGoi.push({ url: String(url), than: JSON.parse(String(tuyChon.body || "{}")) });
    return { ok: true, status: 200, json: async () => ({ ok: true, shop: "toprun", tenShop: "TopRun", keyId: khoaKy.keyId, khoaCongPem: khoaKy.khoaCongPem, maNhanTin: "nt-thu-xxxxxxxxxxxxxxxxxxxx", diaChiXeon: XEON }) };
  };
  try {
    const he1 = await dungHe({ thuMucDuLieu: thuMuc, env: { ...env }, tepEnv: path.join(thuMuc, "khong-co.env") });
    assert.equal(daGoi.length, 1);
    assert.equal(he1.xeon.shop, "toprun");
    assert.equal(he1.cong.quyen.daDangKyXeon(), true);

    const he2 = await dungHe({ thuMucDuLieu: thuMuc, env: { ...env }, tepEnv: path.join(thuMuc, "khong-co.env") });
    assert.equal(daGoi.length, 1, "key khong doi thi khong dang ky lai");
    assert.equal(he2.xeon.keyId, khoaKy.keyId);

    const he3 = await dungHe({ thuMucDuLieu: thuMuc, env: { ...env, LICENSE_KEY: "TR-ZZZZ-ZZZZ-ZZZZ-ZZZZ" }, tepEnv: path.join(thuMuc, "khong-co.env") });
    assert.equal(daGoi.length, 2, "doi key thi dang ky lai");
    assert.equal(daGoi[1].than.key, "TR-ZZZZ-ZZZZ-ZZZZ-ZZZZ");
    assert.equal(he3.xeon.key, "TR-ZZZZ-ZZZZ-ZZZZ-ZZZZ");

    // Khong co key: khoi dong van len, chi bao DANG TAT.
    const he4 = await dungHe({ thuMucDuLieu: tam(), env: {}, tepEnv: path.join(thuMuc, "khong-co.env") });
    assert.equal(he4.xeon, null);
    assert.equal(he4.cong.quyen.daDangKyXeon(), false);
  } finally {
    globalThis.fetch = fetchCu;
  }
});
