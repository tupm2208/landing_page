/**
 * Đ10 — Sales Desk's TopRun-only features as SHOP CONFIGURATION (`tinh-nang-shop`, van-chuyen site accounts,
 * hop-thu stock commanders, don-khach twin-site slug). Fake inventory, fake Xeon, fake partner web shops,
 * fake Sapo, fake Apps Script: no network, no MySQL.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROLE, defineModule, type HttpRequestInit, type IncomingRequest } from "../dist/contract/index.js";
import { FakeHttpClient, FakeStaticFilePort, FixedWindowRateLimiter, JsonFileStore, Kernel, ManualClock, MemoryLogger, TokenAuth, jsonResponse } from "../dist/kernel/index.js";
import { manifest as shopFeatures, runStockCommand } from "../dist/modules/tinh-nang-shop/module.js";
import { manifest as shipping } from "../dist/modules/van-chuyen/module.js";
import { parseStockCommand, parseStockPhotoText, resolveTagCode, resolveTagSize, stockPrice } from "../dist/modules/tinh-nang-shop/stock-text.js";
import { groupRows, haravanRows, normaliseSource, wooRows } from "../dist/modules/tinh-nang-shop/partner-sources.js";
import { claimNext, queueSettingsOf, scanOrders } from "../dist/modules/tinh-nang-shop/auto-purchase.js";
import { withSiteAccount } from "../dist/modules/van-chuyen/site-accounts.js";
import { stockCommander } from "../dist/modules/hop-thu/module.js";
import { siteSlug } from "../dist/modules/don-khach/admin-orders.js";

const ADMIN = "ma-quan-tri-d10";
const T0 = new Date("2026-09-17T08:00:00.000Z");
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test reads arbitrary wire fields

// ------------------------------------------------------------------ pure rules

test("stock text: chat commands keep Desk's grammar; photo text gives sizes + price; tag codes forgive one slip but never guess between several", () => {
  assert.deepEqual(parseStockCommand("tồn JP9192 42 forrest 0"), { type: "set", code: "JP9192", size: "42", warehouseQuery: "forrest", qty: 0 });
  assert.deepEqual(parseStockCommand("Bot hết jp9192 42,5"), { type: "set", code: "JP9192", size: "42.5", warehouseQuery: "", qty: 0 });
  assert.deepEqual(parseStockCommand("ton IF1234 42 2/3 3"), { type: "set", code: "IF1234", size: "42 2/3", warehouseQuery: "", qty: 3 });
  assert.deepEqual(parseStockCommand("hoàn tác"), { type: "undo" });
  assert.deepEqual(parseStockCommand("2"), { type: "choice", index: 2 });
  assert.deepEqual(parseStockCommand("tồn JP9192"), { type: "help" });
  assert.equal(parseStockCommand("còn size 42 không"), null, "ordinary chat is not a command");
  assert.equal(parseStockCommand("123456"), null);

  assert.deepEqual(parseStockPhotoText("Pegasus 41 còn 42, 42,5 44 giá 1tr490"), { rawText: "Pegasus 41 còn 42. 42.5 44 giá 1tr490", sizes: ["42", "42.5", "44"], price: 1490000 });
  assert.equal(stockPrice("850k"), 850000);
  assert.equal(stockPrice("1.290.000đ"), 1290000);

  const codes = ["IT2132", "IT2133", "GY8257"];
  assert.deepEqual(resolveTagCode(["GY8257"], codes), { code: "GY8257", confidence: "exact", candidates: ["GY8257"] });
  assert.equal(resolveTagCode(["6Y8257"], codes).confidence, "fuzzy", "6 read for G at a letter position");
  assert.deepEqual(resolveTagCode(["IT213"], codes).confidence, "ambiguous", "one letter missing and two codes fit: ask a person");
  assert.deepEqual(resolveTagCode(["AB1234"], codes), { code: "AB1234", confidence: "pattern_only", candidates: [] });
  assert.equal(resolveTagCode(["MADEINVIETNAM"], codes).confidence, "none");
  assert.deepEqual(resolveTagSize(["FR 42", "UK 8"], ["41", "42", "43"]), { size: "42", source: "doc_khop", options: ["42"] });
  assert.equal(resolveTagSize(["42", "43"], ["42", "43"]).source, "ambiguous");
});

test("partner sources: the list is the shop's (validated), WooCommerce and Haravan rows group by code, sizes count per source", () => {
  assert.equal(normaliseSource({ ma: "Kho", ten: "x", nenTang: "haravan", diaChi: "https://a.vn" }).ok, false, "reserved / upper-case code refused");
  assert.equal(normaliseSource({ ma: "runner", nenTang: "magento", diaChi: "https://a.vn" }).ok, false);
  assert.equal(normaliseSource({ ma: "runner", nenTang: "haravan", diaChi: "ftp://a.vn" }).ok, false);
  const ok = normaliseSource({ ma: "runner", ten: "Runner", nenTang: "haravan", diaChi: "https://runner.vn/collections/x", cheDo: "thu-cong" });
  assert.equal(ok.ok, true);
  const source = ok.ok ? ok.source : null!;
  assert.deepEqual([source.diaChi, source.maKho, source.cheDo, source.dayKhoSan], ["https://runner.vn", "wh_doi_tac_runner", "thu-cong", false]);

  const hv = haravanRows(source, { id: 9, title: "Nike Pegasus 41 DV7480", handle: "pegasus-41", vendor: "Nike", images: [{ src: "https://img/1.jpg" }], variants: [{ sku: "DV7480-42", option1: "42", price: "2150000", available: true }, { sku: "DV7480-43", option1: "43", price: "2150000", available: false, inventory_quantity: 0 }] });
  assert.deepEqual(hv.map((r) => [r.code, r.size, r.available, r.stockQty]), [["DV7480", "42", true, null], ["DV7480", "43", false, 0]]);
  const woo = wooRows({ ...source, ma: "das", ten: "Das", nenTang: "woocommerce" }, { id: 1, name: "Asics Gel Resolution 9", sku: "1041A330-100", prices: { price: "250000000", regular_price: "290000000", currency_minor_unit: 2 }, attributes: [{ name: "Size", terms: [{ name: "40" }, { name: "41" }] }], is_in_stock: true, images: [] });
  assert.deepEqual([woo[0]!.price, woo[0]!.regularPrice, woo[0]!.size, woo[0]!.brand], [2500000, 2900000, "40, 41", "Asics"]);
  const grouped = groupRows([...hv, ...woo]);
  assert.equal(grouped.length, 2);
  assert.deepEqual(grouped.find((p) => p.code === "DV7480")!.sizes, [{ size: "42", qty: 1 }, { size: "43", qty: 0 }]);
});

test("purchase queue: only paid lines of the shop's keyword; missing cost = blocked once, reopened later; one job at a time; nothing TopRun-specific", () => {
  const settings = queueSettingsOf({ mua_ho_bat: "1", mua_ho_tu_khoa: "supersports", mua_ho_nguoi_nhan: "Nguyễn Văn An", mua_ho_dien_thoai: "0901", mua_ho_dia_chi: "12 Lê Lợi", mua_ho_trang_web: "https://supersports.com.vn/" });
  assert.deepEqual([settings.enabled, settings.recipient.firstName, settings.recipient.lastName, settings.site], [true, "An", "Nguyễn Văn", "https://supersports.com.vn"]);
  assert.equal(queueSettingsOf({ mua_ho_bat: "1" }).enabled, false, "no keyword / recipient = disabled, never a default shop");
  const orders = [
    { id: "ORD-1", paymentStatus: "paid", items: [{ maDong: "L1", productCode: "SS1", size: "42", qty: 1, costPrice: 1500000, warehouseName: "Kho Supersports HN" }, { maDong: "L2", productCode: "X", size: "40", costPrice: 1, warehouseName: "Kho nhà" }] },
    { id: "ORD-2", paymentStatus: "payment_pending", items: [{ maDong: "L3", productCode: "SS2", size: "41", costPrice: 1, sourceName: "supersports" }] },
    { id: "ORD-3", status: "paid", items: [{ maDong: "L4", productCode: "SS3", size: "43", sourceName: "SuperSports" }] }
  ];
  const first = scanOrders(null, orders, settings, T0);
  assert.deepEqual(first.added.map((i) => i.dedupeKey), ["ORD-1::L1"]);
  assert.deepEqual(first.blocked.map((i) => [i.dedupeKey, i.reason]), [["ORD-3::L4", "Thiếu giá nhập trên dòng đơn."]]);
  assert.equal(scanOrders(first.book, orders, settings, T0).blocked.length, 0, "a blocked line is alerted once");
  orders[2]!.items[0]!.costPrice = 900000;
  assert.equal(scanOrders(first.book, orders, settings, T0).reopened, 1);
  const c1 = claimNext(first.book, T0);
  assert.equal(c1.item?.productCode, "SS1");
  assert.deepEqual(claimNext(c1.book, T0), { book: c1.book, item: null, busy: true });
  assert.equal(claimNext(c1.book, new Date(T0.getTime() + 16 * 60_000)).item?.productCode, "SS1", "a dead extension's job goes back after 15 minutes");
});

test("site accounts fold over the shop's carrier config; a stock commander is recognised by name or id; a twin-site slug is sanitised", () => {
  const base = { defaultCarrier: "spx", sender: { name: "Shop", phone: "1", province: "HN" }, spx: { appId: "A", userId: "U", userSecret: "S" }, vtp: { token: "T", username: "shop" } };
  const account = { ma: "abc", ten: "ABC", capNhatLuc: "", spx: { userId: "U2", userSecret: "", senderName: "ABC Shop", senderPhone: "" }, vtp: { username: "abc", password: "p", senderName: "", senderPhone: "" } };
  const spx = withSiteAccount(base, account, "spx") as Body;
  assert.deepEqual([spx.spx.appId, spx.spx.userId, spx.spx.userSecret, spx.sender.name, spx.sender.phone, spx.sender.province], ["A", "U2", "S", "ABC Shop", "1", "HN"]);
  const vtp = withSiteAccount(base, account, "vtp") as Body;
  assert.deepEqual([vtp.vtp.username, vtp.vtp.token, vtp.sender.name], ["abc", "", "Shop"], "own VTP login never rides on the shop's token");
  assert.equal(withSiteAccount(base, null, "spx"), base);

  const msg = { kenh: "zalo", nguoi: "u123", chu: "tồn A 42 1", maTin: "m", tenNguoi: "Nhóm kho · Lan", soAnh: 0, luc: "" };
  assert.equal(stockCommander(msg as never, "Lan, Minh"), true);
  assert.equal(stockCommander(msg as never, "u123"), true);
  assert.equal(stockCommander({ ...msg, kenh: "facebook" } as never, "Lan"), false);
  assert.equal(stockCommander(msg as never, ""), false);
  assert.deepEqual(["Dasbui", "ab c", "", "x".repeat(50)].map(siteSlug), ["dasbui", "", "", ""]);
});

// ------------------------------------------------------------------ module over the kernel

interface Line { size: string; qty: number; price: number; listPrice: number; warehouseId: string; nguon: string }
interface Item { code: string; name: string; brand: string; sourceName: string; price: number; listPrice: number; thumbnailImage: string; highImage: string; galleryImages: string[]; sizes: Line[] }

function build({ settings = {} as Record<string, string>, orders = [] as Body[] } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "d10-"));
  const logger = new MemoryLogger();
  const clock = new ManualClock(T0);
  const items: Item[] = [
    { code: "JP1", name: "adidas Boston 13", brand: "adidas", sourceName: "Shop", price: 3200000, listPrice: 3500000, thumbnailImage: "/api/hang-kho/anh/jp1.jpg", highImage: "", galleryImages: [], sizes: [{ size: "42", qty: 2, price: 3200000, listPrice: 0, warehouseId: "wh_kho_a", nguon: "ready" }, { size: "42", qty: 1, price: 3200000, listPrice: 0, warehouseId: "wh_kho_b", nguon: "ready" }, { size: "43", qty: 0, price: 3200000, listPrice: 0, warehouseId: "wh_kho_a", nguon: "own" }] },
    { code: "IT2132", name: "adidas Adizero", brand: "adidas", sourceName: "Shop", price: 2500000, listPrice: 0, thumbnailImage: "", highImage: "", galleryImages: [], sizes: [{ size: "42", qty: 2, price: 2500000, listPrice: 0, warehouseId: "wh_kho_a", nguon: "ready" }, { size: "42", qty: 1, price: 2500000, listPrice: 0, warehouseId: "wh_kho_b", nguon: "ready" }] },
    { code: "DV7480", name: "Nike Pegasus 41", brand: "Nike", sourceName: "Runner", price: 2150000, listPrice: 0, thumbnailImage: "https://img/1.jpg", highImage: "", galleryImages: [], sizes: [{ size: "42", qty: 1, price: 2150000, listPrice: 0, warehouseId: "wh_doi_tac_runner", nguon: "campaign" }, { size: "43", qty: 0, price: 2150000, listPrice: 0, warehouseId: "wh_doi_tac_runner", nguon: "campaign" }] }
  ];
  const calls: { name: string; input: Body }[] = [];
  const setQty = (input: Body) => {
    const item = items.find((i) => i.code === input.code);
    if (!item) return { ok: false, reason: "khong_co_mon", message: "Mã hàng này chưa có trong danh mục — thêm món trước." };
    let line = item.sizes.find((s) => s.size === input.size && s.warehouseId === input.warehouseId && (!input.source || s.nguon === input.source));
    if (!line) { line = { size: input.size, qty: 0, price: 0, listPrice: 0, warehouseId: input.warehouseId, nguon: input.source ?? "ready" }; item.sizes.push(line); }
    const before = line.qty;
    line.qty = input.quantity;
    return before === input.quantity ? { ok: true, unchanged: true, before, after: before } : { ok: true, variantId: "v", before, after: input.quantity };
  };
  const inventory = defineModule({
    id: "hang-kho", name: "Kho giả", tier: "van-hanh", runsOn: "server-khach", version: "0.0.1",
    provides: {
      "hang-kho.adminSearch": async (_c: unknown, input: Body) => items.filter((i) => !input.query || `${i.code} ${i.name}`.toLowerCase().includes(String(input.query).toLowerCase())),
      "hang-kho.bySource": async (_c: unknown, input: Body) => items.filter((i) => i.sizes.some((s) => s.nguon === input.source)),
      "hang-kho.writeWarehouse": async (_c: unknown, input: Body) => { calls.push({ name: "writeWarehouse", input }); return { itemCount: input.items.length, variantCount: input.items.reduce((n: number, i: Body) => n + i.sizes.length, 0), written: input.items.length, yielded: 0, dropped: 0 }; },
      "hang-kho.setStock": async (_c: unknown, input: Body) => { calls.push({ name: "setStock", input }); return setQty(input); },
      "hang-kho.stockRows": async (_c: unknown, input: Body) => items.filter((i) => i.code === input.code).flatMap((i) => i.sizes.filter((s) => !input.size || s.size === input.size).map((s) => ({ code: i.code, size: s.size, warehouseId: s.warehouseId, source: s.nguon, quantity: s.qty }))),
      "hang-kho.addPhoto": async (_c: unknown, input: Body) => { calls.push({ name: "addPhoto", input: { code: input.code, bytes: input.bytes.length } }); return { ok: true, url: "/api/hang-kho/anh/x.jpg", chinh: false }; },
      "hang-kho.setPrice": async (_c: unknown, input: Body) => { calls.push({ name: "setPrice", input }); return 1; }
    }
  });
  const telegrams: string[] = [];
  const zaloReplies: Body[] = [];
  const others = defineModule({
    id: "khung-nen-tang", name: "Nền giả", tier: "khung", runsOn: "server-khach", version: "0.0.1",
    provides: {
      "khung-nen-tang.settings": async () => settings,
      "khung-nen-tang.xeon": async () => ({ shop: "shop1", diaChiXeon: "https://xeon.test", maNhanTin: "ma-nhan-tin" })
    }
  });
  const orderModule = defineModule({ id: "don-khach", name: "Đơn giả", tier: "van-hanh", runsOn: "server-khach", version: "0.0.1", provides: { "don-khach.search": async () => orders } });
  const money = defineModule({ id: "tien-doi-soat", name: "Tiền giả", tier: "van-hanh", runsOn: "server-khach", version: "0.0.1", provides: { "tien-doi-soat.sendTelegram": async (_c: unknown, i: Body) => { telegrams.push(i.text); return { ok: true }; } } });
  const inbox = defineModule({ id: "hop-thu", name: "Hộp thư giả", tier: "van-hanh", runsOn: "server-khach", version: "0.0.1", provides: { "hop-thu.send": async (_c: unknown, i: Body) => { zaloReplies.push(i); return { guiNgay: false }; } } });
  const net: { url: string; init: HttpRequestInit }[] = [];
  let xeonDoc: Body = {};
  const http = new FakeHttpClient((url: string, init: HttpRequestInit) => {
    net.push({ url, init });
    if (url === "https://xeon.test/ai/doc-anh") return jsonResponse({ ok: true, doc: xeonDoc, ungVien: [] });
    if (url.startsWith("https://runner.vn/collections/all/products.json")) {
      return jsonResponse(url.includes("page=1") ? { products: [
        { id: 9, title: "Nike Pegasus 41 DV7480", handle: "pegasus-41", vendor: "Nike", product_type: "Giày chạy", images: [{ src: "https://img/1.jpg" }], variants: [{ sku: "DV7480-42", option1: "42", price: "2150000", available: true }, { sku: "DV7480-43", option1: "43", price: "2150000", available: true }] },
        { id: 10, title: "Áo chạy bộ Nike", handle: "ao", images: [], variants: [{ option1: "M", price: "500000", available: true }] }
      ] } : { products: [] });
    }
    if (url.startsWith("https://shop.mysapo.net/admin/variants/search.json")) return jsonResponse({ variants: [{ product_name: "JP1", name: "JP1 - 422/3", opt1: "422/3", variant_retail_price: 3300000, inventories: [{ available: 3, on_hand: 4 }, { available: 1, on_hand: 1 }] }] });
    if (url.startsWith("https://script.google.com/macros/s/abc/exec")) return jsonResponse({ ok: true, fileName: "Backup 17-09", fileUrl: "https://docs.google.com/x" });
    if (url === "https://img.test/a.jpg") return { ok: true, status: 200, json: async () => ({}), text: async () => "", arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    throw new Error(`no fake for ${url}`);
  });
  const kernel = new Kernel({
    ports: {
      store: new JsonFileStore(directory, logger), logger, clock, http, rateLimiter: new FixedWindowRateLimiter(clock),
      auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }], clock }),
      staticFiles: new FakeStaticFilePort({ "tinh-nang-shop/goc/scan.html": "<html>scan</html>", "tinh-nang-shop/goc/m.html": "<html>m</html>" })
    },
    logger,
    modules: [shopFeatures, shipping, inventory, others, orderModule, money, inbox],
    config: {}
  });
  const call = async (method: string, p: string, body?: unknown, headers: Record<string, string> = { authorization: `Bearer ${ADMIN}` }) => {
    const [pathname, search = ""] = p.split("?");
    const r = await kernel.handle({ method, path: pathname!, query: Object.fromEntries(new URLSearchParams(search)), ip: "1.1.1.1", headers, json: async () => body ?? {} } as IncomingRequest);
    return { status: r.status, body: r.body as Body, headers: r.headers };
  };
  return { call, calls, net, items, telegrams, zaloReplies, kernel, setXeonDoc: (d: Body) => { xeonDoc = d; } };
}

const RUNNER = { ma: "runner", ten: "Runner", nenTang: "haravan", diaChi: "https://runner.vn", cheDo: "web", dayKhoSan: true, maKho: "wh_doi_tac_runner" };

test("partner catalogue: sources saved per shop; fetch filters non-shoes; sync writes partner stock into the source's warehouse; ready push only when marked", async () => {
  const { call, calls } = build();
  assert.equal((await call("POST", "/api/tinh-nang-shop/doi-tac/tai", { nguon: "all" })).status, 404, "no sources yet: nothing hard-coded");
  assert.equal((await call("POST", "/api/tinh-nang-shop/nguon", { nguon: [RUNNER, RUNNER] })).body.error, "nguon_trung");
  const saved = await call("POST", "/api/tinh-nang-shop/nguon", { nguon: [RUNNER, { ...RUNNER, ma: "das", ten: "Das", dayKhoSan: false, diaChi: "https://das.vn" }] });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const fetched = await call("POST", "/api/tinh-nang-shop/doi-tac/tai", { nguon: "runner" });
  assert.equal(fetched.status, 200, JSON.stringify(fetched.body));
  assert.deepEqual(fetched.body.rows.map((r: Body) => [r.code, r.partner, r.sizes]), [["DV7480", "Runner", ["42", "43"]]], "the shirt is dropped");
  assert.equal((await call("GET", "/api/tinh-nang-shop/doi-tac/tai")).body.rows.length, 1, "the last fetch is kept");
  const synced = await call("POST", "/api/tinh-nang-shop/doi-tac/dong-bo", {});
  assert.equal(synced.body.result.total, 1);
  const write = calls.find((c) => c.name === "writeWarehouse")!.input;
  assert.deepEqual([write.source, write.warehouseId, write.items[0].sourceName, write.items[0].sizes.length], ["campaign", "wh_doi_tac_runner", "Runner", 2]);
  assert.equal((await call("POST", "/api/tinh-nang-shop/doi-tac/day-kho-san", { nguon: "das" })).status, 409, "not marked dayKhoSan");
  await call("POST", "/api/tinh-nang-shop/doi-tac/day-kho-san", { nguon: "runner" });
  assert.equal(calls.filter((c) => c.name === "writeWarehouse").at(-1)!.input.source, "ready");
});

test("manual partner: bootstrap keeps ticks, toggle a size, stock photo read on Xeon then applied (replace mode, price, photo)", async () => {
  const { call, calls, net, setXeonDoc } = build();
  await call("POST", "/api/tinh-nang-shop/nguon", { nguon: [{ ...RUNNER, cheDo: "thu-cong" }] });
  const boot = await call("POST", "/api/tinh-nang-shop/thu-cong/tai", { nguon: "runner" });
  assert.equal(boot.status, 200, JSON.stringify(boot.body));
  const written = calls.find((c) => c.name === "writeWarehouse")!.input.items[0];
  assert.deepEqual(written.sizes.map((s: Body) => [s.size, s.qty]), [["42", 1], ["43", 0]], "web says both available; only the ticked 42 stays 1");
  const list = await call("GET", "/api/tinh-nang-shop/thu-cong?nguon=runner");
  assert.deepEqual(list.body.sanPham.map((p: Body) => p.code), ["DV7480"]);
  assert.equal((await call("POST", "/api/tinh-nang-shop/thu-cong/size", { nguon: "runner", ma: "DV7480", size: "43", con: true })).status, 200);
  assert.deepEqual(calls.filter((c) => c.name === "setStock").at(-1)!.input, { code: "DV7480", size: "43", warehouseId: "wh_doi_tac_runner", source: "campaign", quantity: 1, note: "Runner: tick còn/hết", actor: "quan-tri" });

  assert.equal((await call("POST", "/api/tinh-nang-shop/anh-ton/doc", { nguon: "runner", anh: "khong-phai-anh" })).status, 400);
  setXeonDoc({ brand: "Nike", model: "Pegasus 41", code: "", sizes: ["44"], price: 0, text: "Pegasus 41 size 42 44 giá 1tr990" });
  const read = await call("POST", "/api/tinh-nang-shop/anh-ton/doc", { nguon: "runner", anh: "data:image/jpeg;base64,AAAA", chuThich: "" });
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.deepEqual([read.body.parsed.sizes, read.body.parsed.price, read.body.candidates[0]?.code], [["44", "42"], 1990000, "DV7480"]);
  assert.equal(JSON.parse(String(net.find((n) => n.url.endsWith("/ai/doc-anh"))!.init.body)).mucDich, "ton-anh", "AI reading is on Xeon");
  const applied = await call("POST", "/api/tinh-nang-shop/anh-ton/ap-dung", { nguon: "runner", ma: "DV7480", sizes: "44", gia: 1990000, cheDo: "replace", anh: "data:image/jpeg;base64,AAAA" });
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  const stockCalls = calls.filter((c) => c.name === "setStock").slice(-3).map((c) => [c.input.size, c.input.quantity]);
  assert.deepEqual(stockCalls, [["42", 0], ["43", 0], ["44", 1]], "replace: the other sizes go to 0 first");
  assert.equal(calls.filter((c) => c.name === "setPrice").length, 1);
  assert.equal(calls.filter((c) => c.name === "addPhoto").length, 1);
});

test("realtime lookup over the shop's stock, partner sources and Sapo (the shop's own keys, Basic auth); Sapo is read-only; a size in several warehouses asks which", async () => {
  const { call, net } = build({ settings: { sapo_dia_chi: "https://shop.mysapo.net", sapo_api_key: "k", sapo_api_secret: "s" } });
  await call("POST", "/api/tinh-nang-shop/nguon", { nguon: [RUNNER] });
  assert.equal((await call("POST", "/api/tinh-nang-shop/tra-ton", { q: "j" })).status, 400);
  const r = await call("POST", "/api/tinh-nang-shop/tra-ton", { q: "JP1", size: "42" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.sources.map((s: Body) => [s.source, s.editable, s.variants.length]), [["kho", true, 2], ["runner", true, 0], ["sapo", false, 0]]);
  const sapo = await call("POST", "/api/tinh-nang-shop/tra-ton", { q: "JP1", nguon: ["sapo"] });
  assert.deepEqual(sapo.body.sources[0].variants.map((v: Body) => [v.size, v.available, v.onHand]), [["42 2/3", 4, 5]]);
  const auth = String((net.find((n) => n.url.includes("mysapo"))!.init.headers as Body)["Authorization"]);
  assert.equal(auth, `Basic ${Buffer.from("k:s").toString("base64")}`);
  assert.equal((await call("POST", "/api/tinh-nang-shop/sua-ton", { nguon: "sapo", ma: "JP1", size: "42", soLuong: 1 })).status, 409);
  assert.equal((await call("POST", "/api/tinh-nang-shop/sua-ton", { nguon: "kho", ma: "JP1", size: "42", soLuong: 5 })).body.error, "can_chon_kho");
  const edited = await call("POST", "/api/tinh-nang-shop/sua-ton", { nguon: "kho", ma: "JP1", size: "42", soLuong: 5, maKho: "wh_kho_b" });
  assert.deepEqual([edited.status, edited.body.truoc, edited.body.sau], [200, 1, 5]);
  const partner = await call("POST", "/api/tinh-nang-shop/sua-ton", { nguon: "runner", ma: "DV7480", size: "42", soLuong: 0 });
  assert.equal(partner.status, 200, JSON.stringify(partner.body));
});

test("tag scanning: Xeon reads the tag, the landing matches the catalogue code (one slip forgiven) and the size; the page needs the admin session", async () => {
  const { call, net, setXeonDoc } = build();
  setXeonDoc({ code: "1T2132", sizes: ["UK 8", "FR 42"], primarySize: "42", text: "adidas 1T2132" });
  const r = await call("POST", "/api/tinh-nang-shop/quet-tem/doc", { anh: "data:image/jpeg;base64,AAAA", maKho: "wh_kho_a" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(JSON.parse(String(net.at(-1)!.init.body)).mucDich, "tem");
  assert.equal(r.body.engine, "xeon");
  assert.deepEqual([r.body.code, r.body.codeConfidence, r.body.size, r.body.knownProduct.sizes.find((s: Body) => s.size === "42").branchQty], ["IT2132", "fuzzy", "42", 2], JSON.stringify(r.body));
  assert.equal((await call("GET", "/api/tinh-nang-shop/quet-tem/mon?ma=NOPE")).status, 404);
  assert.equal((await call("GET", "/api/tinh-nang-shop/quet-tem/mon?ma=it2132&maKho=wh_kho_b")).body.knownProduct.sizes[0].branchQty, 1);
  const page = await call("GET", "/scan", undefined, {});
  assert.equal(page.status, 302, "a stranger is sent to the login page");
  assert.equal((await call("GET", "/m")).status, 200);
});

test("browser extension door: refused without the shop's key; the key is shown once and only its hash kept; the queue runs through it and alerts Telegram", async () => {
  const orders = [{ id: "ORD-9", paymentStatus: "paid", customerName: "Bình", items: [{ maDong: "L1", productCode: "SS1", size: "42", qty: 1, costPrice: 1000000, warehouseName: "supersports" }] }];
  const { call, telegrams, kernel } = build({ orders, settings: { mua_ho_bat: "1", mua_ho_tu_khoa: "supersports", mua_ho_nguoi_nhan: "An", mua_ho_dien_thoai: "0901", mua_ho_dia_chi: "12 Lê Lợi", telegram_chat_bao_dong: "-100", mua_ho_trang_web: "https://ss.vn" } });
  assert.equal((await call("POST", "/api/tien-ich/mua-ho-nhan", {}, {})).status, 401);
  const minted = await call("POST", "/api/tinh-nang-shop/tien-ich/khoa", {});
  const key = minted.body.khoa as string;
  assert.match(key, /^TI1\./);
  const info = await call("GET", "/api/tinh-nang-shop/tien-ich/khoa");
  assert.equal(JSON.stringify(info.body).includes(key), false, "the key never comes back");
  assert.equal((await call("POST", "/api/tien-ich/mua-ho-nhan", {}, { "x-omi-tien-ich": `${key}x` })).status, 401);
  const ext = { "x-omi-tien-ich": key };
  assert.equal((await call("POST", "/api/tinh-nang-shop/mua-ho/quet", {})).body.added, 1);
  const claimed = await call("POST", "/api/tien-ich/mua-ho-nhan", {}, ext);
  assert.deepEqual([claimed.body.item.productCode, claimed.body.item.site, claimed.body.item.recipient.fullName], ["SS1", "https://ss.vn", "An"]);
  const done = await call("POST", "/api/tien-ich/mua-ho-ket-qua", { id: claimed.body.item.id, ok: false, status: "stopped", reason: "Lệch giá", actualTotal: 1200000 }, ext);
  assert.equal(done.body.status, "stopped");
  assert.match(telegrams.at(-1)!, /DỪNG[\s\S]*lệch 200\.000đ/);
  const queue = await call("POST", "/api/tien-ich/mua-ho-hang-doi", {}, ext);
  assert.deepEqual([queue.body.pending, queue.body.recent[0].status], [0, "stopped"]);
  assert.equal((await call("POST", "/api/tinh-nang-shop/mua-ho/xep-lai", { ids: [claimed.body.item.id] })).body.requeued, 1);
  assert.equal((await call("POST", "/api/tien-ich/tra-ton", { q: "JP1" }, ext)).status, 200, "the lookup extension uses the same door");
  assert.equal((await call("POST", "/api/tien-ich/xoa-het", {}, ext)).status, 404, "only listed jobs");
  assert.ok(kernel.routes().some((r) => r.path === "/api/tien-ich/:viec" && r.access === "cong-khai"));
});

test("Google Drive backup: address + token are shop settings; only an Apps Script web app; orders and waybills go in Desk's sheet names", async () => {
  const orders = [{ id: "ORD-1", customerName: "An", phone: "0901", total: 500000, paymentAmount: 200000, site: "dasbui", items: [{ productCode: "JP1", productName: "Boston", size: "42", qty: 1, price: 500000 }] }];
  const refused = build({ orders, settings: { google_sao_luu_url: "https://evil.test/exec", google_sao_luu_token: "t" } });
  assert.equal((await refused.call("POST", "/api/tinh-nang-shop/sao-luu/chay", {})).status, 400);
  const { call, net } = build({ orders, settings: { google_sao_luu_url: "https://script.google.com/macros/s/abc/exec", google_sao_luu_token: "bi-mat" } });
  assert.equal((await call("GET", "/api/tinh-nang-shop/sao-luu")).body.daCauHinh, true);
  const r = await call("POST", "/api/tinh-nang-shop/sao-luu/chay", { lyDo: "before-import", ghiChu: "trước khi nhập" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const sent = JSON.parse(String(net.at(-1)!.init.body));
  assert.deepEqual([sent.token, sent.reason, sent.payload.orderFullRows[0].codOrNeedToCollect, sent.payload.orders[0].channel, sent.payload.orderItems.length], ["bi-mat", "before-import", 300000, "dasbui", 1]);
  assert.equal((await call("GET", "/api/tinh-nang-shop/sao-luu")).body.ganNhat.fileName, "Backup 17-09");
  assert.equal(JSON.stringify((await call("GET", "/api/tinh-nang-shop/sao-luu")).body).includes("bi-mat"), false);
});

test("stock commands by Zalo: set, ask which warehouse, answer with a number, undo — through the stock book; the event from hop-thu answers in the same chat", async () => {
  const { call, items, zaloReplies, kernel } = build();
  const say = async (chu: string) => (await call("POST", "/api/tinh-nang-shop/lenh-ton", { nguoi: "lan", chu })).body.traLoi as string;
  assert.match(await say("tồn JP1 42 5"), /có ở 2 kho[\s\S]*1\. wh_kho_a \(còn 2\)[\s\S]*3\. Cả hai/);
  assert.match(await say("2"), /Đã sửa JP1 · size 42 · wh_kho_b: 1 → 5/);
  assert.equal(items[0]!.sizes[1]!.qty, 5);
  assert.match(await say("hoàn"), /Đã hoàn JP1 · size 42 · wh_kho_b: 5 → 1/);
  assert.equal(items[0]!.sizes[1]!.qty, 1);
  assert.match(await say("hết JP1 43"), /Đã sửa|đã là 0/);
  assert.match(await say("tồn JP1"), /Lệnh sửa tồn/);
  assert.equal(await say("chào shop"), "Không phải lệnh tồn / hết / hoàn.");
  assert.match(await say("tồn NOPE 42 1"), /chưa có dòng tồn/);
  // The bus path: hop-thu emits, this module answers through hop-thu.send.
  kernel.bus.emit("hop-thu.lenh-ton", { kenh: "zalo", nguoi: "minh", chu: "tồn JP1 42 kho_a 7", maTin: "z1" });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual([zaloReplies.at(-1)?.kenh, zaloReplies.at(-1)?.nguoi], ["zalo", "minh"]);
  assert.match(String(zaloReplies.at(-1)?.chu), /wh_kho_a: 2 → 7/);
  assert.equal(typeof runStockCommand, "function");
});

test("carrier accounts per site: add, save (empty box = unchanged), secrets never on the screen, remove; a bad slug is refused", async () => {
  const { call } = build({ settings: { site_doi_ma: "dasbui", site_doi_ten: "Dasbui" } });
  assert.equal((await call("POST", "/api/van-chuyen/tai-khoan-site", { site: "A B" })).status, 400);
  assert.match((await call("POST", "/api/van-chuyen/tai-khoan-site", { site: "abcshop", label: "ABC Shop" })).body.message, /Đã thêm đối tác ABC Shop/);
  const saved = await call("POST", "/api/van-chuyen/tai-khoan-site", { site: "abcshop", spxUserId: "U9", spxSecretKey: "bi-mat-spx", vtpUsername: "", spxSenderName: "ABC" });
  assert.equal(saved.body.savedFields, 3);
  await call("POST", "/api/van-chuyen/tai-khoan-site", { site: "abcshop", spxSenderPhone: "0909" });
  const list = await call("GET", "/api/van-chuyen/tai-khoan-site");
  const a = list.body.partnerSites[0];
  assert.deepEqual([a.slug, a.label, a.status.spx.configured, a.status.spx.userId, a.status.spx.hasSecret, a.status.spx.senderPhone, list.body.siteDoi.ma], ["abcshop", "ABC Shop", true, "U9", true, "0909", "dasbui"]);
  assert.equal(JSON.stringify(list.body).includes("bi-mat-spx"), false);
  assert.equal((await call("POST", "/api/van-chuyen/tai-khoan-site", { site: "abcshop", remove: true })).body.removed, true);
  assert.equal((await call("GET", "/api/van-chuyen/tai-khoan-site")).body.partnerSites.length, 0);
});
