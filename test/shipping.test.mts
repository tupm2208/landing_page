/**
 * Shipping module — runs the whole create-and-track path without calling SPX/Viettel Post once.
 *
 * The focus is the QUIRKS that were paid for: item_price as a string, address_version 0/2, SPX
 * locking an order_id forever, blank payer = the receiver pays.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  FakeHttpClient, FixedWindowRateLimiter, JsonFileStore, Kernel, ManualClock, MemoryLogger, TokenAuth, jsonResponse
} from "../dist/kernel/index.js";
import { EVENTS, ROLE, defineModule, type HttpRequestInit, type IncomingRequest, type Reply } from "../dist/contract/index.js";
import { manifest, type Config, type OrderForSlip, type SenderConfig } from "../dist/modules/van-chuyen/module.js";
import { buildSpxPayload, signSpx } from "../dist/modules/van-chuyen/carriers/spx.js";
import { convertToTwoTier } from "../dist/modules/van-chuyen/address.js";
import type { ShippingSlip } from "../dist/modules/van-chuyen/carriers/carrier.js";
import type { ShipmentsBook } from "../dist/modules/van-chuyen/shipments-document.js";

const ADMIN = "ma-quan-tri";
const SERVICE = "ma-bo-nao";
const SPX_CONFIG = { appId: "app-1", appSecret: "bi-mat", userId: "123456", userSecret: "khoa", collectType: 2 };

const SLIP: ShippingSlip = {
  maPhieu: "ORD-1789000000001",
  nguoiGui: { ten: "TopRun H", dienThoai: "0900000000", tinh: "Hà Nội", huyen: "Quận Ba Đình", xa: "Phường Giảng Võ", diaChiChiTiet: "Số 1 ngõ 2" },
  nguoiNhan: { ten: "Nguyễn Văn A", dienThoai: "0911111111", tinh: "Hà Nội", huyen: "Quận Ba Đình", xa: "Phường Điện Biên", diaChiChiTiet: "12 Đội Cấn" },
  mon: [{ ten: "Giày chạy Pegasus 40 size 42", soLuong: 1, donGia: 2890000, canNangKg: 0.75 }],
  cod: 2890000
};

/** Fake network: records every call, answers from a list (last answer repeats) or a function. */
function fakeNetwork(answers: unknown[] | ((url: string, init: HttpRequestInit, n: number) => unknown)): FakeHttpClient {
  let n = 0;
  return new FakeHttpClient((url, init) => {
    const body = typeof answers === "function" ? answers(url, init, n) : answers[Math.min(n, answers.length - 1)];
    n += 1;
    return jsonResponse(body);
  });
}

const SPX_CREATED = { ret_code: 0, message: "success", data: { orders: [{ tracking_no: "SPXVN123456789", order_id: "ORD-1789000000001", estimated_shipping_fee: 25000 }] } };
const SPX_DUPLICATE = { ret_code: 1, message: "fail", data: { fail_list: [{ message: "order id has been used already" }] } };

/** A fake module playing "Orders": provides only `don-khach.read`. */
function fakeOrdersModule(order: OrderForSlip | null) {
  return defineModule({
    id: "don-khach", name: "Đơn hàng giả", tier: "van-hanh", runsOn: "server-khach", version: "0.0.1",
    provides: { "don-khach.read": async (_ctx, orderId: string) => (order && order.id === orderId ? order : null) }
  });
}

const WAREHOUSE = { name: "Kho TopRun", phone: "0900000000", province: "Hà Nội", district: "Quận Ba Đình", ward: "Phường Giảng Võ", addressDetail: "Số 1 ngõ 2" };

interface Build {
  http?: FakeHttpClient;
  config?: Config;
  /** `undefined` = no Orders module at all; `null` = Orders present but knows no order. */
  order?: OrderForSlip | null;
}

function build({ http, config, order }: Build = {}) {
  const logger = new MemoryLogger();
  const clock = new ManualClock();
  const store = new JsonFileStore(fs.mkdtempSync(path.join(os.tmpdir(), "van-chuyen-")), logger);
  const kernel = new Kernel({
    ports: {
      store, logger, clock, http: http ?? fakeNetwork([SPX_CREATED]),
      auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }, { token: SERVICE, name: "bo-nao", role: ROLE.service }], clock }),
      rateLimiter: new FixedWindowRateLimiter(clock)
    },
    logger,
    modules: order === undefined ? [manifest] : [manifest, fakeOrdersModule(order)],
    config: { "van-chuyen": config ?? { defaultCarrier: "spx", spx: SPX_CONFIG } }
  });
  return { kernel, store, logger };
}

interface ShippingReply {
  ok?: boolean;
  error?: string;
  message?: string;
  thieu?: string[];
  maVanDon?: string;
  duongTra?: string;
  don?: { status?: string };
}

const body = (r: Reply): ShippingReply => r.body as ShippingReply;
const requestBody = (init: HttpRequestInit) => JSON.parse(String(init.body ?? "{}"));

const postCreate = (slip: unknown, token = ADMIN): IncomingRequest => ({
  method: "POST", path: "/api/van-chuyen/tao", headers: { authorization: `Bearer ${token}` }, ip: "1.1.1.1", json: async () => slip
});
const postFromOrder = (payload: unknown, token = ADMIN): IncomingRequest => ({
  method: "POST", path: "/api/van-chuyen/tao-tu-don", headers: { authorization: `Bearer ${token}` }, ip: "1.1.1.1", json: async () => payload
});
const getTrack = (slipRef: string, token = SERVICE): IncomingRequest => ({
  method: "GET", path: `/api/van-chuyen/tra-cuu/${slipRef}`, headers: { authorization: `Bearer ${token}` }, ip: "1.1.1.1"
});

const SAMPLE_ORDER: OrderForSlip = {
  id: "ORD-1789000000009",
  customerName: "Nguyễn Văn A", phone: "0911111111",
  province: "Hà Nội", district: "Quận Ba Đình", ward: "Phường Điện Biên",
  addressDetail: "12 Đội Cấn", address: "12 Đội Cấn, Phường Điện Biên, Quận Ba Đình, Hà Nội",
  total: 3000000,
  // 1 million deposited -> 2 million remaining (the Orders module annotates it through the money kit).
  paidAmount: 1000000, remainingAmount: 2000000,
  items: [{ productCode: "A1", productName: "Giày chạy A", size: "42", qty: 1, price: 3000000 }]
};

// ---------- building the payload ----------

test("item_price must be a STRING — a number makes SPX fail with unmarshal error 11001", () => {
  const { payload } = buildSpxPayload({ slip: SLIP, config: SPX_CONFIG });
  assert.equal(typeof payload.parcel_info.item_list[0]?.item_price, "string");
  assert.equal(payload.parcel_info.item_list[0]?.item_price, "2890000");
});

test("a three-tier address that converts to two-tier gets address_version = 2", () => {
  const { payload, thieu } = buildSpxPayload({ slip: SLIP, config: SPX_CONFIG });
  assert.deepEqual(thieu, []);
  assert.equal(payload.sender_info.sender_address_version, 2);
  assert.equal(payload.sender_info.sender_district, "", "the two-tier system has no third level");
  assert.equal(payload.deliver_info.deliver_address_version, 2);
});

test("an address already declared two-tier is kept, not converted again", () => {
  const { payload } = buildSpxPayload({
    slip: { ...SLIP, nguoiNhan: { ...SLIP.nguoiNhan, heDiaChi: "2-cap", huyen: "", xa: "Phường Ba Đình" } },
    config: SPX_CONFIG
  });
  assert.equal(payload.deliver_info.deliver_address_version, 2);
  assert.equal(payload.deliver_info.deliver_city, "Phường Ba Đình");
});

test("blank payer = the RECEIVER pays (decided 25/08/2026; before, the shop lost money for nothing)", () => {
  assert.equal(buildSpxPayload({ slip: SLIP, config: SPX_CONFIG }).payload.fulfillment_info.payment_role, 2);
  assert.equal(buildSpxPayload({ slip: { ...SLIP, aiTraShip: "nguoi-gui" }, config: SPX_CONFIG }).payload.fulfillment_info.payment_role, 1);
});

test("goods over 3 million switch on high-value handling and declare insurance", () => {
  const { payload } = buildSpxPayload({ slip: { ...SLIP, giaTriHang: 3500000 }, config: SPX_CONFIG });
  assert.equal(payload.fulfillment_info.high_value_processing_collection, 1);
  assert.equal(payload.parcel_info.express_insured_value, 3500000);
});

test("COD is capped at 20 million", () => {
  const { payload } = buildSpxPayload({ slip: { ...SLIP, cod: 99000000 }, config: SPX_CONFIG });
  assert.equal(payload.fulfillment_info.cod_amount, 20000000);
});

test("by default the customer may inspect, NOT try on (decided 03/09/2026)", () => {
  const { payload } = buildSpxPayload({ slip: SLIP, config: SPX_CONFIG });
  assert.equal(payload.fulfillment_info.allow_mutual_check, 1);
  assert.equal(payload.fulfillment_info.allow_try_on, 0);
});

test("a broken-font address is blocked early, not left for SPX to answer 'location not found'", () => {
  const { thieu } = buildSpxPayload({
    slip: { ...SLIP, nguoiGui: { ...SLIP.nguoiGui, xa: "Ph�ng Dịch Vọng" } }, config: SPX_CONFIG
  });
  assert.ok(thieu.some((t) => /hỏng font/.test(t)), thieu.join("; "));
});

test("a missing customer phone means no payload, and it says what is missing", () => {
  const { thieu } = buildSpxPayload({
    slip: { ...SLIP, nguoiNhan: { ...SLIP.nguoiNhan, dienThoai: "" } }, config: SPX_CONFIG
  });
  assert.ok(thieu.some((t) => /điện thoại khách nhận/.test(t)));
});

test("an old ward SPLIT into two new wards falls back to the three-tier system — no guessing", () => {
  // "Phường Ngọc Hà" (Ba Đình) is now inside two new wards. Guessing one could deliver to the
  // wrong district. Rule: when unsure, send the old three-tier address — SPX still accepts it.
  const split = convertToTwoTier({ tinh: "Hà Nội", huyen: "Quận Ba Đình", xa: "Phường Ngọc Hà" });
  assert.equal(split.ok, true);
  assert.ok(split.ok && split.ambiguous, "must recognise the split");

  const { payload } = buildSpxPayload({
    slip: { ...SLIP, nguoiNhan: { ...SLIP.nguoiNhan, xa: "Phường Ngọc Hà" } }, config: SPX_CONFIG
  });
  assert.equal(payload.deliver_info.deliver_address_version, 0, "unsure -> old system");
  assert.equal(payload.deliver_info.deliver_city, "Quận Ba Đình");
  assert.equal(payload.deliver_info.deliver_district, "Phường Ngọc Hà");
});

test("the merge table converts District 2 and District 9 to Thu Duc", () => {
  const q2 = convertToTwoTier({ tinh: "TP Hồ Chí Minh", huyen: "Quận 2", xa: "Phường Thảo Điền" });
  assert.equal(q2.ok, true, JSON.stringify(q2));
  assert.ok(q2.ok && q2.province.length > 0);
});

// ---------- signing and calling ----------

test("the signature is HMAC-SHA256 over appId_timestamp_random_body", () => {
  const payload = '{"user_id":1}';
  const expected = crypto.createHmac("sha256", "bi-mat").update("app-1_1700000000_42_" + payload, "utf8").digest("hex");
  assert.equal(signSpx("app-1", "bi-mat", 1700000000, 42, payload), expected);
});

test("a call to SPX carries the four mandatory headers", async () => {
  const net = fakeNetwork([SPX_CREATED]);
  const { kernel } = build({ http: net });
  await kernel.handle(postCreate(SLIP));
  const h = net.calls[0]?.init.headers ?? {};
  assert.equal(h["app-id"], "app-1");
  assert.equal(typeof h["check-sign"], "string");
  assert.ok(h["timestamp"] && h["random-num"]);
  assert.match(net.calls[0]?.url ?? "", /^https:\/\/spx\.vn\//, "the live host is the default");
});

test("the sandbox environment calls the sandbox host", async () => {
  const net = fakeNetwork([SPX_CREATED]);
  const { kernel } = build({ http: net, config: { defaultCarrier: "spx", spx: { ...SPX_CONFIG, environment: "thu" } } });
  await kernel.handle(postCreate(SLIP));
  assert.match(net.calls[0]?.url ?? "", /test-stable\.spx\.vn/);
});

// ---------- creating a shipment ----------

test("created: answers the tracking number and link, and writes the document", async () => {
  const { kernel, store } = build();
  const r = await kernel.handle(postCreate(SLIP));
  assert.equal(r.status, 200);
  assert.equal(body(r).maVanDon, "SPXVN123456789");
  assert.match(body(r).duongTra ?? "", /spx\.vn\/express\/track/);

  await store.flush();
  const book = await store.document<ShipmentsBook>("van-don").read();
  assert.equal(book?.vanDon["ORD-1789000000001"]?.maVanDon, "SPXVN123456789");
});

test("a created shipment is announced on the bus for other modules", async () => {
  const { kernel } = build();
  const seen: { maVanDon?: string }[] = [];
  kernel.bus.on(EVENTS.shipmentCreated, "bai-thu", (d) => { seen.push(d as { maVanDon?: string }); });
  await kernel.handle(postCreate(SLIP));
  await new Promise((r) => setImmediate(r));
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.maVanDon, "SPXVN123456789");
});

test("SPX locks a submitted order id forever — retried automatically with suffix -R2", async () => {
  const net = fakeNetwork([SPX_DUPLICATE, SPX_CREATED]);
  const { kernel } = build({ http: net });
  const r = await kernel.handle(postCreate(SLIP));
  assert.equal(r.status, 200);
  assert.equal(net.calls.length, 2, "must submit a second time");
  assert.equal(requestBody(net.calls[0]!.init).orders[0].order_id, "ORD-1789000000001");
  assert.equal(requestBody(net.calls[1]!.init).orders[0].order_id, "ORD-1789000000001-R2");
});

test("an error OTHER than a duplicate id stops at once, not three submissions", async () => {
  const net = fakeNetwork([{ ret_code: 1, message: "fail", data: { fail_list: [{ message: "location not found" }] } }]);
  const { kernel } = build({ http: net });
  const r = await kernel.handle(postCreate(SLIP));
  assert.equal(r.status, 502);
  assert.equal(net.calls.length, 1);
  assert.match(body(r).message ?? "", /location not found/);
});

test("SPX not configured: NO outbound call, reported for a person to handle", async () => {
  const net = fakeNetwork([SPX_CREATED]);
  const { kernel } = build({ http: net, config: { defaultCarrier: "spx", spx: {} } });
  const r = await kernel.handle(postCreate(SLIP));
  assert.equal(r.status, 400);
  assert.equal(body(r).error, "spx_chua_cau_hinh");
  assert.equal(net.calls.length, 0);
});

test("an incomplete slip answers the list of what is missing, without calling SPX", async () => {
  const net = fakeNetwork([SPX_CREATED]);
  const { kernel } = build({ http: net });
  const r = await kernel.handle(postCreate({ ...SLIP, nguoiNhan: { ...SLIP.nguoiNhan, ten: "" } }));
  assert.equal(r.status, 400);
  assert.ok((body(r).thieu ?? []).some((t) => /tên khách nhận/.test(t)));
  assert.equal(net.calls.length, 0);
});

test("when SPX comes to pick up, a pickup slot is requested first", async () => {
  const slots = { ret_code: 0, data: [{ pickup_time: 1789100000, slots: [{ pickup_time_range_id: 7, pickup_time_range: "09:00-12:00" }] }] };
  const net = fakeNetwork([slots, SPX_CREATED]);
  const { kernel } = build({ http: net, config: { defaultCarrier: "spx", spx: { ...SPX_CONFIG, collectType: 1 } } });
  const r = await kernel.handle(postCreate(SLIP));
  assert.equal(r.status, 200);
  const sent = requestBody(net.calls[1]!.init).orders[0];
  assert.equal(sent.fulfillment_info.pickup_time, 1789100000);
  assert.equal(sent.fulfillment_info.pickup_time_range_id, 7);
});

// ---------- tracking ----------

test("tracking reads the document first: one outbound call for two questions", async () => {
  const status = { ret_code: 0, data: { orders: [{ tracking_no: "SPXVN123456789", status: "delivering" }] } };
  const net = fakeNetwork((url) => (url.includes("create_order") ? SPX_CREATED : status));
  const { kernel, store } = build({ http: net });
  await kernel.handle(postCreate(SLIP));
  await store.flush();

  const r = await kernel.handle(getTrack("ORD-1789000000001"));
  assert.equal(r.status, 200);
  assert.equal(body(r).maVanDon, "SPXVN123456789");
  assert.equal(body(r).don?.status, "delivering");
});

test("tracking an order without a shipment is 404 and makes no outbound call", async () => {
  const net = fakeNetwork([SPX_CREATED]);
  const { kernel } = build({ http: net });
  const r = await kernel.handle(getTrack("ORD-khong-co"));
  assert.equal(r.status, 404);
  assert.equal(net.calls.length, 0);
});

// ---------- access ----------

test("creating a shipment is admin only; the brain cannot create one", async () => {
  const { kernel } = build();
  assert.equal((await kernel.handle(postCreate(SLIP, SERVICE))).status, 401);
  assert.equal((await kernel.handle({ ...postCreate(SLIP), headers: {} })).status, 401);
});

test("tracking is open to the brain (the bot answers 'where is my parcel')", async () => {
  const { kernel } = build();
  const r = await kernel.handle(getTrack("x"));
  assert.notEqual(r.status, 401);
});

// ---------- Viettel Post ----------

test("Viettel Post: logs in for a token, then creates the order", async () => {
  const net = fakeNetwork((url) => (url.includes("login") ? { data: { token: "tk-1" } } : { data: { ORDER_NUMBER: "VTP999", MONEY_TOTALFEE: 30000 } }));
  const { kernel } = build({ http: net, config: { defaultCarrier: "vtp", vtp: { username: "u", password: "p" } } });
  const r = await kernel.handle(postCreate(SLIP));
  assert.equal(r.status, 200);
  assert.equal(body(r).maVanDon, "VTP999");
  assert.equal(net.calls.length, 2);
  assert.equal(net.calls[1]?.init.headers?.["Token"], "tk-1");
});

test("Viettel Post: a ready token skips the login step", async () => {
  const net = fakeNetwork([{ data: { ORDER_NUMBER: "VTP111" } }]);
  const { kernel } = build({ http: net, config: { defaultCarrier: "vtp", vtp: { token: "tk-san" } } });
  const r = await kernel.handle(postCreate(SLIP));
  assert.equal(r.status, 200);
  assert.equal(net.calls.length, 1, "must not log in again when a token is ready");
});

test("Viettel Post counts weight in grams, not kilograms", async () => {
  const net = fakeNetwork([{ data: { ORDER_NUMBER: "VTP222" } }]);
  const { kernel } = build({ http: net, config: { defaultCarrier: "vtp", vtp: { token: "tk" } } });
  await kernel.handle(postCreate(SLIP));
  assert.equal(requestBody(net.calls[0]!.init).PRODUCT_WEIGHT, 750);
});

// ---------- creating FROM AN ORDER (one button on the admin screen) ----------

const withOrder = (order: OrderForSlip | null, http?: FakeHttpClient, sender: SenderConfig = WAREHOUSE) =>
  build({ order, ...(http ? { http } : {}), config: { defaultCarrier: "spx", spx: SPX_CONFIG, sender } });

test("from an order: COD is the REMAINING AMOUNT, not the order total", async () => {
  // A 3 million order with 1 million deposited. Collecting 3 million is charging the customer
  // twice — this loses real money and the customer, so it has its own test.
  const net = fakeNetwork([SPX_CREATED]);
  const { kernel } = withOrder(SAMPLE_ORDER, net);
  const r = await kernel.handle(postFromOrder({ maDon: SAMPLE_ORDER.id }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(body(r).maVanDon, "SPXVN123456789");

  // The body sent to SPX is wrapped: { user_id, user_secret, orders: [ ... ] }.
  const sent = requestBody(net.calls[0]!.init).orders[0];
  assert.equal(sent.fulfillment_info.cod_amount, 2000000, "COD must be the remaining amount");
  assert.equal(sent.fulfillment_info.cod_collection, 1, "with COD the collection flag must be on");
  assert.equal(sent.deliver_info.deliver_name, "Nguyễn Văn A");
  assert.equal(sent.sender_info.sender_name, "Kho TopRun", "the sender comes from the shop's warehouse config");
});

test("missing warehouse address: the carrier is NOT called, and the reply says what is missing", async () => {
  const net = fakeNetwork([SPX_CREATED]);
  const { kernel } = withOrder(SAMPLE_ORDER, net, { name: "Kho TopRun" });
  const r = await kernel.handle(postFromOrder({ maDon: SAMPLE_ORDER.id }));
  assert.equal(r.status, 400);
  assert.equal(body(r).error, "thieu_thong_tin");
  assert.ok((body(r).thieu ?? []).includes("nguoiGui.dienThoai"));
  assert.match(body(r).message ?? "", /thiếu/);
  assert.equal(net.calls.length, 0, "never call a carrier with a blank sender");
});

test("unknown order is 404; no order id is 400; Orders feature off is 503 and says so", async () => {
  const present = withOrder(SAMPLE_ORDER);
  assert.equal((await present.kernel.handle(postFromOrder({ maDon: "ORD-khong-co" }))).status, 404);
  assert.equal((await present.kernel.handle(postFromOrder({}))).status, 400);

  const absent = build({ config: { defaultCarrier: "spx", spx: SPX_CONFIG, sender: WAREHOUSE } });
  const r = await absent.kernel.handle(postFromOrder({ maDon: SAMPLE_ORDER.id }));
  assert.equal(r.status, 503);
  assert.equal(body(r).error, "chua_bat_manh_don_hang");
});

test("the from-order door is NOT open to customers", async () => {
  const { kernel } = withOrder(SAMPLE_ORDER);
  const r = await kernel.handle({ method: "POST", path: "/api/van-chuyen/tao-tu-don", headers: {}, ip: "1.1.1.1", json: async () => ({ maDon: SAMPLE_ORDER.id }) });
  assert.equal(r.status, 401);
});
