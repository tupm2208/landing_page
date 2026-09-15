/**
 * @file The composition root: the ONE place that reads the environment and decides which adapters to use.
 *
 * Modules never read `process.env` — they receive `ctx.config`. Switching from JSON files to
 * MySQL, or from the real Graph API to a fake, is a change in this file only.
 *
 * Environment variables come from `.env` next to the package (written by the install wizard);
 * variables already set in the environment win.
 */

import fs from "node:fs";
import path from "node:path";
import { ROLE, type AuthPort, type DataStore, type HttpClient, type Logger, type Mailer } from "./contract";
import {
  ConsoleLogger, DiskStaticFilePort, FetchHttpClient, FixedWindowRateLimiter, JsonFileStore, Kernel, SmtpMailer, SystemClock,
  TokenAuth, TrialModeHttpClient, TrialModeMailer, UnconfiguredMailer, openMysqlStore, selectModules, smtpConfigured, unsplitModules
} from "./kernel";
import { BUILTIN_MODULES } from "./modules";
import {
  normaliseAddress, normaliseLicenseKey, readXeonRegistration, registerWithXeon, saveXeonRegistration,
  type StoredXeonRegistration
} from "./modules/khung-nen-tang/xeon-registration";

export type Env = Record<string, string | undefined>;

/** The package root: `src/` while type-checking, `dist/` once compiled — both one level below it. */
export const PACKAGE_ROOT = path.join(__dirname, "..");
/** Where each module's `goc/` (verbatim browser assets of the old site) lives. */
export const STATIC_ROOT = path.join(PACKAGE_ROOT, "modules");

/** Reads `KEY=value` lines (comments and surrounding quotes dropped). Existing variables win. Returns how many were added. */
export function loadEnvFile(file: string, env: Env): number {
  if (!fs.existsSync(file)) return 0;
  let added = 0;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (env[name] === undefined) { env[name] = value; added += 1; }
  }
  return added;
}

const text = (v: unknown) => String(v ?? "").trim();

/** Per-module configuration built from the environment. Keys are module ids; shapes are each module's `Config`. */
export function moduleConfigFromEnv(env: Env, { siteUrl, xeonAddress }: { siteUrl: string; xeonAddress: string }): Record<string, unknown> {
  return {
    "hop-thu": {
      verifyToken: text(env["FACEBOOK_VERIFY_TOKEN"]),
      appSecret: text(env["FACEBOOK_APP_SECRET"]),
      pageToken: text(env["FACEBOOK_PAGE_TOKEN"])
    },
    "gian-hang": {
      // The real site origin, for OG tags (Facebook's crawler reads them when a customer shares a link).
      siteUrl: siteUrl || "https://toprun.site",
      // 33,809 product images (7.6 GB) are NOT copied to the split build. With this set, a missing
      // image is 302'd to the real site for the browser to fetch — the trial machine only points.
      realImageOrigin: text(env["GOC_ANH_THAT"])
    },
    "cong-bo-nao": {
      // Links the bot hands to customers must be the shop's public address.
      siteUrl
    },
    "don-khach": {
      // Customer accounts: links in e-mails point at the shop's site; the session cookie is
      // `Secure` on HTTPS; lifetimes as on the running site (30-day session, 30-minute links).
      siteUrl: siteUrl || "https://toprun.site",
      https: text(env["PHIEN_HTTPS"]) === "1",
      sessionDays: Number(env["PHIEN_KHACH_NGAY"] || 30),
      resetMinutes: Number(env["LINK_KHACH_PHUT"] || 30),
      // The transfer reference is stamped when the order is placed — same fallback prefix as Money.
      transferPrefix: text(env["TIEN_TIEN_TO_CK"]) || undefined
    },
    "tien-doi-soat": {
      // Deposit percent / shipping fee / transfer prefix: with the platform module present these
      // come from PAGE CONTENT (the owner edits them in the admin screen). These are fallbacks.
      depositPercent: Number(env["TIEN_PHAN_TRAM_COC"] || 0) || undefined,
      defaultShippingFee: env["TIEN_PHI_SHIP"] === undefined ? undefined : Number(env["TIEN_PHI_SHIP"]),
      transferPrefix: text(env["TIEN_TIEN_TO_CK"]) || undefined,
      // Alerts for the SELLER (not the customer). Unset = off; never alert at random.
      telegram: {
        token: text(env["TELEGRAM_BOT_TOKEN"]),
        chatId: text(env["TELEGRAM_CHAT_ID"] || env["TELEGRAM_ALERT_CHAT_ID"])
      }
    },
    "mua-ho": {
      // The partner portal keeps its session in a self-signed cookie. Without this secret no
      // session can be signed and partners cannot enter.
      sessionSecret: text(env["BI_MAT_PHIEN_DOI_TAC"]),
      sessionHours: Number(env["PHIEN_DOI_TAC_GIO"] || 12),
      https: text(env["PHIEN_HTTPS"]) === "1"
    },
    "van-chuyen": {
      defaultCarrier: text(env["VAN_CHUYEN_MAC_DINH"] || "spx"),
      // The SHOP'S WAREHOUSE — sender on every shipment. Missing pieces make "create shipment from
      // order" return the list of what is missing instead of calling a carrier with a blank sender.
      sender: {
        name: text(env["KHO_TEN"]),
        phone: text(env["KHO_DIEN_THOAI"]),
        province: text(env["KHO_TINH"]),
        district: text(env["KHO_HUYEN"]),
        ward: text(env["KHO_XA"]),
        addressDetail: text(env["KHO_DIA_CHI"])
      },
      spx: {
        appId: text(env["SPX_APP_ID"]),
        appSecret: text(env["SPX_APP_SECRET"]),
        userId: text(env["SPX_USER_ID"]),
        userSecret: text(env["SPX_USER_SECRET"])
      },
      vtp: {
        token: text(env["VTP_TOKEN"]),
        username: text(env["VTP_USERNAME"]),
        password: text(env["VTP_PASSWORD"]),
        groupAddressId: text(env["VTP_GROUP_ADDRESS_ID"])
      }
    },
    "xuong-noi-dung": {
      // Links in the first comment must point at the shop's own site — Desk had `toprun.site` in a regex.
      siteUrl: siteUrl || "https://toprun.site"
    },
    "khung-nen-tang": {
      deployId: text(env["DEPLOY_ID"]) || "chua-dat",
      xeonAddress,
      landingAddress: siteUrl
    },
    "ctv": {
      // Collaborator sessions are signed with this. Missing = collaborators cannot log in (and the startup log says so).
      sessionSecret: text(env["BI_MAT_PHIEN_CTV"] || env["BI_MAT_PHIEN_DOI_TAC"]),
      sessionHours: Number(env["PHIEN_CTV_GIO"] || 24 * 30),
      https: text(env["PHIEN_HTTPS"]) === "1"
    },
    "thong-ke": {
      // Signs the `tr_sig` on comment links, so a click can only be credited to a post the shop
      // itself signed. Falls back to the orders token, as the running site did. Missing = visits
      // and products are still counted, but nothing is attributed to a Facebook post.
      attributionSecret: text(env["TOPRUN_ATTRIBUTION_SECRET"] || env["LANDING_ORDERS_TOKEN"])
    }
  };
}

/** What a merchant switched off by not configuring it — printed once at startup, loudly. */
export function disabledFeatures(env: Env, registered: boolean): string[] {
  const off: string[] = [];
  if (!registered) off.push("OMI vào bằng vé máy và bộ não trả lời khách (chưa đăng ký với Xeon: cần LICENSE_KEY + XEON_DIA_CHI + LANDING_SITE_BASE_URL)");
  if (!text(env["TELEGRAM_BOT_TOKEN"]) || !text(env["TELEGRAM_CHAT_ID"] || env["TELEGRAM_ALERT_CHAT_ID"])) off.push("báo Telegram cho người bán hàng (thiếu TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)");
  if (text(env["BI_MAT_PHIEN_DOI_TAC"]).length < 16) off.push("cổng đối tác mua hộ (thiếu BI_MAT_PHIEN_DOI_TAC dài >= 16 ký tự)");
  if (text(env["BI_MAT_PHIEN_CTV"] || env["BI_MAT_PHIEN_DOI_TAC"]).length < 16) off.push("đăng nhập cộng tác viên (thiếu BI_MAT_PHIEN_CTV dài >= 16 ký tự)");
  if (!text(env["SPX_APP_ID"]) && !text(env["VTP_TOKEN"])) off.push("tạo vận đơn (thiếu khoá SPX và Viettel Post)");
  if (!text(env["SMTP_HOST"]) || !text(env["SMTP_USER"]) || !text(env["SMTP_PASS"])) off.push("e-mail cho khách: quên mật khẩu, xác thực đổi hồ sơ (thiếu SMTP_HOST / SMTP_USER / SMTP_PASS; link vẫn tạo và in ra nhật ký)");
  if (!text(env["KHO_TEN"]) || !text(env["KHO_DIEN_THOAI"])) off.push("tạo vận đơn từ đơn (thiếu địa chỉ kho: KHO_TEN, KHO_DIEN_THOAI, KHO_TINH, KHO_HUYEN, KHO_XA, KHO_DIA_CHI)");
  if (!text(env["FACEBOOK_VERIFY_TOKEN"])) off.push("nhận tin Fanpage (thiếu FACEBOOK_VERIFY_TOKEN)");
  return off;
}

export interface BuildOptions {
  /** Where JSON documents go when there is no MySQL. */
  dataDirectory: string;
  env?: Env;
  envFile?: string;
  logger?: Logger;
}

export interface LandingApp {
  kernel: Kernel;
  store: DataStore;
  auth: AuthPort;
  http: HttpClient;
  logger: Logger;
  xeon: StoredXeonRegistration | null;
  unsplit: string[];
}

/** Builds the whole server: ports, kernel, schemas, Xeon registration. Does not listen. */
export async function buildLandingApp(options: BuildOptions): Promise<LandingApp> {
  const env = options.env ?? process.env;
  const logger = options.logger ?? new ConsoleLogger();
  const envFile = options.envFile ?? path.join(PACKAGE_ROOT, ".env");
  const added = loadEnvFile(envFile, env);
  if (added > 0) logger.info(`[chay] đọc ${added} biến từ ${envFile}`);

  // Decided 12/09: customer data lives in MySQL. Files remain only for machines without MySQL
  // (personal trial) — and the log says so, never silently.
  const mysqlUrl = text(env["TOPRUN_MYSQL_URL"]);
  const realMode = text(env["CHE_DO_THAT"]) === "1";
  // Port 3306 is where real data lives — on a shop's hosting it is the normal port. Only a TRIAL run
  // (no CHE_DO_THAT=1) is kept off it, so a test machine never writes into the running landing's data.
  if (mysqlUrl && !realMode && /:3306\//.test(mysqlUrl)) {
    throw new Error("TOPRUN_MYSQL_URL trỏ vào cổng 3306 (dữ liệu thật) mà chưa đặt CHE_DO_THAT=1 — bản thử chỉ dùng 3307.");
  }
  const store: DataStore = mysqlUrl
    ? await openMysqlStore({ url: mysqlUrl, logger })
    : new JsonFileStore(options.dataDirectory, logger);
  if (!mysqlUrl) logger.warn("[chay] CHƯA có TOPRUN_MYSQL_URL — đang chạy bằng tệp JSON, chỉ dùng để thử.");

  logger.warn(realMode
    ? "[chay] CHẾ ĐỘ THẬT: mọi lời gọi ra ngoài là THẬT. Kiểm lại trước khi chạy trên dữ liệu thật."
    : "[chay] CHẾ ĐỘ THỬ: không gửi tin cho khách, không tạo vận đơn thật, không báo Telegram.");

  const siteUrl = text(env["LANDING_SITE_BASE_URL"] || env["SITE_URL"]).replace(/\/+$/, "");
  const xeonAddress = normaliseAddress(env["XEON_DIA_CHI"]);
  const licenseKey = normaliseLicenseKey(env["LICENSE_KEY"]);
  const clock = new SystemClock();

  // Xeon is OUR machine: pushing messages to the brain and registering the licence must work in trial mode too.
  const realHttp = new FetchHttpClient();
  const allowAlso = xeonAddress ? [{ label: "nói với Xeon của mình", matches: (url: string) => url.startsWith(`${xeonAddress}/`) }] : [];
  // TRIAL MODE IS THE DEFAULT. Only an explicit `CHE_DO_THAT=1` lets calls out. Forgetting the
  // variable must be "safe", not "convenient": nobody gets messaged by mistake.
  const http: HttpClient = realMode ? realHttp : new TrialModeHttpClient({ real: realHttp, logger, allowAlso });

  // E-MAIL to customers (password reset, change verification) follows the same rule: real only
  // in real mode; unconfigured SMTP = "link created, mail not sent" with the text in the log.
  const smtp = {
    host: text(env["SMTP_HOST"]), port: Number(env["SMTP_PORT"] || 587), secure: /^(1|true|yes|on)$/i.test(text(env["SMTP_SECURE"])),
    user: text(env["SMTP_USER"]), pass: text(env["SMTP_PASS"]), from: text(env["SMTP_FROM"])
  };
  const mail: Mailer = !realMode ? new TrialModeMailer(logger) : smtpConfigured(smtp) ? new SmtpMailer(smtp, logger) : new UnconfiguredMailer(logger);

  const auth = new TokenAuth({
    // Long-lived NAMED keys — TopRun's internal tools (Desk, Image Tool). Not feature-gated.
    keys: [
      { token: env["LANDING_ADMIN_TOKEN"], name: "quan-tri", role: ROLE.admin },
      { token: env["LANDING_ORDERS_TOKEN"], name: "don-hang", role: ROLE.admin },
      { token: env["IMAGE_TOOL_TOKEN"], name: "image-tool", role: ROLE.admin },
      { token: env["BO_NAO_TOKEN"], name: "bo-nao", role: ROLE.service }
    ],
    clock,
    logger
  });

  const enabled = text(env["MODULE_BAT"]) ? text(env["MODULE_BAT"]).split(",").map((s) => s.trim()).filter(Boolean) : null;
  const modules = selectModules(BUILTIN_MODULES, enabled);

  const kernel = new Kernel({
    ports: {
      store, logger, clock, http, auth, mail,
      rateLimiter: new FixedWindowRateLimiter(clock),
      // The storefront: a module sees only its own `goc/`, and only the declared file extensions.
      staticFiles: new DiskStaticFilePort(STATIC_ROOT, logger)
    },
    logger,
    // Behind hosting/Cloudflare the real address is in a header. ON only behind a real proxy —
    // on without one lets anyone claim an IP and dodge the rate limit.
    trustProxy: text(env["TIN_PROXY"]) === "1",
    modules,
    config: moduleConfigFromEnv(env, { siteUrl, xeonAddress })
  });

  // Run every module's schema before the first request.
  if (store.supportsTables) {
    for (const m of modules) {
      if ((m.schema ?? []).length > 0) await store.runSchema(m.id, m.schema ?? [], { inheritedTables: m.inheritedTables ?? [] });
    }
  }

  // REGISTER WITH XEON (decided 14/09): the landing identifies itself by licence key and receives
  // Xeon's public key (to verify OMI's and the brain's tickets) and a private inbox token. An
  // existing registration with the same key and Xeon is reused; a changed key re-registers.
  let xeon = await readXeonRegistration(store);
  if (licenseKey && xeonAddress && (!xeon || xeon.key !== licenseKey || xeon.diaChiXeon !== xeonAddress)) {
    try {
      const fresh = await registerWithXeon({ http: realHttp, xeonAddress, key: licenseKey, landingAddress: siteUrl });
      const now = clock.now();
      await saveXeonRegistration(store, fresh, now);
      xeon = { ...fresh, dangKyLuc: now.toISOString() };
      logger.info(`[chay] đăng ký với Xeon ${fresh.diaChiXeon}: landing này là shop "${fresh.shop}"`);
    } catch (e) {
      logger.warn(`[chay] KHÔNG đăng ký được với Xeon: ${e instanceof Error ? e.message : String(e)}${xeon ? " — dùng bản đăng ký cũ" : ""}`);
    }
  }
  if (xeon) auth.setXeon({ keyId: xeon.keyId, publicKeyPem: xeon.khoaCongPem, shop: xeon.shop });

  // SAY WHAT IS OFF. A feature missing its key silently does nothing — and silence is the hardest
  // thing to find: the owner thinks Telegram is broken, the partner thinks the portal is down.
  for (const item of disabledFeatures(env, xeon !== null)) logger.warn(`[chay] ĐANG TẮT: ${item}`);

  const unsplit = unsplitModules(STATIC_ROOT, modules);
  if (unsplit.length > 0) logger.info(`[chay] còn ${unsplit.length} module chưa tách: ${unsplit.join(", ")}`);

  return { kernel, store, auth, http, logger, xeon, unsplit };
}
