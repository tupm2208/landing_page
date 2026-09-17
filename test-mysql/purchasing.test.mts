/**
 * Purchasing module — the partner portal. Runs on real MySQL (port 3307).
 *
 * The focus is the four rules, and every test must prove one of them:
 *   1. not logged in = ONLY the login screen — not one piece of information
 *   2. out-of-stock is keyed by LINE ID, not line position (incident of 10/09)
 *   3. the same command twice is not written twice
 *   4. the cost price is the shop's
 *
 * Orders is being ported in parallel, so a fake provider module plays `don-khach.search` with
 * pending orders held in memory.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FakeHttpClient, FakeStaticFilePort, FixedWindowRateLimiter, Kernel, ManualClock, MemoryLogger, TokenAuth, openMysqlStore
} from "../dist/kernel/index.js";
import { EVENTS, ROLE, defineModule, type IncomingRequest, type Reply } from "../dist/contract/index.js";
import { SessionCookie } from "../dist/shared/session-cookie.js";
import { manifest, type OrderForPurchasing } from "../dist/modules/mua-ho/module.js";
import { PARTNER_COOKIE, PartnerSession } from "../dist/modules/mua-ho/partner-session.js";
import {
  SCHEMA, LOGIN_FAILURES_TABLE, PACKING_TABLE, PARTNERS_TABLE, PURCHASES_TABLE, SHIPMENT_REQUESTS_TABLE, STOCK_OUTS_TABLE
} from "../dist/modules/mua-ho/schema.js";

const ADMIN = "ma-quan-tri";
const SECRET = "bi-mat-phien-doi-tac-dai";
const PORTAL_CODE = "link-rieng-cua-doi-tac-A";
const URL = String(process.env["TOPRUN_MYSQL_URL"] || "").trim();
const skipWithoutDb = URL ? {} : { skip: "chưa đặt TOPRUN_MYSQL_URL — bỏ qua bài mua hộ" };
if (URL && /:3306\//.test(URL)) throw new Error("Cổng 3306 là dữ liệu thật của landing. Dùng 3307.");

const PRODUCT = { code: "DV1234", name: "Giày chạy Nike Pegasus 40", price: 2890000 };

// ---------- the session cookie: no MySQL needed ----------

const cookieHeader = (name: string, value: string) => ({ cookie: `${name}=${encodeURIComponent(value)}` });

test("an expired session can no longer be read", () => {
  const clock = new ManualClock();
  const session = new SessionCookie({ name: "thu", secret: SECRET, clock, lifetimeHours: 12 });
  const cookie = session.create({ maCong: PORTAL_CODE });
  assert.equal(session.read(cookieHeader("thu", cookie))?.["maCong"], PORTAL_CODE);

  clock.advance(12 * 60 * 60 * 1000 + 1000);
  assert.equal(session.read(cookieHeader("thu", cookie)), null, "after 12 hours the session is dead");
});

test("a session with one character changed fails", () => {
  const session = new SessionCookie({ name: "thu", secret: SECRET, clock: new ManualClock() });
  const cookie = session.create({ maCong: PORTAL_CODE });
  const forged = cookie.slice(0, -1) + (cookie.endsWith("A") ? "B" : "A");
  assert.equal(session.read(cookieHeader("thu", forged)), null);
});

test("a session signed with a DIFFERENT secret cannot be read", () => {
  const clock = new ManualClock();
  const real = new SessionCookie({ name: "thu", secret: SECRET, clock });
  const forger = new SessionCookie({ name: "thu", secret: "bi-mat-cua-ke-gia-dai-hon", clock });
  assert.equal(real.read(cookieHeader("thu", forger.create({ maCong: PORTAL_CODE }))), null);
});

test("the cookie is HttpOnly and SameSite — page scripts cannot steal it", () => {
  const session = new SessionCookie({ name: "thu", secret: SECRET, clock: new ManualClock() });
  const set = session.setHeaders({ maCong: PORTAL_CODE })["Set-Cookie"] ?? "";
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Lax/);
  assert.ok(!/Secure/.test(set), "on plain HTTP no Secure flag, or the browser drops the cookie");
  const https = new SessionCookie({ name: "thu", secret: SECRET, clock: new ManualClock(), https: true });
  assert.match(https.setHeaders({})["Set-Cookie"] ?? "", /Secure/);
});

test("BREAKS when the session secret is too short: start-up is refused", () => {
  assert.throws(() => new SessionCookie({ name: "thu", secret: "ngan", clock: new ManualClock() }), /ít nhất 16 ký tự/);
  assert.throws(() => new PartnerSession({ sessionSecret: "ngan" }, new ManualClock()), /ít nhất 16 ký tự/);
});

test("the partner session keeps the live cookie name and carries the portal code", () => {
  const clock = new ManualClock();
  const session = new PartnerSession({ sessionSecret: SECRET, sessionHours: 12 }, clock);
  assert.equal(PARTNER_COOKIE, "toprun_partner_session");
  const set = session.loginHeaders(PORTAL_CODE)["Set-Cookie"] ?? "";
  assert.match(set, /^toprun_partner_session=/);
  const value = decodeURIComponent(set.split("=")[1]?.split(";")[0] ?? "");
  assert.equal(session.portalCode(cookieHeader(PARTNER_COOKIE, value)), PORTAL_CODE);
  assert.match(session.logoutHeaders()["Set-Cookie"] ?? "", /Max-Age=0/);
});

// ---------- on real tables ----------

interface PortalReply {
  ok?: boolean;
  trungLenh?: boolean;
  doiTac?: { ma: string; ten: string };
  canMua?: { maDong: string; maDon: string; maMon: string; size: string }[];
  length?: number;
}
const body = (r: Reply): PortalReply => r.body as PortalReply;

test("The partner portal on real MySQL", { ...skipWithoutDb }, async (t) => {
  const logger = new MemoryLogger();
  const clock = new ManualClock();
  const store = await openMysqlStore({ url: URL, logger });
  await store.runSchema("mua-ho", SCHEMA);

  /** Pending orders the fake Orders module answers with. */
  const pendingOrders: OrderForPurchasing[] = [];
  const fakeOrders = defineModule({
    id: "don-khach", name: "Đơn hàng giả", tier: "van-hanh", runsOn: "server-khach", version: "0.0.1",
    provides: { "don-khach.search": async () => pendingOrders.map((o) => ({ ...o })) }
  });

  const cleanUp = async () => {
    clock.advance(16 * 60 * 1000);
    pendingOrders.length = 0;
    for (const table of [STOCK_OUTS_TABLE, PURCHASES_TABLE, PACKING_TABLE, PARTNERS_TABLE, SHIPMENT_REQUESTS_TABLE, LOGIN_FAILURES_TABLE]) {
      await store.table(table).truncate();
    }
  };
  await cleanUp();
  t.after(async () => { await cleanUp(); await store.close(); });

  const kernel = new Kernel({
    ports: {
      store, logger, clock, http: new FakeHttpClient(),
      auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }], clock }),
      rateLimiter: new FixedWindowRateLimiter(clock),
      // The portal serves its own pages now, so the module declares `staticFiles`; a kernel without
      // that port refuses to load it.
      staticFiles: new FakeStaticFilePort({})
    },
    logger, modules: [fakeOrders, manifest],
    config: { "don-khach": {}, "mua-ho": { sessionSecret: SECRET, sessionHours: 12 } }
  });

  const admin = { authorization: `Bearer ${ADMIN}` };
  const call = (method: string, path: string, { payload, cookie, headers, query }: { payload?: unknown; cookie?: string; headers?: IncomingRequest["headers"]; query?: Record<string, string> } = {}) =>
    kernel.handle({
      method, path, ip: "1.1.1.1", query: query ?? {},
      headers: { ...(headers ?? {}), ...(cookie ? { cookie } : {}) },
      json: async () => payload ?? {}
    });

  const addPartner = () => call("POST", "/api/admin/partners", { headers: admin, payload: { ma: "dt-a", ten: "Đối tác A", maCong: PORTAL_CODE } });
  const login = async () => {
    const r = await call("POST", "/api/partner-portal/login", { payload: { token: PORTAL_CODE } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const set = r.headers?.["Set-Cookie"] ?? "";
    return `toprun_partner_session=${set.split("=")[1]?.split(";")[0]}`;
  };
  let counter = 0;
  /** An order as the storefront would place it: the customer's price is on the line, the partner must never see it. */
  const placeOrder = (lines: { productCode: string; productName: string; partnerId?: string }[] = [{ productCode: PRODUCT.code, productName: PRODUCT.name }]) => {
    counter += 1;
    const id = `ORD-178900000${String(counter).padStart(4, "0")}`;
    // Paid, and every line given to partner A unless said otherwise — the shop already chose the warehouse.
    pendingOrders.push({
      id, status: "partner_assigned", paymentStatus: "paid", createdAt: new Date(Date.UTC(2026, 8, 1, 0, counter)).toISOString(),
      items: lines.map((l) => ({ partnerId: "dt-a", ...l, size: "42", qty: 1, price: PRODUCT.price }))
    });
    return id;
  };

  // ---------- RULE 1 ----------

  await t.test("NOT logged in: the portal leaks not one piece of information", async () => {
    await cleanUp(); await addPartner(); placeOrder();

    const r = await call("GET", "/api/partner-portal");
    assert.equal(r.status, 401);
    const text = JSON.stringify(r.body);
    assert.ok(!text.includes("Đối tác A"), "leaks the partner name");
    assert.ok(!text.includes("DV1234"), "leaks the work to buy");
    assert.ok(!text.includes("dt-a"), "leaks the partner id");
  });

  await t.test("a WRONG portal code cannot enter, and is not told why", async () => {
    await cleanUp(); await addPartner();
    const r = await call("POST", "/api/partner-portal/login", { payload: { token: "doan-bua" } });
    assert.equal(r.status, 401);
    assert.ok(!JSON.stringify(r.body).includes("Đối tác A"));
  });

  await t.test("a partner switched OFF cannot use an old session", async () => {
    await cleanUp(); await addPartner();
    const cookie = await login();
    assert.equal((await call("GET", "/api/partner-portal", { cookie })).status, 200);

    await call("POST", "/api/admin/partners", { headers: admin, payload: { ma: "dt-a", ten: "Đối tác A", maCong: PORTAL_CODE, trangThai: "inactive" } });
    assert.equal((await call("GET", "/api/partner-portal", { cookie })).status, 401, "switching off revokes at once");
  });

  await t.test("logged in, the partner sees ITS OWN work to buy", async () => {
    await cleanUp(); await addPartner();
    const orderId = placeOrder();
    const cookie = await login();

    const r = await call("GET", "/api/partner-portal", { cookie });
    assert.equal(r.status, 200);
    assert.equal(body(r).doiTac?.ten, "Đối tác A");
    assert.equal(body(r).canMua?.length, 1);
    assert.equal(body(r).canMua?.[0]?.maDon, orderId);
    assert.equal(body(r).canMua?.[0]?.maMon, "DV1234");
  });

  await t.test("logging out clears the cookie", async () => {
    await cleanUp(); await addPartner();
    const r = await call("POST", "/api/partner-portal/logout");
    assert.match(r.headers?.["Set-Cookie"] ?? "", /Max-Age=0/);
  });

  // ---------- RULE 3 ----------

  await t.test("the SAME command twice is not written twice", async () => {
    await cleanUp(); await addPartner(); placeOrder();
    const cookie = await login();
    const task = body(await call("GET", "/api/partner-portal", { cookie })).canMua?.[0];
    assert.ok(task);

    const payload = { maDong: task.maDong, maMon: task.maMon, size: task.size, soLuong: 1, giaVon: 2000000, maLenh: "lenh-1" };
    const first = await call("POST", "/api/partner-portal/purchases", { cookie, payload });
    const second = await call("POST", "/api/partner-portal/purchases", { cookie, payload });

    assert.equal(body(first).ok, true);
    assert.equal(body(second).ok, true);
    assert.equal(body(second).trungLenh, true, "the second must recognise the duplicate command");
    assert.equal(await store.table(PURCHASES_TABLE).count(), 1, "exactly one slip");
  });

  await t.test("two taps AT THE SAME TIME still make one slip", async () => {
    await cleanUp(); await addPartner(); placeOrder();
    const cookie = await login();
    const task = body(await call("GET", "/api/partner-portal", { cookie })).canMua?.[0];
    assert.ok(task);
    const payload = { maDong: task.maDong, maMon: task.maMon, size: task.size, soLuong: 1, maLenh: "lenh-dua" };

    await Promise.all([
      call("POST", "/api/partner-portal/purchases", { cookie, payload }),
      call("POST", "/api/partner-portal/purchases", { cookie, payload })
    ]);
    assert.equal(await store.table(PURCHASES_TABLE).count(), 1, "the unique key must stop the race");
  });

  await t.test("a reported purchase disappears from the list to buy", async () => {
    await cleanUp(); await addPartner(); placeOrder();
    const cookie = await login();
    const task = body(await call("GET", "/api/partner-portal", { cookie })).canMua?.[0];
    assert.ok(task);
    await call("POST", "/api/partner-portal/purchases", { cookie, payload: { maDong: task.maDong, maMon: task.maMon, size: task.size, soLuong: 1, maLenh: "l1" } });
    assert.equal(body(await call("GET", "/api/partner-portal", { cookie })).canMua?.length, 0);
  });

  // ---------- RULE 2: the trap of 10/09 ----------

  await t.test("out-of-stock is keyed by LINE ID — it never sticks to another line", async () => {
    await cleanUp(); await addPartner();
    placeOrder([{ productCode: PRODUCT.code, productName: PRODUCT.name }, { productCode: "AB999", productName: "Món khác" }]);
    const cookie = await login();

    const tasks = body(await call("GET", "/api/partner-portal", { cookie })).canMua ?? [];
    assert.equal(tasks.length, 2);

    // Report the SECOND line out of stock.
    await call("POST", "/api/partner-portal/out-of-stock", { cookie, payload: { maDong: tasks[1]?.maDong, maMon: tasks[1]?.maMon, size: tasks[1]?.size, lyDo: "hãng hết" } });

    const left = body(await call("GET", "/api/partner-portal", { cookie })).canMua ?? [];
    assert.equal(left.length, 1);
    assert.equal(left[0]?.maDong, tasks[0]?.maDong, "the first line must NOT be marked out");

    const reported = await store.table(STOCK_OUTS_TABLE).find({});
    assert.equal(reported.length, 1);
    assert.equal(reported[0]?.["ma_dong"], tasks[1]?.maDong, "keyed by line id, not position");
  });

  await t.test("reporting the SAME line again updates it, no second row", async () => {
    await cleanUp(); await addPartner(); placeOrder();
    const cookie = await login();
    const task = body(await call("GET", "/api/partner-portal", { cookie })).canMua?.[0];
    assert.ok(task);

    await call("POST", "/api/partner-portal/out-of-stock", { cookie, payload: { maDong: task.maDong, lyDo: "lan mot" } });
    await call("POST", "/api/partner-portal/out-of-stock", { cookie, payload: { maDong: task.maDong, lyDo: "lan hai" } });

    const rows = await store.table(STOCK_OUTS_TABLE).find({});
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.["ly_do"], "lan hai");
  });

  await t.test("an out-of-stock report is announced on the bus for other features", async () => {
    await cleanUp(); await addPartner(); placeOrder();
    const cookie = await login();
    const task = body(await call("GET", "/api/partner-portal", { cookie })).canMua?.[0];
    assert.ok(task);
    const seen: { maDong?: string }[] = [];
    kernel.bus.on(EVENTS.partnerStockOut, "bai-thu", (d) => { seen.push(d as { maDong?: string }); });

    await call("POST", "/api/partner-portal/out-of-stock", { cookie, payload: { maDong: task.maDong } });
    await new Promise((r) => setImmediate(r));
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.maDong, task.maDong);
  });

  // ---------- RULE 4 ----------

  await t.test("the partner reports the COST price; the customer's price they never see", async () => {
    await cleanUp(); await addPartner(); placeOrder();
    const cookie = await login();
    const r = await call("GET", "/api/partner-portal", { cookie });
    const text = JSON.stringify(r.body);
    assert.ok(!text.includes("2890000"), `the selling price leaked into the partner portal: ${text}`);

    const task = body(r).canMua?.[0];
    assert.ok(task);
    await call("POST", "/api/partner-portal/purchases", { cookie, payload: { maDong: task.maDong, soLuong: 1, giaVon: 2000000, maLenh: "l1" } });
    const slip = await store.table(PURCHASES_TABLE).one({ ma_lenh: "l1" });
    assert.equal(Number(slip?.["gia_von"]), 2000000);
  });

  await t.test("without a session nothing can be reported bought or out of stock", async () => {
    await cleanUp(); await addPartner(); placeOrder();
    assert.equal((await call("POST", "/api/partner-portal/purchases", { payload: { maDong: "x", soLuong: 1 } })).status, 401);
    assert.equal((await call("POST", "/api/partner-portal/out-of-stock", { payload: { maDong: "x" } })).status, 401);
    assert.equal(await store.table(PURCHASES_TABLE).count(), 0);
    assert.equal(await store.table(STOCK_OUTS_TABLE).count(), 0);
  });

  await t.test("the SHOP's screen sees the work, the slips WITH cost price, and what was reported out of stock", async () => {
    await cleanUp(); await addPartner();
    const orderId = placeOrder();
    const cookie = await login();
    const task = body(await call("GET", "/api/partner-portal", { cookie })).canMua?.[0];
    assert.ok(task);
    await call("POST", "/api/partner-portal/purchases", { cookie, payload: { maDong: task.maDong, soLuong: 1, giaVon: 2000000, maLenh: "l-shop" } });

    const second = placeOrder();
    const left = body(await call("GET", "/api/partner-portal", { cookie })).canMua?.find((x) => x.maDon === second);
    assert.ok(left);
    await call("POST", "/api/partner-portal/out-of-stock", { cookie, payload: { maDong: left.maDong, lyDo: "hết size" } });

    const r = await call("GET", "/api/admin/mua-ho", { headers: admin });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const shop = r.body as { canMua: { maDon: string }[]; daMua: { maDon: string; giaVon: number }[]; baoHet: { maDon: string; lyDo: string }[] };
    assert.ok(!shop.canMua.some((x) => x.maDon === orderId), "a line already bought is off the list");
    assert.equal(shop.daMua[0]?.maDon, orderId);
    assert.equal(shop.daMua[0]?.giaVon, 2000000, "the cost price IS the shop's — this is where it belongs");
    assert.equal(shop.baoHet[0]?.maDon, second);
    assert.equal(shop.baoHet[0]?.lyDo, "hết size");

    assert.equal((await call("GET", "/api/admin/mua-ho")).status, 401, "the shop's screen is admin only");
  });

  // ---------- the partner's own list, and the doors of 16/09 ----------

  const PORTAL_CODE_B = "link-rieng-cua-doi-tac-B";
  const addPartnerB = () => call("POST", "/api/admin/partners", { headers: admin, payload: { ma: "dt-b", ten: "Đối tác B", maCong: PORTAL_CODE_B } });
  const loginB = async () => {
    const r = await call("POST", "/api/partner-portal/login", { payload: { token: PORTAL_CODE_B } });
    return `toprun_partner_session=${(r.headers?.["Set-Cookie"] ?? "").split("=")[1]?.split(";")[0]}`;
  };

  await t.test("BREAKS IF a partner sees, or buys, a line the shop gave to ANOTHER partner", async () => {
    await cleanUp(); await addPartner(); await addPartnerB();
    placeOrder([{ productCode: "CUA-A", productName: "Của A" }, { productCode: "CUA-B", productName: "Của B", partnerId: "dt-b" }]);
    const cookieA = await login();
    const cookieB = await loginB();

    const seenByA = body(await call("GET", "/api/partner-portal", { cookie: cookieA })).canMua ?? [];
    assert.deepEqual(seenByA.map((x) => x.maMon), ["CUA-A"]);
    const lineOfB = (body(await call("GET", "/api/partner-portal", { cookie: cookieB })).canMua ?? [])[0];
    assert.equal(lineOfB?.maMon, "CUA-B");

    // A replays B's line id: refused, nothing written.
    const r = await call("POST", "/api/partner-portal/purchases", { cookie: cookieA, payload: { maDong: lineOfB?.maDong, soLuong: 1, maLenh: "trom" } });
    assert.equal(r.status, 400);
    assert.equal((r.body as { error?: string }).error, "dong_khong_thuoc_doi_tac");
    // And by product code: A has no waiting CUA-B line.
    const byCode = await call("POST", "/api/partner-portal/purchases", { cookie: cookieA, payload: { productCode: "CUA-B", size: "42", quantity: 1, commandId: "trom-2" } });
    assert.equal(byCode.status, 400);
    assert.equal(await store.table(PURCHASES_TABLE).count(), 0);
  });

  await t.test("a partner's cookie opened on ANOTHER partner's link is not a session", async () => {
    await cleanUp(); await addPartner(); await addPartnerB();
    const cookieA = await login();
    assert.equal((await call("GET", "/api/partner-portal", { cookie: cookieA, query: { token: PORTAL_CODE_B } })).status, 401);
    assert.equal((await call("GET", "/api/partner-portal", { cookie: cookieA, query: { token: PORTAL_CODE } })).status, 200);
  });

  await t.test("the page's shape: one tap spread over two orders is ONE session, returned with the reply", async () => {
    await cleanUp(); await addPartner();
    const first = placeOrder();
    const second = placeOrder();
    const cookie = await login();
    const r = await call("POST", "/api/partner-portal/purchases", { cookie, payload: { productCode: PRODUCT.code, size: "42", quantity: 2, actualUnitCost: 1900000, commandId: "cham-1" } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const session = (r.body as { session?: { id: string; quantity: number; allocations: { orderId: string }[] } }).session;
    assert.equal(session?.id, "cham-1");
    assert.equal(session?.quantity, 2);
    assert.deepEqual(session?.allocations.map((a) => a.orderId).sort(), [first, second].sort());

    // Undo the row of ONE order: only that order's slip goes, and the session still shows the other.
    const undo = await call("POST", "/api/partner-portal/purchases/undo", { cookie, payload: { sessionId: "cham-1", orderId: first, lineIndex: 0 } });
    assert.equal(undo.status, 200, JSON.stringify(undo.body));
    const left = (undo.body as { session?: { allocations: { orderId: string }[] } }).session;
    assert.deepEqual(left?.allocations.map((a) => a.orderId), [second]);
    assert.equal(await store.table(PURCHASES_TABLE).count(), 1);
  });

  await t.test("what is owed counts EVERY slip, not the newest fifty", async () => {
    await cleanUp();
    await call("POST", "/api/admin/partners", { headers: admin, payload: { ma: "dt-a", ten: "Đối tác A", maCong: PORTAL_CODE, congMoiMon: 10000, congMoiDon: 0, cachTinh: "moi-mon" } });
    const now = clock.now().getTime();
    await store.table(PURCHASES_TABLE).insertMany(Array.from({ length: 60 }, (_, i) => ({
      ma_phieu: `cu_${i}`, ma_doi_tac: "dt-a", ma_don: `ORD-CU-${i}`, ma_dong: `ORD-CU-${i}#1`, ma_mon: "X", size: "42",
      so_luong: 1, gia_von: 1, gia_he_thong: 0, ma_lenh: `cu_${i}`, ghi_chu: "",
      tao_luc: new Date(now - i * 60000).toISOString().slice(0, 23).replace("T", " ")
    })));
    const cookie = await login();
    const summary = (body(await call("GET", "/api/partner-portal", { cookie })) as { summary?: { feeAmount: number; purchasedQty: number } }).summary;
    assert.equal(summary?.purchasedQty, 60);
    assert.equal(summary?.feeAmount, 600000);
  });

  await t.test("five wrong passwords lock the login for fifteen minutes — the right one included", async () => {
    await cleanUp();
    await call("POST", "/api/admin/partners", { headers: admin, payload: { ma: "dt-a", ten: "Đối tác A", maCong: PORTAL_CODE, dangNhap: "doitaca", matKhau: "mat-khau-dung-1" } });
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await call("POST", "/api/partner-portal/login", { payload: { login: "doitaca", password: "sai-sai-sai" } })).status, 401);
    }
    assert.equal((await call("POST", "/api/partner-portal/login", { payload: { login: "doitaca", password: "mat-khau-dung-1" } })).status, 429);
    clock.advance(16 * 60 * 1000);
    assert.equal((await call("POST", "/api/partner-portal/login", { payload: { login: "doitaca", password: " mat-khau-dung-1 " } })).status, 200, "unlocked, and a stray space is forgiven");
    assert.equal((await call("POST", "/api/partner-portal/login", { payload: { login: "dt-a", password: "mat-khau-dung-1" } })).status, 200, "the partner id works as a login, as it did");
  });

  await t.test("BREAKS IF the portal code alone opens a partner who HAS a password", async () => {
    await cleanUp();
    await call("POST", "/api/admin/partners", { headers: admin, payload: { ma: "dt-a", ten: "Đối tác A", maCong: PORTAL_CODE, dangNhap: "doitaca", matKhau: "mat-khau-dung-1" } });
    const r = await call("POST", "/api/partner-portal/login", { payload: { token: PORTAL_CODE } });
    assert.equal(r.status, 401);
    assert.ok(!r.headers?.["Set-Cookie"], "no session handed out");
  });

  await t.test("packing an order that is not on the partner's list writes nothing", async () => {
    await cleanUp(); await addPartner();
    const cookie = await login();
    const r = await call("POST", "/api/partner-portal/order-packing", { cookie, payload: { orderId: "ORD-KHONG-CO", status: "packed" } });
    assert.equal(r.status, 404);
    assert.equal(await store.table(PACKING_TABLE).count(), 0);
  });

  await t.test("the shop previews a partner's portal as the partner sees it", async () => {
    await cleanUp(); await addPartner(); placeOrder();
    const r = await call("GET", "/api/admin/mua-ho/portal", { headers: admin, query: { doiTac: "dt-a" } });
    assert.equal(r.status, 200);
    assert.equal((r.body as { needs: unknown[] }).needs.length, 1);
    assert.equal((await call("GET", "/api/admin/mua-ho/portal", { query: { doiTac: "dt-a" } })).status, 401);
  });

  await t.test("the partner list is admin only", async () => {
    await cleanUp(); await addPartner();
    assert.equal((await call("GET", "/api/admin/partners")).status, 401);
    assert.equal(body(await call("GET", "/api/admin/partners", { headers: admin })).length, 1);
  });
});
