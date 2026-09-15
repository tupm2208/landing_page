/**
 * WEB ANALYTICS on real MySQL — the two doors, and the statements that count.
 *
 * `test/thong-ke.test.mts` pins the way of counting with rows fed by hand. This suite pins that the
 * SQL actually produces those rows: GROUP BY over a 47k-row table is where a report quietly starts
 * lying, and it cannot be checked without a database.
 *
 * Needs the trial MySQL on port 3307. PORT 3306 IS THE REAL LANDING DATA — FORBIDDEN.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { EVENTS, ROLE, type Reply } from "../dist/contract/index.js";
import { FixedWindowRateLimiter, Kernel, ManualClock, MemoryLogger, TokenAuth, openMysqlStore } from "../dist/kernel/index.js";
import { manifest as analytics } from "../dist/modules/thong-ke/module.js";

const ADMIN = "ma-quan-tri";
const URL = String(process.env["TOPRUN_MYSQL_URL"] || "").trim();
const skip = URL ? {} : { skip: "TOPRUN_MYSQL_URL not set — skipping the analytics suite" };
if (URL && /:3306\//.test(URL)) throw new Error("Cong 3306 la du lieu that cua landing. Dung 3307.");

type Body = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any -- test reads arbitrary JSON fields
const bodyOf = (r: Reply) => r.body as Body;

test("Analytics on real MySQL", { ...skip }, async (t) => {
  const logger = new MemoryLogger();
  const clock = new ManualClock();
  const store = await openMysqlStore({ url: URL, logger });

  await store.runSchema(analytics.id, analytics.schema ?? [], { inheritedTables: analytics.inheritedTables ?? [] });

  const cleanUp = async () => { await store.execute("DELETE FROM `analytics_events`", []); };
  await cleanUp();
  t.afterEach(cleanUp);
  t.after(async () => { await store.close(); });

  const kernel = new Kernel({
    ports: {
      store, logger, clock,
      http: { request: async () => ({ ok: true, status: 200, text: async () => "", json: async () => ({}) }) } as never,
      auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }], clock }),
      rateLimiter: new FixedWindowRateLimiter(clock),
      staticFiles: { open: () => ({ read: async () => null }) } as never,
      mail: { send: async () => ({ ok: true }) } as never
    },
    logger, modules: [analytics], config: { "thong-ke": { attributionSecret: "" } }
  });

  /** Posts one event as a browser would. A fresh IP per call keeps the kernel's limit out of the way. */
  const fire = (body: Record<string, unknown>, ip = `10.0.0.${Math.floor(Math.random() * 250) + 1}`) =>
    kernel.handle({
      method: "POST", path: "/api/analytics/event", query: {}, ip,
      headers: { "user-agent": "Mozilla/5.0 (iPhone) Safari/604.1" },
      json: async () => body
    } as never);

  const readReport = (query: Record<string, string> = {}) =>
    kernel.handle({
      method: "GET", path: "/api/admin/analytics", query, ip: "10.9.9.9",
      headers: { authorization: `Bearer ${ADMIN}` },
      json: async () => ({})
    } as never);

  const rowCount = async (): Promise<number> => {
    const rows = await store.rows("SELECT COUNT(*) AS n FROM `analytics_events`");
    return Number(rows[0]?.["n"] ?? 0);
  };

  await t.test("an event from the storefront becomes a row", async () => {
    const r = await fire({
      event: "page_view", visitorId: "visitor_1", sessionId: "session_1",
      path: "/product/gx0709", referrer: "https://www.facebook.com/"
    });
    assert.equal(r.status, 200);
    assert.equal(bodyOf(r).ok, true);
    assert.equal(await rowCount(), 1);
  });

  await t.test("an unknown event name is refused and writes nothing", async () => {
    const r = await fire({ event: "admin_password_seen" });
    assert.equal(r.status, 400);
    assert.equal(bodyOf(r).error, "invalid_event");
    assert.equal(await rowCount(), 0);
  });

  await t.test("`order_success` from a browser is ignored, and writes nothing", async () => {
    const r = await fire({ event: "order_success", visitorId: "kevin" });
    assert.equal(r.status, 200, "a beacon never gets an error it cannot act on");
    assert.equal(bodyOf(r).ignored, true);
    assert.equal(bodyOf(r).reason, "server_order_only");
    assert.equal(await rowCount(), 0);
  });

  await t.test("but a REAL order writes one — the number the running site never recorded", async () => {
    // `emitAndWait` rather than `emit`: the bus is fire-and-forget, and a listener that threw
    // would otherwise look exactly like a listener that had not run yet.
    const delivered = await kernel.bus.emitAndWait(EVENTS.orderCreated, { maDon: "ORD-1", tong: 1000000, soMon: 1, dienThoai: "0900000000" });
    assert.deepEqual(delivered.map((d) => [d.moduleId, d.ok, d.error ?? ""]), [["thong-ke", true, ""]]);
    const rows = await store.rows("SELECT event, user_agent FROM `analytics_events`");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!["event"], "order_success");
    assert.equal(rows[0]!["user_agent"], "may-chu");
  });

  await t.test("the report counts by day, by product, and distinct visitors over the window", async () => {
    await fire({ event: "page_view", visitorId: "v1", sessionId: "s1", path: "/" });
    await fire({ event: "page_view", visitorId: "v1", sessionId: "s1", path: "/mobile" });
    await fire({ event: "page_view", visitorId: "v2", sessionId: "s2", path: "/" });
    await fire({ event: "product_view", visitorId: "v2", sessionId: "s2", payload: { productCode: "GX0709", productName: "DURAMO 10" } });
    await fire({ event: "add_to_cart", visitorId: "v2", sessionId: "s2", payload: { productCode: "GX0709" } });

    const r = await readReport({ days: "7" });
    assert.equal(r.status, 200);
    const data = bodyOf(r).data;

    assert.equal(data.totals.page_view, 3, "three page views");
    assert.equal(data.totals.pageViews, 3, "and under Sales Desk's name too");
    assert.equal(data.totals.uniqueVisitors, 2, "two people, not three visits");
    assert.equal(data.totals.sessions, 2);
    assert.equal(data.totals.add_to_cart, 1);

    assert.equal(data.days.length, 7, "every day of the window is present");
    assert.equal(data.days[6].page_view, 3, "today carries them");

    assert.equal(data.products.length, 1);
    assert.equal(data.products[0].code, "GX0709");
    assert.equal(data.products[0].name, "DURAMO 10");
    assert.equal(data.products[0].product_view, 1);
    assert.equal(data.products[0].add_to_cart, 1);

    assert.ok(data.updatedAt, "the newest row's time");
    assert.equal(data.historyAvailable, true);
  });

  await t.test("the report is the envelope Sales Desk expects, and is never cached", async () => {
    const r = await readReport({ days: "14" });
    assert.equal(r.status, 200);
    assert.equal(bodyOf(r).ok, true, "Sales Desk treats ok:false as a fatal read error");
    assert.ok(bodyOf(r).data, "numbers live under `data`");
    assert.ok(bodyOf(r).generatedAt);
    assert.equal(r.headers?.["Cache-Control"], "no-store");
  });

  await t.test("the report door needs an admin token", async () => {
    const r = await kernel.handle({
      method: "GET", path: "/api/admin/analytics", query: {}, ip: "10.9.9.8", headers: {}, json: async () => ({})
    } as never);
    assert.equal(r.status, 401);
  });

  await t.test("a product range narrows the product table and covers the whole `to` day", async () => {
    const today = clock.now().toISOString().slice(0, 10);
    await fire({ event: "product_view", visitorId: "v1", payload: { productCode: "GX0709" } });

    const inside = bodyOf(await readReport({ days: "7", productFrom: today, productTo: today })).data;
    assert.equal(inside.products.length, 1, "an event today is inside a range of today..today");
    assert.deepEqual(inside.productRange, { from: today, to: today });

    const outside = bodyOf(await readReport({ days: "7", productFrom: "2020-01-01", productTo: "2020-01-02" })).data;
    assert.equal(outside.products.length, 0);
  });

  await t.test("a backwards range is read as what the caller meant", async () => {
    const today = clock.now().toISOString().slice(0, 10);
    await fire({ event: "product_view", visitorId: "v1", payload: { productCode: "GX0709" } });
    const data = bodyOf(await readReport({ days: "7", productFrom: today, productTo: "2020-01-01" })).data;
    assert.deepEqual(data.productRange, { from: "2020-01-01", to: today });
    assert.equal(data.products.length, 1);
  });

  await t.test("an unsigned click is not recorded: no secret, no credit", async () => {
    const r = await fire({ event: "source_click", visitorId: "v1", attribution: { contentId: "c1", clickId: "k1", signature: "bia-dat" } });
    assert.equal(bodyOf(r).ignored, true);
    assert.equal(bodyOf(r).reason, "unverified_or_bot_click");
    assert.equal(await rowCount(), 0);
  });

  await t.test("attribution is empty without a verified click, and the report survives it", async () => {
    await fire({ event: "page_view", visitorId: "v1", attribution: { contentId: "c1", signature: "bia-dat" } });
    const data = bodyOf(await readReport({ days: "7" })).data;
    assert.deepEqual(data.attribution, [], "nothing attributed, but the page view still counted");
    assert.equal(data.totals.page_view, 1);
  });
});
