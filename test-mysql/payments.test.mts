/**
 * Money & reconciliation module.
 *
 * Focus:
 *   - every money number goes through the order-money kit, nothing is derived here
 *   - the amount is computed by the SERVER, never taken from the customer
 *   - recording money is a REAL PERSON's job; the bot only reads
 *   - Telegram is EACH MERCHANT's setting; a shop that has not entered it gets no alerts
 *
 * The old test ran on MySQL through the real Orders module. Orders is being ported in parallel,
 * so this port plays Orders with a fake provider module holding orders in memory (the same
 * `recordPayment` semantics as the old `ghiTien`: only the given columns change). It therefore
 * needs no database today; it keeps the 3306 guard and its place here so the lead can swap the
 * fake for the real module.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { FakeHttpClient, FixedWindowRateLimiter, JsonFileStore, Kernel, ManualClock, MemoryLogger, TokenAuth, jsonResponse } from "../dist/kernel/index.js";
import { EVENTS, ROLE, defineModule, type HttpClient, type IncomingRequest, type Reply } from "../dist/contract/index.js";
import { manifest, type Config } from "../dist/modules/tien-doi-soat/module.js";
import { amountDueNow, roundToPercent, shippingFee, transferCode } from "../dist/modules/tien-doi-soat/money-rules.js";

const ADMIN = "ma-quan-tri";
const SERVICE = "ma-bo-nao";
const URL = String(process.env["TOPRUN_MYSQL_URL"] || "").trim();
if (URL && /:3306\//.test(URL)) throw new Error("Cổng 3306 là dữ liệu thật của landing. Dùng 3307.");

// ---------- the rules: no kernel needed ----------

test("paying 100% up front makes shipping FREE; every other choice pays it", () => {
  assert.equal(shippingFee("full", 30000), 0);
  assert.equal(shippingFee("deposit", 30000), 30000);
  assert.equal(shippingFee("deposit_hold", 30000), 30000);
  assert.equal(shippingFee("confirm_first", 30000), 30000);
});

test("amounts round to ten thousands, at least 10,000đ, never above the order total", () => {
  assert.equal(roundToPercent(2890000, 50), 1450000);
  assert.equal(roundToPercent(15000, 20), 10000, "at least 10,000đ");
  assert.equal(roundToPercent(8000, 50), 8000, "never above the total");
  assert.equal(roundToPercent(0, 50), 0);
});

test("holding an order is 20%, not the shop's deposit percent", () => {
  assert.equal(amountDueNow("deposit_hold", 2890000, 100), roundToPercent(2890000, 20));
  assert.equal(amountDueNow("deposit", 2890000, 50), roundToPercent(2890000, 50));
  assert.equal(amountDueNow("full", 2890000, 50), 2890000, "100% is everything");
});

test("the transfer code carries EACH SHOP's prefix — two shops never mistake each other's money", () => {
  assert.equal(transferCode("ORD-1789000000123", "TR"), "TR-00000123");
  assert.equal(transferCode("ORD-1789000000123", "DB"), "DB-00000123");
  // Strange characters (spaces, $) are stripped — a transfer note must be typeable.
  assert.equal(transferCode("ORD-1", "ma ba$$"), "maba-ORD1");
  // The LAST 8 characters of the order id, hyphens dropped: ORD-1789000000123 -> 00000123.
  assert.equal(transferCode("ORD-1789000000123", ""), "TR-00000123", "no prefix -> default TR");
});

// ---------- a fake Orders module ----------

/** An order as the old Orders module returned it (payment columns mapped to these fields). */
interface FakeOrder {
  id: string;
  token: string;
  total: number;
  paymentStatus: string;
  paymentAmount: number;
  paymentMethod: string;
  paymentReference: string;
  notes: string[];
}

/** The input the real `don-khach.recordPayment` takes (mirrors `RecordPaymentInput` of the Orders module). */
interface RecordPaymentInput {
  id: string; paymentMethod?: string | null; paymentStatus?: string | null; paymentAmount?: number | null; paymentReference?: string | null; note?: string;
}

function fakeOrdersModule(orders: Map<string, FakeOrder>) {
  return defineModule({
    id: "don-khach", name: "Đơn hàng giả", tier: "van-hanh", runsOn: "server-khach", version: "0.0.1",
    provides: {
      "don-khach.read": async (_ctx, orderId: string) => { const o = orders.get(orderId); return o ? { ...o } : null; },
      "don-khach.readByLookupToken": async (_ctx, { id, token }: { id?: string; token?: string }) => {
        const o = orders.get(String(id ?? ""));
        return o && o.token === token ? { ...o } : null;
      },
      // Same semantics as the old `ghiTien`: only the columns given are changed.
      "don-khach.recordPayment": async (_ctx, input: RecordPaymentInput) => {
        const o = orders.get(input.id);
        if (!o) return { ok: false, viSao: "khong_co_don" };
        if (input.paymentMethod != null) o.paymentMethod = String(input.paymentMethod);
        if (input.paymentStatus != null) o.paymentStatus = String(input.paymentStatus);
        if (input.paymentAmount != null) o.paymentAmount = Math.max(0, Math.round(Number(input.paymentAmount) || 0));
        if (input.paymentReference != null) o.paymentReference = String(input.paymentReference);
        o.notes.push(String(input.note || ""));
        return { ok: true };
      }
    }
  });
}

/** Records every outbound call (Telegram) with its parsed JSON body. */
function recordingNetwork(): { http: FakeHttpClient; calls: { url: string; body: Record<string, unknown> }[] } {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const http = new FakeHttpClient((url, init) => {
    calls.push({ url, body: JSON.parse(String(init.body || "{}")) });
    return jsonResponse({ ok: true });
  });
  return { http, calls };
}

function build(moneyConfig: Config, http: HttpClient, orders: Map<string, FakeOrder>) {
  const logger = new MemoryLogger();
  const clock = new ManualClock();
  const kernel = new Kernel({
    ports: {
      store: new JsonFileStore(fs.mkdtempSync(path.join(os.tmpdir(), "tien-"))), logger, clock, http,
      auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }, { token: SERVICE, name: "bo-nao", role: ROLE.service }], clock }),
      rateLimiter: new FixedWindowRateLimiter(clock)
    },
    logger, modules: [fakeOrdersModule(orders), manifest],
    config: { "don-khach": {}, "tien-doi-soat": moneyConfig }
  });
  return { kernel, clock, logger };
}

let counter = 0;
/** Places an order the way the storefront would: 1 x 2,890,000đ, nothing paid yet. */
function placeOrder(orders: Map<string, FakeOrder>): FakeOrder {
  counter += 1;
  const order: FakeOrder = {
    id: `ORD-178900000${String(counter).padStart(4, "0")}`, token: `tra-${counter}`, total: 2890000,
    paymentStatus: "pending", paymentAmount: 0, paymentMethod: "", paymentReference: "", notes: []
  };
  orders.set(order.id, order);
  return order;
}

interface MoneyReply {
  ok?: boolean; error?: string; soPhaiTra?: number; phuongThuc?: string; daTra?: number; conPhaiTra?: number; traDu?: boolean; cod?: number;
}
const body = (r: Reply): MoneyReply => r.body as MoneyReply;

const admin = { authorization: `Bearer ${ADMIN}` };
const choose = (kernel: Kernel, payload: unknown) => kernel.handle({
  method: "POST", path: "/api/orders/public/payment-choice", headers: {}, ip: "1.1.1.1", json: async () => payload
});
const recordPaid = (kernel: Kernel, payload: unknown, headers: IncomingRequest["headers"] = admin) => kernel.handle({
  method: "POST", path: "/api/tien/da-tra", headers, ip: "1.1.1.1", json: async () => payload
});
const askMoney = (kernel: Kernel, orderId: string, token = SERVICE) => kernel.handle({
  method: "GET", path: `/api/tien/don/${orderId}`, headers: { authorization: `Bearer ${token}` }, ip: "1.1.1.1"
});

test("Money & reconciliation through the kernel", async (t) => {
  const orders = new Map<string, FakeOrder>();
  const net = recordingNetwork();
  const fresh = (moneyConfig: Config) => {
    orders.clear();
    net.calls.length = 0;
    return build(moneyConfig, net.http, orders);
  };

  await t.test("the customer picks a method: the SERVER computes the amount, the customer's number is ignored", async () => {
    const { kernel } = fresh({ depositPercent: 50, telegram: {} });
    const order = placeOrder(orders);

    const r = await choose(kernel, { orderId: order.id, token: order.token, choice: "deposit", soPhaiTra: 1 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(body(r).soPhaiTra, roundToPercent(2890000, 50), "computed by the server, not taken from the request");
    assert.equal(body(r).phuongThuc, "bank_deposit");
  });

  await t.test("changing the choice REWRITES the amount (quirk of 04/09)", async () => {
    const { kernel } = fresh({ depositPercent: 100, telegram: {} });
    const order = placeOrder(orders);

    await choose(kernel, { orderId: order.id, token: order.token, choice: "full" });
    const afterFull = body(await askMoney(kernel, order.id));
    assert.equal(afterFull.daTra, 0, "choosing a method is not paying");

    const changed = await choose(kernel, { orderId: order.id, token: order.token, choice: "deposit_hold" });
    assert.equal(body(changed).soPhaiTra, roundToPercent(2890000, 20), "a changed mind changes the amount");
    assert.equal(orders.get(order.id)?.paymentAmount, roundToPercent(2890000, 20), "the amount on the order must be rewritten");
  });

  await t.test("a wrong lookup token cannot change the method", async () => {
    const { kernel } = fresh({ telegram: {} });
    const order = placeOrder(orders);
    const r = await choose(kernel, { orderId: order.id, token: "sai", choice: "full" });
    assert.equal(r.status, 400);
    assert.equal(body(r).error, "khong_thay_don");
  });

  await t.test("an unknown choice is refused", async () => {
    const { kernel } = fresh({ telegram: {} });
    const order = placeOrder(orders);
    const r = await choose(kernel, { orderId: order.id, token: order.token, choice: "tra_bang_niem_tin" });
    assert.equal(body(r).error, "lua_chon_khong_hop_le");
  });

  await t.test("recording money: through the kit; paid in full says so", async () => {
    const { kernel } = fresh({ telegram: {} });
    const order = placeOrder(orders);

    const first = await recordPaid(kernel, { maDon: order.id, soTien: 1000000 });
    assert.equal(first.status, 200);
    assert.equal(body(first).daTra, 1000000);
    assert.equal(body(first).conPhaiTra, 1890000);
    assert.equal(body(first).traDu, false);

    const second = await recordPaid(kernel, { maDon: order.id, soTien: 1890000 });
    assert.equal(body(second).traDu, true);
    assert.equal(body(second).conPhaiTra, 0);

    const money = body(await askMoney(kernel, order.id));
    assert.equal(money.daTra, 2890000);
    assert.equal(money.conPhaiTra, 0);
    assert.equal(money.cod, 0, "paid in full -> no COD");
  });

  await t.test("recording money is a REAL PERSON's job — the brain cannot", async () => {
    const { kernel } = fresh({ telegram: {} });
    const order = placeOrder(orders);
    const r = await recordPaid(kernel, { maDon: order.id, soTien: 100000 }, { authorization: `Bearer ${SERVICE}` });
    assert.equal(r.status, 401, "a service token must not record money");
    assert.equal(body(await askMoney(kernel, order.id)).daTra, 0);
  });

  await t.test("no bot tool carries the money effect", () => {
    for (const tool of manifest.botTools ?? []) assert.notEqual(tool.hieuUng, "tien");
  });

  await t.test("BREAKS when a bot tool with the money effect is declared: the kernel refuses the module", () => {
    const orders2 = new Map<string, FakeOrder>();
    const withMoneyTool = { ...manifest, botTools: [{ ten: "ghi_tien", hieuUng: "tien" as const }] };
    const clock = new ManualClock();
    assert.throws(
      () => new Kernel({
        ports: { logger: new MemoryLogger(), clock, http: net.http, store: new JsonFileStore(fs.mkdtempSync(path.join(os.tmpdir(), "tien-"))) },
        modules: [fakeOrdersModule(orders2), withMoneyTool], config: { "tien-doi-soat": {} }
      }),
      /"tien" effect/
    );
  });

  await t.test("recorded money is announced on the bus", async () => {
    const { kernel } = fresh({ telegram: {} });
    const order = placeOrder(orders);
    const seen: { traDu?: boolean }[] = [];
    kernel.bus.on(EVENTS.paymentReceived, "bai-thu", (d) => { seen.push(d as { traDu?: boolean }); });

    await recordPaid(kernel, { maDon: order.id, soTien: 2890000 });
    await new Promise((r) => setImmediate(r));
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.traDu, true);
  });

  // ---------- Telegram per merchant ----------

  await t.test("a shop that has NOT entered Telegram gets no alert at all", async () => {
    const { kernel } = fresh({ telegram: {} });
    const order = placeOrder(orders);
    await recordPaid(kernel, { maDon: order.id, soTien: 100000 });
    await new Promise((r) => setImmediate(r));
    assert.equal(net.calls.filter((c) => c.url.includes("telegram")).length, 0, "not configured = OFF, never at random");
  });

  await t.test("a shop that has entered Telegram is alerted in ITS OWN group", async () => {
    const { kernel } = fresh({ telegram: { token: "token-cua-shop-A", chatId: "-100111" } });
    const order = placeOrder(orders);
    await recordPaid(kernel, { maDon: order.id, soTien: 2890000 });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const alert = net.calls.find((c) => c.url.includes("telegram"));
    assert.ok(alert, `must alert Telegram: ${JSON.stringify(net.calls.map((c) => c.url))}`);
    assert.match(alert.url, /bottoken-cua-shop-A/, "must use that shop's own token");
    assert.equal(alert.body["chat_id"], "-100111");
    assert.match(String(alert.body["text"]), /2\.890\.000/);
  });

  await t.test("Telegram being down does not stop money from being recorded", async () => {
    orders.clear();
    const dead: HttpClient = { async fetch() { throw new Error("Telegram chết"); } };
    const { kernel } = build({ telegram: { token: "t", chatId: "-1" } }, dead, orders);
    const order = placeOrder(orders);
    const r = await recordPaid(kernel, { maDon: order.id, soTien: 500000 });
    assert.equal(r.status, 200, "a failed alert must not block recording");
    assert.equal(body(r).daTra, 500000);
  });
});
