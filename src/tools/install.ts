#!/usr/bin/env node
/**
 * @file The landing install wizard: asks a few questions, writes `.env`, registers with Xeon.
 *
 * Decided 14/09/2026: "one landing = one shop, one hosting, one database; packaged as an installer".
 *
 *   node dist/tools/install.js
 *   LICENSE_KEY=... XEON_DIA_CHI=... node dist/tools/install.js --khong-hoi   (no questions when variables are set)
 *
 * After writing `.env` it registers with Xeon at once, so a wrong key is found at install time,
 * not when the first customer orders.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { FetchHttpClient } from "../kernel";
import { registerWithXeon } from "../modules/khung-nen-tang/xeon-registration";

const PACKAGE_ROOT = path.join(__dirname, "..", "..");
const ENV_FILE = path.join(PACKAGE_ROOT, ".env");
const NO_QUESTIONS = process.argv.includes("--khong-hoi");

interface Question {
  name: string;
  prompt: string;
  required?: boolean;
  fallback?: string;
  validate?: (value: string) => true | string;
  normalise?: (value: string) => string;
}

const isOrigin = (v: string) => /^https?:\/\/[^/\s]+$/.test(v.replace(/\/+$/, ""));

/** The questions, in the order a merchant answers them. Prompts are Vietnamese: the merchant reads them. */
const QUESTIONS: Question[] = [
  { name: "LICENSE_KEY", prompt: "License key (TR-XXXX-XXXX-XXXX-XXXX)", required: true, validate: (v) => /^TR-[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/.test(v.toUpperCase()) || "Key phải có dạng TR-XXXX-XXXX-XXXX-XXXX", normalise: (v) => v.toUpperCase() },
  { name: "XEON_DIA_CHI", prompt: "Địa chỉ Xeon (vd https://xeon.toprun.vn)", required: true, fallback: "https://xeon.toprun.vn", validate: (v) => isOrigin(v) || "Phải là http(s)://tên-miền, không có đường dẫn", normalise: (v) => v.replace(/\/+$/, "") },
  { name: "LANDING_SITE_BASE_URL", prompt: "Địa chỉ công khai của web shop (vd https://shop.vn)", required: true, validate: (v) => isOrigin(v) || "Phải là http(s)://tên-miền", normalise: (v) => v.replace(/\/+$/, "") },
  { name: "TOPRUN_MYSQL_URL", prompt: "MySQL (mysql://user:pass@host:3306/db)", required: true, validate: (v) => /^mysql:\/\//.test(v) || "Phải bắt đầu bằng mysql://" },
  { name: "PORT", prompt: "Cổng nghe", fallback: "4180", validate: (v) => (/^\d+$/.test(v) && Number(v) > 0 && Number(v) < 65536) || "Cổng phải là số" },
  { name: "KHO_TEN", prompt: "Tên kho (người gửi trên vận đơn)", fallback: "" },
  { name: "KHO_DIEN_THOAI", prompt: "Số điện thoại kho", fallback: "" },
  { name: "KHO_TINH", prompt: "Tỉnh/thành của kho", fallback: "" },
  { name: "KHO_HUYEN", prompt: "Quận/huyện của kho", fallback: "" },
  { name: "KHO_XA", prompt: "Phường/xã của kho", fallback: "" },
  { name: "KHO_DIA_CHI", prompt: "Địa chỉ chi tiết của kho", fallback: "" },
  { name: "FACEBOOK_VERIFY_TOKEN", prompt: "Facebook verify token (để trống = chưa nhận tin Fanpage)", fallback: "" },
  { name: "FACEBOOK_APP_SECRET", prompt: "Facebook app secret", fallback: "" },
  { name: "FACEBOOK_PAGE_TOKEN", prompt: "Facebook page token", fallback: "" },
  { name: "TELEGRAM_BOT_TOKEN", prompt: "Telegram bot token (báo cho người bán hàng)", fallback: "" },
  { name: "TELEGRAM_CHAT_ID", prompt: "Telegram chat id", fallback: "" }
];

/** Secrets generated for the shop: nobody has to invent them, and no two shops share one. */
const GENERATED = ["BI_MAT_PHIEN_DOI_TAC", "BI_MAT_PHIEN_CTV"];

function readExistingEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(ENV_FILE)) return out;
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0) out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

async function ask(rl: readline.Interface | null, q: Question, current: string | undefined): Promise<string> {
  const fallback = current !== undefined && current !== "" ? current : (q.fallback ?? "");
  for (;;) {
    let answer = fallback;
    if (rl) {
      answer = (await new Promise<string>((resolve) => rl.question(`${q.prompt}${fallback ? ` [${fallback}]` : ""}: `, resolve))).trim();
      if (answer === "") answer = fallback;
    }
    if (answer === "" && q.required) {
      if (!rl) throw new Error(`Thiếu ${q.name}.`);
      console.log("  -> bắt buộc.");
      continue;
    }
    if (answer !== "" && q.validate) {
      const verdict = q.validate(answer);
      if (verdict !== true) {
        if (!rl) throw new Error(`${q.name}: ${verdict}`);
        console.log(`  -> ${verdict}`);
        continue;
      }
    }
    return q.normalise ? q.normalise(answer) : answer;
  }
}

async function main(): Promise<void> {
  console.log("");
  console.log("  BỘ CÀI LANDING — một landing = một shop.");
  console.log(`  Viết cấu hình vào ${ENV_FILE}`);
  console.log("");
  const existing = readExistingEnv();
  const current: Record<string, string> = { ...existing };
  for (const q of QUESTIONS) {
    const fromEnv = process.env[q.name];
    if (fromEnv !== undefined && fromEnv !== "") current[q.name] = fromEnv;
  }
  const rl = NO_QUESTIONS ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
  const answers: Record<string, string> = {};
  try {
    for (const q of QUESTIONS) answers[q.name] = await ask(rl, q, current[q.name]);
  } finally {
    rl?.close();
  }
  for (const name of GENERATED) {
    const old = current[name];
    answers[name] = old && old.length >= 16 ? old : crypto.randomBytes(24).toString("base64url");
  }
  // Keep every other variable already in `.env` (SPX/VTP keys, Desk tokens...) — never delete someone's settings.
  for (const [k, v] of Object.entries(existing)) if (answers[k] === undefined) answers[k] = v;

  const lines = ["# Sinh bởi bộ cài (dist/tools/install.js). Sửa tay được; biến đặt trong môi trường đè lên trên."];
  for (const [k, v] of Object.entries(answers)) lines.push(`${k}=${v}`);
  fs.writeFileSync(ENV_FILE, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(`\n  Đã viết ${ENV_FILE}`);

  // Register with Xeon right now — a wrong key is found here.
  try {
    const r = await registerWithXeon({ http: new FetchHttpClient(), xeonAddress: answers["XEON_DIA_CHI"]!, key: answers["LICENSE_KEY"]!, landingAddress: answers["LANDING_SITE_BASE_URL"]! });
    console.log(`  Xeon nhận: landing này là shop "${r.shop}"${r.tenShop ? ` (${r.tenShop})` : ""}, khoá ký ${r.keyId}.`);
    console.log("  Chạy `npm start` — lúc khởi động nó đăng ký lại bằng chính key này và ghi vào sổ.");
  } catch (e) {
    console.log(`  CHƯA đăng ký được với Xeon: ${e instanceof Error ? e.message : String(e)}`);
    console.log("  .env đã viết; kiểm lại key / địa chỉ Xeon rồi `npm start`, nó sẽ thử đăng ký lại.");
    process.exitCode = 2;
  }
}

main().catch((e: unknown) => { console.error(`  Lỗi: ${e instanceof Error ? e.message : String(e)}`); process.exitCode = 1; });
