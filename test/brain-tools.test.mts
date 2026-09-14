/**
 * The FOUR tools added 14/09/2026 for the brain (+ catalog.count): policy.get, variant.chart,
 * purchase.eta, customer.recognize. Before, the engine declared them but the landing lacked them
 * -> every policy question fell to "ask again". Plus the blind warehouse id sent to the brain.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROLE, defineModule } from "../dist/contract/index.js";
import { FixedWindowRateLimiter, JsonFileStore, Kernel, ManualClock, MemoryLogger, TokenAuth } from "../dist/kernel/index.js";
import { manifest as gateway } from "../dist/modules/cong-bo-nao/module.js";
import { blindWarehouseId } from "../dist/modules/cong-bo-nao/blind-warehouse-id.js";
import { defaultPageContent, normalisePageContent } from "../dist/modules/khung-nen-tang/page-content.js";

const BRAIN = "ma-bo-nao";

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test reads arbitrary wire fields

function build({ content = {}, withPlatform = true }: { content?: Record<string, string>; withPlatform?: boolean } = {}) {
  const logger = new MemoryLogger();
  const clock = new ManualClock();
  const store = new JsonFileStore(fs.mkdtempSync(path.join(os.tmpdir(), "cong-cu-")), logger);
  const ITEM = { code: "DV1", name: "Pegasus 40", sizes: [{ size: "41", qty: 0 }, { size: "42", qty: 3 }, { size: "43", qty: 1 }] };
  const fakeInventory = defineModule({
    id: "hang-kho", name: "Hang kho gia", tier: "van-hanh", runsOn: "server-khach", version: "0",
    provides: {
      "hang-kho.search": async () => [ITEM], "hang-kho.stock": async () => ({ cacDong: [] }),
      "hang-kho.count": async () => 4834, "hang-kho.read": async (_ctx, code: string) => (code === "DV1" ? ITEM : null)
    }
  });
  const fakePlatform = defineModule({
    id: "khung-nen-tang", name: "Khung gia", tier: "khung", runsOn: "server-khach", version: "0",
    provides: { "khung-nen-tang.content": async () => normalisePageContent({ ...defaultPageContent(), ...content }, clock.now()) }
  });
  const kernel = new Kernel({
    ports: { store, logger, clock, auth: new TokenAuth({ keys: [{ token: BRAIN, name: "bo-nao", role: ROLE.service }], clock }), rateLimiter: new FixedWindowRateLimiter(clock) },
    logger, modules: [fakeInventory, ...(withPlatform ? [fakePlatform] : []), gateway], config: { "cong-bo-nao": { siteUrl: "https://shop.vn" } }
  });
  const tool = (name: string, input: Record<string, unknown> = {}) => kernel.handle({
    method: "POST", path: "/api/bo-nao/cong-cu", query: {}, ip: "1.1.1.1", headers: { authorization: `Bearer ${BRAIN}` }, json: async () => ({ ten: name, input })
  });
  const list = () => kernel.handle({ method: "GET", path: "/api/bo-nao/cong-cu", query: {}, ip: "1.1.1.1", headers: { authorization: `Bearer ${BRAIN}` } });
  return { tool, list };
}

test("the open tool list includes the four new tools + catalog.count when the services are there", async () => {
  const { list } = build();
  const open = ((await list()).body as Body).congCu as string[];
  for (const name of ["catalog.count", "variant.chart", "policy.get", "purchase.eta", "customer.recognize"]) assert.ok(open.includes(name), name);
  assert.ok(!open.includes("order.lookup"), "without the orders feature it is not open");
});

test("catalog.count returns the item total; variant.chart returns the size chart with in/out of stock", async () => {
  const { tool } = build();
  assert.deepEqual(((await tool("catalog.count")).body as Body).data, { total: 4834 });
  const chart = ((await tool("variant.chart", { itemId: "DV1" })).body as Body).data;
  assert.equal(chart.axis, "size");
  assert.deepEqual(chart.rows, [{ label: "41", note: "hết" }, { label: "42", note: "còn" }, { label: "43", note: "còn" }]);
  assert.deepEqual(((await tool("variant.chart", { itemId: "khong-co" })).body as Body).data.rows, []);
});

test("policy.get: read from the page content; empty -> found=false; topics returns / shipping / warranty", async () => {
  const { tool } = build({ content: { chinhSachDoiTra: "Đổi size trong 7 ngày, còn tem mác.", chinhSachShip: "Ship 30k toàn quốc." } });
  const returns = ((await tool("policy.get", { topic: "doi_tra" })).body as Body).data;
  assert.equal(returns.found, true);
  assert.equal(returns.text, "Đổi size trong 7 ngày, còn tem mác.");
  assert.equal(((await tool("policy.get", { topic: "phi_ship" })).body as Body).data.text, "Ship 30k toàn quốc.");
  const warranty = ((await tool("policy.get", { topic: "bao-hanh" })).body as Body).data;
  assert.equal(warranty.found, false);
  assert.equal(warranty.text, "");
  assert.equal(((await tool("policy.get", { topic: "gi-do-la" })).body as Body).data.found, false);
});

test("purchase.eta: a known item returns the day count from the page content; unknown item or empty day count -> available=false", async () => {
  const { tool } = build({ content: { soNgayHangOrder: "5" } });
  assert.deepEqual(((await tool("purchase.eta", { itemId: "DV1" })).body as Body).data, { available: true, days: 5 });
  assert.deepEqual(((await tool("purchase.eta", { itemId: "khong" })).body as Body).data, { available: false });
  const { tool: tool2 } = build({ content: { soNgayHangOrder: "" } });
  assert.deepEqual(((await tool2("purchase.eta", { itemId: "DV1" })).body as Body).data, { available: false });
});

test("customer.recognize: the landing cannot map a conversation to a customer yet, so it honestly answers isReturning=false", async () => {
  const { tool } = build();
  assert.deepEqual(((await tool("customer.recognize", { conversationId: "facebook:k1" })).body as Body).data, { isReturning: false, orderCount: 0 });
});

test("without the platform base policy.get is not open; purchase.eta still runs (no day count -> available=false)", async () => {
  const { tool, list } = build({ withPlatform: false });
  const open = ((await list()).body as Body).congCu as string[];
  assert.ok(!open.includes("policy.get"));
  assert.equal((await tool("policy.get", { topic: "doi_tra" })).status, 400);
  assert.deepEqual(((await tool("purchase.eta", { itemId: "DV1" })).body as Body).data, { available: false });
});

test("the warehouse id sent to the brain is BLIND, yet two different warehouses still give two different ids", () => {
  assert.match(blindWarehouseId("wh_yen"), /^kho_[0-9a-f]{8}$/);
  assert.ok(!/yen/.test(blindWarehouseId("wh_yen")), "must not spell out a person's name");
  assert.ok(!/supersports/.test(blindWarehouseId("supersports_supersports_com_vn")), "must not spell out a partner's name");
  assert.equal(blindWarehouseId("wh_yen"), blindWarehouseId("wh_yen"), "same warehouse, same id — or the brain miscounts sources");
  assert.notEqual(blindWarehouseId("wh_yen"), blindWarehouseId("wh_cau_dien"));
  assert.equal(blindWarehouseId(""), "");
});
