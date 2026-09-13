#!/usr/bin/env node
// BO CAI LANDING — hoi may cau, viet `.env`, dang ky voi Xeon. Anh Dung chot 14/09/2026:
// "landing page se duoc setup rieng, 1 landing = 1 shop, 1 hosting, 1 database; dong goi
// thanh bo cai".
//
// Chay:  node cong-cu/cai-dat.js
// Khong hoi gi khi da co san bien:  LICENSE_KEY=... XEON_DIA_CHI=... node cong-cu/cai-dat.js --khong-hoi
//
// Viet xong `.env`, no goi Xeon dang ky ngay de biet key co dung khong — sai key thi biet luc
// cai, khong phai luc khach dat don.

"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const crypto = require("crypto");

const GOC = path.join(__dirname, "..");
const TEP_ENV = path.join(GOC, ".env");
const khongHoi = process.argv.includes("--khong-hoi");

const CAU_HOI = [
  { ten: "LICENSE_KEY", hoi: "License key (TR-XXXX-XXXX-XXXX-XXXX)", batBuoc: true, kiem: (v) => /^TR-[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/.test(v.toUpperCase()) || "Key phai co dang TR-XXXX-XXXX-XXXX-XXXX", chuan: (v) => v.toUpperCase() },
  { ten: "XEON_DIA_CHI", hoi: "Dia chi Xeon (vd https://xeon.toprun.vn)", batBuoc: true, macDinh: "https://xeon.toprun.vn", kiem: (v) => /^https?:\/\/[^/\s]+$/.test(v.replace(/\/+$/, "")) || "Phai la http(s)://ten-mien, khong co duong dan", chuan: (v) => v.replace(/\/+$/, "") },
  { ten: "LANDING_SITE_BASE_URL", hoi: "Dia chi cong khai cua web shop (vd https://shop.vn)", batBuoc: true, kiem: (v) => /^https?:\/\/[^/\s]+$/.test(v.replace(/\/+$/, "")) || "Phai la http(s)://ten-mien", chuan: (v) => v.replace(/\/+$/, "") },
  { ten: "TOPRUN_MYSQL_URL", hoi: "MySQL (mysql://user:pass@host:3306/db)", batBuoc: true, kiem: (v) => /^mysql:\/\//.test(v) || "Phai bat dau bang mysql://" },
  { ten: "PORT", hoi: "Cong nghe", macDinh: "4180", kiem: (v) => (/^\d+$/.test(v) && Number(v) > 0 && Number(v) < 65536) || "Cong phai la so" },
  { ten: "KHO_TEN", hoi: "Ten kho (nguoi gui tren van don)", macDinh: "" },
  { ten: "KHO_DIEN_THOAI", hoi: "So dien thoai kho", macDinh: "" },
  { ten: "KHO_TINH", hoi: "Tinh/thanh cua kho", macDinh: "" },
  { ten: "KHO_HUYEN", hoi: "Quan/huyen cua kho", macDinh: "" },
  { ten: "KHO_XA", hoi: "Phuong/xa cua kho", macDinh: "" },
  { ten: "KHO_DIA_CHI", hoi: "Dia chi chi tiet cua kho", macDinh: "" },
  { ten: "FACEBOOK_VERIFY_TOKEN", hoi: "Facebook verify token (de trong = chua nhan tin Fanpage)", macDinh: "" },
  { ten: "FACEBOOK_APP_SECRET", hoi: "Facebook app secret", macDinh: "" },
  { ten: "FACEBOOK_PAGE_TOKEN", hoi: "Facebook page token", macDinh: "" },
  { ten: "TELEGRAM_BOT_TOKEN", hoi: "Telegram bot token (bao cho nguoi ban hang)", macDinh: "" },
  { ten: "TELEGRAM_CHAT_ID", hoi: "Telegram chat id", macDinh: "" }
];

/** Khoa tu sinh: shop khong phai nghi ra, va khong hai shop nao trung nhau. */
const TU_SINH = ["BI_MAT_PHIEN_DOI_TAC", "BI_MAT_PHIEN_CTV"];

function docEnvCu() {
  const ra = {};
  if (!fs.existsSync(TEP_ENV)) return ra;
  for (const dong of fs.readFileSync(TEP_ENV, "utf8").split(/\r?\n/)) {
    const d = dong.trim();
    if (!d || d.startsWith("#")) continue;
    const i = d.indexOf("=");
    if (i > 0) ra[d.slice(0, i).trim()] = d.slice(i + 1).trim();
  }
  return ra;
}

async function hoi(rl, cau, cu) {
  const macDinh = cu !== undefined && cu !== "" ? cu : (cau.macDinh ?? "");
  for (;;) {
    let tra = "";
    if (khongHoi) {
      tra = macDinh;
    } else {
      tra = (await new Promise((r) => rl.question(`${cau.hoi}${macDinh ? ` [${macDinh}]` : ""}: `, r))).trim();
      if (tra === "") tra = macDinh;
    }
    if (tra === "" && cau.batBuoc) {
      if (khongHoi) throw new Error(`Thieu ${cau.ten}.`);
      console.log("  -> bat buoc.");
      continue;
    }
    if (tra !== "" && cau.kiem) {
      const kq = cau.kiem(tra);
      if (kq !== true) {
        if (khongHoi) throw new Error(`${cau.ten}: ${kq}`);
        console.log(`  -> ${kq}`);
        continue;
      }
    }
    return cau.chuan ? cau.chuan(tra) : tra;
  }
}

async function main() {
  console.log("");
  console.log("  BO CAI LANDING — mot landing = mot shop.");
  console.log(`  Viet cau hinh vao ${TEP_ENV}`);
  console.log("");
  const cu = { ...docEnvCu(), ...Object.fromEntries(CAU_HOI.map((c) => [c.ten, process.env[c.ten]]).filter(([, v]) => v !== undefined && v !== "")) };
  const rl = khongHoi ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
  const ra = {};
  try {
    for (const cau of CAU_HOI) ra[cau.ten] = await hoi(rl, cau, cu[cau.ten]);
  } finally {
    if (rl) rl.close();
  }
  for (const ten of TU_SINH) ra[ten] = cu[ten] && cu[ten].length >= 16 ? cu[ten] : crypto.randomBytes(24).toString("base64url");
  // Giu lai nhung bien khac da co trong .env cu (khoa SPX, VTP, ma Desk...) — khong xoa cua nguoi ta.
  for (const [k, v] of Object.entries(docEnvCu())) if (ra[k] === undefined) ra[k] = v;

  const dong = ["# Sinh boi cong-cu/cai-dat.js. Sua tay duoc; bien dat trong moi truong de len tren."];
  for (const [k, v] of Object.entries(ra)) dong.push(`${k}=${v}`);
  fs.writeFileSync(TEP_ENV, `${dong.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(`\n  Da viet ${TEP_ENV}`);

  // Dang ky voi Xeon ngay — sai key thi biet bay gio.
  const { dangKyXeon } = require("../modules/khung-nen-tang/dang-ky-xeon");
  const { taoHttpNgoai } = require("../loi/cong/co-ban");
  try {
    const ban = await dangKyXeon({ httpNgoai: taoHttpNgoai(), diaChiXeon: ra.XEON_DIA_CHI, key: ra.LICENSE_KEY, diaChiLanding: ra.LANDING_SITE_BASE_URL });
    console.log(`  Xeon nhan: landing nay la shop "${ban.shop}"${ban.tenShop ? ` (${ban.tenShop})` : ""}, khoa ky ${ban.keyId}.`);
    console.log("  Chay `node chay.js` — luc khoi dong no se dang ky lai bang chinh key nay va ghi vao so.");
  } catch (e) {
    console.log(`  CHUA dang ky duoc voi Xeon: ${e.message}`);
    console.log("  .env da viet; kiem lai key / dia chi Xeon roi chay `node chay.js`, no se thu dang ky lai.");
    process.exitCode = 2;
  }
}

main().catch((e) => { console.error(`  Loi: ${e.message}`); process.exitCode = 1; });
