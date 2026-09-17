/**
 * PAGE CONTENT — home-page text, shipping fee, bank-transfer details.
 *
 * Two promises here:
 *   1. The public document holds ONLY the declared fields. Whoever sends an extra field (on
 *      purpose or through a bad paste) does not get it into the document — so a Telegram token or
 *      any key can never leak through the public door.
 *   2. When the owner edits the deposit percent / shipping fee / transfer prefix, the money module
 *      follows, because both read the SAME root.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROLE } from "../dist/contract/index.js";
import { FakeHttpClient, FixedWindowRateLimiter, JsonFileStore, Kernel, ManualClock, MemoryLogger, MemoryMailer, TokenAuth } from "../dist/kernel/index.js";
import { defaultPageContent, moneySettingsFrom, normalisePageContent } from "../dist/modules/khung-nen-tang/page-content.js";
import { manifest as platform } from "../dist/modules/khung-nen-tang/module.js";

const ADMIN = "ma-quan-tri";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "noi-dung-"));

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test reads arbitrary wire fields

function build() {
  const clock = new ManualClock();
  const logger = new MemoryLogger();
  const kernel = new Kernel({
    ports: {
      store: new JsonFileStore(tmp()), logger, clock, http: new FakeHttpClient(),
      auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }], clock }), rateLimiter: new FixedWindowRateLimiter(clock), mail: new MemoryMailer()
    },
    logger, modules: [platform], config: {}
  });
  const read = () => kernel.handle({ method: "GET", path: "/api/content", query: {}, headers: {}, ip: "1.1.1.1" });
  const write = (body: unknown, token: string | null = ADMIN) => kernel.handle({
    method: "POST", path: "/api/content", query: {},
    headers: token ? { authorization: `Bearer ${token}` } : {}, ip: "1.1.1.1", json: async () => body
  });
  return { kernel, read, write, clock };
}

test("nothing edited yet: the defaults come back", async () => {
  const { read } = build();
  const r = await read();
  assert.equal(r.status, 200);
  assert.equal((r.body as Body).heroTitle, defaultPageContent().heroTitle);
  assert.equal((r.body as Body).shippingFeeDefault, "30000");
});

test("the owner edits: the web sees it right away; untouched fields stay as they were", async () => {
  const { read, write } = build();
  const r = await write({ heroTitle: "Sale tháng 9", bankAccountNumber: "0123456789" });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  const web = (await read()).body as Body;
  assert.equal(web.heroTitle, "Sale tháng 9");
  assert.equal(web.bankAccountNumber, "0123456789");
  assert.equal(web.orderNote, defaultPageContent().orderNote, "an untouched field must stay as it was");
  assert.ok(web.updatedAt, "the edit time must be recorded");
});

test("ONLY declared fields are kept — an unknown field does NOT enter the document", () => {
  const r = normalisePageContent({ heroTitle: "A", telegramToken: "123:bi-mat", maQuanTri: "xxx" }) as Body;
  assert.equal(r.heroTitle, "A");
  assert.equal(r.telegramToken, undefined, "an unknown field must not enter the document");
  assert.equal(r.maQuanTri, undefined);
  assert.ok(!JSON.stringify(r).includes("bi-mat"));
});

test("an unknown field sent through the real write door still never reaches the public door", async () => {
  const { read, write } = build();
  await write({ heroTitle: "B", telegramToken: "123:bi-mat", bankPin: "9999" });
  const text = JSON.stringify((await read()).body);
  assert.ok(!text.includes("bi-mat"), "a Telegram token must not leak through the public door");
  assert.ok(!text.includes("9999"));
});

test("a customer can read, but NOT edit", async () => {
  const { read, write } = build();
  assert.equal((await read()).status, 200);
  const noToken = await write({ heroTitle: "khach sua" }, null);
  assert.equal(noToken.status, 401);
  assert.equal(((await read()).body as Body).heroTitle, defaultPageContent().heroTitle, "not one word may change");
});

test("an array or a string is refused", async () => {
  const { write } = build();
  assert.equal((await write([{ heroTitle: "x" }])).status, 400);
  assert.equal((await write("heroTitle=x")).status, 400);
});

test("the money module's numbers come from the content; a nonsensical value is null so the other side uses its default", () => {
  assert.deepEqual(moneySettingsFrom({ momoDepositPercent: "20", shippingFeeDefault: "30000", momoTransferPrefix: "TR" }),
    { phanTramCoc: 20, phiShipMacDinh: 30000, tienToChuyenKhoan: "TR" });
  assert.deepEqual(moneySettingsFrom({ momoDepositPercent: "0", shippingFeeDefault: "-5", momoTransferPrefix: "" }),
    { phanTramCoc: null, phiShipMacDinh: null, tienToChuyenKhoan: null });
  assert.deepEqual(moneySettingsFrom({ momoDepositPercent: "abc", shippingFeeDefault: "" }),
    { phanTramCoc: null, phiShipMacDinh: null, tienToChuyenKhoan: null });
  assert.deepEqual(moneySettingsFrom({ momoDepositPercent: "120" }).phanTramCoc, null, "above 100% is nonsense");
});

test("the content service is open to other modules, and a shipping fee of 0 is a REAL value", async () => {
  const { kernel, write } = build();
  await write({ shippingFeeDefault: "0", momoDepositPercent: "50", momoTransferPrefix: "TRX" });
  const services = kernel.serviceTable().map((s) => s.name);
  assert.ok(services.includes("khung-nen-tang.content"));
  assert.ok(services.includes("khung-nen-tang.moneySettings"));

  // Free shipping is a real choice of the owner — it must not be read as "not set" and quietly
  // replaced by 30,000.
  assert.equal(moneySettingsFrom({ shippingFeeDefault: "0" }).phiShipMacDinh, 0);
});
