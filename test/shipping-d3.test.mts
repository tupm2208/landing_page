/**
 * Đ3 (17/09/2026) — shipping beyond "create": one waybill PER PARCEL with the parcel's own COD,
 * batch create, cancel / label / verify at the carrier, the tracking sync (status, fee, COD
 * collected → the bus) and the report that says what does not add up. No real carrier is called.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { FakeHttpClient, FixedWindowRateLimiter, JsonFileStore, Kernel, ManualClock, MemoryLogger, TokenAuth, jsonResponse } from "../dist/kernel/index.js";
import { EVENTS, ROLE, defineModule, type HttpRequestInit, type Reply } from "../dist/contract/index.js";
import { manifest, shippingReport, type Config, type OrderForSlip } from "../dist/modules/van-chuyen/module.js";
import { deliveryStateFromStatus } from "../dist/modules/van-chuyen/carriers/carrier.js";

const ADMIN = "ma-quan-tri";
const SPX = { appId: "app-1", appSecret: "bi-mat", userId: "123456", userSecret: "khoa", collectType: 2 };
const WAREHOUSE = { name: "Kho", phone: "0900000000", province: "Hà Nội", district: "Quận Ba Đình", ward: "Phường Giảng Võ", addressDetail: "Số 1" };

const ORDER: OrderForSlip = {
  id: "ORD-9", customerName: "A", phone: "0911111111", province: "Hà Nội", district: "Quận Ba Đình", ward: "Phường Điện Biên",
  addressDetail: "12 Đội Cấn", total: 3000000, paidAmount: 0, remainingAmount: 3000000,
  items: [{ productCode: "A1", productName: "Giày A", qty: 1, price: 2000000 }, { productCode: "B2", productName: "Giày B", qty: 1, price: 1000000 }]
};
const PARCELS = [
  { maKien: "ORD-9-01", maDon: "ORD-9", thuTu: 1, maKho: "wh_a", tenKho: "Kho A", maDoiTac: "", giaTriHang: 2000000, daTra: 0, cod: 2000000, mon: [{ maDong: "ORD-9#1", productCode: "A1", productName: "Giày A", size: "42", qty: 1, price: 2000000, warehouseId: "wh_a", warehouseName: "Kho A", partnerId: "" }] },
  { maKien: "ORD-9-02", maDon: "ORD-9", thuTu: 2, maKho: "wh_b", tenKho: "Kho B", maDoiTac: "", giaTriHang: 1000000, daTra: 0, cod: 1000000, mon: [{ maDong: "ORD-9#2", productCode: "B2", productName: "Giày B", size: "40", qty: 1, price: 1000000, warehouseId: "wh_b", warehouseName: "Kho B", partnerId: "" }] }
];

const ordersFake = defineModule({
  id: "don-khach", name: "Đơn giả", tier: "van-hanh", runsOn: "server-khach", version: "0.0.1",
  provides: {
    "don-khach.read": async (_ctx, id: string) => (id === ORDER.id ? ORDER : null),
    "don-khach.parcels": async (_ctx, id: string) => (id === ORDER.id ? PARCELS : [])
  }
});

function build(answer: (url: string, init: HttpRequestInit) => unknown) {
  const logger = new MemoryLogger();
  const clock = new ManualClock();
  const store = new JsonFileStore(fs.mkdtempSync(path.join(os.tmpdir(), "van-chuyen-d3-")), logger);
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const http = new FakeHttpClient((url, init) => {
    calls.push({ url, body: JSON.parse(String(init.body ?? "{}")) as Record<string, unknown> });
    return jsonResponse(answer(url, init));
  });
  const config: Config = { defaultCarrier: "spx", spx: SPX, sender: WAREHOUSE };
  const kernel = new Kernel({
    ports: { store, logger, clock, http, auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }], clock }), rateLimiter: new FixedWindowRateLimiter(clock) },
    logger, modules: [manifest, ordersFake], config: { "van-chuyen": config }
  });
  const call = (method: string, p: string, json?: unknown) => kernel.handle({ method, path: p, headers: { authorization: `Bearer ${ADMIN}` }, ip: "1.1.1.1", json: async () => json ?? {} });
  return { kernel, store, calls, call };
}

let tn = 0;
const created = (orderId: string) => { tn += 1; return { ret_code: 0, message: "ok", data: { orders: [{ tracking_no: `SPXVN${tn}`, order_id: orderId }] } }; };
const body = <T,>(r: Reply) => r.body as T;

test("delivery state from carrier text: FAILED and RETURNED are caught before 'đã giao' / 'hoàn thành'", () => {
  assert.equal(deliveryStateFromStatus("Giao hàng không thành công"), "delivery_failed");
  assert.equal(deliveryStateFromStatus("Đã hoàn hàng thành công"), "returned");
  assert.equal(deliveryStateFromStatus("Đang hoàn trả"), "returning");
  assert.equal(deliveryStateFromStatus("Đã giao hàng"), "delivered");
  assert.equal(deliveryStateFromStatus("Đang vận chuyển"), "shipping");
  assert.equal(deliveryStateFromStatus(""), "shipping_created");
});

test("one waybill per PARCEL: the parcel's own lines and its OWN COD, never the order's remainder", async () => {
  const { call, calls, store } = build((url, init) => created(String((JSON.parse(String(init.body)) as { orders: { order_id: string }[] }).orders[0]?.order_id)));
  const r = await call("POST", "/api/van-chuyen/tao-tu-don", { maDon: "ORD-9", maKien: "ORD-9-02" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const order = (calls[0]?.body["orders"] as Record<string, Record<string, unknown>>[])[0];
  assert.equal(order?.["order_id"], "ORD-9-02");
  assert.equal((order?.["fulfillment_info"] as { cod_amount?: number }).cod_amount, 1000000, "COD of THIS parcel");
  assert.deepEqual((order?.["parcel_info"] as { item_list: { item_name: string }[] }).item_list.map((i) => i.item_name), ["Giày B"]);
  await store.flush();
  const book = await store.document<{ vanDon: Record<string, { maDon?: string }> }>("van-don").read();
  assert.equal(book?.vanDon["ORD-9-02"]?.maDon, "ORD-9", "the document remembers which order the parcel belongs to");
  const missing = await call("POST", "/api/van-chuyen/tao-tu-don", { maDon: "ORD-9", maKien: "ORD-9-07" });
  assert.equal(missing.status, 400);
});

test("batch create: each order on its own; one refusal does not hide the others", async () => {
  let n = 0;
  const { call } = build(() => { n += 1; return n === 2 ? { ret_code: 1, message: "fail", data: { fail_list: [{ message: "địa chỉ sai" }] } } : created("x"); });
  const r = body<{ ketQua: { ok: boolean; maKien: string; loiNhan?: string }[]; soTao: number }>(await call("POST", "/api/van-chuyen/tao-hang-loat", { phieu: [{ maDon: "ORD-9", maKien: "ORD-9-01" }, { maDon: "ORD-9", maKien: "ORD-9-02" }, { maDon: "KHONG-CO" }] }));
  assert.equal(r.soTao, 1);
  assert.deepEqual(r.ketQua.map((k) => k.ok), [true, false, false]);
  assert.match(String(r.ketQua[1]?.loiNhan), /địa chỉ sai/);
});

test("cancel / label / verify go to Desk's batch doors; a cancel is remembered and announced", async () => {
  const { call, calls, kernel } = build((url) => {
    if (url.endsWith("/order/create_order")) return created("ORD-9");
    if (url.endsWith("/batch_cancel_order")) return { ret_code: 0, data: { tracking_no_list: ["SPXVN" + tn] } };
    if (url.endsWith("/batch_get_shipping_label")) return { ret_code: 0, data: { awb_link: "https://spx.vn/awb/1.pdf" } };
    if (url.endsWith("/account/verify")) return { ret_code: 0, data: { match_result: true } };
    return { ret_code: 1, message: "?" };
  });
  await call("POST", "/api/van-chuyen/tao-tu-don", { maDon: "ORD-9" });
  const seen: { trangThaiGiao?: string }[] = [];
  kernel.bus.on(EVENTS.shipmentStatusChanged, "bai-thu", (d) => { seen.push(d as { trangThaiGiao?: string }); });

  const label = body<{ ok: boolean; duongDan: string }>(await call("GET", "/api/van-chuyen/nhan/ORD-9"));
  assert.equal(label.duongDan, "https://spx.vn/awb/1.pdf");
  const verify = body<{ ok: boolean; loiNhan: string }>(await call("POST", "/api/van-chuyen/thu-ket-noi", { hang: "spx" }));
  assert.equal(verify.ok, true);
  const cancel = await call("POST", "/api/van-chuyen/huy", { maPhieu: "ORD-9" });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
  await new Promise((r) => setImmediate(r));
  assert.equal(seen[0]?.trangThaiGiao, "cancelled");
  assert.deepEqual(calls.slice(1).map((c) => c.url.replace(/^https:\/\/spx\.vn/, "")), ["/open/api/v1/order/batch_get_shipping_label", "/open/api/v1/account/verify", "/open/api/v1/order/batch_cancel_order"]);
  const again = body<{ loiNhan: string }>(await call("POST", "/api/van-chuyen/huy", { maPhieu: "ORD-9" }));
  assert.match(again.loiNhan, /đã huỷ từ trước/, "cancelling twice does not call the carrier twice");
  assert.equal(calls.length, 4);
  assert.equal((await call("GET", "/api/van-chuyen/nhan/KHONG-CO")).status, 409, "no waybill = a clear refusal");
});

test("tracking sync: writes status / fee / COD collected, announces changes once, skips finished parcels; the report flags short COD", async () => {
  let search = 0;
  const { call, kernel } = build((url) => {
    if (url.endsWith("/order/create_order")) return created("ORD-9");
    if (url.endsWith("/order/search_order")) { search += 1; return { ret_code: 0, data: { orders: [{ status: "Đã giao hàng", cod_amount: 3000000, cod_collected_amount: 2500000, actual_shipping_fee: 32000 }] } }; }
    return { ret_code: 1 };
  });
  await call("POST", "/api/van-chuyen/tao-tu-don", { maDon: "ORD-9" });
  const seen: unknown[] = [];
  kernel.bus.on(EVENTS.shipmentStatusChanged, "bai-thu", (d) => { seen.push(d); });
  const first = body<{ daKiem: number; capNhat: { trangThaiGiao: string; phi: number }[] }>(await call("POST", "/api/van-chuyen/dong-bo", {}));
  assert.equal(first.daKiem, 1);
  assert.deepEqual([first.capNhat[0]?.trangThaiGiao, first.capNhat[0]?.phi], ["delivered", 32000]);
  await new Promise((r) => setImmediate(r));
  assert.equal(seen.length, 1);
  const second = body<{ daKiem: number }>(await call("POST", "/api/van-chuyen/dong-bo", {}));
  assert.equal(second.daKiem, 0, "a delivered parcel is not asked again");
  assert.equal(search, 1);

  const report = body<{ tong: { daGiao: number; codDuKien: number; codDaThu: number; phi: number; canhBao: number }; dong: { canhBao: string[] }[] }>(await call("GET", "/api/van-chuyen/bao-cao"));
  assert.equal(report.tong.daGiao, 1);
  assert.deepEqual([report.tong.codDuKien, report.tong.codDaThu, report.tong.phi], [3000000, 2500000, 32000]);
  assert.match(String(report.dong[0]?.canhBao[0]), /Thu COD thiếu 500000đ/);
});

test("report (pure): cancelled parcels are listed but not counted; returns and failures are flagged", () => {
  const r = shippingReport({
    "A": { hang: "spx", maVanDon: "1", cod: 100, luc: "2026-09-17T00:00:00Z", trangThaiGiao: "returning" },
    "B": { hang: "spx", maVanDon: "2", cod: 200, luc: "2026-09-17T00:00:00Z", trangThaiGiao: "delivery_failed" },
    "C": { hang: "spx", maVanDon: "3", cod: 300, luc: "2026-09-17T00:00:00Z", daHuy: true, trangThaiGiao: "cancelled" }
  });
  assert.equal(r.dong.length, 3);
  assert.equal(r.tong.soVanDon, 2);
  assert.equal(r.tong.codDuKien, 300);
  assert.equal(r.tong.hoan, 1);
  assert.equal(r.tong.canhBao, 2);
});
