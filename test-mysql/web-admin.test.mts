/**
 * The web admin's people — on real MySQL (port 3307).
 *
 * Every test proves one of the module's five rules, and each rule has a "breaks if" half:
 *   1. no session, no admin code          4. five wrong passwords lock the login
 *   2. a new device waits for the owner   5. only an owner manages people; the last owner stays
 *   3. revoking is immediate
 * plus the point of it all: a person's session opens EVERY `ACCESS.admin` route of every module.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FakeHttpClient, FakeStaticFilePort, FixedWindowRateLimiter, Kernel, ManualClock, MemoryLogger, TokenAuth, openMysqlStore
} from "../dist/kernel/index.js";
import { ACCESS, ROLE, defineModule, type IncomingRequest, type Reply } from "../dist/contract/index.js";
import { manifest } from "../dist/modules/quan-tri/module.js";
import { AdminSessionResolver, seedOwnerFromEnv } from "../dist/modules/quan-tri/sessions.js";
import { DEVICES_TABLE, LOGIN_FAILURES_TABLE, PEOPLE_TABLE, SCHEMA, SESSIONS_TABLE } from "../dist/modules/quan-tri/schema.js";

const URL = String(process.env["TOPRUN_MYSQL_URL"] || "").trim();
const skipWithoutDb = URL ? {} : { skip: "chưa đặt TOPRUN_MYSQL_URL — bỏ qua bài quản trị web" };
if (URL && /:3306\//.test(URL)) throw new Error("Cổng 3306 là dữ liệu thật của landing. Dùng 3307.");

const ADMIN_KEY = "ma-quan-tri-may";
const OWNER_PASSWORD = "mat-khau-chu-shop";
const PHONE = "may-dien-thoai-chu-shop";
const LAPTOP = "may-tinh-nhan-vien-01";

test("The web admin on real MySQL", { ...skipWithoutDb }, async (t) => {
  const logger = new MemoryLogger();
  const clock = new ManualClock();
  const store = await openMysqlStore({ url: URL, logger });
  await store.runSchema("quan-tri", SCHEMA);

  // Another module's admin route: the proof that a person's session opens EVERY admin door.
  const orders = defineModule({
    id: "don-thu", name: "Đơn thử", tier: "van-hanh", runsOn: "server-khach", version: "0.0.1",
    routes: [{ method: "GET", path: "/api/orders", access: ACCESS.admin, handle: (_ctx, request) => ({ status: 200, body: { ok: true, ai: request.caller?.name } }) }]
  });

  const auth = new TokenAuth({ keys: [{ token: ADMIN_KEY, name: "quan-tri", role: ROLE.admin }], clock });
  auth.usePersonSessions(new AdminSessionResolver(store, clock));
  const kernel = new Kernel({
    ports: {
      store, logger, clock, http: new FakeHttpClient(), auth, rateLimiter: new FixedWindowRateLimiter(clock),
      staticFiles: new FakeStaticFilePort({
        "quan-tri/goc/admin.html": "<html>ADMIN</html>", "quan-tri/goc/admin.js": "// ban do moi duong quan tri",
        "quan-tri/goc/admin-login.html": "<html>LOGIN</html>", "quan-tri/goc/admin-login.js": "", "quan-tri/goc/admin.css": ""
      })
    },
    logger, modules: [manifest, orders], config: { "quan-tri": { sessionDays: 14 }, "don-thu": {} }
  });

  const cleanUp = async () => {
    for (const table of [SESSIONS_TABLE, DEVICES_TABLE, PEOPLE_TABLE, LOGIN_FAILURES_TABLE]) await store.table(table).truncate();
    clock.advance(20 * 60 * 1000);
  };
  await cleanUp();
  t.after(async () => { await cleanUp(); await store.close(); });

  let ip = 0;
  const call = (method: string, path: string, { payload, cookie, headers, from }: { payload?: unknown; cookie?: string; headers?: IncomingRequest["headers"]; from?: string } = {}): Promise<Reply> =>
    kernel.handle({ method, path, ip: from ?? `10.0.0.${(ip = (ip % 200) + 1)}`, query: {}, headers: { ...(headers ?? {}), ...(cookie ? { cookie } : {}) }, json: async () => payload ?? {} });
  const machine = { authorization: `Bearer ${ADMIN_KEY}` };
  const seedOwner = () => seedOwnerFromEnv(store, { ADMIN_LOGIN: "Chu", ADMIN_PASSWORD: OWNER_PASSWORD }, clock, logger);
  const cookieOf = (r: Reply): string => {
    const set = r.headers?.["Set-Cookie"] ?? "";
    return `toprun_admin_session=${set.split("=")[1]?.split(";")[0] ?? ""}`;
  };
  const login = async (loginName: string, password: string, deviceId: string, from = "1.1.1.1") =>
    call("POST", "/api/admin/login", { payload: { login: loginName, password, deviceId, deviceName: "Thử" }, from });
  const body = (r: Reply) => r.body as Record<string, unknown>;

  await t.test("the first owner comes from .env once; the owner's FIRST device is approved, and the session opens other modules' admin routes", async () => {
    await cleanUp(); await seedOwner();
    await seedOwnerFromEnv(store, { ADMIN_LOGIN: "ke-khac", ADMIN_PASSWORD: "mat-khau-khac-1" }, clock, logger);
    assert.equal(await store.table(PEOPLE_TABLE).count(), 1, "the variables are ignored once someone exists");

    const r = await login("chu", OWNER_PASSWORD, PHONE);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.headers?.["Set-Cookie"] ?? "", /HttpOnly/);
    const cookie = cookieOf(r);
    const orders = await call("GET", "/api/orders", { cookie });
    assert.equal(orders.status, 200);
    assert.equal(body(orders)["ai"], "nguoi:chu", "the order history will name the person");
    assert.equal(body(await call("GET", "/api/admin/me", { cookie }))["admin"] && (body(await call("GET", "/api/admin/me", { cookie }))["admin"] as { role: string }).role, "chu-shop");
  });

  await t.test("RULE 1 — BREAKS IF the admin page or script reaches someone without a session", async () => {
    await cleanUp(); await seedOwner();
    const page = await call("GET", "/admin");
    assert.equal(page.redirect, "/admin-login");
    assert.equal((await call("GET", "/admin.js")).status, 404);
    assert.equal((await call("GET", "/api/orders", { cookie: "toprun_admin_session=doan-bua" })).status, 401);

    const cookie = cookieOf(await login("chu", OWNER_PASSWORD, PHONE));
    assert.match(String((await call("GET", "/admin", { cookie })).file?.data), /ADMIN/);
    assert.equal((await call("GET", "/admin.js", { cookie })).status, 200);
    assert.equal((await call("GET", "/admin-login", { cookie })).redirect, "/admin", "already in: straight to the admin");
  });

  await t.test("RULE 2 — a staff member's new device waits; the owner approves it; a blocked one loses its session", async () => {
    await cleanUp(); await seedOwner();
    const owner = cookieOf(await login("chu", OWNER_PASSWORD, PHONE));
    assert.equal((await call("POST", "/api/admin/nguoi", { cookie: owner, payload: { dangNhap: "lan", ten: "Lan", vai: "nhan-vien", matKhau: "mat-khau-lan-1" } })).status, 200);

    const waiting = await login("lan", "mat-khau-lan-1", LAPTOP);
    assert.equal(waiting.status, 403);
    assert.equal(body(waiting)["error"], "device_not_approved");
    assert.ok(!waiting.headers?.["Set-Cookie"], "no session before approval");

    const people = body(await call("GET", "/api/admin/nguoi", { cookie: owner }))["nguoi"] as { id: string; login: string }[];
    const lan = people.find((p) => p.login === "lan")!;
    assert.equal((await call("POST", "/api/admin/devices", { cookie: owner, payload: { maNguoi: lan.id, deviceId: LAPTOP, status: "approved" } })).status, 200);
    const staff = cookieOf(await login("lan", "mat-khau-lan-1", LAPTOP));
    assert.equal((await call("GET", "/api/orders", { cookie: staff })).status, 200);

    await call("POST", "/api/admin/devices", { cookie: owner, payload: { maNguoi: lan.id, deviceId: LAPTOP, status: "blocked" } });
    assert.equal((await call("GET", "/api/orders", { cookie: staff })).status, 401, "blocking the device ends its session at once");
    assert.equal(body(await login("lan", "mat-khau-lan-1", LAPTOP))["error"], "device_blocked");
  });

  await t.test("RULE 3 — logging out, switching a person off and a new password each end the session on the NEXT request", async () => {
    await cleanUp(); await seedOwner();
    const owner = cookieOf(await login("chu", OWNER_PASSWORD, PHONE));
    await call("POST", "/api/admin/logout", { cookie: owner });
    assert.equal((await call("GET", "/api/orders", { cookie: owner })).status, 401);

    const again = cookieOf(await login("chu", OWNER_PASSWORD, PHONE));
    await call("POST", "/api/admin/nguoi", { cookie: again, payload: { dangNhap: "lan", matKhau: "mat-khau-lan-1", vai: "chu-shop" } });
    const lanPerson = (await store.table(PEOPLE_TABLE).one({ dang_nhap: "lan" }))!;
    const lan = cookieOf(await login("lan", "mat-khau-lan-1", LAPTOP));   // an owner's first device
    assert.equal((await call("GET", "/api/orders", { cookie: lan })).status, 200, String(lanPerson["ma"]));

    await call("POST", "/api/admin/nguoi", { cookie: again, payload: { dangNhap: "lan", dangBat: false } });
    assert.equal((await call("GET", "/api/orders", { cookie: lan })).status, 401, "switched off: out at once");

    // Your own password: the other sessions end, the one in use stays.
    const second = cookieOf(await login("chu", OWNER_PASSWORD, PHONE, "2.2.2.2"));
    const changed = await call("POST", "/api/admin/password-reset", { cookie: again, payload: { currentPassword: OWNER_PASSWORD, password: "mat-khau-moi-12" } });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.equal((await call("GET", "/api/orders", { cookie: again })).status, 200);
    assert.equal((await call("GET", "/api/orders", { cookie: second })).status, 401);
    assert.equal((await call("POST", "/api/admin/password-reset", { cookie: again, payload: { currentPassword: "sai", password: "mat-khau-moi-34" } })).status, 400, "the current password is required");
  });

  await t.test("RULE 4 — five wrong passwords lock the login for fifteen minutes, the right one included", async () => {
    await cleanUp(); await seedOwner();
    for (let i = 0; i < 5; i += 1) assert.equal((await login("chu", "sai-mat-khau", PHONE)).status, 401);
    assert.equal((await login("chu", OWNER_PASSWORD, PHONE)).status, 429);
    assert.equal((await login("chu", OWNER_PASSWORD, PHONE, "9.9.9.9")).status, 200, "another address is not locked by a guesser elsewhere");
    clock.advance(16 * 60 * 1000);
    assert.equal((await login("chu", OWNER_PASSWORD, PHONE)).status, 200);
    // One refusal for everything: an unknown name reads exactly like a wrong password.
    assert.deepEqual(body(await login("khong-ai", "x-x-x-x-x", PHONE, "3.3.3.3")), body(await login("chu", "sai-mat-khau", PHONE, "3.3.3.4")));
  });

  await t.test("RULE 5 — BREAKS IF staff manage people or devices, or the last owner can be switched off", async () => {
    await cleanUp(); await seedOwner();
    const owner = cookieOf(await login("chu", OWNER_PASSWORD, PHONE));
    await call("POST", "/api/admin/nguoi", { cookie: owner, payload: { dangNhap: "lan", matKhau: "mat-khau-lan-1" } });
    const lanId = String((await store.table(PEOPLE_TABLE).one({ dang_nhap: "lan" }))!["ma"]);
    await store.table(DEVICES_TABLE).upsert({ ma_nguoi: lanId, ma_may: LAPTOP, ten_may: "", trang_thai: "approved", ip: "", trinh_duyet: "", lan_dau: "2026-09-16 00:00:00", lan_cuoi: "2026-09-16 00:00:00" });
    const staff = cookieOf(await login("lan", "mat-khau-lan-1", LAPTOP));

    assert.equal((await call("GET", "/api/admin/nguoi", { cookie: staff })).status, 403);
    assert.equal((await call("POST", "/api/admin/nguoi", { cookie: staff, payload: { dangNhap: "lan", vai: "chu-shop" } })).status, 403, "staff cannot promote themselves");
    assert.equal((await call("GET", "/api/admin/devices", { cookie: staff })).status, 403);
    assert.equal((await call("POST", "/api/admin/password-reset", { cookie: staff, payload: { login: "chu", password: "chiem-quyen-123" } })).status, 403);

    const last = await call("POST", "/api/admin/nguoi", { cookie: owner, payload: { dangNhap: "chu", dangBat: false } });
    assert.equal(last.status, 409, "the shop must never lock itself out");
    assert.equal((await call("POST", "/api/admin/nguoi", { cookie: owner, payload: { dangNhap: "chu", vai: "nhan-vien" } })).status, 409);
    // The machine key (OMI, Desk) counts as the owner.
    assert.equal((await call("GET", "/api/admin/nguoi", { headers: machine })).status, 200);
  });

  await t.test("the password hash never leaves the server", async () => {
    await cleanUp(); await seedOwner();
    const owner = cookieOf(await login("chu", OWNER_PASSWORD, PHONE));
    const text = JSON.stringify([
      (await call("GET", "/api/admin/nguoi", { cookie: owner })).body,
      (await call("GET", "/api/admin/devices", { cookie: owner })).body,
      (await call("GET", "/api/admin/me", { cookie: owner })).body
    ]);
    assert.ok(!text.includes("pbkdf2"), text);
  });
});
