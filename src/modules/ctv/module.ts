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
import { ACCESS, ERROR_CODES, defineModule, reply, type KernelRequest, type ModuleContext, type ReplyDraft, type Row } from "../../contract";
import type { InventoryServices } from "../hang-kho/module";
import { toMysqlDateTime, isoFromMysql } from "../../shared/mysql-time";
import { CollaboratorRepository, DEVICE_STATUS, deviceView, downloadView, publicView, type CollaboratorView } from "./collaborator-repository";
import { hashPassword, hashToken, verifyPassword } from "../../shared/password";
import { SCHEMA } from "./schema";
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

/** Admin: create or update an account. The whole row is rebuilt; the hash is kept unless a new password comes in. */
async function saveAccount(ctx: Ctx, request: KernelRequest): Promise<ReplyDraft> {
  const body = asRecord(await request.json());
  const name = String(body["ten"] || body["name"] || "").trim();
  const phone = digitsOnly(body["dienThoai"] || body["phone"]);
  if (!name || phone.length < 9) {
    return reply.json({ ok: false, error: "thieu_ten_hoac_dien_thoai" }, 400);
  }
  const password = String(body["matKhau"] || body["password"] || "");
  if (password !== "" && password.length < 8) {
    return reply.json({ ok: false, error: "mat_khau_qua_ngan", message: "Mật khẩu phải từ 8 ký tự." }, 400);
  }

  const now = ctx.ports.clock.now();
  const id = String(body["ma"] || "").trim() || `ctv_${now.getTime().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
  const repo = new CollaboratorRepository(ctx.ports.store);
  const existing = await repo.findAccount(id);

  const row: Row = {
    ma: id,
    ten: name,
    dien_thoai: phone,
    email: String(body["email"] || "").trim().toLowerCase().slice(0, 190),
    ten_dang_nhap: String(body["tenDangNhap"] || body["username"] || phone).trim().slice(0, 190),
    ma_gioi_thieu: String(body["maGioiThieu"] || body["code"] || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 40)
      || `CTV${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
    dang_bat: body["dangBat"] === false ? 0 : 1,
    cho_bo_logo: body["choBoLogo"] === true ? 1 : 0,
    bam_mat_khau: password !== "" ? await hashPassword(password) : String(existing?.["bam_mat_khau"] || ""),
    bam_cap_luc: password !== "" ? toMysqlDateTime(now) : (existing?.["bam_cap_luc"] ?? null),
    tao_luc: existing ? existing["tao_luc"] : toMysqlDateTime(now),
    sua_luc: toMysqlDateTime(now)
  };
  if (!existing && row["bam_mat_khau"] === "") {
    return reply.json({ ok: false, error: "thieu_mat_khau", message: "Tài khoản mới phải có mật khẩu (từ 8 ký tự)." }, 400);
  }
  await repo.saveAccount(row);

  // Switching an account off CUTS every open session — they must not stay in until it expires.
  if (row["dang_bat"] === 0) await repo.deleteSessions({ ma_ctv: id });

  ctx.ports.logger.info(`[ctv] ${existing ? "sua" : "them"} tai khoan ${id}`);
  return reply.json({ ok: true, ctv: publicView(row) }, 200, NO_STORE);
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

export const manifest = defineModule<Config, Services>({
  id: "ctv",
  name: "Cộng tác viên",
  tier: "van-hanh",
  runsOn: "server-khach",
  feature: "gian-hang",
  version: "0.1.0",
  ports: ["store", "logger", "clock", "config"],
  schema: SCHEMA,

  // Images of a product code come through the inventory feature. Without it the download route
  // is off; login and collaborator management still run.
  requiresOptional: ["hang-kho.read"],

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
        return reply.json({ ok: true, ctv: who }, 200, NO_STORE);
      }
    },
    {
      method: "GET", path: "/api/ctv/anh", access: ACCESS.public,
      whyPublic: "Cộng tác viên tải ảnh sản phẩm. Phải có phiên đăng nhập hợp lệ; bản trả về CHỈ có danh sách ảnh, không tồn kho, không giá vốn, không tên kho.",
      rateLimit: { calls: 120, windowMs: MINUTES_10 },
      handle: downloadImages
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
