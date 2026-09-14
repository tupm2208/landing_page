/**
 * ORDERS & CUSTOMERS on REAL MySQL — because real orders live in MySQL.
 *
 *   TOPRUN_MYSQL_URL=mysql://root:thu-nghiem-chi-may-nay@127.0.0.1:3307/toprun_port_donkhach \
 *     node --test --test-concurrency=1 --test-force-exit test-mysql/orders.test.mts
 *
 * Focus: placing an order must RESERVE stock first, writing an order is ONE transaction, and every
 * money number goes through the order-money kit.
 *
 * Inventory is a FAKE provider module declared in this file (in-memory stock, the same
 * `hang-kho.reserve` / `hang-kho.release` services), so this test does not depend on the real
 * Inventory module, which is being ported separately.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ROLE, defineModule, type Reply, type Row } from "../dist/contract/index.js";
import { FakeHttpClient, FixedWindowRateLimiter, Kernel, ManualClock, MemoryLogger, TokenAuth, openMysqlStore } from "../dist/kernel/index.js";
import { manifest, type ReleaseInput, type ReserveInput, type ReserveResult } from "../dist/modules/don-khach/module.js";
import type { Order } from "../dist/modules/don-khach/order-repository.js";
import type { DetailView, StatusView } from "../dist/modules/don-khach/public-orders.js";

const ADMIN = "ma-quan-tri";
const URL = String(process.env["TOPRUN_MYSQL_URL"] || "").trim();
const skip = URL ? {} : { skip: "TOPRUN_MYSQL_URL not set — skipping the orders tests" };
if (URL && /:3306\//.test(URL)) throw new Error("Cổng 3306 là dữ liệu thật của landing. Dùng 3307.");

// ---------- the fake Inventory: in-memory stock behind the real service names ----------

interface StockLine { qty: number; price: number; variantId: string; warehouseId: string }
const stock = new Map<string, StockLine>();
const tickets = new Map<string, { key: string; quantity: number }>();
let ticketCounter = 0;

/** Puts `qty` pairs of DV1234 size 42 on the shelf (like pushing the catalogue in the old test). */
function stockUp(qty = 2): void {
  stock.clear();
  tickets.clear();
  stock.set("DV1234|42", { qty, price: 2890000, variantId: "DV1234-42", warehouseId: "wh_yen" });
}

const fakeInventory = defineModule({
  id: "hang-kho", name: "Kho giả", tier: "van-hanh", runsOn: "server-khach", version: "0.0.0",
  provides: {
    "hang-kho.reserve": (_ctx, input: ReserveInput): ReserveResult => {
      const key = `${input.code}|${input.size}`;
      const line = stock.get(key);
      if (!line || line.qty < input.quantity) return { ok: false, reason: "khong_du_hang" };
      line.qty -= input.quantity;
      ticketCounter += 1;
      const ticket = `giu_${ticketCounter}`;
      tickets.set(ticket, { key, quantity: input.quantity });
      return { ok: true, ticket, variantId: line.variantId, size: input.size, price: line.price, warehouseId: line.warehouseId };
    },
    "hang-kho.release": (_ctx, input: ReleaseInput) => {
      const held = tickets.get(input.ticket);
      if (!held) return { ok: false };
      tickets.delete(input.ticket);
      const line = stock.get(held.key);
      if (line) line.qty += held.quantity;
      return { ok: true };
    }
  }
});

// ---------- helpers ----------

interface PlacedBody { ok: boolean; id: string; token: string; total: number; error?: string }
interface ViewBody<T> { ok: boolean; order: T; error?: string }
const body = <T,>(r: Reply): T => r.body as T;

test("Orders on real MySQL", { ...skip }, async (t) => {
  const logger = new MemoryLogger();
  const clock = new ManualClock();
  const store = await openMysqlStore({ url: URL, logger });

  // The module's own schema creates the three inherited tables on a fresh database.
  await store.runSchema(manifest.id, manifest.schema ?? [], { inheritedTables: manifest.inheritedTables ?? [] });

  // Between tests: wipe the orders AND put the stock back. Forgetting the second means the next
  // test always sees "out of stock" — a fault of the test, not of the module. `clock.advance` so
  // the rate limit (20 orders / 10 minutes on the public route) never trips.
  const cleanUp = async () => {
    clock.advance(11 * 60 * 1000);
    for (const table of ["order_status_logs", "order_items", "orders"]) await store.execute(`DELETE FROM \`${table}\``);
    stockUp();
  };
  await cleanUp();
  t.after(async () => { await cleanUp(); await store.close(); });

  const kernel = new Kernel({
    ports: {
      store, logger, clock, http: new FakeHttpClient(),
      auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }], clock }),
      rateLimiter: new FixedWindowRateLimiter(clock)
    },
    logger, modules: [fakeInventory, manifest], config: { "hang-kho": {}, "don-khach": {} }
  });

  const admin = { authorization: `Bearer ${ADMIN}` };
  const place = (order: unknown) => kernel.handle({ method: "POST", path: "/api/orders", headers: {}, ip: "1.1.1.1", json: async () => order });
  const readAsAdmin = async (id: string) => body<Order>(await kernel.handle({ method: "GET", path: `/api/orders/${id}`, headers: admin }));
  const SAMPLE_ORDER = {
    customerName: "Nguyễn Văn A", phone: "0911111111", province: "Hà Nội", district: "Quận Ba Đình",
    ward: "Phường Giảng Võ", addressDetail: "12 Đội Cấn",
    items: [{ productCode: "DV1234", productName: "Giày chạy Nike Pegasus 40", size: "42", price: 2890000, qty: 1 }]
  };

  await t.test("a table has exactly ONE owning module", () => {
    const owners = kernel.tableOwnerTable();
    for (const table of ["orders", "order_items", "order_status_logs"]) {
      assert.equal(owners.find((x) => x.table === table)?.moduleId, "don-khach");
    }
  });

  await t.test("placing an order writes head, lines and log in the same go", async () => {
    const r = await place(SAMPLE_ORDER);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const placed = body<PlacedBody>(r);
    assert.match(placed.id, /^ORD-\d+$/);
    assert.equal(placed.total, 2890000);

    assert.equal(await store.table("orders").count({ id: placed.id }), 1);
    assert.equal(await store.table("order_items").count({ order_id: placed.id }), 1);
    assert.equal(await store.table("order_status_logs").count({ order_id: placed.id }), 1);
  });

  await t.test("placing an order RESERVES stock — the next customer cannot buy the pair already sold", async () => {
    await cleanUp(); stockUp(1);
    assert.equal((await place(SAMPLE_ORDER)).status, 200);

    const second = await place(SAMPLE_ORDER);
    assert.equal(second.status, 400);
    assert.equal(body<PlacedBody>(second).error, "het_hang");
  });

  await t.test("out of stock writes NO order at all", async () => {
    await cleanUp(); stockUp(0);
    assert.equal(body<PlacedBody>(await place(SAMPLE_ORDER)).error, "het_hang");
    assert.equal(await store.table("orders").count(), 0, "no empty order may be left behind");
  });

  await t.test("an order missing the name or the phone is refused", async () => {
    await cleanUp();
    assert.equal(body<PlacedBody>(await place({ ...SAMPLE_ORDER, customerName: "" })).error, "thieu_ten_khach");
    assert.equal(body<PlacedBody>(await place({ ...SAMPLE_ORDER, phone: "" })).error, "thieu_dien_thoai");
    assert.equal(body<PlacedBody>(await place({ ...SAMPLE_ORDER, items: [] })).error, "don_khong_co_mon");
    assert.equal(await store.table("orders").count(), 0);
  });

  await t.test("a placed order is announced on the bus", async () => {
    await cleanUp();
    const heard: { maDon?: string }[] = [];
    kernel.bus.on("don-khach.da-tao", "bai-thu", (d) => { heard.push(d as { maDon?: string }); });
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    await new Promise((r) => setImmediate(r));
    assert.equal(heard.length, 1);
    assert.equal(heard[0]?.maDon, placed.id);
  });

  await t.test("lookup: the right id + token shows the order; one of the two wrong shows nothing", async () => {
    await cleanUp();
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    const lookup = (form: unknown) => kernel.handle({ method: "POST", path: "/api/orders/lookup", headers: {}, json: async () => form });

    const right = await lookup({ order: placed.id, token: placed.token });
    assert.equal(right.status, 200);
    // The PUBLIC view of the order (view "detail"), not the in-house one.
    const view = body<ViewBody<DetailView>>(right).order;
    assert.equal(view.view, "detail");
    assert.equal(view.customer?.customerName, "Nguyễn Văn A");

    assert.equal((await lookup({ order: placed.id, token: "sai" })).status, 404);
    assert.equal((await lookup({ order: "ORD-khong-co", token: placed.token })).status, 404);
    assert.equal((await lookup({ order: placed.id })).status, 422);
  });

  await t.test("opening the link: GET /api/orders/public returns the detail view; a wrong token shows nothing", async () => {
    await cleanUp();
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    const view = (query: Record<string, string>) => kernel.handle({ method: "GET", path: "/api/orders/public", query, headers: {}, ip: "1.1.1.1" });

    const right = await view({ order: placed.id, token: placed.token });
    assert.equal(right.status, 200, JSON.stringify(right.body));
    const order = body<ViewBody<DetailView>>(right).order;
    assert.equal(order.view, "detail");
    assert.equal(order.canEdit, true, "just placed = still editable");
    assert.equal(order.total, 2890000);
    assert.equal(order.paidAmount, 0);
    assert.equal(right.headers?.["Cache-Control"], "no-store", "a customer's order must never sit in a cache");

    assert.equal((await view({ order: placed.id, token: "sai" })).status, 404);
    assert.equal((await view({ order: placed.id })).status, 422);
  });

  await t.test("the customer edits the recipient profile within 15 minutes, but NOT the lines or the price", async () => {
    await cleanUp();
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    const edit = (form: unknown) => kernel.handle({ method: "PATCH", path: "/api/orders/public", headers: {}, ip: "1.1.1.1", json: async () => form });

    const done = await edit({
      orderId: placed.id, token: placed.token,
      customerName: "Nguyễn Văn B", phone: "0922222222", addressDetail: "99 Láng Hạ",
      province: "Hà Nội", district: "Quận Đống Đa", ward: "Phường Thành Công", note: "Gọi trước",
      // The storefront sends lines too; the server must IGNORE them — changing lines changes stock and money.
      items: [{ productCode: "DV1234", productName: "Hàng khác", size: "43", price: 1, qty: 5 }],
      total: 5
    });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const order = body<ViewBody<DetailView>>(done).order;
    assert.equal(order.customer?.customerName, "Nguyễn Văn B");
    assert.equal(order.customer?.phone, "0922222222");
    assert.match(order.customer?.address ?? "", /99 Láng Hạ/);
    assert.equal(order.total, 2890000, "THE PRICE MUST NOT CHANGE with the request body");
    assert.equal(order.items.length, 1);
    assert.equal(order.items[0]?.["size"], "42", "THE LINES MUST NOT CHANGE with the request body");

    const head = await store.table("orders").one({ id: placed.id });
    assert.equal(Number(head?.["total"]), 2890000);
    const lines = await store.table("order_items").find({ where: { order_id: placed.id } });
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.["size"], "42");

    // Every customer edit leaves a log entry — later someone can tell who changed what.
    const logs = await store.table("order_status_logs").find({ where: { order_id: placed.id } });
    assert.ok(logs.some((n: Row) => n["actor_type"] === "khach" && /tự sửa/.test(String(n["note"] || ""))));

    assert.equal((await edit({ orderId: placed.id, token: "sai", customerName: "X" })).status, 404);
    assert.equal((await edit({ orderId: placed.id, token: placed.token, customerName: "" })).status, 422);
    assert.equal((await edit({ orderId: placed.id, token: placed.token, customerName: "C", phone: "123" })).status, 422);
  });

  await t.test("after 15 minutes: no more editing, no more cancelling", async () => {
    await cleanUp();
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    clock.advance(16 * 60 * 1000);

    const edit = await kernel.handle({
      method: "PATCH", path: "/api/orders/public", headers: {}, ip: "1.1.1.1",
      json: async () => ({ orderId: placed.id, token: placed.token, customerName: "Muộn rồi" })
    });
    assert.equal(edit.status, 409);
    assert.equal(body<PlacedBody>(edit).error, "het_gio_sua");

    const cancel = await kernel.handle({
      method: "POST", path: "/api/orders/public/cancel", headers: {}, ip: "1.1.1.1",
      json: async () => ({ orderId: placed.id, token: placed.token })
    });
    assert.equal(cancel.status, 409);
    assert.equal(body<PlacedBody>(cancel).error, "het_gio_huy");

    const head = await store.table("orders").one({ id: placed.id });
    assert.equal(head?.["customer_name"], "Nguyễn Văn A", "not one letter of the order may change");
    assert.equal(head?.["status"], "pending");
  });

  await t.test("the customer cancels: status changes, log written, event emitted, cancelling again is 409", async () => {
    await cleanUp();
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    const heard: { maDon?: string }[] = [];
    kernel.bus.on("don-khach.da-huy", "bai-kiem-tra", (d) => { heard.push(d as { maDon?: string }); });

    const cancel = (form: unknown) => kernel.handle({ method: "POST", path: "/api/orders/public/cancel", headers: {}, ip: "1.1.1.1", json: async () => form });

    const done = await cancel({ orderId: placed.id, token: placed.token });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const order = body<ViewBody<DetailView>>(done).order;
    assert.equal(order.status, "cancelled");
    assert.equal(order.statusLabel, "Đơn đã hủy");
    assert.equal(order.canCancel, false, "once cancelled there is no cancel button");

    await new Promise((r) => setImmediate(r));
    assert.equal(heard.length, 1, "the event must go out so Inventory can release the reservation");
    assert.equal(heard[0]?.maDon, placed.id);

    const logs = await store.table("order_status_logs").find({ where: { order_id: placed.id } });
    assert.ok(logs.some((n: Row) => n["status"] === "cancelled" && n["actor_type"] === "khach"));

    const again = await cancel({ orderId: placed.id, token: placed.token });
    assert.equal(again.status, 409);
    assert.equal(body<PlacedBody>(again).error, "da_huy_roi");

    assert.equal((await cancel({ orderId: placed.id, token: "sai" })).status, 404);
  });

  await t.test("lookup by phone number: only how far the order got, NO address", async () => {
    await cleanUp();
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    const lookup = (form: unknown) => kernel.handle({ method: "POST", path: "/api/orders/lookup", headers: {}, ip: "1.1.1.1", json: async () => form });

    const right = await lookup({ orderId: placed.id, contact: "0911111111" });
    assert.equal(right.status, 200, JSON.stringify(right.body));
    const order = body<ViewBody<StatusView>>(right).order;
    assert.equal((order as { view?: string }).view, "status");
    const json = JSON.stringify(order);
    assert.ok(!json.includes("Đội Cấn"), "the status view must not leak the address");
    assert.ok(!json.includes("2890000"), "the status view must not leak money");

    // Another number sees nothing, and the refusal is identical to "no such order".
    const wrong = await lookup({ orderId: placed.id, contact: "0999999999" });
    assert.equal(wrong.status, 404);
    assert.equal(body<PlacedBody>(wrong).error, "khong_thay_don");
    const missing = await lookup({ orderId: "ORD-khong-co", contact: "0911111111" });
    assert.deepEqual(wrong.body, missing.body, "the two refusals must be identical, or an order's existence leaks");
  });

  await t.test("the lookup token is NEVER stored in clear text", async () => {
    await cleanUp();
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    const head = await store.table("orders").one({ id: placed.id });
    assert.notEqual(head?.["order_lookup_token_hash"], placed.token);
    assert.equal(String(head?.["order_lookup_token_hash"]).length, 64, "must be a sha256 hash");
  });

  await t.test("money on the order goes through the order-money kit, never derived", async () => {
    await cleanUp();
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));

    const unpaid = await readAsAdmin(placed.id);
    assert.equal(unpaid.paidAmount, 0);
    assert.equal(unpaid.remainingAmount, 2890000);

    await store.table("orders").update({ id: placed.id }, { payment_status: "paid" });
    const paid = await readAsAdmin(placed.id);
    assert.equal(paid.paidAmount, 2890000, "status paid without an amount = fully paid");
    assert.equal(paid.remainingAmount, 0);
  });

  await t.test("changing the status: one more log entry, announced on the bus", async () => {
    await cleanUp();
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    const heard: unknown[] = [];
    kernel.bus.on("don-khach.doi-trang-thai", "bai-thu", (d) => { heard.push(d); });

    const changed = await kernel.handle({
      method: "PATCH", path: `/api/orders/${placed.id}`, headers: admin,
      json: async () => ({ status: "confirmed", note: "Gọi khách xác nhận" })
    });
    assert.equal(changed.status, 200);
    assert.equal(await store.table("order_status_logs").count({ order_id: placed.id }), 2);

    const order = await readAsAdmin(placed.id);
    assert.equal(order.status, "confirmed");
    assert.equal(order.statusLogs.length, 2);

    await new Promise((r) => setImmediate(r));
    assert.equal(heard.length, 1);
  });

  await t.test("changing the status of an unknown order says so", async () => {
    const r = await kernel.handle({
      method: "PATCH", path: "/api/orders/ORD-khong-co", headers: admin,
      json: async () => ({ status: "confirmed" })
    });
    assert.equal(r.status, 404);
  });

  await t.test("the order list is admin-only and filters by status and phone", async () => {
    await cleanUp(); stockUp(9);
    // The manual clock does NOT tick, so these two orders share one timestamp — exactly the duplicate-id edge.
    assert.equal((await place(SAMPLE_ORDER)).status, 200);
    assert.equal((await place({ ...SAMPLE_ORDER, phone: "0922222222" })).status, 200, "the second order must not be lost to a duplicate id");

    assert.equal((await kernel.handle({ method: "GET", path: "/api/orders", headers: {} })).status, 401);

    const all = body<Order[]>(await kernel.handle({ method: "GET", path: "/api/orders", headers: admin }));
    assert.equal(all.length, 2);

    const one = body<Order[]>(await kernel.handle({ method: "GET", path: "/api/orders", query: { phone: "0922222222" }, headers: admin }));
    assert.equal(one.length, 1);
    assert.equal(one[0]?.phone, "0922222222");
  });

  await t.test("THE PRICE comes from stock, NOT from the customer — a client sending 1 dong still pays the real price", async () => {
    await cleanUp();
    const r = await place({ ...SAMPLE_ORDER, items: [{ productCode: "DV1234", size: "42", price: 1, qty: 1 }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const placed = body<PlacedBody>(r);
    assert.equal(placed.total, 2890000, "the total follows the stock price, not the price the client sent");

    const order = await readAsAdmin(placed.id);
    assert.equal(order.items[0]?.price, 2890000);
  });

  await t.test("two orders in the SAME millisecond still get two different ids", async () => {
    await cleanUp(); stockUp(5);

    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const r = await place(SAMPLE_ORDER);
      assert.equal(r.status, 200, `order ${i + 1}: ${JSON.stringify(r.body)}`);
      ids.push(body<PlacedBody>(r).id);
    }
    assert.equal(new Set(ids).size, 3, `three orders must get three ids: ${ids.join(", ")}`);
    assert.ok(ids.every((id) => /^ORD-\d+$/.test(id)), "the id shape must not change — Desk reads it");
    assert.equal(await store.table("orders").count(), 3);
  });

  await t.test("an order leaving the server carries its lines and pre-computed money", async () => {
    await cleanUp();
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    const order = await readAsAdmin(placed.id);
    assert.equal(order.items.length, 1);
    assert.equal(order.items[0]?.productCode, "DV1234");
    assert.equal(order.items[0]?.size, "42");
    assert.ok("paidAmount" in order && "remainingAmount" in order, "clients only read the fields, never derive them");
  });

  await t.test("BREAKS when the write fails after the reservation: the reservation is released", async () => {
    // Reserve first, then write. If the write fails the stock must not stay held: the next
    // customer could not buy a pair that nobody ordered.
    await cleanUp(); stockUp(1);
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    assert.ok(placed.ok);
    assert.equal(stock.get("DV1234|42")?.qty, 0, "the pair is held by the order");

    // Simulate a write failure: the orders table is gone for a moment.
    stockUp(1);
    await store.execute("RENAME TABLE `orders` TO `orders_tam`");
    try {
      const r = await place(SAMPLE_ORDER);
      assert.equal(r.status, 500, "a failed write is a server error, not a silent success");
    } finally {
      await store.execute("RENAME TABLE `orders_tam` TO `orders`");
    }
    assert.equal(stock.get("DV1234|42")?.qty, 1, "the reservation must be released when the write fails");
    assert.ok(logger.has(/ghi don hong, da tra lai cho giu/));
  });
});
