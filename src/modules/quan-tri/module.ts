/**
 * @file MODULE WEB ADMIN ("quan-tri") — tier "khung": the `/admin` pages and the people behind them.
 *
 * Dũng, 16/09/2026: "các tính năng cũ trên web như partner hay admin đều phải có ở trên web mới",
 * logging in as a PERSON with a password. OMI stays; this is the same shop, reached from a browser.
 *
 * This module owns WHO may log in (people, sessions, devices) and serves the admin pages from its
 * own `goc/`. It owns no shop data: the pages call the routes of the modules that own orders,
 * products, partners… — every `ACCESS.admin` route accepts a person's session, because the kernel
 * resolves the cookie before any handler runs (`AdminSessionResolver`, plugged in by `app.ts`).
 *
 * FIVE RULES:
 * 1. NO SESSION, NO ADMIN CODE. `/admin` and `/admin.js` answer a stranger with the login page / 404:
 *    the running site did the same, because the script alone maps every admin route.
 * 2. A NEW DEVICE WAITS FOR THE OWNER. Except an owner's very first device (someone must be able to
 *    approve the rest), a login from an unknown browser is refused with the device code to approve.
 * 3. REVOKING IS IMMEDIATE. Logging out, switching a person off, blocking a device and changing a
 *    password delete session rows; the next request of that session is anonymous.
 * 4. FIVE WRONG PASSWORDS LOCK THE LOGIN for fifteen minutes (the running site had no limit at all).
 * 5. ONLY AN OWNER manages people and devices, and the last active owner cannot be switched off or
 *    demoted — a shop must never lock itself out of its own admin.
 */

import { ACCESS, ERROR_CODES, defineModule, reply, type Caller, type KernelRequest, type ModuleContext, type ReplyDraft } from "../../contract";
import { LoginLockout } from "../../shared/login-lockout";
import { hashPassword, verifyPassword } from "../../shared/password";
import { readCookie } from "../../shared/session-cookie";
import {
  DEVICE_APPROVED, DEVICE_BLOCKED, DEVICE_PENDING, OWNER, PeopleRepository, STAFF, newSessionToken, normaliseLogin, type PersonRole
} from "./people-repository";
import { LOGIN_FAILURES_TABLE, SCHEMA } from "./schema";
import { ADMIN_COOKIE, sessionCookieHeaders } from "./sessions";

/** `ctx.config` as `app.ts` builds it. */
export interface Config {
  /** How long a web-admin session lives, in days. */
  sessionDays?: number;
  /** `Secure` cookie (the site is served over HTTPS). */
  https?: boolean;
}

type Ctx = ModuleContext<Config>;

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const TEN_MINUTES = 10 * 60 * 1000;
const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" };
const DEVICE_ID = /^[A-Za-z0-9_.-]{8,120}$/;
const MIN_PASSWORD = 8;

const text = (v: unknown): string => String(v ?? "").trim();
const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? v as Record<string, unknown> : {});

function people(ctx: Ctx): PeopleRepository {
  return new PeopleRepository(ctx.ports.store);
}

function lifetimeMs(ctx: Ctx): number {
  return Math.max(1, Number(ctx.config.sessionDays) || 14) * 24 * 60 * 60 * 1000;
}

/** Owners, and machines holding an admin key or ticket (they are the shop's own tools). */
function isOwner(caller: Caller | undefined): boolean {
  if (!caller) return false;
  return caller.via !== "phien-nguoi" || caller.personRole === OWNER;
}

const OWNER_ONLY: ReplyDraft = { status: 403, body: { ok: false, error: "chi_chu_shop", message: "Chỉ chủ shop mới làm được việc này." } };

async function servePage(ctx: Ctx, path: string): Promise<ReplyDraft> {
  const file = await ctx.ports.staticFiles.open(`${ctx.id}/goc`).read(path);
  if (!file) return reply.json({ ok: false, error: ERROR_CODES.notFound }, 404);
  return reply.file(file.data, file.type, 200, NO_STORE);
}

/** Is a person (or an admin machine) behind this request? Pages that are not API routes ask this themselves. */
async function signedIn(ctx: Ctx, request: KernelRequest): Promise<boolean> {
  const caller = await ctx.ports.auth.resolve(request);
  return ctx.ports.auth.callerAllows(caller, ACCESS.admin);
}

function roleOf(value: unknown): PersonRole | null {
  const v = text(value);
  return v === OWNER || v === STAFF ? v : null;
}

/** The person as the admin page reads it (the running site's `admin` object, plus the Vietnamese names OMI uses). */
function publicAdmin(caller: Caller): Record<string, unknown> {
  return {
    login: caller.login || caller.name,
    name: caller.name,
    role: caller.personRole || "quan-tri",
    vai: caller.personRole || "quan-tri",
    via: caller.via,
    laChuShop: isOwner(caller)
  };
}

async function login(ctx: Ctx, request: KernelRequest): Promise<ReplyDraft> {
  const body = asRecord(await request.json());
  const repo = people(ctx);
  const now = ctx.ports.clock.now();
  const loginName = normaliseLogin(body["login"] || body["username"]);
  const password = String(body["password"] ?? "");
  const deviceId = text(body["deviceId"]);
  if (!loginName || !password) return reply.json({ ok: false, error: "thieu_dang_nhap", message: "Nhập tài khoản và mật khẩu." }, 400);

  const lockout = new LoginLockout(ctx.ports.store, LOGIN_FAILURES_TABLE);
  const lockKey = `${request.ip}|${loginName}`;
  const lockedUntil = await lockout.lockedUntil(lockKey, now);
  if (lockedUntil) {
    return reply.json({ ok: false, error: "tam_khoa", message: `Sai mật khẩu quá nhiều lần. Thử lại sau ${LoginLockout.minutesLeft(lockedUntil, now)} phút.` }, 429);
  }

  const person = await repo.forLogin(loginName);
  // One refusal for every failure, or login names could be enumerated.
  if (!person || !person.active || !person.passwordHash || !(await verifyPassword(password, person.passwordHash))) {
    await lockout.recordFailure(lockKey, now);
    ctx.ports.logger.warn(`[quan-tri] đăng nhập sai: "${loginName}" từ ${request.ip}`);
    return reply.json({ ok: false, error: "invalid_login", message: "Tài khoản hoặc mật khẩu không đúng." }, 401);
  }
  await lockout.clear(lockKey);

  // RULE 2: the device. The running site's error names are kept — the login page reads them.
  if (!DEVICE_ID.test(deviceId)) {
    return reply.json({ ok: false, error: "device_required", message: "Trình duyệt không gửi mã thiết bị. Tải lại trang đăng nhập rồi thử lại." }, 400);
  }
  const known = await repo.device(person.id, deviceId);
  const status = known?.status
    ?? (person.role === OWNER && (await repo.approvedDevicesOf(person.id)) === 0 ? DEVICE_APPROVED : DEVICE_PENDING);
  await repo.touchDevice({
    personId: person.id, deviceId, name: text(body["deviceName"]), ip: request.ip,
    userAgent: text(request.headers["user-agent"]), status, now
  });
  if (status === DEVICE_BLOCKED) {
    return reply.json({ ok: false, error: "device_blocked", device: { id: deviceId }, message: "Thiết bị này đã bị chặn." }, 403);
  }
  if (status !== DEVICE_APPROVED) {
    ctx.ports.logger.info(`[quan-tri] "${person.login}" đăng nhập từ máy mới ${deviceId} — chờ chủ shop duyệt`);
    return reply.json({ ok: false, error: "device_not_approved", device: { id: deviceId }, message: "Thiết bị mới — chờ chủ shop duyệt trên màn quản trị." }, 403);
  }

  const token = newSessionToken();
  await repo.createSession({ personId: person.id, token, deviceId, ip: request.ip, now, lifetimeMs: lifetimeMs(ctx) });
  ctx.ports.logger.info(`[quan-tri] "${person.login}" đăng nhập từ ${request.ip}`);
  return {
    status: 200,
    headers: { ...sessionCookieHeaders(token, lifetimeMs(ctx) / 1000, ctx.config.https === true), ...NO_STORE },
    body: { ok: true, admin: { login: person.login, name: person.name, role: person.role, vai: person.role } }
  };
}

async function changePassword(ctx: Ctx, request: KernelRequest): Promise<ReplyDraft> {
  const body = asRecord(await request.json());
  const caller = request.caller;
  const repo = people(ctx);
  const now = ctx.ports.clock.now();
  const newPassword = String(body["password"] ?? body["matKhauMoi"] ?? "");
  if (newPassword.length < MIN_PASSWORD) return reply.json({ ok: false, error: "mat_khau_ngan", message: `Mật khẩu phải dài ít nhất ${MIN_PASSWORD} ký tự.` }, 400);

  const targetLogin = normaliseLogin(body["login"]);
  const self = caller?.via === "phien-nguoi" && (!targetLogin || targetLogin === caller.login);
  if (self) {
    // Your own password: prove you know the current one — a borrowed, unlocked browser is not you.
    const hash = await repo.passwordHashOf(caller!.personId!);
    if (!(await verifyPassword(String(body["currentPassword"] ?? body["matKhauCu"] ?? ""), hash))) {
      return reply.json({ ok: false, error: "sai_mat_khau_cu", message: "Mật khẩu hiện tại không đúng." }, 400);
    }
    await repo.update(caller!.personId!, { passwordHash: await hashPassword(newPassword) }, now);
    // RULE 3: every OTHER session of this person ends; the one in use stays.
    await repo.deleteSessionsOf(caller!.personId!, readCookie(request.headers, ADMIN_COOKIE));
    return reply.json({ ok: true, message: "Đã đổi mật khẩu. Các máy khác đã bị đăng xuất." });
  }

  if (!isOwner(caller)) return OWNER_ONLY;
  const target = await repo.byLogin(targetLogin);
  if (!target) return reply.json({ ok: false, error: ERROR_CODES.notFound, message: "Không có tài khoản này." }, 404);
  await repo.update(target.id, { passwordHash: await hashPassword(newPassword) }, now);
  await repo.deleteSessionsOf(target.id);
  ctx.ports.logger.info(`[quan-tri] ${caller?.name} đặt lại mật khẩu cho "${target.login}"`);
  return reply.json({ ok: true, message: `Đã đặt lại mật khẩu cho ${target.login}; mọi phiên của tài khoản đó đã kết thúc.` });
}

async function savePerson(ctx: Ctx, request: KernelRequest): Promise<ReplyDraft> {
  if (!isOwner(request.caller)) return OWNER_ONLY;
  const body = asRecord(await request.json());
  const repo = people(ctx);
  const now = ctx.ports.clock.now();
  const loginName = normaliseLogin(body["dangNhap"] || body["login"]);
  if (!/^[a-z0-9._@-]{3,190}$/.test(loginName)) {
    return reply.json({ ok: false, error: "ten_dang_nhap_sai", message: "Tên đăng nhập 3+ ký tự: chữ thường không dấu, số, . _ - @" }, 400);
  }
  const password = String(body["matKhau"] ?? body["password"] ?? "");
  if (password !== "" && password.length < MIN_PASSWORD) {
    return reply.json({ ok: false, error: "mat_khau_ngan", message: `Mật khẩu phải dài ít nhất ${MIN_PASSWORD} ký tự.` }, 400);
  }
  const role = body["vai"] === undefined ? null : roleOf(body["vai"]);
  if (body["vai"] !== undefined && !role) return reply.json({ ok: false, error: "vai_sai", message: "Vai là chu-shop hoặc nhan-vien." }, 400);

  const existing = await repo.byLogin(loginName);
  if (!existing) {
    if (!password) return reply.json({ ok: false, error: "thieu_mat_khau", message: "Tài khoản mới cần mật khẩu." }, 400);
    const id = await repo.create({ login: loginName, name: text(body["ten"]) || loginName, role: role ?? STAFF, passwordHash: await hashPassword(password), now });
    ctx.ports.logger.info(`[quan-tri] ${request.caller?.name} tạo tài khoản "${loginName}" (${role ?? STAFF})`);
    return reply.json({ ok: true, ma: id, taoMoi: true });
  }

  const active = body["dangBat"] === undefined ? undefined : body["dangBat"] === true || body["dangBat"] === 1 || body["dangBat"] === "1";
  // RULE 5: the last active owner stays an active owner.
  const losesOwner = existing.role === OWNER && existing.active && (active === false || (role !== null && role !== OWNER));
  if (losesOwner && (await repo.activeOwners()) <= 1) {
    return reply.json({ ok: false, error: "chu_shop_cuoi", message: "Đây là chủ shop cuối cùng — tạo chủ shop khác trước." }, 409);
  }
  await repo.update(existing.id, {
    ...(body["ten"] !== undefined ? { name: text(body["ten"]) || existing.login } : {}),
    ...(role ? { role } : {}),
    ...(active !== undefined ? { active } : {}),
    ...(password ? { passwordHash: await hashPassword(password) } : {})
  }, now);
  // RULE 3: switched off, or given a new password by the owner — every session ends.
  if (active === false || password) await repo.deleteSessionsOf(existing.id);
  ctx.ports.logger.info(`[quan-tri] ${request.caller?.name} sửa tài khoản "${existing.login}"`);
  return reply.json({ ok: true, ma: existing.id, taoMoi: false });
}

async function setDevice(ctx: Ctx, request: KernelRequest): Promise<ReplyDraft> {
  if (!isOwner(request.caller)) return OWNER_ONLY;
  const body = asRecord(await request.json());
  const repo = people(ctx);
  const deviceId = text(body["deviceId"] || body["maMay"]);
  const status = text(body["status"] || body["trangThai"]);
  let personId = text(body["maNguoi"]);
  if (!personId && body["login"]) personId = (await repo.byLogin(text(body["login"])))?.id ?? "";
  if (!personId || !deviceId) return reply.json({ ok: false, error: "thieu_thiet_bi", message: "Thiếu tài khoản hoặc mã thiết bị." }, 400);
  if (![DEVICE_APPROVED, DEVICE_BLOCKED, DEVICE_PENDING, "deleted"].includes(status)) {
    return reply.json({ ok: false, error: "trang_thai_sai", message: "Trạng thái là approved, blocked, pending hoặc deleted." }, 400);
  }
  const changed = status === "deleted" ? await repo.deleteDevice(personId, deviceId) : await repo.setDeviceStatus(personId, deviceId, status);
  if (changed === 0) return reply.json({ ok: false, error: ERROR_CODES.notFound, message: "Không thấy thiết bị này." }, 404);
  // A device that is no longer approved loses its sessions at once.
  if (status !== DEVICE_APPROVED) await repo.deleteSessionsOfDevice(personId, deviceId);
  ctx.ports.logger.info(`[quan-tri] ${request.caller?.name} đặt thiết bị ${deviceId} của người ${personId} -> ${status}`);
  return reply.json({ ok: true, data: { devices: await repo.listDevices(), updatedAt: ctx.ports.clock.now().toISOString() } });
}

export const manifest = defineModule<Config>({
  id: "quan-tri",
  name: "Quản trị web",
  tier: "khung",
  runsOn: "server-khach",
  version: "0.1.0",
  ports: ["store", "logger", "clock", "auth", "config", "staticFiles"],
  schema: SCHEMA,

  routes: [
    // ---------------- pages ----------------
    {
      method: "GET", path: "/admin-login", access: ACCESS.public,
      whyPublic: "Màn đăng nhập quản trị web. Chỉ trả tệp tĩnh trong goc/; người đã đăng nhập được đưa thẳng vào /admin.",
      rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => ((await signedIn(ctx, request)) ? reply.redirect("/admin") : servePage(ctx, "/admin-login.html"))
    },
    {
      method: "GET", path: "/admin-login.html", access: ACCESS.public,
      whyPublic: "Địa chỉ cũ của màn đăng nhập quản trị; chỉ chuyển hướng.",
      rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: () => reply.redirect("/admin-login")
    },
    ...["/admin-login.js", "/admin.css"].map((asset) => ({
      method: "GET" as const, path: asset, access: ACCESS.public,
      whyPublic: "Tệp giao diện của màn đăng nhập quản trị (không chứa dữ liệu, không lộ đường quản trị nào ngoài /api/admin/login).",
      rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: (ctx: Ctx) => servePage(ctx, asset)
    })),
    {
      // RULE 1: the admin shell only for someone signed in.
      method: "GET", path: "/admin", access: ACCESS.public,
      whyPublic: "Khung màn quản trị web. Tự kiểm phiên trước: chưa đăng nhập thì chuyển về /admin-login, không trả tệp nào.",
      rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => ((await signedIn(ctx, request)) ? servePage(ctx, "/admin.html") : reply.redirect("/admin-login"))
    },
    {
      method: "GET", path: "/admin.html", access: ACCESS.public,
      whyPublic: "Địa chỉ cũ của màn quản trị; chỉ chuyển hướng về /admin (nơi kiểm phiên).",
      rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: () => reply.redirect("/admin")
    },
    {
      method: "GET", path: "/admin/nguoi", access: ACCESS.public,
      whyPublic: "Màn người & máy của quản trị web. Tự kiểm phiên: chưa đăng nhập thì về /admin-login; dữ liệu chỉ lấy qua /api/admin/nguoi và /devices (chỉ chủ shop).",
      rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => ((await signedIn(ctx, request)) ? servePage(ctx, "/nguoi.html") : reply.redirect("/admin-login"))
    },
    {
      // Web OMI (17/09/2026): OMI's own screens — orders, order editor, customers, shipments — in a
      // browser tab, on the person's session. Built by scripts/build-omi-web.mjs.
      method: "GET", path: "/admin/desk", access: ACCESS.public,
      whyPublic: "Màn quản trị kiểu Sales Desk (bản web của OMI). Tự kiểm phiên: chưa đăng nhập thì về /admin-login; mọi dữ liệu đi qua đường ACCESS.admin.",
      rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => ((await signedIn(ctx, request)) ? servePage(ctx, "/omi-web/index.html") : reply.redirect("/admin-login"))
    },
    ...["/omi-web/app.js", "/omi-web/desk.css", "/omi-web/app.css", "/admin.js", "/admin-api.js", "/nguoi.js"].map((asset) => ({
      // RULE 1: the admin script maps every admin route — a stranger gets a 404, as on the running site.
      method: "GET" as const, path: asset, access: ACCESS.public,
      whyPublic: "Mã màn quản trị. Tự kiểm phiên: chưa đăng nhập thì 404 như bản cũ, không trả tệp.",
      rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx: Ctx, request: KernelRequest) => ((await signedIn(ctx, request)) ? servePage(ctx, asset) : reply.json({ ok: false, error: ERROR_CODES.notFound }, 404, { "Cache-Control": "no-store" }))
    })),

    // ---------------- the session ----------------
    {
      method: "POST", path: "/api/admin/login", access: ACCESS.public,
      whyPublic: "Người quản trị tự đăng nhập, chưa có mã. Tự bảo vệ bằng: mật khẩu PBKDF2, khoá 15 phút sau 5 lần sai, hạn 30 lần/15 phút, máy lạ phải được chủ shop duyệt, và một câu từ chối chung cho mọi lỗi.",
      rateLimit: { calls: 30, windowMs: FIFTEEN_MINUTES },
      handle: login
    },
    {
      method: "POST", path: "/api/admin/logout", access: ACCESS.public,
      whyPublic: "Chỉ xoá phiên của chính cookie người gọi gửi lên; không đọc hay sửa gì khác.",
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        await people(ctx).deleteSession(readCookie(request.headers, ADMIN_COOKIE));
        return { status: 200, headers: { ...sessionCookieHeaders("", 0, ctx.config.https === true), ...NO_STORE }, body: { ok: true } };
      }
    },
    {
      method: "GET", path: "/api/admin/me", access: ACCESS.admin,
      handle: (_ctx, request) => ({ status: 200, headers: NO_STORE, body: { ok: true, admin: publicAdmin(request.caller!) } })
    },
    {
      method: "POST", path: "/api/admin/password-reset", access: ACCESS.admin,
      rateLimit: { calls: 20, windowMs: FIFTEEN_MINUTES },
      handle: changePassword
    },

    // ---------------- people and devices (owner only) ----------------
    {
      method: "GET", path: "/api/admin/nguoi", access: ACCESS.admin,
      handle: async (ctx, request) => (isOwner(request.caller)
        ? { status: 200, headers: NO_STORE, body: { ok: true, nguoi: await people(ctx).list() } }
        : OWNER_ONLY)
    },
    {
      method: "POST", path: "/api/admin/nguoi", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: savePerson
    },
    {
      method: "GET", path: "/api/admin/devices", access: ACCESS.admin,
      handle: async (ctx, request) => (isOwner(request.caller)
        ? { status: 200, headers: NO_STORE, body: { ok: true, data: { devices: await people(ctx).listDevices(), updatedAt: ctx.ports.clock.now().toISOString() } } }
        : OWNER_ONLY)
    },
    {
      method: "POST", path: "/api/admin/devices", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: setDevice
    }
  ]
});
