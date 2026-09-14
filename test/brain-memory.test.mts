/**
 * The bot's CONVERSATION MEMORY lives on the landing (decided 14/09/2026). The brain reads and
 * writes it over the API.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROLE, defineModule } from "../dist/contract/index.js";
import { FixedWindowRateLimiter, JsonFileStore, Kernel, ManualClock, MemoryLogger, TokenAuth } from "../dist/kernel/index.js";
import { MEMORY_DOCUMENT, manifest as gateway } from "../dist/modules/cong-bo-nao/module.js";
import type { MemoryBook } from "../dist/modules/cong-bo-nao/conversation-memory.js";

const BRAIN = "ma-bo-nao";
const ADMIN = "ma-quan-tri";

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test reads arbitrary wire fields

function build() {
  const logger = new MemoryLogger();
  const clock = new ManualClock();
  const store = new JsonFileStore(fs.mkdtempSync(path.join(os.tmpdir(), "tri-nho-")), logger);
  // The gateway requires the inventory module; a fake one provides exactly those two services.
  const fakeInventory = defineModule({
    id: "hang-kho", name: "Hang kho gia", tier: "van-hanh", runsOn: "server-khach", version: "0",
    provides: { "hang-kho.search": async () => [], "hang-kho.stock": async () => ({ cacDong: [] }) }
  });
  const kernel = new Kernel({
    ports: { store, logger, clock, auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }, { token: BRAIN, name: "bo-nao", role: ROLE.service }], clock }), rateLimiter: new FixedWindowRateLimiter(clock) },
    logger, modules: [fakeInventory, gateway], config: { "cong-bo-nao": { siteUrl: "https://shop.vn" } }
  });
  const call = (method: string, route: string, { token = BRAIN, body }: { token?: string; body?: unknown } = {}) =>
    kernel.handle({ method, path: route, query: {}, ip: "1.1.1.1", headers: { authorization: `Bearer ${token}` }, json: async () => body ?? {} });
  return { call, clock, store };
}

test("reading an unknown conversation -> null; write then read back; bad id / bad body / too large refused; no service token -> 401", async () => {
  const { call } = build();
  const id = "facebook:khach-1";
  const empty = await call("GET", `/api/bo-nao/tri-nho/${encodeURIComponent(id)}`);
  assert.equal(empty.status, 200);
  assert.equal((empty.body as Body).trangThai, null);

  const state = { tenant: "toprun", conversationId: id, turns: [{ role: "customer", text: "con size 42", at: "2026-09-14T08:00:00.000Z" }] };
  const written = await call("PUT", `/api/bo-nao/tri-nho/${encodeURIComponent(id)}`, { body: { trangThai: state } });
  assert.equal(written.status, 200, JSON.stringify(written.body));
  const read = await call("GET", `/api/bo-nao/tri-nho/${encodeURIComponent(id)}`);
  assert.deepEqual((read.body as Body).trangThai, state);
  assert.equal((read.body as Body).capNhatLuc, (written.body as Body).capNhatLuc);

  assert.equal((await call("GET", "/api/bo-nao/tri-nho/co%20cach")).status, 400);
  assert.equal((await call("PUT", `/api/bo-nao/tri-nho/${id}`, { body: { trangThai: "chuoi" } })).status, 400);
  assert.equal((await call("PUT", `/api/bo-nao/tri-nho/${id}`, { body: { trangThai: { to: "x".repeat(100 * 1024) } } })).status, 413);
  assert.equal((await call("GET", `/api/bo-nao/tri-nho/${id}`, { token: "la" })).status, 401);
  assert.equal((await call("GET", `/api/bo-nao/tri-nho/${id}`, { token: ADMIN })).status, 200, "admin can read too");
});

test("keeps at most 2000 conversations, dropping the oldest", async () => {
  const { call, clock, store } = build();
  for (let i = 0; i < 2001; i += 1) {
    clock.advance(1000);
    await call("PUT", `/api/bo-nao/tri-nho/h${i}`, { body: { trangThai: { i } } });
  }
  const book = (await store.document<MemoryBook>(MEMORY_DOCUMENT).read())!;
  assert.equal(Object.keys(book.hoiThoai).length, 2000);
  assert.equal(book.hoiThoai["h0"], undefined, "the oldest is dropped");
  assert.ok(book.hoiThoai["h2000"]);
});
