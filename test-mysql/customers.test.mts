/**
 * CUSTOMER ACCOUNTS on REAL MySQL — the running site's `/api/account/*` doors, same wire.
 *
 *   TOPRUN_MYSQL_URL=mysql://root:...@127.0.0.1:3307/toprun_modules_test \
 *     node --test --test-concurrency=1 --test-force-exit test-mysql/customers.test.mts
 *
 * Focus: a session is a hashed token in an HttpOnly cookie; password reset kills every session;
 * profile changes wait for the e-mail link; the answers never reveal whether an e-mail exists;
 * trial mode mails nobody and says so.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ROLE, defineModule, type Reply } from "../dist/contract/index.js";
import {
  FakeHttpClient, FakeStaticFilePort, FixedWindowRateLimiter, Kernel, ManualClock, MemoryLogger, MemoryMailer, TokenAuth, TrialModeMailer, openMysqlStore
} from "../dist/kernel/index.js";
import { manifest, type ReleaseInput, type ReserveInput, type ReserveResult } from "../dist/modules/don-khach/module.js";

const ADMIN = "ma-quan-tri";
const URL = String(process.env["TOPRUN_MYSQL_URL"] || "").trim();
const skip = URL ? {} : { skip: "TOPRUN_MYSQL_URL not set — skipping the customer-account tests" };
if (URL && /:3306\//.test(URL)) throw new Error("Cổng 3306 là dữ liệu thật của landing. Dùng 3307.");

// A tiny fake Inventory so orders can be placed (the account links to them).
let qty = 5;
const fakeInventory = defineModule({
  id: "hang-kho", name: "Kho giả", tier: "van-hanh", runsOn: "server-khach", version: "0.0.0",
  provides: {
    "hang-kho.reserve": (_ctx, input: ReserveInput): ReserveResult => {
      if (qty < input.quantity) return { ok: false, reason: "khong_du_hang" };
      qty -= input.quantity;
      return { ok: true, ticket: `giu_${Date.now()}_${Math.random()}`, variantId: "DV1234-42", size: input.size, price: 2890000, warehouseId: "wh_yen" };
    },
    "hang-kho.release": (_ctx, _input: ReleaseInput) => { qty += 1; return { ok: true }; },
    "hang-kho.commit": () => ({ ok: true, variantId: "DV1234-42", quantity: 1 }),
    "hang-kho.restock": (_ctx, input: { quantity: number }) => { qty += input.quantity; return { ok: true }; }
  }
});

const body = <T,>(r: Reply): T => r.body as T;
/** The session cookie value out of a reply's Set-Cookie, or "" when the reply clears it. */
function cookieOf(r: Reply): string {
  const header = String(r.headers?.["Set-Cookie"] ?? "");
  const m = /toprun_account_session=([^;]*)/.exec(header);
  return m ? decodeURIComponent(m[1] ?? "") : "";
}
const withCookie = (token: string) => (token ? { cookie: `toprun_account_session=${encodeURIComponent(token)}` } : {});

interface AccountBody { ok: boolean; error?: string; message?: string; customer?: { id: number; username: string; email: string; name: string; phone: string } | null; linkedOrder?: { ok: boolean; skipped?: boolean; orderId?: string }; mail?: { ok: boolean; configured: boolean; blocked?: boolean } }

test("Customer accounts on real MySQL", { ...skip }, async (t) => {
  const logger = new MemoryLogger();
  const clock = new ManualClock();
  const store = await openMysqlStore({ url: URL, logger });
  const mailer = new MemoryMailer();

  // Disposable test database: an orders table from an older schema is started over (see orders.test.mts).
  const columns = await store.rows("SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'");
  if (columns.length > 0 && !columns.some((r) => r["c"] === "stock_reservation_json")) {
    for (const table of ["order_status_logs", "order_items", "orders"]) await store.execute(`DROP TABLE IF EXISTS \`${table}\``);
    await store.execute("DELETE FROM lich_su_luoc_do WHERE module = ?", [manifest.id]);
  }
  await store.runSchema(manifest.id, manifest.schema ?? [], { inheritedTables: manifest.inheritedTables ?? [] });

  const cleanUp = async () => {
    clock.advance(11 * 60 * 1000);
    for (const table of ["customer_change_requests", "customer_addresses", "customer_sessions", "customers", "order_status_logs", "order_items", "orders"]) await store.execute(`DELETE FROM \`${table}\``);
    mailer.sent.length = 0;
    qty = 5;
  };
  await cleanUp();
  t.after(async () => { await cleanUp(); await store.close(); });

  const makeKernel = (mail: MemoryMailer | TrialModeMailer) => new Kernel({
    ports: {
      store, logger, clock, http: new FakeHttpClient(),
      auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }], clock }),
      rateLimiter: new FixedWindowRateLimiter(clock),
      staticFiles: new FakeStaticFilePort({ "don-khach/goc/account.html": "<html>tài khoản</html>", "don-khach/goc/account.js": "// js" }),
      mail
    },
    logger, modules: [fakeInventory, manifest], config: { "hang-kho": {}, "don-khach": { siteUrl: "https://shop.test", https: false, sessionDays: 30, resetMinutes: 30 } }
  });
  const kernel = makeKernel(mailer);
  const call = (method: string, path: string, json?: unknown, headers: Record<string, string> = {}) =>
    kernel.handle({ method, path, headers, ip: "1.1.1.1", json: async () => json ?? {} });
  const GOOD = { username: "khach.a", email: "a@example.com", password: "matkhau1", confirmPassword: "matkhau1" };

  await t.test("the account pages are served from this module's goc/", async () => {
    const page = await call("GET", "/account.html");
    assert.equal(page.status, 200);
    assert.match(String(page.file?.type), /text\/html/);
    assert.equal((await call("GET", "/account.js")).status, 200);
    assert.equal((await call("GET", "/account-manage.html")).status, 404, "not in the fake zone -> 404, never another module's file");
  });

  await t.test("register: bad username / mismatch are 422, success sets an HttpOnly cookie and hides the password hash", async () => {
    await cleanUp();
    assert.equal(body<AccountBody>(await call("POST", "/api/account/register", { ...GOOD, username: "a" })).error, "invalid_account");
    assert.equal(body<AccountBody>(await call("POST", "/api/account/register", { ...GOOD, confirmPassword: "khac" })).error, "password_mismatch");
    const r = await call("POST", "/api/account/register", GOOD);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const made = body<AccountBody>(r);
    assert.equal(made.customer?.username, "khach.a");
    assert.equal(made.customer?.email, "a@example.com");
    assert.ok(!JSON.stringify(r.body).includes("pbkdf2"), "the hash never leaves");
    const cookie = String(r.headers?.["Set-Cookie"]);
    assert.match(cookie, /^toprun_account_session=.+; Path=\/; Max-Age=2592000; HttpOnly; SameSite=Lax$/);
    const row = await store.table("customers").one({ username: "khach.a" });
    assert.match(String(row?.["password_hash"]), /^pbkdf2\$210000\$/, "same hash shape as the running site");
    const session = await store.table("customer_sessions").one({ customer_id: Number(row?.["id"]) });
    assert.notEqual(session?.["token_hash"], cookieOf(r), "the table holds the HASH, the cookie the token");

    assert.equal(body<AccountBody>(await call("POST", "/api/account/register", GOOD)).error, "account_exists");
    assert.equal(body<AccountBody>(await call("POST", "/api/account/register", { ...GOOD, username: "khac" })).error, "account_exists", "same e-mail = exists");
  });

  await t.test("me / login / logout: the cookie is the identity; a wrong password is 401 and says nothing more", async () => {
    await cleanUp();
    const reg = await call("POST", "/api/account/register", GOOD);
    const token = cookieOf(reg);
    assert.equal(body<AccountBody>(await call("GET", "/api/account/me")).customer, null, "no cookie = nobody");
    assert.equal(body<AccountBody>(await call("GET", "/api/account/me", undefined, withCookie(token))).customer?.username, "khach.a");

    const wrong = await call("POST", "/api/account/login", { login: "khach.a", password: "sai" });
    assert.equal(wrong.status, 401);
    assert.equal(body<AccountBody>(wrong).error, "invalid_login");
    const byEmail = await call("POST", "/api/account/login", { login: "A@Example.com", password: "matkhau1" });
    assert.equal(byEmail.status, 200, JSON.stringify(byEmail.body));
    const token2 = cookieOf(byEmail);
    assert.ok(token2 && token2 !== token, "a login is a new session");

    const out = await call("POST", "/api/account/logout", {}, withCookie(token2));
    assert.match(String(out.headers?.["Set-Cookie"]), /Max-Age=0/);
    assert.equal(body<AccountBody>(await call("GET", "/api/account/me", undefined, withCookie(token2))).customer, null, "logged out");
    assert.equal(body<AccountBody>(await call("GET", "/api/account/me", undefined, withCookie(token))).customer?.username, "khach.a", "the other session lives on");
    assert.equal((await call("GET", "/api/account/profile")).status, 401);
    assert.equal(body<AccountBody>(await call("GET", "/api/account/profile", undefined, withCookie(token))).customer?.username, "khach.a");
  });

  await t.test("my orders: the order placed before registering is linked by id + lookup token, listed, and cancelled within 15 minutes (stock goes back)", async () => {
    await cleanUp();
    const placed = body<{ id: string; token: string }>(await call("POST", "/api/orders", {
      customerName: "Khách A", phone: "0911111111", province: "Hà Nội", items: [{ productCode: "DV1234", size: "42", qty: 1 }]
    }));
    assert.equal(qty, 4);
    const reg = await call("POST", "/api/account/register", { ...GOOD, orderId: placed.id, orderToken: placed.token });
    assert.equal(body<AccountBody>(reg).linkedOrder?.ok, true, JSON.stringify(reg.body));
    const token = cookieOf(reg);
    const mine = body<{ ok: boolean; data: { id: string; status: string }[]; count: number }>(await call("GET", "/api/account/orders", undefined, withCookie(token)));
    assert.equal(mine.count, 1);
    assert.equal(mine.data[0]?.id, placed.id);

    // Someone else's account cannot cancel it, and a wrong token cannot link it.
    const other = await call("POST", "/api/account/register", { username: "nguoi.khac", email: "b@example.com", password: "matkhau2" });
    const cancelByOther = await call("POST", "/api/account/orders/cancel", { orderId: placed.id }, withCookie(cookieOf(other)));
    assert.equal(cancelByOther.status, 404);
    const relink = await call("POST", "/api/account/login", { login: "nguoi.khac", password: "matkhau2", orderId: placed.id, orderToken: placed.token });
    assert.equal(body<AccountBody>(relink).linkedOrder?.ok, false, "an order already linked to A is not re-linked to B");

    const cancel = await call("POST", "/api/account/orders/cancel", { orderId: placed.id }, withCookie(token));
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    assert.equal(qty, 5, "cancelling from the account page gives the pair back too");
    assert.equal(body<AccountBody>(await call("POST", "/api/account/orders/cancel", { orderId: placed.id }, withCookie(token))).error, "already_cancelled");
  });

  await t.test("forgot / reset password: same answer whether the e-mail exists; the link works once and logs every session out", async () => {
    await cleanUp();
    const reg = await call("POST", "/api/account/register", GOOD);
    const token = cookieOf(reg);
    const unknown = body<AccountBody>(await call("POST", "/api/account/forgot-password", { email: "khong@example.com" }));
    assert.equal(unknown.ok, true);
    assert.equal(mailer.sent.length, 0);
    const known = body<AccountBody>(await call("POST", "/api/account/forgot-password", { email: "a@example.com" }));
    assert.equal(known.ok, true);
    assert.equal(known.mail?.ok, true);
    assert.equal(mailer.sent.length, 1);
    assert.equal(mailer.sent[0]?.to, "a@example.com");
    const link = /https:\/\/shop\.test\/account\.html\?reset=([^\s"<]+)/.exec(mailer.sent[0]?.text ?? "");
    assert.ok(link, "the mail carries the reset link");
    const resetToken = decodeURIComponent(link![1] ?? "");
    assert.notEqual((await store.table("customers").one({ username: "khach.a" }))?.["reset_token_hash"], resetToken, "hashed in the table");

    assert.equal(body<AccountBody>(await call("POST", "/api/account/reset-password", { token: resetToken, password: "12" })).error, "weak_password");
    const done = await call("POST", "/api/account/reset-password", { token: resetToken, password: "matkhaumoi" });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(body<AccountBody>(await call("GET", "/api/account/me", undefined, withCookie(token))).customer, null, "old sessions are dead");
    assert.equal((await call("POST", "/api/account/login", { login: "khach.a", password: "matkhau1" })).status, 401);
    assert.equal((await call("POST", "/api/account/login", { login: "khach.a", password: "matkhaumoi" })).status, 200);
    assert.equal(body<AccountBody>(await call("POST", "/api/account/reset-password", { token: resetToken, password: "matkhaumoi2" })).error, "invalid_token", "used once");

    clock.advance(31 * 60 * 1000);
    await call("POST", "/api/account/forgot-password", { email: "a@example.com" });
    const late = /reset=([^\s"<]+)/.exec(mailer.sent[1]?.text ?? "")?.[1] ?? "";
    clock.advance(31 * 60 * 1000);
    assert.equal(body<AccountBody>(await call("POST", "/api/account/reset-password", { token: decodeURIComponent(late), password: "matkhaumoi3" })).error, "invalid_token", "expired after 30 minutes");
  });

  await t.test("change my profile: nothing changes until the link in the e-mail is opened; then name, phone and a default address are written", async () => {
    await cleanUp();
    const token = cookieOf(await call("POST", "/api/account/register", GOOD));
    assert.equal((await call("POST", "/api/account/request-change", { name: "X" })).status, 401);
    assert.equal(body<AccountBody>(await call("POST", "/api/account/request-change", {}, withCookie(token))).error, "nothing_to_change");
    assert.equal(body<AccountBody>(await call("POST", "/api/account/request-change", { phone: "123" }, withCookie(token))).error, "invalid_phone");
    const asked = await call("POST", "/api/account/request-change", { name: "Nguyễn Văn A", phone: "0912 345 678", province: "Hà Nội", ward: "Phường Giảng Võ", addressDetail: "12 Đội Cấn" }, withCookie(token));
    assert.equal(asked.status, 200, JSON.stringify(asked.body));
    assert.equal(mailer.sent.length, 1);
    assert.equal(body<AccountBody>(await call("GET", "/api/account/me", undefined, withCookie(token))).customer?.name, "khach.a", "NOT applied yet");
    const verify = decodeURIComponent(/verify=([^\s"<]+)/.exec(mailer.sent[0]?.text ?? "")?.[1] ?? "");
    const done = await call("POST", "/api/account/verify-change", { token: verify });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const prof = body<AccountBody & { address: { province: string; addressDetail: string; fullAddress: string } }>(await call("GET", "/api/account/profile", undefined, withCookie(token)));
    assert.equal(prof.customer?.name, "Nguyễn Văn A");
    assert.equal(prof.customer?.phone, "0912345678");
    assert.equal(prof.address.province, "Hà Nội");
    assert.match(prof.address.fullAddress, /12 Đội Cấn/);
    assert.equal(body<AccountBody>(await call("POST", "/api/account/verify-change", { token: verify })).error, "invalid_token", "a link is used once");
  });

  await t.test("TRIAL MODE mails nobody: the link is created, the customer is told the mail was not sent, nothing goes out", async () => {
    await cleanUp();
    const trialMail = new TrialModeMailer(logger);
    const trial = makeKernel(trialMail);
    await trial.handle({ method: "POST", path: "/api/account/register", headers: {}, ip: "2.2.2.2", json: async () => GOOD });
    const r = await trial.handle({ method: "POST", path: "/api/account/forgot-password", headers: {}, ip: "2.2.2.2", json: async () => ({ email: "a@example.com" }) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const out = body<AccountBody>(r);
    assert.equal(out.mail?.ok, false);
    assert.equal(out.mail?.blocked, true);
    assert.match(String(out.message), /chưa gửi/);
    assert.equal(trialMail.blocked.length, 1, "the blocked mail is recorded, not lost");
    assert.ok((await store.table("customers").one({ username: "khach.a" }))?.["reset_token_hash"], "the reset link exists — the owner can read it in the log");
  });
});
