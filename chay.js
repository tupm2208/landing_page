// DIEM KHOI DONG cua server khach.
//
// Day la CHO DUY NHAT doc bien moi truong va quyet dinh dung cong nao. Module khong bao gio
// doc `process.env` — no nhan `ctx.cauHinh`. Nho vay doi tu tep JSON sang MySQL, hay doi
// tu Graph API that sang ban gia, chi sua tep nay.
//
// Bien moi truong doc tu `.env` canh tep nay (bo cai `cong-cu/cai-dat.js` viet ra), bien da
// dat san trong moi truong thi de len tren.

"use strict";

const fs = require("fs");
const path = require("path");
const { taoKhung } = require("./loi/khung");
const { taoMayChu } = require("./loi/may-chu");
const { napToKhais, moduleChuaTach } = require("./loi/nap-modules");
const { taoKhoTep } = require("./loi/cong/kho-tep");
const { taoKhoMysql } = require("./loi/cong/kho-mysql");
const { taoCongQuyen } = require("./loi/cong/quyen");
const { taoNhatKy, gioThat, taoHttpNgoai } = require("./loi/cong/co-ban");
const { taoBoDemGoi } = require("./loi/cong/han-goi");
const { bocCheDoThu } = require("./loi/cong/che-do-thu");
const { taoCongTepTinh } = require("./loi/cong/tep-tinh");
const { dangKyXeon, docXeon, luuXeon, chuanKey, chuanDiaChi } = require("./modules/khung-nen-tang/dang-ky-xeon");

/** Doc `.env` dang KEY=value (bo dong #, bo dau nhay bao quanh). Bien da co trong `env` thang. */
function napTepEnv(tep, env) {
  if (!fs.existsSync(tep)) return 0;
  let so = 0;
  for (const dong of fs.readFileSync(tep, "utf8").split(/\r?\n/)) {
    const d = dong.trim();
    if (!d || d.startsWith("#")) continue;
    const i = d.indexOf("=");
    if (i <= 0) continue;
    const ten = d.slice(0, i).trim();
    let gia = d.slice(i + 1).trim();
    if ((gia.startsWith('"') && gia.endsWith('"')) || (gia.startsWith("'") && gia.endsWith("'"))) gia = gia.slice(1, -1);
    if (env[ten] === undefined) { env[ten] = gia; so += 1; }
  }
  return so;
}

async function dungHe({ thuMucDuLieu, env = process.env, tepEnv = path.join(__dirname, ".env") } = {}) {
  const nhatKy = taoNhatKy();
  const soEnv = napTepEnv(tepEnv, env);
  if (soEnv > 0) nhatKy.tin(`[chay] doc ${soEnv} bien tu ${tepEnv}`);

  // Anh Dung chot 12/09: du lieu khach ve HET MySQL. Duong tep chi con cho may chua co
  // MySQL (chay thu tren may ca nhan) — va no noi ro ra o nhat ky, khong im lang.
  const duongMysql = String(env.TOPRUN_MYSQL_URL || "").trim();
  if (duongMysql && /:3306\//.test(duongMysql)) {
    throw new Error("TOPRUN_MYSQL_URL tro vao cong 3306 — do la du lieu that cua landing dang chay.");
  }
  const kho = duongMysql
    ? await taoKhoMysql({ duongKetNoi: duongMysql, nhatKy })
    : taoKhoTep({ thuMuc: thuMucDuLieu, nhatKy });
  if (!duongMysql) nhatKy.canhBao("[chay] CHUA co TOPRUN_MYSQL_URL — dang chay bang tep JSON, chi dung de thu.");

  const cheDoThat = String(env.CHE_DO_THAT || "").trim() === "1";
  if (!cheDoThat) {
    nhatKy.canhBao("[chay] CHE DO THU: khong gui tin cho khach, khong tao van don that, khong bao Telegram.");
  } else {
    nhatKy.canhBao("[chay] CHE DO THAT: moi loi goi ra ngoai la THAT. Kiem lai truoc khi chay tren du lieu that.");
  }

  const diaChiWeb = String(env.LANDING_SITE_BASE_URL || env.SITE_URL || "").trim().replace(/\/+$/, "");
  const diaChiXeonEnv = chuanDiaChi(env.XEON_DIA_CHI);
  const keyLicense = chuanKey(env.LICENSE_KEY);

  // Xeon la MAY CUA MINH: day tin cho bo nao va dang ky license phai di duoc ke ca o che do thu.
  const httpNgoaiThat = taoHttpNgoai();
  const choQuaThem = diaChiXeonEnv ? [{ chu: "noi voi Xeon cua minh", khop: (url) => String(url).startsWith(`${diaChiXeonEnv}/`) }] : [];

  const quyen = taoCongQuyen({
    // Khoa dai han CO TEN — cong cu noi bo cua TopRun (Desk, Image Tool). Khong bi chan theo manh.
    cacKhoa: [
      { ma: env.LANDING_ADMIN_TOKEN, ten: "quan-tri", vai: "quan-tri" },
      { ma: env.LANDING_ORDERS_TOKEN, ten: "don-hang", vai: "quan-tri" },
      { ma: env.IMAGE_TOOL_TOKEN, ten: "image-tool", vai: "quan-tri" },
      { ma: env.BO_NAO_TOKEN, ten: "bo-nao", vai: "dich-vu" }
    ].filter((k) => String(k.ma || "").trim() !== ""),
    gio: gioThat,
    nhatKy
  });

  const cong = {
    kho,
    nhatKy,
    gio: gioThat,
    // CHE DO THU BAT THEO MAC DINH. Phai khai ro `CHE_DO_THAT=1` moi cho goi that ra ngoai.
    // Anh Dung chot 12/09: ban thu duoc doc realtime tu Graph API nhung KHONG duoc tra loi
    // khach. Mac dinh la "an toan" chu khong phai "tien": quen dat bien thi khong ai bi
    // nhan tin oan.
    httpNgoai: cheDoThat ? httpNgoaiThat : bocCheDoThu({ httpNgoaiThat, nhatKy, choQuaThem }),
    quyen,
    hanGoi: taoBoDemGoi({ gio: gioThat }),
    // Mat web: module chi thay thu muc `goc/` cua chinh no, va chi nhung duoi tep da khai.
    tepTinh: taoCongTepTinh({ thuMucGoc: path.join(__dirname, "modules"), nhatKy })
  };

  const thuMucModules = path.join(__dirname, "modules");
  const bat = String(env.MODULE_BAT || "").trim()
    ? String(env.MODULE_BAT).split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  const khung = taoKhung({
    cong,
    nhatKy,
    // Tren hosting/Cloudflare thi dia chi that nam o tieu de. BAT khi co proxy that o truoc;
    // bat khi KHONG co proxy la de nguoi ta tu khai IP va lach han goi.
    tinProxy: String(env.TIN_PROXY || "").trim() === "1",
    toKhais: napToKhais(thuMucModules, { bat }),
    cauHinh: {
      "hop-thu": {
        verifyToken: String(env.FACEBOOK_VERIFY_TOKEN || "").trim(),
        appSecret: String(env.FACEBOOK_APP_SECRET || "").trim(),
        tokenTrang: String(env.FACEBOOK_PAGE_TOKEN || "").trim()
      },
      "gian-hang": {
        // Goc site that, dung cho the OG (crawler Facebook doc the nay khi khach share link).
        gocSite: diaChiWeb || "https://toprun.site",
        // 33.809 tep anh san pham (7,6 GB) KHONG duoc cop sang ban tach. Khai bien nay thi anh
        // nao khong co o day se duoc 302 sang site that de trinh duyet tu lay — may thu khong
        // goi ra ngoai, no chi chi duong.
        gocAnhThat: String(env.GOC_ANH_THAT || "").trim()
      },
      "cong-bo-nao": {
        // Bot dua khach link ve web: link phai la dia chi cong khai cua shop.
        diaChiWeb
      },
      "tien-doi-soat": {
        // Phan tram coc / phi ship / tien to chuyen khoan: neu co manh Khung nen tang thi
        // module Tien doc tu NOI DUNG TRANG (chu shop sua trong man quan tri). Ba bien duoi
        // day chi la ban lui khi chua co noi dung trang.
        phanTramCoc: Number(env.TIEN_PHAN_TRAM_COC || 0) || undefined,
        phiShipMacDinh: env.TIEN_PHI_SHIP === undefined ? undefined : Number(env.TIEN_PHI_SHIP),
        tienToChuyenKhoan: String(env.TIEN_TIEN_TO_CK || "").trim() || undefined,
        // Bao cho NGUOI BAN HANG (khong phai cho khach). Khong khai thi tat — khong bao bua.
        telegram: {
          token: String(env.TELEGRAM_BOT_TOKEN || "").trim(),
          nhom: String(env.TELEGRAM_CHAT_ID || env.TELEGRAM_ALERT_CHAT_ID || "").trim()
        }
      },
      "mua-ho": {
        // Cong doi tac giu phien bang cookie tu ky (anh Dung chot: "giu phien cookie nhu hien
        // nay"). KHONG co khoa nay thi khong ky duoc phien -> doi tac khong vao duoc cong.
        biMatPhien: String(env.BI_MAT_PHIEN_DOI_TAC || "").trim(),
        songGio: Number(env.PHIEN_DOI_TAC_GIO || 12),
        https: String(env.PHIEN_HTTPS || "").trim() === "1"
      },
      "van-chuyen": {
        hangMacDinh: String(env.VAN_CHUYEN_MAC_DINH || "spx").trim(),
        // Dia chi KHO CUA SHOP — nguoi gui tren moi van don. Thieu thi duong "tao van don tu
        // don" tra ve danh sach thieu gi, chu khong goi hang van chuyen voi dia chi rong.
        nguoiGui: {
          ten: String(env.KHO_TEN || "").trim(),
          dienThoai: String(env.KHO_DIEN_THOAI || "").trim(),
          tinh: String(env.KHO_TINH || "").trim(),
          huyen: String(env.KHO_HUYEN || "").trim(),
          xa: String(env.KHO_XA || "").trim(),
          diaChiChiTiet: String(env.KHO_DIA_CHI || "").trim()
        },
        spx: {
          appId: String(env.SPX_APP_ID || "").trim(),
          appSecret: String(env.SPX_APP_SECRET || "").trim(),
          userId: String(env.SPX_USER_ID || "").trim(),
          userSecret: String(env.SPX_USER_SECRET || "").trim()
        },
        vtp: {
          token: String(env.VTP_TOKEN || "").trim(),
          username: String(env.VTP_USERNAME || "").trim(),
          password: String(env.VTP_PASSWORD || "").trim(),
          groupAddressId: String(env.VTP_GROUP_ADDRESS_ID || "").trim()
        }
      },
      "khung-nen-tang": {
        deployId: String(env.DEPLOY_ID || "").trim() || "chua-dat",
        diaChiXeon: diaChiXeonEnv,
        diaChiLanding: diaChiWeb
      },
      "ctv": {
        // Phien cua cong tac vien cung ky bang khoa nay. Thieu thi khong ky duoc phien ->
        // CTV khong dang nhap duoc (va nhat ky khoi dong noi ro dieu do).
        biMatPhien: String(env.BI_MAT_PHIEN_CTV || env.BI_MAT_PHIEN_DOI_TAC || "").trim(),
        songGio: Number(env.PHIEN_CTV_GIO || 24 * 30),
        https: String(env.PHIEN_HTTPS || "").trim() === "1"
      }
    }
  });

  // Chay luoc do cua tung module truoc khi nhan yeu cau dau tien.
  if (typeof kho.chayLuocDo === "function") {
    for (const tk of napToKhais(thuMucModules, { bat })) {
      if ((tk.luocDo ?? []).length > 0) {
        await kho.chayLuocDo(tk.id, tk.luocDo, { bangKeThua: tk.bangKeThua ?? [] });
      }
    }
  }

  // DANG KY VOI XEON (anh Dung chot 14/09): landing tu khai minh bang license key, nhan ve khoa
  // cong Xeon (de soi ve may cua OMI va ve cua bo nao) va ma nhan tin rieng (de day tin sang bo
  // nao). Da dang ky roi va key khong doi thi dung lai; doi key hay doi Xeon thi dang ky lai.
  let xeon = typeof kho.so === "function" ? await docXeon(kho) : null;
  if (keyLicense && diaChiXeonEnv && (!xeon || xeon.key !== keyLicense || xeon.diaChiXeon !== diaChiXeonEnv)) {
    try {
      const ban = await dangKyXeon({ httpNgoai: httpNgoaiThat, diaChiXeon: diaChiXeonEnv, key: keyLicense, diaChiLanding: diaChiWeb });
      await luuXeon(kho, ban, gioThat.bayGio());
      xeon = { ...ban, dangKyLuc: gioThat.bayGio().toISOString() };
      nhatKy.tin(`[chay] dang ky voi Xeon ${ban.diaChiXeon}: landing nay la shop "${ban.shop}"`);
    } catch (e) {
      nhatKy.canhBao(`[chay] KHONG dang ky duoc voi Xeon: ${e.message}${xeon ? " — dung ban dang ky cu" : ""}`);
    }
  }
  if (xeon) quyen.datXeon({ keyId: xeon.keyId, khoaCongPem: xeon.khoaCongPem, shop: xeon.shop });

  // NOI RO CAI GI DANG TAT. Mot manh thieu khoa thi no im lang khong lam gi — va im lang la
  // thu kho tim nhat: chu shop tuong Telegram hong, doi tac tuong cong sap. Vi vay bao ngay
  // luc khoi dong, mot lan, ro rang.
  const dangTat = [];
  if (!xeon) {
    dangTat.push("OMI vao bang ve may va bo nao tra loi khach (chua dang ky voi Xeon: can LICENSE_KEY + XEON_DIA_CHI + LANDING_SITE_BASE_URL)");
  }
  if (!String(env.TELEGRAM_BOT_TOKEN || "").trim() || !String(env.TELEGRAM_CHAT_ID || env.TELEGRAM_ALERT_CHAT_ID || "").trim()) {
    dangTat.push("bao Telegram cho nguoi ban hang (thieu TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)");
  }
  if (String(env.BI_MAT_PHIEN_DOI_TAC || "").trim().length < 16) {
    dangTat.push("cong doi tac mua ho (thieu BI_MAT_PHIEN_DOI_TAC dai >= 16 ky tu)");
  }
  if (String(env.BI_MAT_PHIEN_CTV || env.BI_MAT_PHIEN_DOI_TAC || "").trim().length < 16) {
    dangTat.push("dang nhap cong tac vien (thieu BI_MAT_PHIEN_CTV dai >= 16 ky tu)");
  }
  if (!String(env.SPX_APP_ID || "").trim() && !String(env.VTP_TOKEN || "").trim()) {
    dangTat.push("tao van don (thieu khoa SPX va Viettel Post)");
  }
  if (!String(env.KHO_TEN || "").trim() || !String(env.KHO_DIEN_THOAI || "").trim()) {
    dangTat.push("tao van don tu don (thieu dia chi kho: KHO_TEN, KHO_DIEN_THOAI, KHO_TINH, KHO_HUYEN, KHO_XA, KHO_DIA_CHI)");
  }
  if (!String(env.FACEBOOK_VERIFY_TOKEN || "").trim()) {
    dangTat.push("nhan tin Fanpage (thieu FACEBOOK_VERIFY_TOKEN)");
  }
  for (const viec of dangTat) nhatKy.canhBao(`[chay] DANG TAT: ${viec}`);

  const chuaTach = moduleChuaTach(thuMucModules);
  if (chuaTach.length > 0) nhatKy.tin(`[chay] con ${chuaTach.length} module chua tach: ${chuaTach.join(", ")}`);
  return { khung, cong, kho, xeon };
}

if (require.main === module) {
  const cong = Number(process.env.PORT || 4180);
  dungHe({ thuMucDuLieu: process.env.THU_MUC_DU_LIEU || path.join(__dirname, "du-lieu") }).then(({ khung, xeon }) => {
    taoMayChu(khung).listen(cong, () => {
      console.log(`[chay] server khach nghe o cong ${cong}`);
      for (const d of khung.banDuong()) console.log(`        ${d.method.padEnd(6)} ${d.path}  (${d.moduleId}${d.manh ? `, manh ${d.manh}` : ""})`);
      console.log("");
      if (xeon) {
        console.log(`  Shop "${xeon.shop}" da dang ky voi Xeon ${xeon.diaChiXeon}. OMI: nhap license key la vao.`);
      } else {
        console.log("  CHUA dang ky voi Xeon. Chay `node cong-cu/cai-dat.js` hoac dat LICENSE_KEY + XEON_DIA_CHI roi bat lai.");
      }
      console.log("");
    });
  }).catch((e) => {
    console.error("[chay] khong khoi dong duoc:", e.message);
    process.exitCode = 1;
  });
}

module.exports = { dungHe, napTepEnv };
