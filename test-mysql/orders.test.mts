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
import { EVENTS, ROLE, defineModule, type Reply, type Row } from "../dist/contract/index.js";
import { FakeHttpClient, FakeStaticFilePort, FixedWindowRateLimiter, Kernel, ManualClock, MemoryLogger, MemoryMailer, TokenAuth, jsonResponse, openMysqlStore } from "../dist/kernel/index.js";
import {
  manifest, type CommitInput, type CommitResult, type ReleaseInput, type ReserveInput, type ReserveResult, type RestockInput, type RestockResult
} from "../dist/modules/don-khach/module.js";
import type { Order } from "../dist/modules/don-khach/order-repository.js";
import type { DetailView, StatusView } from "../dist/modules/don-khach/public-orders.js";
import { manifest as shipping } from "../dist/modules/van-chuyen/module.js";

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
    },
    // The hold becomes a sale: the fake already took the pairs off at reserve, so only the ticket goes.
    "hang-kho.commit": (_ctx, input: CommitInput): CommitResult => {
      const held = tickets.get(input.ticket);
      if (!held) return { ok: false, reason: "khong_co_phieu" };
      tickets.delete(input.ticket);
      return { ok: true, variantId: stock.get(held.key)?.variantId ?? "", quantity: held.quantity };
    },
    /**
     * Tồn của một mã, như Hàng hoá thật trả về. Bài cần nó vì đổi mẫu hỏi tên hàng ở đây —
     * kho giả thiếu cửa này thì dòng sau khi đổi mất tên, và bài sẽ không thấy.
     */
    "hang-kho.stock": (_ctx, input: { code?: string }) => {
      const code = String(input?.code ?? "");
      const lines = [...stock.entries()]
        .filter(([key]) => key.startsWith(`${code}|`))
        .map(([key, line]) => ({ variantId: line.variantId, size: key.split("|")[1] ?? "", quantity: line.qty, price: line.price, warehouseId: line.warehouseId, rank: 1 }));
      if (lines.length === 0) return { found: false as const, available: false as const, reason: "khong_co_ma", lines: [] };
      return { found: true as const, available: lines.some((l) => l.quantity > 0), code, name: `Giày ${code}`, lines };
    },
    "hang-kho.restock": (_ctx, input: RestockInput): RestockResult => {
      for (const line of stock.values()) {
        if (line.variantId === input.variantId) { line.qty += input.quantity; return { ok: true }; }
      }
      return { ok: false, reason: "khong_co_bien_the" };
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

  // A test database created by an OLDER schema (before 12/09/2026 the orders table was born from
  // a test, with fewer columns) keeps its old shape — `CREATE TABLE IF NOT EXISTS` does not add
  // columns. The test database is disposable, so start it over rather than debug "unknown column".
  const columns = await store.rows("SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'");
  if (columns.length > 0 && !columns.some((r) => r["c"] === "stock_reservation_json")) {
    for (const table of ["order_status_logs", "order_items", "orders"]) await store.execute(`DROP TABLE IF EXISTS \`${table}\``);
    await store.execute("DELETE FROM lich_su_luoc_do WHERE module = ?", [manifest.id]);
  }
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
      rateLimiter: new FixedWindowRateLimiter(clock),
      staticFiles: new FakeStaticFilePort({}), mail: new MemoryMailer()
    },
    logger, modules: [fakeInventory, manifest], config: { "hang-kho": {}, "don-khach": { siteUrl: "https://shop.test" } }
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

  // The old site's refusal, which the storefront reads: `message` is shown, m-order.js branches on 409 / invalid_order.
  type Refusal = { ok: false; error: string; lyDo: string; message: string };

  await t.test("placing an order RESERVES stock — the next customer cannot buy the pair already sold", async () => {
    await cleanUp(); stockUp(1);
    assert.equal((await place(SAMPLE_ORDER)).status, 200);

    const second = await place(SAMPLE_ORDER);
    assert.equal(second.status, 409);
    assert.equal(body<Refusal>(second).error, "insufficient_stock");
    assert.equal(body<Refusal>(second).lyDo, "het_hang");
    assert.match(body<Refusal>(second).message, /DV1234 size 42/);
  });

  await t.test("out of stock writes NO order at all", async () => {
    await cleanUp(); stockUp(0);
    assert.equal(body<Refusal>(await place(SAMPLE_ORDER)).lyDo, "het_hang");
    assert.equal(await store.table("orders").count(), 0, "no empty order may be left behind");
  });

  await t.test("an order missing the name or the phone is refused", async () => {
    await cleanUp();
    const cases: [unknown, string][] = [
      [{ ...SAMPLE_ORDER, customerName: "" }, "thieu_ten_khach"],
      [{ ...SAMPLE_ORDER, phone: "" }, "thieu_dien_thoai"],
      [{ ...SAMPLE_ORDER, items: [] }, "don_khong_co_mon"]
    ];
    for (const [order, reason] of cases) {
      const r = await place(order);
      assert.equal(r.status, 422);
      assert.equal(body<Refusal>(r).error, "invalid_order");
      assert.equal(body<Refusal>(r).lyDo, reason);
      assert.ok(body<Refusal>(r).message.length > 0, "the page shows this message to the customer");
    }
    assert.equal(await store.table("orders").count(), 0);
  });

  await t.test("the order carries its transfer reference from the start — the QR and 'Nội dung CK' show it", async () => {
    await cleanUp();
    const placed = body<PlacedBody & { paymentReference: string }>(await place(SAMPLE_ORDER));
    assert.equal(placed.paymentReference, `TR-${placed.id.replace(/[^0-9a-z]/gi, "").slice(-8).toUpperCase()}`);
    assert.equal((await readAsAdmin(placed.id)).paymentReference, placed.paymentReference, "stamped on the order, not only in the reply");
  });

  await t.test("the same checkout form sent twice places ONE order (clientOrderId)", async () => {
    await cleanUp();
    const form = { ...SAMPLE_ORDER, clientOrderId: "co-bai-thu-1" };
    const first = body<PlacedBody>(await place(form));
    const again = await place(form);
    assert.equal(again.status, 200);
    assert.equal(body<PlacedBody & { duplicate?: boolean }>(again).id, first.id);
    assert.equal(body<PlacedBody & { duplicate?: boolean }>(again).duplicate, true);
    assert.equal(await store.table("orders").count(), 1, "a retry must not hold the stock twice");
    assert.notEqual(body<PlacedBody>(await place({ ...SAMPLE_ORDER, clientOrderId: "co-bai-thu-2" })).id, first.id, "another form is another order");
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

  await t.test("Lỗ 1 closed: placing TAKES the pair for good; cancelling gives it BACK — once, from any path", async () => {
    await cleanUp(); stockUp(1);
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    assert.equal(stock.get("DV1234|42")?.qty, 0, "sold: off the shelf");
    assert.equal(tickets.size, 0, "the hold was turned into a sale — no ticket left to expire after 30 minutes");
    const head = await store.table("orders").one({ id: placed.id });
    assert.match(String(head?.["stock_reservation_json"]), /DV1234-42/, "the order remembers what it took");
    assert.ok(head?.["stock_reserved_at"], "and when");

    const cancel = await kernel.handle({ method: "POST", path: "/api/orders/public/cancel", headers: {}, ip: "1.1.1.1", json: async () => ({ orderId: placed.id, token: placed.token }) });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    assert.equal(stock.get("DV1234|42")?.qty, 1, "cancelled: back on the shelf");
    const after = await store.table("orders").one({ id: placed.id });
    assert.ok(after?.["stock_restored_at"], "the order remembers its stock was returned");

    // The owner cancels the SAME order again from OMI: the pair must not come back twice.
    const again = await kernel.handle({ method: "PATCH", path: `/api/orders/${placed.id}`, headers: admin, ip: "1.1.1.1", json: async () => ({ status: "cancelled" }) });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(stock.get("DV1234|42")?.qty, 1, "never restocked twice");

    // The owner cancelling a FRESH order from OMI restores too — one path for every canceller.
    const second = body<PlacedBody>(await place(SAMPLE_ORDER));
    assert.equal(stock.get("DV1234|42")?.qty, 0);
    const heard: { maDon?: string; boi?: string }[] = [];
    kernel.bus.on("don-khach.da-huy", "bai-huy-quan-tri", (d) => { heard.push(d as { maDon?: string; boi?: string }); });
    await kernel.handle({ method: "PATCH", path: `/api/orders/${second.id}`, headers: admin, ip: "1.1.1.1", json: async () => ({ status: "cancelled" }) });
    assert.equal(stock.get("DV1234|42")?.qty, 1);
    await new Promise((r) => setImmediate(r));
    assert.equal(heard.filter((h) => h.maDon === second.id).length, 1, "the owner's cancel is announced exactly once");
    assert.equal(heard.find((h) => h.maDon === second.id)?.boi, "quan-tri");
  });

  // ---------- the owner's doors (OMI) and Sales Desk's sync ----------

  const asAdmin = (method: string, path: string, json?: unknown) => kernel.handle({ method, path, headers: admin, ip: "1.1.1.1", json: async () => json ?? {} });
  interface ManualBody { ok: boolean; orderId: string; lookupUrl: string; lookupSecret: string; created: boolean; stock: { ok: boolean; thieu: { code: string; size: string }[] }; error?: string }

  await t.test("OWNER: a manual order (MAN-) takes stock where the catalogue has it, keeps the rest, and gets a lookup secret the customer can type", async () => {
    await cleanUp(); stockUp(1);
    const r = await asAdmin("POST", "/api/orders/thu-cong", {
      customerName: "Khách gọi điện", phone: "0933333333", address: "5 Lý Thường Kiệt, Hà Nội", paymentMethod: "cod",
      items: [
        { productCode: "DV1234", size: "42", qty: 1, price: 2500000 },                     // in the catalogue, owner's price
        { productCode: "HOKA-MACH", productName: "Hoka Mach 6", size: "44", qty: 1, price: 3900000 } // a partner's pair, not in stock
      ]
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const made = body<ManualBody>(r);
    assert.match(made.orderId, /^MAN-\d+$/);
    assert.equal(made.created, true);
    assert.match(made.lookupSecret, /^TR-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    assert.match(made.lookupUrl, /^https:\/\/shop\.test\/order-status\.html\?order=MAN-/);
    assert.deepEqual(made.stock.thieu, [{ code: "HOKA-MACH", size: "44" }], "the line the catalogue lacks is reported, not dropped");
    assert.equal(stock.get("DV1234|42")?.qty, 0, "the catalogue pair was taken");
    const order = await readAsAdmin(made.orderId);
    assert.equal(order.items.length, 2, "both lines are on the order");
    assert.equal(order.items[0]?.price, 2500000, "THE OWNER's price is kept (the customer's would not be)");
    assert.equal(order.total, 6400000);

    // The customer types the secret with dashes, or without: both open the order.
    for (const typed of [made.lookupSecret, made.lookupSecret.replace(/-/g, "").toLowerCase()]) {
      const look = await kernel.handle({ method: "POST", path: "/api/orders/lookup", headers: {}, ip: "1.1.1.1", json: async () => ({ orderId: made.orderId, lookupSecret: typed }) });
      assert.equal(look.status, 200, `secret typed as ${typed}: ${JSON.stringify(look.body)}`);
    }
  });

  await t.test("OWNER: editing lines gives the old pair back and takes the new one; editing the recipient leaves stock alone", async () => {
    await cleanUp(); stockUp(1);
    const made = body<ManualBody>(await asAdmin("POST", "/api/orders/thu-cong", { customerName: "A", phone: "0911111111", items: [{ productCode: "DV1234", size: "42", qty: 1, price: 2500000 }] }));
    assert.equal(stock.get("DV1234|42")?.qty, 0);

    const renamed = await asAdmin("PUT", `/api/orders/${made.orderId}`, { customerName: "Nguyễn Văn Sửa", trackingCode: "SPX-1" });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
    assert.equal(stock.get("DV1234|42")?.qty, 0, "recipient edit must not touch stock");
    let order = await readAsAdmin(made.orderId);
    assert.equal(order.customerName, "Nguyễn Văn Sửa");
    assert.equal(order.trackingCode, "SPX-1");
    assert.ok(order.statusLogs.some((n) => n.actorType === "quan-tri" && /Sửa đơn/.test(n.note)), "every owner edit leaves a log line");

    const swapped = await asAdmin("PUT", `/api/orders/${made.orderId}`, { items: [{ productCode: "DV1234", size: "43", qty: 1, price: 2500000 }] });
    assert.equal(swapped.status, 200, JSON.stringify(swapped.body));
    assert.equal(stock.get("DV1234|42")?.qty, 1, "the old pair went back");
    assert.deepEqual(body<{ stock: ManualBody["stock"] }>(swapped).stock.thieu, [{ code: "DV1234", size: "43" }], "size 43 is not in the fake stock");
    order = await readAsAdmin(made.orderId);
    assert.equal(order.items[0]?.size, "43");

    const back = await asAdmin("PUT", `/api/orders/${made.orderId}`, { items: [{ productCode: "DV1234", size: "42", qty: 1, price: 2500000 }] });
    assert.equal(back.status, 200);
    assert.equal(stock.get("DV1234|42")?.qty, 0, "taken again");
    // …and a cancel after the edit still returns exactly what the edited order took.
    await asAdmin("PATCH", `/api/orders/${made.orderId}`, { status: "cancelled" });
    assert.equal(stock.get("DV1234|42")?.qty, 1);
  });

  await t.test("OWNER: deleting an order puts it in the BIN and gives its pair back — the row survives", async () => {
    await cleanUp(); stockUp(1);
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    assert.equal(stock.get("DV1234|42")?.qty, 0);

    const gone = await asAdmin("DELETE", `/api/orders/${placed.id}`);
    assert.equal(gone.status, 200, JSON.stringify(gone.body));
    assert.equal(body<{ daXoa: boolean }>(gone).daXoa, true);
    assert.equal(stock.get("DV1234|42")?.qty, 1, "the pair goes back on the shelf straight away");
    // The row is NOT gone: the seller must be able to change their mind.
    assert.equal(await store.table("orders").count({ id: placed.id }), 1);
    assert.equal(await store.table("order_items").count({ order_id: placed.id }), 1);

    const listed = body<Order[]>(await kernel.handle({ method: "GET", path: "/api/orders", headers: admin }));
    assert.ok(!listed.some((o) => o.id === placed.id), "an order in the bin is not in the working list");
    const bin = body<Order[]>(await kernel.handle({ method: "GET", path: "/api/orders", query: { daXoa: "chi" }, headers: admin }));
    assert.ok(bin.some((o) => o.id === placed.id), "…but the bin shows it");
    assert.equal(bin.find((o) => o.id === placed.id)?.daXoa, true);
  });

  await t.test("deleting TWICE does not return the pair twice", async () => {
    await cleanUp(); stockUp(1);
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    await asAdmin("DELETE", `/api/orders/${placed.id}`);
    assert.equal(stock.get("DV1234|42")?.qty, 1);

    const again = await asAdmin("DELETE", `/api/orders/${placed.id}`);
    assert.equal(again.status, 200);
    assert.equal(body<{ daXoa: boolean }>(again).daXoa, false, "the second delete says it changed nothing");
    assert.equal(stock.get("DV1234|42")?.qty, 1, "stock must not be invented by clicking twice");
  });

  await t.test("RESTORING TWICE does not take the pair twice", async () => {
    await cleanUp(); stockUp(1);
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    await asAdmin("DELETE", `/api/orders/${placed.id}`);
    assert.equal(stock.get("DV1234|42")?.qty, 1);

    const back = await asAdmin("POST", `/api/orders/${placed.id}/khoi-phuc`, {});
    assert.equal(back.status, 200, JSON.stringify(back.body));
    assert.equal(body<{ daKhoiPhuc: boolean }>(back).daKhoiPhuc, true);
    assert.equal(stock.get("DV1234|42")?.qty, 0, "restoring takes the pair again");
    assert.equal((await readAsAdmin(placed.id)).daXoa, false);

    const twice = await asAdmin("POST", `/api/orders/${placed.id}/khoi-phuc`, {});
    assert.equal(twice.status, 200);
    assert.equal(body<{ daKhoiPhuc: boolean }>(twice).daKhoiPhuc, false, "the second restore says it changed nothing");
    assert.equal(stock.get("DV1234|42")?.qty, 0, "THE BUG THIS GUARDS: a second restore must not take a second pair");
  });

  await t.test("restoring an order whose stock was sold meanwhile still restores it, and names what is missing", async () => {
    await cleanUp(); stockUp(1);
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    await asAdmin("DELETE", `/api/orders/${placed.id}`);
    stock.set("DV1234|42", { qty: 0, price: 2890000, variantId: "DV1234-42", warehouseId: "wh_yen" }); // somebody else bought it

    const back = await asAdmin("POST", `/api/orders/${placed.id}/khoi-phuc`, {});
    assert.equal(back.status, 200, JSON.stringify(back.body));
    assert.equal(body<{ daKhoiPhuc: boolean }>(back).daKhoiPhuc, true, "one missing line must not block the restore");
    assert.deepEqual(body<{ stock: ManualBody["stock"] }>(back).stock.thieu, [{ code: "DV1234", size: "42" }], "the seller is told which line is short");
  });

  await t.test("an order in the bin counts for nothing: not revenue, not a customer's order count", async () => {
    await cleanUp(); stockUp(2);
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    const report = () => kernel.handle({ method: "GET", path: "/api/bao-cao/tong-quan", query: { ngay: "365" }, headers: admin });
    const before = body<{ tong: { soDon: number } }>(await report());
    assert.equal(before.tong.soDon, 1);

    await asAdmin("DELETE", `/api/orders/${placed.id}`);
    const after = body<{ tong: { soDon: number } }>(await report());
    assert.equal(after.tong.soDon, 0, "a deleted order is not revenue");
    const customers = body<{ theoDon: { dienThoai: string }[] }>(await kernel.handle({ method: "GET", path: "/api/admin/khach", headers: admin }));
    assert.ok(!customers.theoDon.some((c) => c.dienThoai === "0911111111"), "nor does it make the customer look like a buyer");
  });

  await t.test("PERMANENT delete only empties the BIN — an order still in use is refused", async () => {
    await cleanUp(); stockUp(1);
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    const tooSoon = await asAdmin("DELETE", `/api/orders/${placed.id}/vinh-vien`);
    assert.equal(tooSoon.status, 409, "deleting for good is a decision about something already set aside");
    assert.equal(body<{ error: string }>(tooSoon).error, "chua_xoa_mem");
    assert.equal(await store.table("orders").count({ id: placed.id }), 1);

    await asAdmin("DELETE", `/api/orders/${placed.id}`);
    const gone = await asAdmin("DELETE", `/api/orders/${placed.id}/vinh-vien`);
    assert.equal(gone.status, 200, JSON.stringify(gone.body));
    assert.equal(await store.table("orders").count({ id: placed.id }), 0);
    assert.equal(await store.table("order_items").count({ order_id: placed.id }), 0);
    assert.equal(await store.table("order_status_logs").count({ order_id: placed.id }), 0);
    assert.equal(stock.get("DV1234|42")?.qty, 1, "the stock came back at the FIRST delete, and is not doubled here");
    assert.equal((await asAdmin("PUT", `/api/orders/${placed.id}`, { customerName: "X" })).status, 404);
  });

  await t.test("A LINE KEEPS ITS ID across an edit — the trap of 10/09/2026, closed", async () => {
    // Two lines, neither with a variant id (the shape 284 of 421 real lines have). Drop the FIRST
    // one: without a stored id the second line would slide into position 1 and inherit the id the
    // first line's purchase slips were written against.
    await cleanUp(); stockUp(2);
    const made = body<ManualBody>(await asAdmin("POST", "/api/orders/thu-cong", {
      customerName: "Khách hai dòng", phone: "0911111111",
      items: [
        { productCode: "NGOAI-A", size: "41", qty: 1, price: 1000000 },
        { productCode: "NGOAI-B", size: "42", qty: 1, price: 2000000 }
      ]
    }));
    const before = await readAsAdmin(made.orderId);
    assert.equal(before.items.length, 2);
    const idOfB = before.items[1]?.maDong;
    assert.ok(idOfB, "every line carries a stable id");

    const edited = await asAdmin("PUT", `/api/orders/${made.orderId}`, {
      items: [{ productCode: "NGOAI-B", size: "42", qty: 1, price: 2000000 }]
    });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    const after = await readAsAdmin(made.orderId);
    assert.equal(after.items.length, 1);
    assert.equal(after.items[0]?.maDong, idOfB, "the surviving line keeps ITS id — it must not inherit the dropped line's");
  });

  await t.test("PER-LINE: picking a warehouse writes it on the LINE and moves the order to waiting_partner_confirm", async () => {
    await cleanUp(); stockUp(1);
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    const maDong = (await readAsAdmin(placed.id)).items[0]?.maDong ?? "";
    assert.ok(maDong, "the line has a stable id to address");

    const r = await asAdmin("PATCH", `/api/orders/${placed.id}/dong/${encodeURIComponent(maDong)}`, {
      maDoiTac: "partner_wh_yen", maKho: "wh_yen", tenKho: "Yên"
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const line = (await readAsAdmin(placed.id)).items[0];
    assert.equal(line?.partnerId, "partner_wh_yen");
    assert.equal(line?.warehouseId, "wh_yen");
    assert.equal(line?.procurementStatus, "waiting_partner_confirm");
    assert.equal((await readAsAdmin(placed.id)).status, "waiting_partner_confirm", "every line assigned = the order waits on partners");
  });

  await t.test("PER-LINE: pushing to the buying list pins the cost price ONCE", async () => {
    await cleanUp(); stockUp(1);
    const made = body<ManualBody>(await asAdmin("POST", "/api/orders/thu-cong", {
      customerName: "A", phone: "0911111111",
      items: [{ productCode: "DV1234", size: "42", qty: 1, price: 2890000, saleFilePrice: 2000000 }]
    }));
    const maDong = (await readAsAdmin(made.orderId)).items[0]?.maDong ?? "";
    const at = (path: string, payload: unknown) => asAdmin("PATCH", path, payload);
    const door = `/api/orders/${made.orderId}/dong/${encodeURIComponent(maDong)}`;

    // Pushing without a PARTNER is refused: the line may already know which warehouse it was
    // reserved from, but nobody has been asked to go and buy it.
    const tooSoon = await at(door, { dayMua: true });
    assert.equal(tooSoon.status, 409, JSON.stringify(tooSoon.body));
    assert.equal(body<{ error: string }>(tooSoon).error, "chua_chon_kho");
    await at(door, { maDoiTac: "partner_wh_yen", maKho: "wh_yen", tenKho: "Yên" });

    assert.equal((await at(door, { dayMua: true })).status, 200);
    let line = (await readAsAdmin(made.orderId)).items[0];
    assert.equal(line?.purchaseAuthorized, true);
    assert.equal(line?.procurementStatus, "purchase_ready");
    assert.equal(line?.costPrice, 2000000, "what the shop expects to pay is pinned at the moment of the decision");

    // Pulling it back and pushing again must not re-read a price that may have changed since.
    await at(door, { dayMua: false });
    await at(door, { dayMua: true });
    line = (await readAsAdmin(made.orderId)).items[0];
    assert.equal(line?.costPrice, 2000000, "the pinned price is not rewritten by a second push");
  });

  await t.test("PER-LINE: a line with a purchase slip against it CANNOT change warehouse", async () => {
    await cleanUp(); stockUp(1);
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    const maDong = (await readAsAdmin(placed.id)).items[0]?.maDong ?? "";
    const door = `/api/orders/${placed.id}/dong/${encodeURIComponent(maDong)}`;
    await asAdmin("PATCH", door, { maDoiTac: "partner_wh_yen", maKho: "wh_yen", tenKho: "Yên" });

    // A partner bought it: Purchasing announces it on the bus, Orders stamps the line.
    kernel.bus.emit(EVENTS.purchaseReported, { maDon: placed.id, maDong, maMon: "DV1234", soLuong: 1, boi: "partner_wh_yen" });
    for (let i = 0; i < 40 && (await readAsAdmin(placed.id)).items[0]?.purchaseLockedAt === ""; i += 1) {
      await new Promise((done) => setTimeout(done, 25));
    }
    assert.notEqual((await readAsAdmin(placed.id)).items[0]?.purchaseLockedAt, "", "the line is stamped as bought");

    const swap = await asAdmin("PATCH", door, { maDoiTac: "partner_wh_khac", maKho: "wh_khac", tenKho: "Khác" });
    assert.equal(swap.status, 409, "swapping now would orphan the partner's slip");
    assert.equal(body<{ error: string }>(swap).error, "khoa_kho");
    assert.equal((await readAsAdmin(placed.id)).items[0]?.partnerId, "partner_wh_yen", "the warehouse did not move");
  });

  await t.test("PER-LINE: the shop's decisions survive an edit of the recipient", async () => {
    await cleanUp(); stockUp(1);
    const made = body<ManualBody>(await asAdmin("POST", "/api/orders/thu-cong", {
      customerName: "A", phone: "0911111111", items: [{ productCode: "DV1234", size: "42", qty: 1, price: 2890000 }]
    }));
    const maDong = (await readAsAdmin(made.orderId)).items[0]?.maDong ?? "";
    await asAdmin("PATCH", `/api/orders/${made.orderId}/dong/${encodeURIComponent(maDong)}`, {
      maDoiTac: "partner_wh_yen", maKho: "wh_yen", tenKho: "Yên", loaiSanPham: "shoe"
    });

    // Re-sending the same lines rewrites every row — the assignment must not be lost with them,
    // or a partner already out buying would quietly stop being responsible for the pair.
    await asAdmin("PUT", `/api/orders/${made.orderId}`, {
      customerName: "Tên mới", items: [{ productCode: "DV1234", size: "42", qty: 1, price: 2890000 }]
    });
    const line = (await readAsAdmin(made.orderId)).items[0];
    assert.equal(line?.maDong, maDong, "and it is still the same line");
    assert.equal(line?.partnerId, "partner_wh_yen");
    assert.equal(line?.productKind, "shoe");
  });

  await t.test("PER-LINE: house and external warehouses need nobody to buy them", async () => {
    await cleanUp(); stockUp(1);
    const made = body<ManualBody>(await asAdmin("POST", "/api/orders/thu-cong", {
      customerName: "A", phone: "0911111111", items: [{ productCode: "NGOAI", size: "44", qty: 1, price: 900000 }]
    }));
    const maDong = (await readAsAdmin(made.orderId)).items[0]?.maDong ?? "";
    const r = await asAdmin("PATCH", `/api/orders/${made.orderId}/dong/${encodeURIComponent(maDong)}`, { maKho: "wh_external", tenKho: "Kho ngoài" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const line = body<{ order: Order }>(r).order.items[0] as unknown as { procurementStatus: string; daMuaDu: boolean };
    assert.equal(line.procurementStatus, "purchase_complete", "a pair bought outside the system is already here");
  });

  await t.test("PER-LINE: an unknown product kind is refused, and an unknown line is a 404", async () => {
    await cleanUp(); stockUp(1);
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    const maDong = (await readAsAdmin(placed.id)).items[0]?.maDong ?? "";
    const bad = await asAdmin("PATCH", `/api/orders/${placed.id}/dong/${encodeURIComponent(maDong)}`, { loaiSanPham: "tau-vu-tru" });
    assert.equal(bad.status, 422);
    assert.equal(body<{ error: string }>(bad).error, "loai_san_pham_la");
    assert.equal((await asAdmin("PATCH", `/api/orders/${placed.id}/dong/khong-co-dong-nay`, { loaiSanPham: "shoe" })).status, 404);
  });

  await t.test("QUICK ACTION: 'Sẵn sàng giao' is a GATE — refused while a line is unbought, and it says which", async () => {
    await cleanUp(); stockUp(1);
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    const maDong = (await readAsAdmin(placed.id)).items[0]?.maDong ?? "";
    await asAdmin("PATCH", `/api/orders/${placed.id}/dong/${encodeURIComponent(maDong)}`, { maDoiTac: "partner_wh_yen", maKho: "wh_yen", tenKho: "Yên" });

    const shut = await asAdmin("POST", `/api/orders/${placed.id}/viec`, { viec: "san-sang-giao" });
    assert.equal(shut.status, 409, JSON.stringify(shut.body));
    assert.equal(body<{ error: string }>(shut).error, "chua_mua_du");
    assert.match(body<{ message: string }>(shut).message, /DV1234/, "nói rõ dòng nào, không chỉ 'chưa đủ'");
    assert.match(body<{ message: string }>(shut).message, /Chờ ship bắt buộc/, "chỉ luôn đường thoát");

    // Bought: the gate opens.
    kernel.bus.emit(EVENTS.purchaseReported, { maDon: placed.id, maDong, maMon: "DV1234", soLuong: 1, boi: "partner_wh_yen" });
    for (let i = 0; i < 40 && (await readAsAdmin(placed.id)).items[0]?.purchaseLockedAt === ""; i += 1) {
      await new Promise((done) => setTimeout(done, 25));
    }
    const open = await asAdmin("POST", `/api/orders/${placed.id}/viec`, { viec: "san-sang-giao" });
    assert.equal(open.status, 200, JSON.stringify(open.body));
    assert.equal((await readAsAdmin(placed.id)).status, "ready_to_ship");
  });

  await t.test("QUICK ACTION: 'Chờ ship bắt buộc' is the way THROUGH the gate, and is remembered as forced", async () => {
    await cleanUp(); stockUp(1);
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    const maDong = (await readAsAdmin(placed.id)).items[0]?.maDong ?? "";
    await asAdmin("PATCH", `/api/orders/${placed.id}/dong/${encodeURIComponent(maDong)}`, { maDoiTac: "partner_wh_yen", maKho: "wh_yen", tenKho: "Yên" });

    const forced = await asAdmin("POST", `/api/orders/${placed.id}/viec`, { viec: "cho-ship-bat-buoc" });
    assert.equal(forced.status, 200, JSON.stringify(forced.body));
    const after = await readAsAdmin(placed.id);
    assert.equal(after.status, "ready_to_ship");
    assert.equal(after.epChoShip, true, "đơn nhớ là mình đi qua bằng đường thoát");
    assert.ok(after.statusLogs.some((l) => /chưa mua đủ/.test(String(l.note ?? ""))), "nhật ký nói vì sao phải ép");
  });

  await t.test("QUICK ACTION: undo goes back EXACTLY one step, then there is nothing left to undo", async () => {
    await cleanUp(); stockUp(1);
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    assert.equal((await readAsAdmin(placed.id)).status, "pending");
    assert.ok(!body<{ viecLamDuoc: string[] }>(await kernel.handle({ method: "GET", path: `/api/orders/${placed.id}`, headers: admin }))
      .viecLamDuoc.includes("hoan-tac"), "chưa đổi gì thì chưa có gì để hoàn tác");

    await asAdmin("POST", `/api/orders/${placed.id}/viec`, { viec: "xac-nhan" });
    assert.equal((await readAsAdmin(placed.id)).status, "confirmed_by_customer");

    const undone = await asAdmin("POST", `/api/orders/${placed.id}/viec`, { viec: "hoan-tac" });
    assert.equal(undone.status, 200, JSON.stringify(undone.body));
    assert.equal((await readAsAdmin(placed.id)).status, "pending", "về đúng chỗ cũ");

    // Một bậc, không phải một chồng: hoàn tác xong thì hết chỗ để lùi.
    const again = await asAdmin("POST", `/api/orders/${placed.id}/viec`, { viec: "hoan-tac" });
    assert.equal(again.status, 409, JSON.stringify(again.body));
  });

  await t.test("QUICK ACTION: 'Hoàn tất' closes every line and warns when money is short", async () => {
    await cleanUp(); stockUp(1);
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));   // chưa trả đồng nào
    const done = await asAdmin("POST", `/api/orders/${placed.id}/viec`, { viec: "hoan-tat" });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const after = await readAsAdmin(placed.id);
    assert.equal(after.status, "completed");
    assert.equal(after.items[0]?.procurementStatus, "purchase_complete", "đơn xong thì không còn ai phải mua gì cho nó");
    assert.ok(after.statusLogs.some((l) => /CÒN THIẾU/.test(String(l.note ?? ""))), "nhật ký ghi rõ còn thiếu tiền");

    // Đơn đã xong thì không nhận việc nhanh nào nữa.
    assert.equal((await asAdmin("POST", `/api/orders/${placed.id}/viec`, { viec: "xac-nhan" })).status, 409);
  });

  await t.test("QUICK ACTION: an unknown job is refused, and an order in the bin takes none", async () => {
    await cleanUp(); stockUp(1);
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    assert.equal((await asAdmin("POST", `/api/orders/${placed.id}/viec`, { viec: "bay-len-troi" })).status, 422);
    await asAdmin("DELETE", `/api/orders/${placed.id}`);
    const inBin = await asAdmin("POST", `/api/orders/${placed.id}/viec`, { viec: "xac-nhan" });
    assert.equal(inBin.status, 409);
    assert.equal(body<{ error: string }>(inBin).error, "don_o_thung_rac");
  });

  await t.test("KẾT THÚC: 'Hủy' trả hàng về kho ĐÚNG MỘT LẦN, kể cả bấm hai lần", async () => {
    await cleanUp(); stockUp(1);
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    assert.equal(stock.get("DV1234|42")?.qty, 0);

    const off = await asAdmin("POST", `/api/orders/${placed.id}/ket-thuc`, { cach: "huy", lyDo: "Khách đổi ý" });
    assert.equal(off.status, 200, JSON.stringify(off.body));
    assert.equal(body<{ trangThai: string }>(off).trangThai, "cancelled");
    assert.equal(body<{ daTraTon: number }>(off).daTraTon, 1);
    assert.equal(stock.get("DV1234|42")?.qty, 1, "hàng về kho");

    const again = await asAdmin("POST", `/api/orders/${placed.id}/ket-thuc`, { cach: "huy", lyDo: "bấm nhầm lần nữa" });
    assert.equal(again.status, 409, "đơn đã kết thúc thì không kết thúc lại");
    assert.equal(stock.get("DV1234|42")?.qty, 1, "LỖI NÀY LÀ THỨ BÀI GIỮ: không bao giờ được cộng tồn hai lần");
  });

  await t.test("KẾT THÚC: 'Hàng hoàn' bắt buộc có lý do, và ghi RÕ vào nhật ký là hàng hoàn", async () => {
    await cleanUp(); stockUp(1);
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));

    const noReason = await asAdmin("POST", `/api/orders/${placed.id}/ket-thuc`, { cach: "hang-hoan" });
    assert.equal(noReason.status, 422, "ba tháng sau không ai phân biệt được hàng hoàn với một cú bấm nhầm");
    assert.equal(body<{ error: string }>(noReason).error, "thieu_ly_do");

    const back = await asAdmin("POST", `/api/orders/${placed.id}/ket-thuc`, { cach: "hang-hoan", lyDo: "Khách chê chật" });
    assert.equal(back.status, 200, JSON.stringify(back.body));
    const after = await readAsAdmin(placed.id);
    assert.equal(after.status, "returned_to_stock", "KHÁC 'cancelled': lượt bán đã xảy ra thật");
    assert.ok(after.statusLogs.some((l) => /Hàng hoàn/.test(String(l.note ?? "")) && /Khách chê chật/.test(String(l.note ?? ""))),
      "nhật ký nói đây là hàng hoàn và vì sao — sáu tháng sau chỉ còn dòng này");
  });

  await t.test("KẾT THÚC: việc của NGƯỜI được nói ra, không giả vờ đã làm hộ", async () => {
    await cleanUp(); stockUp(1);
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    // Đơn đã có vận đơn và khách đã trả tiền: hai thứ OMI KHÔNG tự xử lý được.
    // `paymentStatus` phải đi kèm — kit tiền chỉ tính "đã trả" dưới đúng những trạng thái của nó.
    await asAdmin("PUT", `/api/orders/${placed.id}`, { trackingCode: "SPXVN123", carrier: "spx", paidAmount: 500000, paymentStatus: "partially_paid" });
    assert.equal((await readAsAdmin(placed.id)).paidAmount, 500000, "đơn thật sự đang giữ tiền của khách");

    const off = await asAdmin("POST", `/api/orders/${placed.id}/ket-thuc`, { cach: "huy", lyDo: "Khách huỷ" });
    assert.equal(off.status, 200, JSON.stringify(off.body));
    const todo = body<{ canNguoiLam: string[] }>(off).canNguoiLam;
    assert.ok(todo.some((x) => /SPXVN123/.test(x) && /bằng tay/.test(x)), "vận đơn: nói rõ phải gọi hãng, không giả vờ đã huỷ");
    assert.ok(todo.some((x) => /500000|Hoàn tiền/.test(x)), "tiền khách đã trả: nhắc người quyết định");
  });

  await t.test("KẾT THÚC: cách lạ bị từ chối; đơn trong thùng rác không kết thúc được", async () => {
    await cleanUp(); stockUp(1);
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    assert.equal((await asAdmin("POST", `/api/orders/${placed.id}/ket-thuc`, { cach: "vut-di" })).status, 422);
    await asAdmin("DELETE", `/api/orders/${placed.id}`);
    const inBin = await asAdmin("POST", `/api/orders/${placed.id}/ket-thuc`, { cach: "huy" });
    assert.equal(inBin.status, 409);
    assert.equal(body<{ error: string }>(inBin).error, "don_o_thung_rac");
  });

  await t.test("ĐỔI MẪU: tồn đi theo món — đôi cũ VỀ kho, đôi mới RỜI kho, trong cùng một lượt", async () => {
    // Đây đúng chỗ Desk bỏ dở: nó ghi dòng mới mà không đụng giữ chỗ tồn, nên đôi cũ vẫn bị đơn
    // giữ (không ai bán được) còn đôi mới thì không ai giữ (người khác mua mất).
    await cleanUp(); stockUp(1);
    stock.set("DV9999|43", { qty: 2, price: 3500000, variantId: "DV9999-43", warehouseId: "wh_yen" });
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    assert.equal(stock.get("DV1234|42")?.qty, 0, "đôi cũ đang bị đơn giữ");
    const maDong = (await readAsAdmin(placed.id)).items[0]?.maDong ?? "";

    const r = await asAdmin("POST", `/api/orders/${placed.id}/dong/${encodeURIComponent(maDong)}/doi-mau`,
      { ma: "DV9999", size: "43", lyDo: "Đối tác báo hết" });
    assert.equal(r.status, 200, JSON.stringify(r.body));

    assert.equal(stock.get("DV1234|42")?.qty, 1, "ĐÔI CŨ VỀ KHO — bán lại được ngay");
    assert.equal(stock.get("DV9999|43")?.qty, 1, "ĐÔI MỚI RỜI KHO — người khác không mua mất");

    const after = await readAsAdmin(placed.id);
    assert.equal(after.items[0]?.productCode, "DV9999");
    assert.equal(after.items[0]?.size, "43");
    assert.equal(after.items[0]?.maDong, maDong, "MÃ DÒNG GIỮ NGUYÊN — phiếu mua khoá theo nó");
    assert.equal(after.items[0]?.price, 3500000, "giá là giá MỚI của kho, không giữ giá cũ");
    // TÊN HÀNG phải đi cùng: người bán đọc bảng đơn bằng tên, không bằng mã. Chạy thật 16/09 mới
    // lộ ra chỗ này — hai dòng khác nhau trông y hệt nhau, và người đóng gói lấy nhầm đôi.
    assert.notEqual(after.items[0]?.productName, "", "dòng sau khi đổi phải có TÊN, không chỉ có mã");
    assert.equal(after.total, 3500000, "tổng đơn đi theo dòng, nếu không COD sai ngay lần giao tới");
    assert.ok(after.statusLogs.some((l) => /Đổi mẫu/.test(String(l.note ?? "")) && /Đối tác báo hết/.test(String(l.note ?? ""))));
  });

  await t.test("ĐỔI MẪU: nói ra phần chênh để người bán báo khách", async () => {
    await cleanUp(); stockUp(1);
    stock.set("RE9999|43", { qty: 1, price: 1000000, variantId: "RE9999-43", warehouseId: "wh_yen" });
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));   // đôi cũ 2.890.000
    const maDong = (await readAsAdmin(placed.id)).items[0]?.maDong ?? "";
    const r = await asAdmin("POST", `/api/orders/${placed.id}/dong/${encodeURIComponent(maDong)}/doi-mau`, { ma: "RE9999", size: "43" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const out = body<{ chenh: number; loiNhan: string }>(r);
    assert.equal(out.chenh, -1890000, "mẫu mới rẻ hơn");
    assert.match(out.loiNhan, /trả lại khách/, "người bán đang cầm điện thoại — nói cho họ câu để nói");
  });

  await t.test("ĐỔI MẪU: dòng ĐÃ MUA thì không đổi, và mẫu mới hết hàng cũng không đổi", async () => {
    await cleanUp(); stockUp(1);
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    const maDong = (await readAsAdmin(placed.id)).items[0]?.maDong ?? "";
    const door = `/api/orders/${placed.id}/dong/${encodeURIComponent(maDong)}/doi-mau`;

    // Mẫu mới không có trong kho: từ chối, và KHÔNG được đụng gì tới đôi cũ.
    const noStock = await asAdmin("POST", door, { ma: "KHONG-CO", size: "43" });
    assert.equal(noStock.status, 409);
    assert.equal(body<{ error: string }>(noStock).error, "het_hang_mau_moi");
    assert.equal(stock.get("DV1234|42")?.qty, 0, "đôi cũ vẫn đang được giữ cho đơn");
    assert.equal((await readAsAdmin(placed.id)).items[0]?.productCode, "DV1234", "dòng không đổi");

    // Đối tác đã mua rồi: đổi mẫu lúc này là bỏ rơi một món hàng đã trả tiền.
    stock.set("DV9999|43", { qty: 1, price: 3500000, variantId: "DV9999-43", warehouseId: "wh_yen" });
    kernel.bus.emit(EVENTS.purchaseReported, { maDon: placed.id, maDong, maMon: "DV1234", soLuong: 1, boi: "partner_wh_yen" });
    // Bus là fire-and-forget: phiếu mua là thứ chặn, và nó đến từ `purchasedByLine` — ở bài này
    // không có module mua hộ, nên chặn bằng đường khác: đơn đã có vận đơn.
    await asAdmin("PUT", `/api/orders/${placed.id}`, { trackingCode: "SPXVN777" });
    const shipped = await asAdmin("POST", door, { ma: "DV9999", size: "43" });
    assert.equal(shipped.status, 409);
    assert.equal(body<{ error: string }>(shipped).error, "don_da_co_van_don", "hàng đang trên đường thì đổi mẫu là quá muộn");
  });

  await t.test("GIÁ VỐN: người làm sổ gõ tay, và dòng chưa có giá thì hiện ở danh sách còn thiếu", async () => {
    await cleanUp(); stockUp(1);
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    const maDong = (await readAsAdmin(placed.id)).items[0]?.maDong ?? "";

    const before = body<{ dong: { maDon: string; maDong: string; goiY: number }[] }>(
      await kernel.handle({ method: "GET", path: "/api/tien/gia-von/thieu", headers: admin }));
    assert.ok(before.dong.some((d) => d.maDong === maDong), "dòng chưa có giá vốn là việc còn phải làm");

    const wrote = await asAdmin("POST", "/api/tien/gia-von", { dong: [{ maDon: placed.id, maDong, giaVon: 2000000 }] });
    assert.equal(wrote.status, 200, JSON.stringify(wrote.body));
    assert.deepEqual(body<{ daGhi: string[] }>(wrote).daGhi, [maDong]);
    assert.equal((await readAsAdmin(placed.id)).items[0]?.costPrice, 2000000);

    const after = body<{ dong: { maDong: string }[] }>(
      await kernel.handle({ method: "GET", path: "/api/tien/gia-von/thieu", headers: admin }));
    assert.ok(!after.dong.some((d) => d.maDong === maDong), "ghi xong thì hết là việc phải làm");
  });

  await t.test("GIÁ VỐN: bù tự động KHÔNG BAO GIỜ đè lên số người làm sổ đã gõ", async () => {
    // Người gõ một con số nghĩa là họ biết gì đó máy không biết. Một vòng đồng bộ chạy lại mà xoá
    // nó đi là mất thông tin không lấy lại được — và không ai biết là đã mất.
    await cleanUp(); stockUp(1);
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    const maDong = (await readAsAdmin(placed.id)).items[0]?.maDong ?? "";
    await asAdmin("POST", "/api/tien/gia-von", { dong: [{ maDon: placed.id, maDong, giaVon: 1234000 }] });

    // Bài này không cắm module mua hộ, nên không có phiếu nào để bù — cửa vẫn phải trả lời tử tế.
    const filled = await asAdmin("POST", "/api/tien/gia-von/bu-tu-phieu", {});
    assert.equal(filled.status, 200, JSON.stringify(filled.body));
    assert.equal((await readAsAdmin(placed.id)).items[0]?.costPrice, 1234000, "số gõ tay còn nguyên");
  });

  await t.test("GIÁ VỐN: gửi rỗng thì từ chối, gửi quá nhiều dòng cũng từ chối", async () => {
    await cleanUp(); stockUp(1);
    assert.equal((await asAdmin("POST", "/api/tien/gia-von", { dong: [] })).status, 422);
    const qua = Array.from({ length: 201 }, (_, i) => ({ maDon: "X", maDong: `X#${i}`, giaVon: 1 }));
    assert.equal((await asAdmin("POST", "/api/tien/gia-von", { dong: qua })).status, 413);
  });

  await t.test("SALES DESK: POST /api/admin/manual-orders/sync creates a MAN- order the first time and updates it after, with the running site's reply", async () => {
    await cleanUp(); stockUp(2);
    const first = await asAdmin("POST", "/api/admin/manual-orders/sync", {
      order: { id: "MAN-1757800000000", customerName: "Khách Desk", phone: "0944444444", status: "processing", total: 2890000, paidAmount: 500000,
        items: [{ productCode: "DV1234", productName: "Pegasus 40", size: "42", qty: 1, price: 2890000 }] }
    });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const made = body<ManualBody>(first);
    assert.equal(made.orderId, "MAN-1757800000000");
    assert.equal(made.created, true);
    assert.match(made.lookupSecret, /^TR-/);
    let order = await readAsAdmin("MAN-1757800000000");
    assert.equal(order.status, "processing");
    assert.equal(order.paidAmount, 500000, "money through the kit: paidAmount from the paid amount Desk sent");
    assert.equal(order.remainingAmount, 2390000);
    assert.equal(stock.get("DV1234|42")?.qty, 1);

    const second = await asAdmin("POST", "/api/admin/manual-orders/sync", { order: { id: "MAN-1757800000000", status: "shipped", trackingCode: "VTP-9" } });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(body<ManualBody>(second).created, false);
    assert.equal(body<ManualBody>(second).lookupSecret, "", "the stored secret is a hash — it is never handed out again");
    order = await readAsAdmin("MAN-1757800000000");
    assert.equal(order.status, "shipped");
    assert.equal(order.trackingCode, "VTP-9");
    assert.equal(order.items.length, 1, "no items sent = lines untouched");
    assert.equal(stock.get("DV1234|42")?.qty, 1, "no items sent = stock untouched");

    assert.equal((await asAdmin("POST", "/api/admin/manual-orders/sync", { order: { id: "ORD-123" } })).status, 422, "only MAN- ids");
  });

  await t.test("OWNER: GET /api/admin/khach lists customers as the orders know them, one row per phone", async () => {
    await cleanUp(); stockUp(3);
    await place(SAMPLE_ORDER);
    await place(SAMPLE_ORDER);
    await place({ ...SAMPLE_ORDER, customerName: "Người khác", phone: "0988888888" });
    const r = await asAdmin("GET", "/api/admin/khach");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const list = body<{ ok: boolean; theoDon: { dienThoai: string; ten: string; soDon: number; tongTien: number }[]; taiKhoan: unknown[] }>(r);
    const a = list.theoDon.find((k) => k.dienThoai === "0911111111");
    assert.equal(a?.soDon, 2);
    assert.equal(a?.tongTien, 2 * 2890000);
    assert.equal(list.theoDon.find((k) => k.dienThoai === "0988888888")?.ten, "Người khác");
    assert.equal(list.taiKhoan.length, 0, "no accounts registered in this test");
    const filtered = body<{ theoDon: unknown[] }>(await kernel.handle({ method: "GET", path: "/api/admin/khach", query: { q: "0988" }, headers: admin, ip: "1.1.1.1" }));
    assert.equal(filtered.theoDon.length, 1);
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

  await t.test("creating a waybill writes the tracking number ONTO the order — and does not mark it shipped", async () => {
    // Before this, a waybill made from OMI existed at the carrier and nowhere else: the order
    // screen still said "chưa có vận đơn". Shipping and Orders meet on the bus, not in code.
    await cleanUp();
    const placed = body<PlacedBody>(await place(SAMPLE_ORDER));
    assert.ok(placed.ok);

    const withShipping = new Kernel({
      ports: {
        store, logger, clock,
        http: new FakeHttpClient(() => jsonResponse({ ret_code: 0, message: "success", data: { orders: [{ tracking_no: "SPXVN000111", order_id: placed.id, estimated_shipping_fee: 25000 }] } })),
        auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }], clock }),
        rateLimiter: new FixedWindowRateLimiter(clock),
        staticFiles: new FakeStaticFilePort({}), mail: new MemoryMailer()
      },
      logger, modules: [fakeInventory, manifest, shipping],
      config: {
        "hang-kho": {}, "don-khach": { siteUrl: "https://shop.test" },
        "van-chuyen": {
          defaultCarrier: "spx",
          sender: { name: "Kho TopRun", phone: "0900000000", province: "Hà Nội", district: "Quận Ba Đình", ward: "Phường Giảng Võ", addressDetail: "Số 1 ngõ 2" },
          spx: { appId: "app", appSecret: "secret", userId: "user", userSecret: "user-secret" }
        }
      }
    });

    const made = await withShipping.handle({
      method: "POST", path: "/api/van-chuyen/tao-tu-don", headers: admin, ip: "1.1.1.1", json: async () => ({ maDon: placed.id })
    });
    assert.equal(made.status, 200, JSON.stringify(made.body));

    // The bus is fire-and-forget on purpose (a listener must never hold up the emitter), so the
    // tracking number lands a tick after the reply — wait for it rather than read too early.
    let order = await readAsAdmin(placed.id);
    for (let i = 0; i < 40 && order.trackingCode === ""; i += 1) {
      await new Promise((done) => setTimeout(done, 25));
      order = await readAsAdmin(placed.id);
    }
    assert.equal(order.trackingCode, "SPXVN000111", "the order must remember its waybill");
    assert.equal(order.shippingProvider, "spx");
    assert.notEqual(order.status, "shipped", "handing the parcel over is a separate, human act");
    assert.ok(order.statusLogs.some((l) => /SPXVN000111/.test(String(l.note ?? ""))), "the log says which waybill was created");
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
