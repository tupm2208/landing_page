/**
 * COLLABORATORS — login, device approval, image download.
 *
 * Most of this suite is BLOCKING tests: this is a login door for people OUTSIDE the shop, so it is
 * the easiest place to lose.
 *
 * Needs the trial MySQL on port 3307. PORT 3306 IS THE REAL LANDING DATA — FORBIDDEN.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ROLE, defineModule, type AnyManifest, type Reply } from "../dist/contract/index.js";
import { FixedWindowRateLimiter, Kernel, ManualClock, MemoryLogger, TokenAuth, openMysqlStore } from "../dist/kernel/index.js";
import { manifest as collaborators } from "../dist/modules/ctv/module.js";
import { hashPassword, verifyPassword } from "../dist/modules/ctv/password.js";

const ADMIN = "ma-quan-tri";
const SECRET = "bi-mat-phien-ctv-that-dai";
const URL = String(process.env["TOPRUN_MYSQL_URL"] || "").trim();
const skip = URL ? {} : { skip: "TOPRUN_MYSQL_URL not set — skipping the collaborator suite" };
if (URL && /:3306\//.test(URL)) throw new Error("Cong 3306 la du lieu that cua landing. Dung 3307.");

/** What `hang-kho.read` hands back for CTV001 — carries stock, price and warehouse that must NOT leak. */
const PRODUCT = {
  code: "CTV001", name: "Giày cho CTV bán", brand: "Nike",
  thumbnailImage: "/assets/products/ctv001.jpg",
  highImage: "/assets/products/ctv001-lon.jpg",
  galleryImages: ["/assets/products/ctv001-2.jpg", "/assets/products/ctv001-2.jpg", "/assets/products/ctv001-3.jpg"],
  sizes: [{ size: "42", qty: 3, price: 2000000, warehouseId: "wh_yen", warehouse: "Yên" }]
};

/** A fake inventory module: the real one is being ported in parallel, and this suite only needs `hang-kho.read`. */
const fakeInventory: AnyManifest = defineModule({
  id: "hang-kho", name: "Hàng kho giả", tier: "van-hanh", runsOn: "server-khach", version: "0.0.1",
  provides: { "hang-kho.read": async (_ctx, code: string) => (code === PRODUCT.code ? PRODUCT : null) }
});

type Body = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any -- test reads arbitrary JSON fields
const bodyOf = (r: Reply) => r.body as Body;

// ---------- no MySQL needed ----------

test("password hash: the SHAPE IS KEPT EXACTLY as on the running site", async () => {
  const hash = await hashPassword("mat-khau-that-dai");
  const [scheme, iterations, salt, key] = hash.split("$");
  assert.equal(scheme, "pbkdf2");
  assert.equal(iterations, "210000", "changing the iteration count = the six real collaborators must reset their passwords");
  assert.ok(salt!.length >= 20);
  assert.ok(key!.length >= 40);
  assert.equal(await verifyPassword("mat-khau-that-dai", hash), true);
  assert.equal(await verifyPassword("mat-khau-khac", hash), false);
});

test("a garbage stored hash verifies as FALSE, never throws", async () => {
  for (const garbage of ["", "abc", "pbkdf2$", "pbkdf2$0$x$y", "scrypt$1$a$b", null, undefined]) {
    assert.equal(await verifyPassword("gi cung duoc", garbage), false, `"${garbage}" must be false`);
  }
});

test("hashing the same password twice gives two different hashes (own salt each)", async () => {
  const a = await hashPassword("cung-mot-mat-khau");
  const b = await hashPassword("cung-mot-mat-khau");
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("cung-mot-mat-khau", a), true);
  assert.equal(await verifyPassword("cung-mot-mat-khau", b), true);
});

// ---------- real MySQL ----------

test("Collaborators on real MySQL", { ...skip }, async (t) => {
  const logger = new MemoryLogger();
  const clock = new ManualClock();
  const store = await openMysqlStore({ url: URL, logger });

  await store.runSchema("ctv", collaborators.schema ?? []);

  const cleanUp = async () => {
    for (const table of ["ctv_nhat_ky_tai", "ctv_phien", "ctv_thiet_bi", "ctv_tai_khoan"]) {
      await store.execute(`DELETE FROM \`${table}\``, []);
    }
    clock.advance(16 * 60 * 1000);   // stay clear of the 20 calls / 15 minutes login limit
  };
  await cleanUp();
  t.after(async () => { await cleanUp(); await store.close(); });

  const buildKernel = (modules: AnyManifest[]) => new Kernel({
    ports: {
      store, logger, clock,
      auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }], clock }),
      rateLimiter: new FixedWindowRateLimiter(clock)
    },
    logger, modules, config: { ctv: { sessionSecret: SECRET }, "hang-kho": {} }
  });
  const kernel = buildKernel([collaborators, fakeInventory]);

  const adminHeaders = { authorization: `Bearer ${ADMIN}` };
  const addCollaborator = (body: Body, k = kernel) =>
    k.handle({ method: "POST", path: "/api/admin/ctv", query: {}, headers: adminHeaders, ip: "1.1.1.1", json: async () => body });
  const login = (body: Body, cookie = "", k = kernel) => k.handle({
    method: "POST", path: "/api/ctv/login", query: {}, ip: "2.2.2.2",
    headers: cookie ? { cookie, "user-agent": "May cua CTV" } : { "user-agent": "May cua CTV" },
    json: async () => body
  });
  const cookieFrom = (r: Reply, name: string) => {
    const raw = String(r.headers?.["Set-Cookie"] || "");
    const m = raw.match(new RegExp(`${name}=([^;]*)`));
    return m ? `${name}=${m[1]}` : "";
  };
  const asCollaborator = (path: string, cookie: string, query: Record<string, string> = {}, k = kernel) => k.handle({
    method: "GET", path, query, ip: "2.2.2.2", headers: cookie ? { cookie } : {}
  });
  const adminGet = (path: string, k = kernel) => k.handle({ method: "GET", path, query: {}, headers: adminHeaders });
  const decideDevice = (body: Body, k = kernel) =>
    k.handle({ method: "POST", path: "/api/admin/ctv/thiet-bi", query: {}, headers: adminHeaders, json: async () => body });

  await t.test("adding a collaborator: no password is refused, a short password too", async () => {
    await cleanUp();
    assert.equal(bodyOf(await addCollaborator({ ten: "Đặng Mai", dienThoai: "0356095310" })).error, "thieu_mat_khau");
    assert.equal(bodyOf(await addCollaborator({ ten: "Đặng Mai", dienThoai: "0356095310", matKhau: "ngan" })).error, "mat_khau_qua_ngan");
    assert.equal(bodyOf(await addCollaborator({ ten: "Đặng Mai", dienThoai: "123" })).error, "thieu_ten_hoac_dien_thoai");
  });

  await t.test("THE PASSWORD HASH never leaves the machine", async () => {
    await cleanUp();
    const r = await addCollaborator({ ten: "Đặng Mai", dienThoai: "0356095310", matKhau: "mat-khau-cua-mai" });
    assert.equal(r.status, 200);
    const json = JSON.stringify(r.body);
    assert.ok(!json.includes("pbkdf2"), "the hash leaked out");
    assert.ok(!json.includes("mat-khau-cua-mai"), "the plain password leaked out");
    assert.equal(bodyOf(r).ctv.coMatKhau, true, "says only that there IS a password, not what it is");

    const list = await adminGet("/api/admin/ctv");
    assert.ok(!JSON.stringify(list.body).includes("pbkdf2"), "the admin list must not carry the hash either");
  });

  await t.test("an UNKNOWN DEVICE must be approved by the shop owner before it gets in", async () => {
    await cleanUp();
    const added = await addCollaborator({ ten: "Đặng Mai", dienThoai: "0356095310", matKhau: "mat-khau-cua-mai" });
    const collaboratorId = bodyOf(added).ctv.ma;

    // First time: right password, unknown machine -> 403, plus a device id to be recognised next time.
    const first = await login({ login: "0356095310", password: "mat-khau-cua-mai" });
    assert.equal(first.status, 403);
    assert.equal(bodyOf(first).error, "thiet_bi_cho_duyet");
    const deviceCookie = cookieFrom(first, "toprun_ctv_may");
    assert.ok(deviceCookie, "must return a device id to compare next time");

    // Not approved yet: logging in again is still 403 — and does NOT create another request.
    const second = await login({ login: "0356095310", password: "mat-khau-cua-mai" }, deviceCookie);
    assert.equal(second.status, 403);
    const devices = bodyOf(await adminGet("/api/admin/ctv")).thietBi;
    assert.equal(devices.length, 1, "must not spawn a new request on every attempt");
    assert.equal(devices[0].trangThai, "cho-duyet");
    assert.equal(devices[0].maCtv, collaboratorId);

    // The shop owner approves -> in.
    const approved = await decideDevice({ ma: devices[0].ma, viec: "duyet" });
    assert.equal(approved.status, 200);
    const third = await login({ login: "0356095310", password: "mat-khau-cua-mai" }, deviceCookie);
    assert.equal(third.status, 200, JSON.stringify(third.body));
    assert.equal(bodyOf(third).ctv.ten, "Đặng Mai");
  });

  await t.test("wrong password: the refusal is IDENTICAL to 'no such account'", async () => {
    await cleanUp();
    await addCollaborator({ ten: "Đặng Mai", dienThoai: "0356095310", matKhau: "mat-khau-cua-mai" });
    const wrong = await login({ login: "0356095310", password: "mat-khau-khac" });
    const unknown = await login({ login: "0999999999", password: "mat-khau-nao-do" });
    assert.equal(wrong.status, 401);
    assert.deepEqual(wrong.body, unknown.body, "the two refusals must match, or the collaborator list can be enumerated");
  });

  /** Sets up a collaborator with an approved device; returns the session cookie. */
  async function loggedInCollaborator() {
    await cleanUp();
    await addCollaborator({ ten: "Đặng Mai", dienThoai: "0356095310", matKhau: "mat-khau-cua-mai", choBoLogo: true });
    const first = await login({ login: "0356095310", password: "mat-khau-cua-mai" });
    const deviceCookie = cookieFrom(first, "toprun_ctv_may");
    const device = bodyOf(await adminGet("/api/admin/ctv")).thietBi[0];
    await decideDevice({ ma: device.ma, viec: "duyet" });
    const entered = await login({ login: "0356095310", password: "mat-khau-cua-mai" }, deviceCookie);
    return { cookie: `${cookieFrom(entered, "toprun_ctv_phien")}; ${deviceCookie}`, collaboratorId: bodyOf(entered).ctv.ma as string, deviceId: device.ma as string };
  }

  await t.test("not logged in: nothing can be read", async () => {
    await cleanUp();
    assert.equal((await asCollaborator("/api/ctv/me", "")).status, 401);
    assert.equal((await asCollaborator("/api/ctv/anh", "", { ma: "CTV001" })).status, 401);
    // A forged cookie (bad signature) does not get in either.
    assert.equal((await asCollaborator("/api/ctv/me", "toprun_ctv_phien=bia.dat")).status, 401);
  });

  await t.test("image download: ONLY images — no stock, no price, no warehouse name", async () => {
    const { cookie } = await loggedInCollaborator();

    const r = await asCollaborator("/api/ctv/anh", cookie, { ma: "CTV001" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const body = bodyOf(r);
    assert.equal(body.ma, "CTV001");
    assert.ok(body.anh.length >= 3);
    assert.equal(new Set(body.anh).size, body.anh.length, "duplicate images must be dropped");
    assert.equal(body.choBoLogo, true);

    const json = JSON.stringify(r.body);
    assert.ok(!json.includes("wh_yen"), "must not leak the warehouse id");
    assert.ok(!json.includes("Yên"), "must not leak the warehouse name");
    assert.ok(!json.includes("2000000"), "must not leak the price");
    assert.equal(body.ton, undefined);
  });

  await t.test("every download goes into the LOG (so it can be traced later)", async () => {
    const { cookie, collaboratorId } = await loggedInCollaborator();
    await asCollaborator("/api/ctv/anh", cookie, { ma: "CTV001" });
    await asCollaborator("/api/ctv/anh", cookie, { ma: "CTV001" });

    const rows = bodyOf(await adminGet("/api/admin/ctv/nhat-ky")).dong;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].maCtv, collaboratorId);
    assert.equal(rows[0].maHang, "CTV001");
    assert.ok(rows[0].soAnh >= 3);
  });

  await t.test("SWITCHING an account off ends its open session at once", async () => {
    const { cookie, collaboratorId } = await loggedInCollaborator();
    const me = await asCollaborator("/api/ctv/me", cookie);
    assert.equal(me.status, 200);
    // The old site's envelope: ctv-account.js reads payload.data.name / .code, ctv-image.js .allowNoLogo.
    assert.equal(bodyOf(me).data.id, collaboratorId);
    assert.equal(bodyOf(me).data.name, "Đặng Mai");
    assert.ok(String(bodyOf(me).data.code).length > 0, "the ?ref link needs the referral code");
    assert.equal(bodyOf(me).data.allowNoLogo, true);
    assert.ok(!JSON.stringify(me.body).includes("maPhien"), "the session id must not leave the server");

    await addCollaborator({ ma: collaboratorId, ten: "Đặng Mai", dienThoai: "0356095310", dangBat: false });
    assert.equal((await asCollaborator("/api/ctv/me", cookie)).status, 401, "an account switched off that still gets in is a hole");
  });

  await t.test("BLOCKING a device ends the session on that very device", async () => {
    const { cookie, deviceId } = await loggedInCollaborator();
    assert.equal((await asCollaborator("/api/ctv/me", cookie)).status, 200);

    await decideDevice({ ma: deviceId, viec: "chan" });
    assert.equal((await asCollaborator("/api/ctv/me", cookie)).status, 401);
  });

  await t.test("after logout the session cannot be reused", async () => {
    const { cookie } = await loggedInCollaborator();
    const r = await kernel.handle({ method: "POST", path: "/api/ctv/logout", query: {}, ip: "2.2.2.2", headers: { cookie }, json: async () => ({}) });
    assert.equal(r.status, 200);
    assert.match(String(r.headers?.["Set-Cookie"]), /Max-Age=0/);
    assert.equal((await asCollaborator("/api/ctv/me", cookie)).status, 401, "a deleted session must not work again");
  });

  await t.test("the collaborator admin routes are closed to outsiders", async () => {
    await cleanUp();
    assert.equal((await kernel.handle({ method: "GET", path: "/api/admin/ctv", query: {}, headers: {} })).status, 401);
    assert.equal((await kernel.handle({ method: "POST", path: "/api/admin/ctv", query: {}, headers: {}, json: async () => ({}) })).status, 401);
    assert.equal((await kernel.handle({ method: "GET", path: "/api/admin/ctv/nhat-ky", query: {}, headers: {} })).status, 401);
  });

  await t.test("without the inventory feature the download route says so, and does not throw", async () => {
    // A kernel with only the collaborator module.
    const alone = buildKernel([collaborators]);
    await cleanUp();
    const added = await addCollaborator({ ten: "Mai", dienThoai: "0356095310", matKhau: "mat-khau-cua-mai" }, alone);
    assert.equal(added.status, 200);
    const first = await login({ login: "0356095310", password: "mat-khau-cua-mai" }, "", alone);
    const deviceCookie = cookieFrom(first, "toprun_ctv_may");
    const device = bodyOf(await adminGet("/api/admin/ctv", alone)).thietBi[0];
    await decideDevice({ ma: device.ma, viec: "duyet" }, alone);
    const entered = await login({ login: "0356095310", password: "mat-khau-cua-mai" }, deviceCookie, alone);
    const cookie = `${cookieFrom(entered, "toprun_ctv_phien")}; ${deviceCookie}`;

    const r = await asCollaborator("/api/ctv/anh", cookie, { ma: "CTV001" }, alone);
    assert.equal(r.status, 503);
    assert.equal(bodyOf(r).error, "chua_bat_manh_hang_hoa");
  });

  await t.test("the route table keeps the exact public paths of the old site", () => {
    const paths = kernel.routes().filter((r) => r.moduleId === "ctv" && r.access === "cong-khai").map((r) => `${r.method} ${r.path}`).sort();
    assert.deepEqual(paths, ["GET /api/ctv/anh", "GET /api/ctv/me", "POST /api/ctv/login", "POST /api/ctv/logout"]);
  });
});
