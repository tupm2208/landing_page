/**
 * The inbox behind the developer's Meta app (decided 15/09/2026): Xeon receives Meta's webhook for
 * every merchant and forwards each shop's share here; the shop keeps one token PER PAGE and answers
 * as the page the customer wrote to. No Internet: fake Graph API, fake Xeon.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROLE, type IncomingRequest } from "../dist/contract/index.js";
import { FakeHttpClient, FixedWindowRateLimiter, MemoryUploadPort, JsonFileStore, Kernel, ManualClock, MemoryLogger, TokenAuth, jsonResponse } from "../dist/kernel/index.js";
import { manifest as inbox, type Config } from "../dist/modules/hop-thu/module.js";

const ADMIN = "ma-quan-tri-thu";
const SERVICE = "ve-dich-vu-thu";

function build() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hop-thu-meta-"));
  const logger = new MemoryLogger();
  const clock = new ManualClock(new Date("2026-09-15T08:00:00.000Z"));
  const http = new FakeHttpClient((url: string) => (url.includes("/tin-den") ? jsonResponse({ ok: true }) : jsonResponse({ message_id: "m.di", id: "c.di" })));
  const store = new JsonFileStore(directory, logger);
  // The landing no longer holds the app secret: Meta talks to Xeon.
  const config: Config = { verifyToken: "", appSecret: "", pageToken: "", brain: { address: "https://xeon.test", token: "ma-nhan-tin", tenant: "toprun" } };
  const kernel = new Kernel({
    ports: {
      store, logger, clock, http, rateLimiter: new FixedWindowRateLimiter(clock), uploads: new MemoryUploadPort(),
      auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }, { token: SERVICE, name: "xeon", role: ROLE.service }], clock })
    },
    logger,
    modules: [inbox],
    config: { "hop-thu": config }
  });
  const call = (method: string, p: string, body?: unknown, token = ADMIN) => kernel.handle({
    method, path: p, query: {}, headers: token ? { authorization: `Bearer ${token}` } : {}, json: async () => body ?? {}
  } as IncomingRequest);
  return { kernel, http, store, logger, call };
}

const tick = () => new Promise((r) => setImmediate(r));

const messagePacket = (page: string, customer: string, mid: string, text: string) => ({
  object: "page",
  entry: [{ id: page, time: 1789459200000, messaging: [{ sender: { id: customer }, recipient: { id: page }, timestamp: 1789459200000, message: { mid, text } }] }]
});

const commentPacket = (page: string, customer: string, commentId: string, text: string) => ({
  object: "page",
  entry: [{ id: page, time: 1789459200000, changes: [{ field: "feed", value: { item: "comment", verb: "add", from: { id: customer, name: "Khach" }, message: text, comment_id: commentId, post_id: `${page}_bai`, created_time: 1789459200 } }] }]
});

test("Xeon forwards a packet: it takes a service ticket, lands in the thread with its page, and goes to the brain", async () => {
  const { http, call } = build();
  assert.equal((await call("POST", "/api/hop-thu/meta-tu-xeon", { goi: messagePacket("trang-2", "khach-9", "m.1", "con size 42") }, "")).status, 401);

  const r = await call("POST", "/api/hop-thu/meta-tu-xeon", { goi: messagePacket("trang-2", "khach-9", "m.1", "con size 42") }, SERVICE);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true, daNhan: 1, trung: 0 });

  const threads = (await call("GET", "/api/hop-thu/hoi-thoai")).body as { hoiThoai: { ma: string; trang: string }[] };
  assert.deepEqual(threads.hoiThoai.map((t) => [t.ma, t.trang]), [["facebook:khach-9", "trang-2"]]);

  await tick(); await tick();
  const toBrain = http.calls.filter((c) => c.url.includes("/tin-den"));
  assert.equal(toBrain.length, 1);
  assert.equal(JSON.parse(toBrain[0]!.init.body!).chu, "con size 42");

  assert.equal((await call("POST", "/api/hop-thu/meta-tu-xeon", { goi: { object: "instagram", entry: [] } }, SERVICE)).status, 400);
});

test("the same packet twice (Meta retrying, Xeon re-sending what it kept) is filed and answered ONCE", async () => {
  const { http, call } = build();
  const goi = messagePacket("trang-2", "khach-9", "m.1", "con size 42");
  await call("POST", "/api/hop-thu/meta-tu-xeon", { goi }, SERVICE);
  const again = await call("POST", "/api/hop-thu/meta-tu-xeon", { goi }, SERVICE);
  assert.deepEqual(again.body, { ok: true, daNhan: 0, trung: 1 });
  await tick(); await tick();
  assert.equal(http.calls.filter((c) => c.url.includes("/tin-den")).length, 1, "the customer must not get two answers");
});

test("page tokens in Sales Desk's shape: stored per page, never shown again, and a reply goes out AS the thread's page", async () => {
  const { http, call } = build();
  const saved = await call("POST", "/api/admin/fanpage/credentials", {
    metaGraphVersion: "v23.0",
    pages: [{ pageId: "trang-1", name: "Trang Mot", accessToken: "tk-mot" }, { pageId: "trang-2", name: "Trang Hai", accessToken: "tk-hai" }, { pageId: "", accessToken: "x" }]
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const body = saved.body as { soTrang: number; xeon: { ok: boolean; viSao: string } };
  assert.equal(body.soTrang, 2, "the entry without a page id is dropped");
  assert.deepEqual(body.xeon, { ok: false, viSao: "chua_dang_ky_xeon" }, "no Xeon registration = nothing to announce, tokens still kept");
  assert.ok(!JSON.stringify(saved.body).includes("tk-"), "a token never comes back");

  const listed = (await call("GET", "/api/hop-thu/trang")).body as { trang: { ma: string; coToken: boolean }[] };
  assert.deepEqual(listed.trang.map((p) => [p.ma, p.coToken]), [["trang-1", true], ["trang-2", true]]);
  assert.ok(!JSON.stringify(listed).includes("tk-"));
  assert.equal((await call("GET", "/api/hop-thu/trang", undefined, "")).status, 401);

  await call("POST", "/api/hop-thu/meta-tu-xeon", { goi: messagePacket("trang-2", "khach-9", "m.1", "con size 42") }, SERVICE);
  const sent = await call("POST", "/api/hop-thu/gui", { nguoi: "khach-9", chu: "Da con a" }, SERVICE);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const toGraph = http.calls.find((c) => c.url.includes("graph.facebook.com"))!;
  assert.match(toGraph.url, /graph\.facebook\.com\/v23\.0\/trang-2\/messages\?access_token=tk-hai$/);
});

test("a comment reply without a comment id goes under the customer's latest comment, with that page's token", async () => {
  const { http, call } = build();
  await call("POST", "/api/admin/fanpage/credentials", { pages: [{ pageId: "trang-1", name: "Trang Mot", accessToken: "tk-mot" }] });
  await call("POST", "/api/hop-thu/meta-tu-xeon", { goi: commentPacket("trang-1", "khach-5", "c_cu", "gia bao nhieu") }, SERVICE);
  await call("POST", "/api/hop-thu/meta-tu-xeon", { goi: commentPacket("trang-1", "khach-5", "c_moi", "con size 40 khong") }, SERVICE);

  const r = await call("POST", "/api/hop-thu/gui", { kenh: "facebook-binh-luan", nguoi: "khach-5", chu: "Da con a" }, SERVICE);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const toGraph = http.calls.find((c) => c.url.includes("graph.facebook.com"))!;
  assert.match(toGraph.url, /\/c_moi\/comments\?access_token=tk-mot$/);
});

test("credentials without a single usable page are refused", async () => {
  const { call } = build();
  const r = await call("POST", "/api/admin/fanpage/credentials", { pages: [{ name: "khong co ma" }] });
  assert.equal(r.status, 400);
  assert.equal((await call("POST", "/api/admin/fanpage/credentials", { pages: [] }, "")).status, 401);
});
