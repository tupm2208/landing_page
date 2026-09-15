/**
 * @file Customer accounts: register, log in, see and cancel MY orders, forgot/reset password,
 * change my profile with an e-mail confirmation.
 *
 * Ported from the running site's `/api/account/*` (11 routes) with the SAME wire: field names,
 * error codes (`invalid_account`, `login_required`...) and the session cookie name, so the copied
 * pages `account.html` / `account-manage.html` work unchanged.
 *
 * THREE RULES:
 * 1. The session is a random token in an HttpOnly cookie; the table holds only its hash. A
 *    password reset deletes every session of that customer.
 * 2. An e-mail address is proved before it changes anything: profile changes wait in
 *    `customer_change_requests` until the link in the e-mail is opened (30 minutes).
 * 3. Answers never say whether an e-mail exists ("if the e-mail exists, a link was sent").
 *
 * Mail goes through the `mail` port. Trial mode blocks it (the port throws); the customer is told
 * the link was created but not sent, exactly like an unconfigured SMTP on the running site.
 */

import crypto from "node:crypto";
import type { Headers, ReplyDraft, Row } from "../../contract";
import { hashPassword, hashToken, verifyPassword } from "../../shared/password";
import { readCookie } from "../../shared/session-cookie";
import type { OrderContext } from "./context";
import { repositoryOf } from "./context";
import { CustomerRepository, type ChangePayload } from "./customer-repository";
import { changeStatus, readOrder } from "./order-service";
import { canEdit } from "./public-orders";

/** Cookie name of the running site — the copied pages send it back as is. */
export const ACCOUNT_COOKIE = "toprun_account_session";
const DEFAULT_SESSION_DAYS = 30;
const DEFAULT_RESET_MINUTES = 30;
const NO_STORE = { "Cache-Control": "no-store" };

const text = (v: unknown): string => String(v ?? "").trim();
const lower = (v: unknown): string => text(v).toLowerCase();
const refuse = (status: number, error: string, message: string): ReplyDraft => ({ status, body: { ok: false, error, message } });
const LOGIN_REQUIRED = () => refuse(401, "login_required", "Vui lòng đăng nhập.");

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidPassword(password: string): boolean {
  return password.length >= 6;
}

export function normalizePhone(value: unknown): string {
  return String(value ?? "").replace(/[\s.-]/g, "");
}

export function isValidVietnamPhone(value: unknown): boolean {
  return /^(0|\+84)(3|5|7|8|9)\d{8}$/.test(normalizePhone(value));
}

/** The username/e-mail/password rules of the running site; returns the reason or "". */
export function validateAccountInput(input: { username: string; email: string; password: string }): string {
  if (!/^[a-z0-9._-]{3,32}$/.test(input.username)) return "Tên đăng nhập gồm 3–32 ký tự: chữ, số, dấu chấm, gạch dưới hoặc gạch ngang.";
  if (!isValidEmail(input.email)) return "Email không hợp lệ.";
  if (!isValidPassword(input.password)) return "Mật khẩu cần ít nhất 6 ký tự.";
  return "";
}

/** The customer as the page sees them — never the password hash or a token. */
export function publicCustomer(row: Row | null): Record<string, unknown> | null {
  if (!row) return null;
  const dob = row["date_of_birth"];
  return {
    id: Number(row["id"]),
    username: text(row["username"]),
    email: text(row["email"] || row["google_email"]),
    emailVerified: Number(row["email_verified"] || 0) === 1,
    name: text(row["name"]),
    dateOfBirth: dob instanceof Date ? dob.toISOString().slice(0, 10) : dob ? String(dob).slice(0, 10) : "",
    gender: text(row["gender"]),
    phone: text(row["phone"]),
    marketingOptIn: Number(row["marketing_opt_in"] ?? 1) !== 0
  };
}

export function publicAddress(row: Row | null): Record<string, string> {
  return {
    receiverName: text(row?.["receiver_name"]),
    phone: text(row?.["phone"]),
    province: text(row?.["province"]),
    district: text(row?.["district"]),
    ward: text(row?.["ward"]),
    addressDetail: text(row?.["address_detail"]),
    fullAddress: text(row?.["full_address"])
  };
}

function customersOf(ctx: OrderContext): CustomerRepository {
  return new CustomerRepository(ctx.ports.store);
}

function sessionDays(ctx: OrderContext): number {
  return Math.max(1, Number(ctx.config.sessionDays) || DEFAULT_SESSION_DAYS);
}

function linkMinutes(ctx: OrderContext): number {
  return Math.max(1, Number(ctx.config.resetMinutes) || DEFAULT_RESET_MINUTES);
}

function siteUrl(ctx: OrderContext): string {
  return text(ctx.config.siteUrl || "https://toprun.site").replace(/\/+$/, "");
}

function cookieHeaders(ctx: OrderContext, token: string, maxAgeSeconds: number): Record<string, string> {
  const secure = ctx.config.https === true ? "; Secure" : "";
  return { ...NO_STORE, "Set-Cookie": `${ACCOUNT_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure}` };
}

/** The logged-in customer of a request, or null. */
export async function currentCustomer(ctx: OrderContext, headers: Headers): Promise<Row | null> {
  const token = readCookie(headers, ACCOUNT_COOKIE);
  if (!token) return null;
  return customersOf(ctx).customerBySession(hashToken(token), ctx.ports.clock.now());
}

async function openSession(ctx: OrderContext, customerId: unknown): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = ctx.ports.clock.now();
  await customersOf(ctx).createSession({ customerId, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + sessionDays(ctx) * 86400000), now });
  return token;
}

/** Links the order the customer just placed (id + lookup token in the body) to the account. */
async function attachOrder(ctx: OrderContext, customerId: number, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const orderId = text(body["orderId"] || body["pendingOrderId"]);
  const token = text(body["orderToken"] || body["pendingOrderToken"]);
  if (!orderId || !token) return { ok: false, skipped: true };
  const outcome = await repositoryOf(ctx).attachCustomer({ id: orderId, token, customerId, at: ctx.ports.clock.now() });
  if (outcome === "attached") return { ok: true, orderId };
  if (outcome === "other_customer") return { ok: false, status: 409, error: "order_already_linked", message: "Đơn hàng đã được lưu vào tài khoản khác." };
  return { ok: false, status: 404, error: "order_not_found", message: "Không tìm thấy đơn hàng để gắn vào tài khoản." };
}

async function sendMail(ctx: OrderContext, to: string, subject: string, textBody: string, html: string): Promise<{ ok: boolean; configured: boolean; blocked?: boolean }> {
  try {
    const r = await ctx.ports.mail.send({ to, subject, text: textBody, html });
    return { ok: r.ok, configured: r.configured };
  } catch (e) {
    // Trial mode throws on purpose (nobody gets mailed by a trial machine). Report it, do not hide it.
    ctx.ports.logger.warn(`[don-khach] không gửi được e-mail tới ${to}: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, configured: true, blocked: true };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c] ?? c);
}

// ---- the eleven doors ------------------------------------------------------------------------

export async function me(ctx: OrderContext, headers: Headers): Promise<ReplyDraft> {
  return { status: 200, headers: NO_STORE, body: { ok: true, customer: publicCustomer(await currentCustomer(ctx, headers)) } };
}

export async function profile(ctx: OrderContext, headers: Headers): Promise<ReplyDraft> {
  const customer = await currentCustomer(ctx, headers);
  if (!customer) return LOGIN_REQUIRED();
  const address = await customersOf(ctx).defaultAddress(customer["id"]);
  return { status: 200, headers: NO_STORE, body: { ok: true, customer: publicCustomer(customer), address: publicAddress(address), storage: "mysql" } };
}

export async function register(ctx: OrderContext, body: Record<string, unknown>): Promise<ReplyDraft> {
  const username = lower(body["username"]);
  const email = lower(body["email"]);
  const password = String(body["password"] ?? "");
  const confirm = body["confirmPassword"] === undefined || body["confirmPassword"] === null ? password : String(body["confirmPassword"]);
  const why = validateAccountInput({ username, email, password });
  if (why) return refuse(422, "invalid_account", why);
  if (password !== confirm) return refuse(422, "password_mismatch", "Mật khẩu xác nhận chưa khớp.");

  const repo = customersOf(ctx);
  const now = ctx.ports.clock.now();
  if (await repo.findByUsername(username)) return refuse(409, "account_exists", "Tên đăng nhập đã có tài khoản.");
  const passwordHash = await hashPassword(password);
  let customerId: number;
  const byEmail = await repo.findByEmail(email);
  if (byEmail) {
    if (byEmail["password_hash"] || byEmail["username"]) return refuse(409, "account_exists", "Email đã có tài khoản.");
    // A row created from an order (e-mail only) becomes the account.
    await repo.claim({ id: byEmail["id"], username, passwordHash, now });
    customerId = Number(byEmail["id"]);
  } else {
    try {
      customerId = await repo.insert({ username, email, passwordHash, name: username, now });
    } catch (e) {
      if (/ER_DUP_ENTRY|duplicate/i.test(e instanceof Error ? e.message : String(e))) return refuse(409, "account_exists", "Tên đăng nhập hoặc email đã có tài khoản.");
      throw e;
    }
  }
  const customer = await repo.findById(customerId);
  const linkedOrder = await attachOrder(ctx, customerId, body);
  const token = await openSession(ctx, customerId);
  ctx.ports.logger.info(`[don-khach] khách đăng ký tài khoản #${customerId}`);
  return { status: 200, headers: cookieHeaders(ctx, token, sessionDays(ctx) * 86400), body: { ok: true, customer: publicCustomer(customer), linkedOrder } };
}

export async function login(ctx: OrderContext, body: Record<string, unknown>): Promise<ReplyDraft> {
  const loginText = text(body["login"] || body["username"] || body["email"]);
  const password = String(body["password"] ?? "");
  if (!loginText || !password) return refuse(422, "missing_login", "Vui lòng nhập tên đăng nhập/email và mật khẩu.");
  const customer = await customersOf(ctx).findByLogin(lower(loginText), lower(loginText));
  if (!customer || !customer["password_hash"] || !(await verifyPassword(password, customer["password_hash"]))) {
    return refuse(401, "invalid_login", "Tên đăng nhập/email hoặc mật khẩu không đúng.");
  }
  const linkedOrder = await attachOrder(ctx, Number(customer["id"]), body);
  const token = await openSession(ctx, customer["id"]);
  return { status: 200, headers: cookieHeaders(ctx, token, sessionDays(ctx) * 86400), body: { ok: true, customer: publicCustomer(customer), linkedOrder } };
}

export async function logout(ctx: OrderContext, headers: Headers): Promise<ReplyDraft> {
  const token = readCookie(headers, ACCOUNT_COOKIE);
  if (token) await customersOf(ctx).deleteSession(hashToken(token));
  return { status: 200, headers: cookieHeaders(ctx, "", 0), body: { ok: true } };
}

export async function forgotPassword(ctx: OrderContext, body: Record<string, unknown>): Promise<ReplyDraft> {
  const email = lower(body["email"]);
  if (!email || !isValidEmail(email)) return refuse(422, "invalid_email", "Vui lòng nhập email hợp lệ.");
  const repo = customersOf(ctx);
  const customer = await repo.findByEmail(email);
  // RULE 3: the same sentence whether or not the e-mail exists.
  const quiet = "Nếu email tồn tại, shop sẽ gửi link đặt lại mật khẩu.";
  if (!customer) return { status: 200, body: { ok: true, message: quiet } };
  const token = crypto.randomBytes(32).toString("base64url");
  const now = ctx.ports.clock.now();
  const minutes = linkMinutes(ctx);
  await repo.setResetToken({ id: customer["id"], tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + minutes * 60000), now });
  const url = `${siteUrl(ctx)}/account.html?reset=${encodeURIComponent(token)}`;
  const who = text(customer["username"]) || "khách hàng";
  const mail = await sendMail(ctx, email, "Đặt lại mật khẩu",
    `Xin chào ${who},\n\nBấm link sau để đặt lại mật khẩu trong ${minutes} phút:\n${url}\n\nNếu bạn không yêu cầu, hãy bỏ qua email này.`,
    `<p>Xin chào ${escapeHtml(who)},</p><p>Bấm link sau để đặt lại mật khẩu trong ${minutes} phút:</p><p><a href="${escapeHtml(url)}">Đặt lại mật khẩu</a></p><p>Nếu bạn không yêu cầu, hãy bỏ qua email này.</p>`);
  return {
    status: 200,
    body: { ok: true, message: mail.ok ? "Đã gửi link đặt lại mật khẩu nếu email tồn tại." : "Đã tạo link đặt lại mật khẩu, nhưng chưa gửi email (shop chưa cấu hình SMTP hoặc đang chạy thử).", mail }
  };
}

export async function resetPassword(ctx: OrderContext, body: Record<string, unknown>): Promise<ReplyDraft> {
  const token = text(body["token"]);
  const password = String(body["password"] ?? "");
  if (!token) return refuse(422, "missing_token", "Link đặt lại mật khẩu không hợp lệ.");
  if (!isValidPassword(password)) return refuse(422, "weak_password", "Mật khẩu cần ít nhất 6 ký tự.");
  const repo = customersOf(ctx);
  const now = ctx.ports.clock.now();
  const customer = await repo.findByResetToken(hashToken(token), now);
  if (!customer) return refuse(400, "invalid_token", "Link đặt lại mật khẩu đã hết hạn hoặc không hợp lệ.");
  await repo.setPassword({ id: customer["id"], passwordHash: await hashPassword(password), now });
  await repo.deleteSessionsOf(customer["id"]);
  return { status: 200, body: { ok: true, message: "Đã cập nhật mật khẩu. Bạn có thể đăng nhập lại." } };
}

export async function myOrders(ctx: OrderContext, headers: Headers): Promise<ReplyDraft> {
  const customer = await currentCustomer(ctx, headers);
  if (!customer) return LOGIN_REQUIRED();
  const data = await repositoryOf(ctx).searchByCustomer(Number(customer["id"]), 100);
  return { status: 200, headers: NO_STORE, body: { ok: true, data, count: data.length, storage: "mysql" } };
}

export async function cancelMyOrder(ctx: OrderContext, headers: Headers, body: Record<string, unknown>): Promise<ReplyDraft> {
  const customer = await currentCustomer(ctx, headers);
  if (!customer) return LOGIN_REQUIRED();
  const orderId = text(body["orderId"] || body["id"]);
  if (!orderId) return refuse(422, "missing_order_id", "Thiếu mã đơn hàng.");
  const order = await repositoryOf(ctx).readForCustomer(orderId, Number(customer["id"]));
  if (!order) return refuse(404, "order_not_found", "Không tìm thấy đơn hàng của tài khoản này.");
  const status = lower(order.status);
  if (status === "cancelled") return refuse(409, "already_cancelled", "Đơn hàng đã được huỷ.");
  if (!["pending", "processing"].includes(status) || !["", "not_assigned", "processing"].includes(lower(order.fulfillmentStatus))) {
    return refuse(409, "cannot_cancel", "Đơn hàng đã xử lý/xuất kho nên không thể huỷ trên web.");
  }
  if (!canEdit(order, ctx.ports.clock.now())) return refuse(409, "cancel_window_expired", "Đã quá thời gian huỷ đơn 15 phút.");
  const outcome = await changeStatus(ctx, { id: order.id, status: "cancelled", note: "Khách huỷ đơn trong 15 phút.", actor: "khach" });
  if (!outcome.ok) return refuse(409, outcome.reason, "Chưa huỷ được đơn hàng.");
  return { status: 200, headers: NO_STORE, body: { ok: true, order: await readOrder(ctx, order.id), message: "Đã huỷ đơn hàng." } };
}

export async function requestChange(ctx: OrderContext, headers: Headers, body: Record<string, unknown>): Promise<ReplyDraft> {
  const customer = await currentCustomer(ctx, headers);
  if (!customer) return LOGIN_REQUIRED();
  const changeType = text(body["changeType"] || "profile");
  if (changeType !== "profile") return refuse(422, "unsupported_change", "Loại thay đổi chưa được hỗ trợ.");
  const payload: ChangePayload = {};
  if (body["name"] !== undefined) payload.name = text(body["name"]);
  if (body["dateOfBirth"] !== undefined) payload.dateOfBirth = text(body["dateOfBirth"]);
  if (body["gender"] !== undefined) payload.gender = text(body["gender"]);
  if (body["phone"] !== undefined) {
    const phone = normalizePhone(body["phone"]);
    if (phone && !isValidVietnamPhone(phone)) return refuse(422, "invalid_phone", "Số điện thoại chưa đúng định dạng Việt Nam.");
    payload.phone = phone;
  }
  if (body["email"] !== undefined) {
    const email = lower(body["email"]);
    if (!isValidEmail(email)) return refuse(422, "invalid_email", "Email không hợp lệ.");
    payload.email = email;
  }
  for (const field of ["province", "district", "ward", "addressDetail"] as const) {
    if (body[field] !== undefined) payload[field] = text(body[field]);
  }
  if (Object.keys(payload).length === 0) return refuse(422, "nothing_to_change", "Chưa có thông tin cần thay đổi.");
  const targetEmail = lower(customer["email"] || customer["google_email"]);
  if (!targetEmail || !isValidEmail(targetEmail)) return refuse(422, "missing_verified_email", "Tài khoản chưa có email hợp lệ để xác thực thay đổi.");
  const repo = customersOf(ctx);
  if (payload.email && payload.email !== targetEmail && await repo.emailTakenByOther(payload.email, customer["id"])) {
    return refuse(409, "email_exists", "Email này đã được tài khoản khác sử dụng.");
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const now = ctx.ports.clock.now();
  const minutes = linkMinutes(ctx);
  await repo.insertChangeRequest({ customerId: customer["id"], tokenHash: hashToken(token), changeType, payload, expiresAt: new Date(now.getTime() + minutes * 60000), now });
  const url = `${siteUrl(ctx)}/account.html?verify=${encodeURIComponent(token)}`;
  const who = text(customer["username"] || customer["name"]) || "khách hàng";
  const mail = await sendMail(ctx, targetEmail, "Xác thực thay đổi tài khoản",
    `Xin chào ${who},\n\nBấm link sau trong ${minutes} phút để xác nhận thay đổi thông tin tài khoản:\n${url}\n\nNếu bạn không yêu cầu, hãy bỏ qua email này.`,
    `<p>Xin chào ${escapeHtml(who)},</p><p>Bấm link sau trong ${minutes} phút để xác nhận thay đổi thông tin tài khoản:</p><p><a href="${escapeHtml(url)}">Xác nhận thay đổi</a></p><p>Nếu bạn không yêu cầu, hãy bỏ qua email này.</p>`);
  return {
    status: 200,
    body: { ok: true, message: mail.ok ? "Đã gửi email xác thực thay đổi. Vui lòng kiểm tra hộp thư." : "Đã tạo yêu cầu thay đổi, nhưng chưa gửi email (shop chưa cấu hình SMTP hoặc đang chạy thử).", mail }
  };
}

export async function verifyChange(ctx: OrderContext, body: Record<string, unknown>): Promise<ReplyDraft> {
  const token = text(body["token"]);
  if (!token) return refuse(422, "missing_token", "Link xác thực không hợp lệ.");
  const repo = customersOf(ctx);
  const now = ctx.ports.clock.now();
  const request = await repo.findChangeRequest(hashToken(token), now);
  if (!request) return refuse(400, "invalid_token", "Link xác thực đã hết hạn hoặc không hợp lệ.");
  let payload: ChangePayload = {};
  try { payload = JSON.parse(String(request["payload_json"] || "{}")) as ChangePayload; } catch { payload = {}; }
  await repo.applyChange(request, payload, now);
  return { status: 200, body: { ok: true, message: "Đã xác thực và cập nhật thông tin tài khoản." } };
}
