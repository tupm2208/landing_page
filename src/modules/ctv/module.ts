/**
 * @file COLLABORATOR module ("ctv") — tier "van-hanh", runs on the merchant server.
 *
 * A collaborator sells on the shop's behalf: they log in, download product images to post, and
 * earn commission on orders carrying their referral code.
 *
 * FOUR RULES NOT TO BREAK:
 *
 * 1. A PASSWORD IS NEVER STORED IN THE CLEAR. PBKDF2, 210,000 iterations, the exact shape of the
 *    running site — so the six real collaborator accounts imported here log in at once with
 *    their old passwords (see `password.ts`).
 *
 * 2. A NEW DEVICE MUST BE APPROVED. Right password on an unknown machine does NOT get in yet: the
 *    request sits in the device table and the shop owner approves it on OMI. A leaked
 *    collaborator password (they reuse it elsewhere) does not lose the whole image bank and the
 *    customer list.
 *
 * 3. A COLLABORATOR SEES NO ORDERS, NO STOCK, NO WAREHOUSE NAMES. They see the IMAGES of one
 *    product code. `/api/ctv/anh` reads through the inventory service and keeps ONLY the images.
 *
 * 4. A SESSION MUST NOT LIVE ON ITS OWN. Sessions are rows with an expiry; switching an account
 *    off makes every open session USELESS at the next call — each call re-checks the table.
 */

import crypto from "node:crypto";
import { ACCESS, ERROR_CODES, EVENTS, defineModule, reply, type KernelRequest, type ModuleContext, type ReplyDraft, type Row } from "../../contract";
import type { InventoryServices } from "../hang-kho/module";
import { toMysqlDateTime, isoFromMysql } from "../../shared/mysql-time";
import { CollaboratorRepository, DEVICE_STATUS, deviceView, downloadView, publicView, type CollaboratorView } from "./collaborator-repository";
import { hashPassword, hashToken, verifyPassword } from "../../shared/password";
import { ACCOUNT_TABLE, DEFAULT_RESET_MINUTES, DEVICE_TABLE, SCHEMA, SESSION_TABLE } from "./schema";
import {
  COMMISSION_SCHEMA, CommissionBook, readAffiliateConfig, updateAffiliateConfig,
  type AffiliateCampaign, type AffiliateRule, type Attribution, type OrderForCommission
} from "./commissions";
import { CollaboratorCookies, DEFAULT_SESSION_HOURS } from "./session";

/** `ctx.config` as built by `moduleConfigFromEnv()` in app.ts. */
export interface Config {
  /** Signs both cookies. Missing or shorter than 16 characters = nobody can log in. */
  sessionSecret: string;
  /** Session life in hours (`PHIEN_CTV_GIO`, default 30 days). */
  sessionHours: number;
  /** Adds `Secure` to the cookies when the site runs on HTTPS. */
  https: boolean;
  /** Device-cookie life in hours. Not set by app.ts today; defaults to one year. */
  deviceCookieHours?: number;
  /** Public URL of the storefront, used in password-reset emails. */
  siteUrl?: string;
  /** How many minutes a reset link stays alive (default 30). */
  resetMinutes?: number;
}

/**
 * The slice of a product the collaborator route needs from `hang-kho.read`. Declared locally
 * because `../hang-kho/module` does not export its service types yet; swap for
 * `import type { InventoryServices }` once it does.
 */
export interface ProductImages {
  code?: unknown;
  name?: unknown;
  highImage?: unknown;
  thumbnailImage?: unknown;
  galleryImages?: unknown;
  [extra: string]: unknown;
}

/** Services this module may use. `hang-kho.read` is optional: without it only the image route is off. */
export interface Services {
  "hang-kho"?: Pick<InventoryServices, "read">;
}

type Ctx = ModuleContext<Config, Services>;

const MINUTES_15 = 15 * 60 * 1000;
const MINUTES_10 = 10 * 60 * 1000;
/** At most this many images per download call. */
const MAX_IMAGES = 30;

const NO_STORE = { "Cache-Control": "no-store" };

function normaliseLogin(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function digitsOnly(value: unknown): string {
  return String(value ?? "").replace(/[^0-9]/g, "");
}

/** A JSON body as a record; anything else (array, null, text) is an empty record. */
function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

function cookiesOf(ctx: Ctx): CollaboratorCookies {
  return new CollaboratorCookies({
    secret: String(ctx.config.sessionSecret || ""),
    clock: ctx.ports.clock,
    sessionHours: Number(ctx.config.sessionHours || DEFAULT_SESSION_HOURS),
    deviceHours: ctx.config.deviceCookieHours,
    https: ctx.config.https === true
  });
}

function sessionHoursOf(ctx: Ctx): number {
  return Number(ctx.config.sessionHours || DEFAULT_SESSION_HOURS);
}

/** A logged-in collaborator: the public view plus the session hash and device id of this call. */
export interface LoggedInCollaborator extends CollaboratorView {
  maPhien: string;
  maThietBi: string;
}

/**
 * The collaborator making this request, or `null`.
 *
 * Reads the cookie and then RE-CHECKS THE TABLES: a session still within its life whose account
 * was switched off, or whose device was blocked, is no longer usable. Trusting only the cookie
 * signature would let a collaborator switched off today keep entering for a month.
 */
async function loggedIn(ctx: Ctx, request: KernelRequest): Promise<LoggedInCollaborator | null> {
  const sessionId = cookiesOf(ctx).readSessionId(request.headers);
  if (!sessionId) return null;
  const repo = new CollaboratorRepository(ctx.ports.store);
  const sessionHash = hashToken(sessionId);
  const session = await repo.findSession(sessionHash);
  if (!session) return null;
  if (isoFromMysql(session["het_luc"]) <= ctx.ports.clock.now().toISOString()) return null;

  const account = await repo.findEnabledAccount(String(session["ma_ctv"]));
  if (!account) return null;
  const deviceId = String(session["ma_thiet_bi"] || "");
  if (deviceId) {
    const device = await repo.findDevice(deviceId);
    if (!device || String(device["trang_thai"]) !== DEVICE_STATUS.approved) return null;
  }
  return { ...publicView(account), maPhien: sessionHash, maThietBi: deviceId };
}

/** An order as the commission book needs it, through Orders' service (absent = null). */
async function readOrderFor(ctx: Ctx, id: string): Promise<OrderForCommission | null> {
  const read = (ctx.services as Record<string, Record<string, unknown> | undefined>)["don-khach"]?.["read"] as ((id: string) => Promise<OrderForCommission | null>) | undefined;
  return read ? read(id) : null;
}

function commissionReader(ctx: Ctx): ((id: string) => Promise<OrderForCommission | null>) | undefined {
  const read = (ctx.services as Record<string, Record<string, unknown> | undefined>)["don-khach"]?.["read"];
  return read ? (id: string) => readOrderFor(ctx, id) : undefined;
}

/** Login: right password AND an approved device. */
async function login(ctx: Ctx, request: KernelRequest, body: Record<string, unknown>): Promise<ReplyDraft> {
  const loginText = normaliseLogin(body["login"] || body["username"] || body["email"] || body["phone"]);
  const password = String(body["password"] || body["matKhau"] || "");
  const now = ctx.ports.clock.now();

  // The SAME refusal for every wrong case — never "no such account", or the collaborators'
  // phone numbers could be enumerated.
  const refused = reply.json({ ok: false, error: "dang_nhap_sai", message: "Số điện thoại, email hoặc mật khẩu không đúng." }, 401);
  if (!loginText || !password) return refused;

  const repo = new CollaboratorRepository(ctx.ports.store);
  const account = await repo.findEnabledByLogin(loginText, digitsOnly(loginText));
  if (!account) return refused;
  if (!(await verifyPassword(password, account["bam_mat_khau"]))) return refused;
  const accountId = String(account["ma"]);

  // RULE 2: the device must be approved.
  const cookies = cookiesOf(ctx);
  let deviceId = cookies.readDeviceId(request.headers);
  const device = deviceId ? await repo.findDeviceByHash(accountId, hashToken(deviceId)) : null;

  if (!device || String(device["trang_thai"]) !== DEVICE_STATUS.approved) {
    if (!deviceId) deviceId = crypto.randomBytes(24).toString("base64url");
    if (!device) {
      await repo.requestDevice({
        ma: `tb_${crypto.randomBytes(8).toString("hex")}`,
        ma_ctv: accountId,
        bam_ma_thiet_bi: hashToken(deviceId),
        nhan: String(body["tenMay"] || "").trim().slice(0, 190),
        trinh_duyet: String(request.headers["user-agent"] || "").slice(0, 300),
        dia_chi_ip: String(request.ip || "").slice(0, 64),
        xin_luc: toMysqlDateTime(now)
      });
      ctx.ports.logger.info(`[ctv] thiet bi moi xin duyet cho CTV ${accountId}`);
    }
    return {
      status: 403,
      headers: { ...cookies.setDeviceHeaders({ maMay: deviceId }), ...NO_STORE },
      body: {
        ok: false, error: "thiet_bi_cho_duyet",
        message: "Máy này đang chờ chủ shop duyệt. Nhờ shop duyệt rồi đăng nhập lại."
      }
    };
  }

  const sessionId = crypto.randomBytes(32).toString("base64url");
  await repo.insertSession({
    bam_ma_phien: hashToken(sessionId),
    ma_ctv: accountId,
    ma_thiet_bi: String(device["ma"]),
    tao_luc: toMysqlDateTime(now),
    het_luc: toMysqlDateTime(new Date(now.getTime() + sessionHoursOf(ctx) * 60 * 60 * 1000))
  });
  ctx.ports.logger.info(`[ctv] ${accountId} dang nhap`);

  return {
    status: 200,
    headers: { ...cookies.setSessionHeaders({ maPhien: sessionId }), ...NO_STORE },
    body: { ok: true, ctv: publicView(account) }
  };
}

/**
 * Admin: create or update an account.
 *
 * UPDATE IS PARTIAL (16/09/2026): only the fields sent change. The web admin's "Tạm dừng" sends
 * `{ma, dangBat:false}` alone; rebuilding the whole row from that erased the name and phone and
 * minted a new referral code — which orphans every link the collaborator already shared.
 * CREATE needs a phone OR an e-mail (the running site's rule) and a password. A phone, e-mail,
 * login or referral code already used by another account is refused (409), as it was.
 */
async function saveAccount(ctx: Ctx, request: KernelRequest): Promise<ReplyDraft> {
  const body = asRecord(await request.json());
  const has = (...keys: string[]) => keys.some((k) => body[k] !== undefined);
  const pick = (...keys: string[]) => { for (const k of keys) if (body[k] !== undefined) return body[k]; return undefined; };

  const password = String(body["matKhau"] || body["password"] || "");
  if (password !== "" && password.length < 8) {
    return reply.json({ ok: false, error: "mat_khau_qua_ngan", message: "Mật khẩu phải từ 8 ký tự." }, 400);
  }

  const now = ctx.ports.clock.now();
  const repo = new CollaboratorRepository(ctx.ports.store);
  const givenId = String(body["ma"] || body["id"] || "").trim();
  const existing = givenId ? await repo.findAccount(givenId) : null;
  if (givenId && !existing && !has("ten", "name", "dienThoai", "phone", "email")) {
    return reply.json({ ok: false, error: "khong_thay", message: "Không thấy tài khoản cộng tác viên này." }, 404);
  }
  const id = givenId || `ctv_${now.getTime().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
  const current = (key: string): unknown => existing?.[key];

  const phone = has("dienThoai", "phone") ? digitsOnly(pick("dienThoai", "phone")) : String(current("dien_thoai") ?? "");
  const email = has("email") ? String(body["email"] ?? "").trim().toLowerCase().slice(0, 190) : String(current("email") ?? "");
  if (phone === "" && email === "") return reply.json({ ok: false, error: "thieu_dien_thoai_hoac_email", message: "Cần số điện thoại hoặc email." }, 400);
  if (phone !== "" && phone.length < 9) return reply.json({ ok: false, error: "thieu_ten_hoac_dien_thoai", message: "Số điện thoại chưa đúng." }, 400);
  if (email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply.json({ ok: false, error: "email_sai", message: "Email chưa đúng." }, 400);

  const name = has("ten", "name") ? String(pick("ten", "name") ?? "").trim() : String(current("ten") ?? "");
  const login = has("tenDangNhap", "username") ? String(pick("tenDangNhap", "username") ?? "").trim() : String(current("ten_dang_nhap") ?? "");
  const code = has("maGioiThieu", "code")
    ? String(pick("maGioiThieu", "code") ?? "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 40)
    : String(current("ma_gioi_thieu") ?? "");
  const flag = (keys: string[], column: string, fallback: number) => {
    const v = pick(...keys);
    if (v === undefined) return existing ? Number(current(column) ?? fallback) : fallback;
    return v === true || v === 1 || v === "1" ? 1 : 0;
  };

  const row: Row = {
    ma: id,
    ten: (name || phone || email).slice(0, 190),
    dien_thoai: phone,
    email,
    ten_dang_nhap: (login || phone || email).slice(0, 190),
    ma_gioi_thieu: code || `CTV${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
    dang_bat: flag(["dangBat", "active"], "dang_bat", 1),
    cho_bo_logo: flag(["choBoLogo", "allowNoLogo"], "cho_bo_logo", 0),
    hoa_hong_mac_dinh: has("hoaHongMacDinh", "defaultCommission")
      ? String(pick("hoaHongMacDinh", "defaultCommission") ?? "").trim().replace(/[^\d.%]/g, "").slice(0, 16)
      : String(current("hoa_hong_mac_dinh") ?? ""),
    bam_mat_khau: password !== "" ? await hashPassword(password) : String(current("bam_mat_khau") || ""),
    bam_cap_luc: password !== "" ? toMysqlDateTime(now) : (current("bam_cap_luc") ?? null),
    tao_luc: existing ? existing["tao_luc"] : toMysqlDateTime(now),
    sua_luc: toMysqlDateTime(now)
  };
  if (!existing && row["bam_mat_khau"] === "") {
    return reply.json({ ok: false, error: "thieu_mat_khau", message: "Tài khoản mới phải có mật khẩu (từ 8 ký tự)." }, 400);
  }

  // Two accounts sharing a phone, e-mail, login or referral code cannot both log in / be paid.
  for (const [column, value, label] of [["dien_thoai", row["dien_thoai"], "Số điện thoại"], ["email", row["email"], "Email"], ["ten_dang_nhap", row["ten_dang_nhap"], "Tên đăng nhập"], ["ma_gioi_thieu", row["ma_gioi_thieu"], "Mã giới thiệu"]] as const) {
    if (!value) continue;
    const other = await ctx.ports.store.table(ACCOUNT_TABLE).one({ [column]: value });
    if (other && String(other["ma"]) !== id) {
      return reply.json({ ok: false, error: "trung_tai_khoan", message: `${label} đã dùng cho cộng tác viên khác.` }, 409);
    }
  }
  await repo.saveAccount(row);

  // Switching an account off CUTS every open session — they must not stay in until it expires.
  if (row["dang_bat"] === 0) await repo.deleteSessions({ ma_ctv: id });

  ctx.ports.logger.info(`[ctv] ${existing ? "sua" : "them"} tai khoan ${id}`);
  return reply.json({ ok: true, ctv: publicView(row) }, 200, NO_STORE);
}

/** Admin: delete an account for good — its sessions and devices go with it; download history stays. */
async function deleteAccount(ctx: Ctx, request: KernelRequest): Promise<ReplyDraft> {
  const body = asRecord(await request.json());
  const id = String(body["ma"] || body["id"] || "").trim();
  if (!id) return reply.json({ ok: false, error: "thieu_ma", message: "Thiếu mã cộng tác viên." }, 400);
  const removed = await ctx.ports.store.transaction(async (tx) => {
    await tx.table(SESSION_TABLE).delete({ ma_ctv: id });
    await tx.table(DEVICE_TABLE).delete({ ma_ctv: id });
    return tx.table(ACCOUNT_TABLE).delete({ ma: id });
  });
  if (removed === 0) return reply.json({ ok: false, error: "khong_thay", message: "Không thấy tài khoản cộng tác viên này." }, 404);
  ctx.ports.logger.info(`[ctv] xoa tai khoan ${id}`);
  return reply.json({ ok: true, message: "Đã xoá cộng tác viên." }, 200, NO_STORE);
}

/** Admin: approve or block one device of a collaborator. */
async function decideDevice(ctx: Ctx, request: KernelRequest): Promise<ReplyDraft> {
  const body = asRecord(await request.json());
  const id = String(body["ma"] || "").trim();
  const action = String(body["viec"] || "").trim();
  if (!id || !["duyet", "chan"].includes(action)) {
    return reply.json({ ok: false, error: "can_ma_va_viec", message: 'Cần `ma` thiết bị và `viec` là "duyet" hoặc "chan".' }, 400);
  }
  const repo = new CollaboratorRepository(ctx.ports.store);
  const device = await repo.findDevice(id);
  if (!device) return reply.json({ ok: false, error: "khong_thay_thiet_bi" }, 404);

  await repo.setDeviceStatus(id, action === "duyet" ? DEVICE_STATUS.approved : DEVICE_STATUS.blocked, toMysqlDateTime(ctx.ports.clock.now()));
  // Blocking a device also cuts the sessions open on that very device.
  if (action === "chan") await repo.deleteSessions({ ma_thiet_bi: id });

  ctx.ports.logger.info(`[ctv] ${action} thiet bi ${id} cua CTV ${String(device["ma_ctv"])}`);
  return reply.json({ ok: true }, 200, NO_STORE);
}

/** A collaborator downloads the images of one product code. ONLY images — no stock, no cost, no warehouse. */
async function downloadImages(ctx: Ctx, request: KernelRequest): Promise<ReplyDraft> {
  const who = await loggedIn(ctx, request);
  if (!who) return reply.json({ ok: false, error: ERROR_CODES.unauthenticated }, 401);

  const code = String(request.query["ma"] || request.query["code"] || "").trim();
  if (!code) return reply.json({ ok: false, error: "thieu_ma_hang" }, 400);

  const read = ctx.services["hang-kho"]?.read;
  if (!read) return reply.json({ ok: false, error: "chua_bat_manh_hang_hoa" }, 503);
  const product = await read(code);
  if (!product) return reply.json({ ok: false, error: "khong_thay_ma" }, 404);

  const images = [product.highImage, product.thumbnailImage, ...(Array.isArray(product.galleryImages) ? product.galleryImages : [])]
    .map((x) => String(x || "").trim())
    .filter((x) => x !== "");
  const unique = [...new Set(images)].slice(0, MAX_IMAGES);

  await new CollaboratorRepository(ctx.ports.store).logDownload({
    ma_ctv: who.ma, ma_hang: code, so_anh: unique.length,
    dia_chi_ip: String(request.ip || "").slice(0, 64),
    luc: toMysqlDateTime(ctx.ports.clock.now())
  });

  return reply.json({ ok: true, ma: product.code, ten: product.name, anh: unique, choBoLogo: who.choBoLogo }, 200, NO_STORE);
}

// ---- password reset (CTV) -------------------------------------------------------------------

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function resetMinutesOf(ctx: Ctx): number {
  return Number(ctx.config.resetMinutes) || DEFAULT_RESET_MINUTES;
}

function siteUrlOf(ctx: Ctx): string {
  return String(ctx.config.siteUrl || "https://toprun.site").replace(/\/+$/, "");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Collaborator forgot password: send a reset link to their registered email. */
async function forgotPassword(ctx: Ctx, body: Record<string, unknown>): Promise<ReplyDraft> {
  const email = String(body["email"] ?? "").trim().toLowerCase();
  if (!email || !isValidEmail(email)) return reply.json({ ok: false, error: "email_khong_hop_le", message: "Vui lòng nhập email hợp lệ." }, 422);

  const repo = new CollaboratorRepository(ctx.ports.store);
  const account = await repo.findByEmail(email);

  // RULE: same sentence whether or not the email exists — no enumeration.
  const quiet = "Nếu email tồn tại, shop sẽ gửi link đặt lại mật khẩu.";
  if (!account) return { status: 200, body: { ok: true, message: quiet } };

  const token = crypto.randomBytes(32).toString("base64url");
  const now = ctx.ports.clock.now();
  const minutes = resetMinutesOf(ctx);
  await repo.setResetToken({
    id: String(account["ma"]),
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + minutes * 60000),
    now
  });

  const url = `${siteUrlOf(ctx)}/ctv-login?reset=${encodeURIComponent(token)}`;
  const who = String(account["ten"] || "cộng tác viên");

  let mailOk = false;
  let mailConfigured = false;
  try {
    const result = await ctx.ports.mail.send({
      to: email,
      subject: "Đặt lại mật khẩu CTV",
      text: `Xin chào ${who},\n\nBấm link sau để đặt lại mật khẩu trong ${minutes} phút:\n${url}\n\nNếu bạn không yêu cầu, hãy bỏ qua email này.`,
      html: `<p>Xin chào ${escapeHtml(who)},</p><p>Bấm link sau để đặt lại mật khẩu trong ${minutes} phút:</p><p><a href="${escapeHtml(url)}">Đặt lại mật khẩu</a></p><p>Nếu bạn không yêu cầu, hãy bỏ qua email này.</p>`
    });
    mailOk = result.ok;
    mailConfigured = result.configured;
  } catch (e) {
    // Trial mode throws on purpose — report it, do not hide it.
    ctx.ports.logger.warn(`[ctv] không gửi được e-mail tới ${email}: ${e instanceof Error ? e.message : String(e)}`);
  }

  return {
    status: 200,
    body: {
      ok: true,
      message: mailOk
        ? "Đã gửi link đặt lại mật khẩu nếu email tồn tại."
        : "Đã tạo link đặt lại mật khẩu, nhưng chưa gửi email (shop chưa cấu hình SMTP hoặc đang chạy thử).",
      mail: { ok: mailOk, configured: mailConfigured }
    }
  };
}

/** Collaborator resets password with the token from the email link. */
async function resetPassword(ctx: Ctx, body: Record<string, unknown>): Promise<ReplyDraft> {
  const token = String(body["token"] ?? "").trim();
  const password = String(body["password"] ?? "");
  if (!token) return reply.json({ ok: false, error: "thieu_ma", message: "Link đặt lại mật khẩu không hợp lệ." }, 422);
  if (password.length < 8) return reply.json({ ok: false, error: "mat_khau_qua_ngan", message: "Mật khẩu cần ít nhất 8 ký tự." }, 422);

  const repo = new CollaboratorRepository(ctx.ports.store);
  const now = ctx.ports.clock.now();
  const account = await repo.findByResetToken(hashToken(token), now);
  if (!account) return reply.json({ ok: false, error: "ma_het_han", message: "Link đặt lại mật khẩu đã hết hạn hoặc không hợp lệ." }, 400);

  const id = String(account["ma"]);
  await repo.setPassword({ id, passwordHash: await hashPassword(password), now });
  await repo.deleteSessionsOf(id);

  ctx.ports.logger.info(`[ctv] ${id} dat lai mat khau`);
  return { status: 200, body: { ok: true, message: "Đã cập nhật mật khẩu. Bạn có thể đăng nhập lại." } };
}

/** Collaborator download log: fire-and-forget from the image page. */
async function logDownload(ctx: Ctx, request: KernelRequest): Promise<ReplyDraft> {
  const who = await loggedIn(ctx, request);
  if (!who) return reply.json({ ok: false, error: ERROR_CODES.unauthenticated }, 401);
  const body = asRecord(await request.json());
  const productCode = String(body["productCode"] || "").trim().slice(0, 128);
  const imageIndex = Math.max(0, Number(body["imageIndex"]) || 0);
  if (productCode) {
    await new CollaboratorRepository(ctx.ports.store).logDownload({
      ma_ctv: who.ma, ma_hang: productCode, so_anh: imageIndex,
      dia_chi_ip: String(request.ip || "").slice(0, 64),
      luc: toMysqlDateTime(ctx.ports.clock.now())
    });
  }
  return reply.json({ ok: true }, 200, NO_STORE);
}

export const manifest = defineModule<Config, Services>({
  id: "ctv",
  name: "Cộng tác viên",
  tier: "van-hanh",
  runsOn: "server-khach",
  feature: "gian-hang",
  version: "0.1.0",
  ports: ["store", "logger", "clock", "config", "mail"],
  schema: [...SCHEMA, ...COMMISSION_SCHEMA],

  // Images of a product code come through the inventory feature. Without it the download route
  // is off; login and collaborator management still run. `don-khach.read`: the commission book
  // reads each order's status NOW (see commissions.ts) — without Orders nothing is ever approved.
  requiresOptional: ["hang-kho.read", "don-khach.read"],

  provides: {
    /** `Set-Cookie` for a `?ref=CODE` landing, when the code belongs to an active collaborator. */
    "ctv.referralCookieFor": (ctx: Ctx, code: unknown) => new CommissionBook(ctx.ports.store).referralCookie(code, ctx.config.https === true),
    /**
     * Who brought this order: the collaborator logged in on the site, else the referral cookie.
     * Orders asks at placement and puts the answer in `don-khach.da-tao`.
     */
    "ctv.attributionFor": async (ctx: Ctx, headers: Record<string, string | undefined>): Promise<Attribution | null> => {
      const me = await loggedIn(ctx, { headers } as KernelRequest).catch(() => null);
      if (me) return { maCtv: me.ma, maGioiThieu: me.maGioiThieu, nguon: "affiliate_ctv_session" };
      return new CommissionBook(ctx.ports.store).referralFromCookie(headers);
    }
  },

  events: {
    emits: [],
    listens: {
      // A new order carrying an attribution gets its commission row, at the rate of that moment.
      [EVENTS.orderCreated]: async (ctx: Ctx, payload: unknown) => {
        const p = (payload ?? {}) as { maDon?: string; ctv?: Attribution | null };
        if (!p.maDon || !p.ctv?.maCtv) return;
        const order = await readOrderFor(ctx, p.maDon);
        if (!order) return;
        const written = await new CommissionBook(ctx.ports.store).record(order, p.ctv, ctx.ports.clock.now());
        if (written) ctx.ports.logger.info(`[ctv] đơn ${p.maDon} ghi nhận cho CTV ${p.ctv.maCtv} (${p.ctv.nguon})`);
      }
    }
  },

  routes: [
    {
      method: "POST", path: "/api/ctv/login", access: ACCESS.public,
      whyPublic: "Cộng tác viên tự đăng nhập, chưa có mã nào. Tự bảo vệ bằng: mật khẩu PBKDF2, hạn gọi 20 lần/15 phút, và máy lạ phải được chủ shop duyệt mới vào được.",
      rateLimit: { calls: 20, windowMs: MINUTES_15 },
      handle: async (ctx, request) => login(ctx, request, asRecord(await request.json()))
    },
    {
      method: "POST", path: "/api/ctv/logout", access: ACCESS.public,
      whyPublic: "Đăng xuất chính phiên của mình. Không có phiên thì cũng chỉ xoá cookie, không đọc dữ liệu nào.",
      rateLimit: { calls: 60, windowMs: MINUTES_10 },
      handle: async (ctx, request) => {
        const who = await loggedIn(ctx, request);
        if (who) await new CollaboratorRepository(ctx.ports.store).deleteSessions({ bam_ma_phien: who.maPhien });
        return { status: 200, headers: { ...cookiesOf(ctx).clearSessionHeaders(), ...NO_STORE }, body: { ok: true } };
      }
    },
    {
      method: "GET", path: "/api/ctv/me", access: ACCESS.public,
      whyPublic: "Trang CTV hỏi 'tôi là ai'. Chưa đăng nhập thì trả 401 và không đọc gì.",
      rateLimit: { calls: 240, windowMs: MINUTES_10 },
      handle: async (ctx, request) => {
        const who = await loggedIn(ctx, request);
        if (!who) return reply.json({ ok: false, error: ERROR_CODES.unauthenticated }, 401);
        // The old site's envelope and English names, which the storefront reads: ctv-account.js
        // `payload.data.name` / `.code`, ctv-image.js `.allowNoLogo`, the ?ref badge `.code`. Returning
        // `{ ctv }` (15/09/2026) threw on `account.name` and bounced collaborators between the login
        // and account pages forever. Commission figures come from Sales Desk and are not on this
        // server yet: empty, never invented. Session and device ids stay inside.
        return reply.json({
          ok: true,
          data: {
            id: who.ma, affiliateId: who.ma, name: who.ten, email: who.email, username: who.tenDangNhap,
            code: who.maGioiThieu, allowNoLogo: who.choBoLogo, ...(await (async () => {
              const book = await new CommissionBook(ctx.ports.store).read(commissionReader(ctx), who.ma);
              return { commissionSummary: CommissionBook.summary(book), orders: book.commissions, payments: book.payments };
            })())
          }
        }, 200, NO_STORE);
      }
    },
    {
      method: "GET", path: "/api/ctv/anh", access: ACCESS.public,
      whyPublic: "Cộng tác viên tải ảnh sản phẩm. Phải có phiên đăng nhập hợp lệ; bản trả về CHỈ có danh sách ảnh, không tồn kho, không giá vốn, không tên kho.",
      rateLimit: { calls: 120, windowMs: MINUTES_10 },
      handle: downloadImages
    },
    {
      method: "POST", path: "/api/ctv/forgot-password", access: ACCESS.public,
      whyPublic: "Cộng tác viên xin link đặt lại mật khẩu qua e-mail đã đăng ký. Câu trả lời giống nhau dù e-mail có hay không; hạn gọi chặt.",
      rateLimit: { calls: 10, windowMs: MINUTES_15 },
      handle: async (ctx, request) => forgotPassword(ctx, asRecord(await request.json()))
    },
    {
      method: "POST", path: "/api/ctv/reset-password", access: ACCESS.public,
      whyPublic: "Đặt lại mật khẩu bằng mã trong e-mail (sống 30 phút, băm trong bảng); sai mã là 400.",
      rateLimit: { calls: 10, windowMs: MINUTES_15 },
      handle: async (ctx, request) => resetPassword(ctx, asRecord(await request.json()))
    },
    {
      method: "POST", path: "/api/ctv/download-log", access: ACCESS.public,
      whyPublic: "Ghi nhật ký tải ảnh. Gọi fire-and-forget từ trang ảnh CTV; phải có phiên đăng nhập.",
      rateLimit: { calls: 120, windowMs: MINUTES_10 },
      handle: logDownload
    },

    // ---------- admin screen ----------
    {
      method: "GET", path: "/api/admin/ctv", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: MINUTES_10 },
      handle: async (ctx) => {
        const repo = new CollaboratorRepository(ctx.ports.store);
        const accounts = await repo.listAccounts();
        const devices = await repo.listDevices();
        return reply.json({ ok: true, ctv: accounts.map((row) => publicView(row)), thietBi: devices.map(deviceView) }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/admin/ctv", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: MINUTES_10 },
      handle: saveAccount
    },
    {
      // The commission book of every collaborator (the web admin's CTV tab).
      method: "GET", path: "/api/admin/ctv/hoa-hong", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: MINUTES_10 },
      handle: async (ctx) => reply.json({ ok: true, data: await new CommissionBook(ctx.ports.store).read(commissionReader(ctx)) }, 200, NO_STORE)
    },
    {
      method: "POST", path: "/api/admin/ctv/thanh-toan", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: MINUTES_10 },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const id = String(body["maCtv"] || body["affiliateId"] || "").trim();
        const amount = Number(body["soTien"] ?? body["amount"] ?? 0);
        if (!id || !(amount > 0)) return reply.json({ ok: false, error: "thieu_ctv_hoac_so_tien", message: "Cần CTV và số tiền lớn hơn 0." }, 400);
        const account = await new CollaboratorRepository(ctx.ports.store).findAccount(id);
        if (!account) return reply.json({ ok: false, error: "khong_thay", message: "Không thấy cộng tác viên này." }, 404);
        const paymentId = await new CommissionBook(ctx.ports.store).pay({
          collaboratorId: id, amount, note: String(body["ghiChu"] ?? body["note"] ?? ""), actor: String(request.caller?.name || "quan-tri"), now: ctx.ports.clock.now()
        });
        ctx.ports.logger.info(`[ctv] trả ${Math.round(amount)}đ cho CTV ${id}`);
        return reply.json({ ok: true, ma: paymentId, message: "Đã ghi thanh toán tiền công." }, 200, NO_STORE);
      }
    },
    {
      // Đ4: correct / void one payment. The collaborator's own page and the debt follow at once.
      method: "POST", path: "/api/admin/ctv/thanh-toan/sua", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: MINUTES_10 },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const amount = Number(body["soTien"] ?? 0);
        if (!(amount > 0)) return reply.json({ ok: false, error: "so_tien_sai", message: "Số tiền phải lớn hơn 0." }, 400);
        const changed = await new CommissionBook(ctx.ports.store).correctPayment(String(body["ma"] ?? ""), { amount, note: String(body["ghiChu"] ?? ""), now: ctx.ports.clock.now() });
        if (changed === 0) return reply.json({ ok: false, error: "khong_thay", message: "Không tìm thấy giao dịch CTV cần sửa (hoặc đã hoàn tác)." }, 404);
        return reply.json({ ok: true, message: "Đã sửa thanh toán CTV." }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/admin/ctv/thanh-toan/huy", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: MINUTES_10 },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const changed = await new CommissionBook(ctx.ports.store).voidPayment(String(body["ma"] ?? ""), { reason: String(body["lyDo"] ?? "").trim() || "Nhập nhầm giao dịch", now: ctx.ports.clock.now() });
        if (changed === 0) return reply.json({ ok: false, error: "khong_thay", message: "Không tìm thấy giao dịch CTV cần hoàn tác (hoặc đã hoàn tác)." }, 404);
        return reply.json({ ok: true, message: "Đã hoàn tác thanh toán CTV và tính lại công nợ." }, 200, NO_STORE);
      }
    },
    {
      // Đ4: campaigns + fixed per-product rules. A rule applies to orders placed AFTER it (rates are frozen per order).
      method: "GET", path: "/api/admin/ctv/cau-hinh", access: ACCESS.admin,
      handle: async (ctx) => reply.json({ ok: true, ...(await readAffiliateConfig(ctx.ports.store)) }, 200, NO_STORE)
    },
    {
      method: "POST", path: "/api/admin/ctv/chien-dich", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: MINUTES_10 },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const code = String(body["ma"] ?? "").trim().toUpperCase().slice(0, 60);
        const name = String(body["ten"] ?? "").trim().slice(0, 190);
        if (!code || !name) return reply.json({ ok: false, error: "thieu_ten_ma", message: "Cần nhập tên và mã chiến dịch." }, 400);
        const now = ctx.ports.clock.now();
        const config = await updateAffiliateConfig(ctx.ports.store, (c) => ({
          ...c,
          campaigns: [
            { id: `camp_${now.getTime()}`, name, code, scope: String(body["phamVi"] ?? "").trim().slice(0, 190), note: String(body["ghiChu"] ?? "").trim().slice(0, 1000), status: "active", createdAt: now.toISOString() },
            ...c.campaigns.filter((x) => x.code !== code)
          ]
        }));
        return reply.json({ ok: true, ...config, message: "Đã thêm chiến dịch affiliate." }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/admin/ctv/quy-tac", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: MINUTES_10 },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const value = Number(body["giaTri"] ?? 0);
        const target = String(body["maSanPham"] ?? "").trim().toUpperCase().slice(0, 128);
        if (!(value > 0)) return reply.json({ ok: false, error: "thieu_gia_tri", message: "Cần nhập giá trị hoa hồng." }, 400);
        if (!target) return reply.json({ ok: false, error: "thieu_ma", message: "Cần nhập mã sản phẩm." }, 400);
        const now = ctx.ports.clock.now();
        const type = String(body["loai"] ?? "fixed") === "percent" ? "percent" : "fixed";
        const config = await updateAffiliateConfig(ctx.ports.store, (c) => ({
          ...c,
          rules: [{ id: `rule_${now.getTime()}`, scope: "product", targetId: target, type, value, status: "active", createdAt: now.toISOString() }, ...c.rules.filter((r) => !(r.scope === "product" && r.targetId === target))]
        }));
        return reply.json({ ok: true, ...config, message: "Đã thêm rule hoa hồng." }, 200, NO_STORE);
      }
    },
    {
      // Desk `save-affiliate-config`: writes both lists as the screen holds them (e.g. a rule switched off).
      method: "POST", path: "/api/admin/ctv/cau-hinh", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: MINUTES_10 },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const config = await updateAffiliateConfig(ctx.ports.store, (c) => ({
          campaigns: Array.isArray(body["campaigns"]) ? (body["campaigns"] as AffiliateCampaign[]).slice(0, 500) : c.campaigns,
          rules: Array.isArray(body["rules"]) ? (body["rules"] as AffiliateRule[]).slice(0, 500) : c.rules
        }));
        return reply.json({ ok: true, ...config, message: "Đã lưu cấu hình affiliate." }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/admin/ctv/xoa", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: MINUTES_10 },
      handle: deleteAccount
    },
    {
      method: "POST", path: "/api/admin/ctv/thiet-bi", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: MINUTES_10 },
      handle: decideDevice
    },
    {
      method: "GET", path: "/api/admin/ctv/nhat-ky", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: MINUTES_10 },
      handle: async (ctx, request) => {
        const collaboratorId = String(request.query["ctv"] || "").trim();
        const limit = Math.min(Number(request.query["limit"] || 100) || 100, 500);
        const rows = await new CollaboratorRepository(ctx.ports.store).listDownloads(collaboratorId, limit);
        return reply.json({ ok: true, dong: rows.map(downloadView) }, 200, NO_STORE);
      }
    }
  ],

  botTools: []
});
