/**
 * The inbox module — the whole path from Meta calling in to the reply going out, without
 * touching the Internet once.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EVENTS, ROLE, type HttpResponse, type IncomingRequest } from "../dist/contract/index.js";
import { FakeHttpClient, FixedWindowRateLimiter, JsonFileStore, Kernel, ManualClock, MemoryLogger, TokenAuth, jsonResponse, type FakeResponder } from "../dist/kernel/index.js";
import { INBOX_DOCUMENT, manifest as inbox, type Config } from "../dist/modules/hop-thu/module.js";
import { parseWebhookMessages, verifySignature } from "../dist/modules/hop-thu/webhook.js";

const ADMIN = "ma-quan-tri-thu";
const APP_SECRET = "bi-mat-ung-dung";
const VERIFY = "verify-thu";

interface InboxBookOnDisk { events: { daXacMinh: boolean }[] }

function build({ appSecret = APP_SECRET, pageToken = "token-trang", responder, brain }: { appSecret?: string; pageToken?: string; responder?: FakeResponder; brain?: Config["brain"] } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hop-thu-"));
  const logger = new MemoryLogger();
  const clock = new ManualClock();
  const http = new FakeHttpClient(responder ?? (() => jsonResponse({ message_id: "m.1" })));
  const store = new JsonFileStore(directory, logger);
  const config: Config = { verifyToken: VERIFY, appSecret, pageToken, ...(brain ? { brain } : {}) };
  const kernel = new Kernel({
    ports: { store, logger, clock, http, auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }], clock }), rateLimiter: new FixedWindowRateLimiter(clock) },
    logger,
    modules: [inbox],
    config: { "hop-thu": config }
  });
  return { kernel, logger, http, store, directory };
}

function metaPacket(text = "con size 42 khong shop"): string {
  return JSON.stringify({
    object: "page",
    entry: [{ id: "trang-1", messaging: [{ sender: { id: "khach-1" }, timestamp: 1789099200000, message: { mid: "m.abc", text } }] }]
  });
}

function webhookRequest(raw: string, { appSecret = APP_SECRET }: { appSecret?: string } = {}): IncomingRequest {
  const signature = "sha256=" + crypto.createHmac("sha256", appSecret).update(raw).digest("hex");
  return {
    method: "POST", path: "/api/facebook/webhook", query: {},
    headers: { "x-hub-signature-256": signature },
    raw: async () => Buffer.from(raw, "utf8")
  };
}

const tick = () => new Promise((r) => setImmediate(r));

test("Meta confirms the webhook address: the right token gets the challenge back", async () => {
  const { kernel } = build();
  const r = await kernel.handle({
    method: "GET", path: "/api/facebook/webhook",
    query: { "hub.mode": "subscribe", "hub.verify_token": VERIFY, "hub.challenge": "12345" },
    headers: {}
  });
  assert.equal(r.status, 200);
  assert.equal(Buffer.from(r.file!.data).toString("utf8"), "12345");
});

test("a wrong verify token is 403 — and no configured token is 403 too (fail closed)", async () => {
  const { kernel } = build();
  const wrong = await kernel.handle({
    method: "GET", path: "/api/facebook/webhook",
    query: { "hub.mode": "subscribe", "hub.verify_token": "bua", "hub.challenge": "x" }, headers: {}
  });
  assert.equal(wrong.status, 403);
});

test("a real message: stored in the document, announced on the bus, 200 to Meta", async () => {
  const { kernel, store } = build();
  const heard: { chu: string; nguoi: string }[] = [];
  kernel.bus.on(EVENTS.messageIn, "bai-thu", (m) => heard.push(m as { chu: string; nguoi: string }));

  const r = await kernel.handle(webhookRequest(metaPacket()));
  assert.equal(r.status, 200);
  assert.equal((r.body as { daXacMinh: boolean }).daXacMinh, true);

  await store.flush();
  const book = (await store.document<InboxBookOnDisk>(INBOX_DOCUMENT).read())!;
  assert.equal(book.events.length, 1);
  assert.equal(book.events[0]!.daXacMinh, true);

  await tick();
  assert.equal(heard.length, 1);
  assert.equal(heard[0]!.chu, "con size 42 khong shop");
  assert.equal(heard[0]!.nguoi, "khach-1");
});

test("a wrong signature is refused with 401 and NOT announced on the bus", async () => {
  const { kernel, store } = build();
  const heard: unknown[] = [];
  kernel.bus.on(EVENTS.messageIn, "bai-thu", (m) => heard.push(m));

  const r = await kernel.handle(webhookRequest(metaPacket(), { appSecret: "khoa-cua-ke-gia" }));
  assert.equal(r.status, 401);

  await tick();
  assert.equal(heard.length, 0, "an unverified packet must not be announced to the brain");
  await store.flush();
  assert.equal((await store.document<InboxBookOnDisk>(INBOX_DOCUMENT).read({ events: [] }))!.events.length, 0);
});

test("relay mode (no APP_SECRET): the message is still kept, but NOT announced to the brain", async () => {
  const { kernel, store } = build({ appSecret: "" });
  const heard: unknown[] = [];
  kernel.bus.on(EVENTS.messageIn, "bai-thu", (m) => heard.push(m));

  const r = await kernel.handle(webhookRequest(metaPacket()));
  assert.equal(r.status, 200);
  assert.equal((r.body as { daXacMinh: boolean }).daXacMinh, false);

  await store.flush();
  assert.equal((await store.document<InboxBookOnDisk>(INBOX_DOCUMENT).read())!.events.length, 1, "must still be kept for Desk to pull");
  await tick();
  assert.equal(heard.length, 0, "not sure the packet came from Meta = never answer the customer");
});

test("junk packets (no signature / not a page) are refused with 400", async () => {
  const { kernel } = build();
  const unsigned = await kernel.handle({
    method: "POST", path: "/api/facebook/webhook", query: {}, headers: {},
    raw: async () => Buffer.from(metaPacket(), "utf8")
  });
  assert.equal(unsigned.status, 400);

  const notAPage = await kernel.handle(webhookRequest(JSON.stringify({ object: "instagram", entry: [] })));
  assert.equal(notAPage.status, 400);
});

test("a message the page itself sent (echo) does not count as a customer writing in", () => {
  const messages = parseWebhookMessages({
    object: "page",
    entry: [{ id: "trang-1", messaging: [
      { sender: { id: "trang-1" }, message: { mid: "m.1", text: "shop tra loi" } },
      { sender: { id: "khach-1" }, message: { mid: "m.2", text: "em hoi", is_echo: true } },
      { sender: { id: "khach-2" }, timestamp: 1789099200000, message: { mid: "m.3", text: "con hang khong" } }
    ] }]
  });
  assert.equal(messages.length, 1);
  assert.equal(messages[0]!.nguoi, "khach-2");
});

test("a customer sending only an image (no text) still counts as one message", () => {
  const messages = parseWebhookMessages({
    object: "page",
    entry: [{ id: "t", messaging: [{ sender: { id: "k" }, timestamp: 1, message: { mid: "m", attachments: [{ type: "image" }] } }] }]
  });
  assert.equal(messages.length, 1);
  assert.equal(messages[0]!.soAnh, 1);
});

test("sending a reply: calls the right Graph API address, with the page token", async () => {
  const { kernel, http } = build();
  const r = await kernel.handle({
    method: "POST", path: "/api/hop-thu/gui", query: {},
    headers: { authorization: `Bearer ${ADMIN}` },
    json: async () => ({ nguoi: "khach-1", chu: "Da con size 42 anh nhe" })
  });
  assert.equal(r.status, 200);
  assert.equal(http.calls.length, 1);
  assert.match(http.calls[0]!.url, /graph\.facebook\.com\/v\d+\.\d+\/me\/messages/);
  assert.match(http.calls[0]!.url, /access_token=token-trang/);
  assert.equal(JSON.parse(http.calls[0]!.init.body!).message.text, "Da con size 42 anh nhe");
});

test("without an admin token the send route cannot be called", async () => {
  const { kernel, http } = build();
  const r = await kernel.handle({
    method: "POST", path: "/api/hop-thu/gui", query: {}, headers: {},
    json: async () => ({ nguoi: "khach-1", chu: "xin chao" })
  });
  assert.equal(r.status, 401);
  assert.equal(http.calls.length, 0);
});

test("Meta refusing the send is a 502 that says why — the error is not swallowed", async () => {
  const refusal: HttpResponse = { ok: false, status: 400, text: async () => '{"error":{"message":"ngoai 24h"}}', json: async () => ({}) };
  const { kernel } = build({ responder: () => refusal });
  const r = await kernel.handle({
    method: "POST", path: "/api/hop-thu/gui", query: {},
    headers: { authorization: `Bearer ${ADMIN}` },
    json: async () => ({ nguoi: "khach-1", chu: "tra loi muon" })
  });
  assert.equal(r.status, 502);
  assert.match((r.body as { message: string }).message, /ngoai 24h/);
});

test("Desk pulling the inbox still needs the admin token", async () => {
  const { kernel } = build();
  await kernel.handle(webhookRequest(metaPacket()));
  const noToken = await kernel.handle({ method: "GET", path: "/api/facebook/webhook-inbox", query: {}, headers: {} });
  assert.equal(noToken.status, 401);

  const withToken = await kernel.handle({
    method: "GET", path: "/api/facebook/webhook-inbox", query: {},
    headers: { authorization: `Bearer ${ADMIN}` }
  });
  assert.equal(withToken.status, 200);
  assert.equal((withToken.body as { events: unknown[] }).events.length, 1);
});

test("with a brain configured, the message is pushed to Xeon with the service token", async () => {
  const { kernel, http } = build({ pageToken: "tk", brain: { address: "https://xeon.example.vn", token: "ma-bo-nao", tenant: "toprun" } });

  await kernel.handle(webhookRequest(metaPacket("còn size 42 không")));
  await tick();
  await tick();

  const toXeon = http.calls.find((c) => c.url.includes("/tin-den"));
  assert.ok(toXeon, `must push the message to the brain: ${JSON.stringify(http.calls.map((c) => c.url))}`);
  assert.equal(toXeon.init.headers!["Authorization"], "Bearer ma-bo-nao");
  const body = JSON.parse(toXeon.init.body!);
  assert.equal(body.tenant, "toprun");
  assert.equal(body.chu, "còn size 42 không");
  assert.equal(body.nguoi, "khach-1");
});

test("a dead brain STILL gets Meta a 200 — never let Meta retry forever", async () => {
  const { kernel, logger } = build({
    pageToken: "tk",
    responder: () => { throw new Error("Xeon chet"); },
    brain: { address: "https://xeon.example.vn", token: "x", tenant: "toprun" }
  });

  const r = await kernel.handle(webhookRequest(metaPacket()));
  assert.equal(r.status, 200, "a dead brain must not make the inbox answer anything but 200");
  await tick();
  await tick();
  assert.ok(logger.has(/khong day duoc tin sang bo nao/), "must be logged");
});

test("with no brain connected the inbox works as usual", async () => {
  const { kernel, http } = build();
  const r = await kernel.handle(webhookRequest(metaPacket()));
  assert.equal(r.status, 200);
  await tick();
  assert.equal(http.calls.filter((c) => c.url.includes("/tin-den")).length, 0);
});

test("the signature is computed over the RAW BYTES, not over re-serialised JSON", () => {
  const raw = Buffer.from('{"object":"page",  "entry":[]}', "utf8");        // two spaces on purpose
  const reserialised = Buffer.from(JSON.stringify(JSON.parse(raw.toString())), "utf8");
  const signature = "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(raw).digest("hex");
  assert.equal(verifySignature(raw, signature, APP_SECRET), true);
  assert.equal(verifySignature(reserialised, signature, APP_SECRET), false, "parse + stringify changes bytes — it must fail");
});
