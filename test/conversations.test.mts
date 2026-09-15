/**
 * THE CONVERSATION BOOK — messages grouped into threads, both directions.
 *
 * The promise that matters most: WHAT WE SENT IS KEPT TOO. Before this, an outgoing message was
 * emitted on the bus and forgotten, so any chat view would have shown every customer question and
 * not one answer — and a seller taking over from the bot could not see what the bot had promised.
 *
 * The pure rules are tested directly (no kernel), then the whole path once through the kernel.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROLE, type IncomingRequest } from "../dist/contract/index.js";
import { FakeHttpClient, FixedWindowRateLimiter, JsonFileStore, Kernel, ManualClock, MemoryLogger, TokenAuth, jsonResponse } from "../dist/kernel/index.js";
import { manifest as inbox, type Config } from "../dist/modules/hop-thu/module.js";
import { parseWebhookComments } from "../dist/modules/hop-thu/webhook.js";
import {
  MESSAGE_KEEP_MAX, THREAD_KEEP_MAX, conversationId, defaultConversationBook, fileIncoming, fileOutgoing,
  listThreads, markOutgoingState, markRead, threadOf, unreadThreadCount
} from "../dist/modules/hop-thu/conversations.js";

const ADMIN = "ma-quan-tri-thu";
const APP_SECRET = "bi-mat-ung-dung";
const VERIFY = "verify-thu";
const AT = "2026-09-14T10:00:00.000Z";

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test reads arbitrary wire fields

// ---------- the rules, no kernel ----------

test("the thread id is the SAME string the brain and the handoff list use", () => {
  assert.equal(conversationId("facebook", "khach-1"), "facebook:khach-1");
  assert.equal(conversationId("zalo", "k9"), "zalo:k9");
});

test("a customer message opens a thread and counts as unread; ours never does", () => {
  let book = fileIncoming(defaultConversationBook(), { kenh: "facebook", nguoi: "k1", maTin: "m1", chu: "còn size 42 không", luc: AT }, AT);
  assert.equal(unreadThreadCount(book), 1);
  assert.equal(listThreads(book)[0]?.soChuaDoc, 1);
  assert.equal(listThreads(book)[0]?.tinCuoi, "còn size 42 không");

  book = fileOutgoing(book, { kenh: "facebook", nguoi: "k1", maTin: "d1", chu: "dạ còn ạ", luc: "2026-09-14T10:01:00.000Z", boi: "bo-nao" }, AT);
  assert.equal(listThreads(book)[0]?.soChuaDoc, 1, "our own reply is not something to read");
  assert.equal(listThreads(book)[0]?.chieuCuoi, "di");

  const thread = threadOf(book, "facebook:k1");
  assert.equal(thread?.tin.length, 2);
  assert.deepEqual(thread?.tin.map((m) => [m.chieu, m.chu, m.boi]), [
    ["den", "còn size 42 không", "khach"],
    ["di", "dạ còn ạ", "bo-nao"]
  ], "both sides, oldest first — this is the whole point of the book");
});

test("messages are ordered by WHEN THEY WERE SENT, not by when they were filed", () => {
  let book = fileIncoming(defaultConversationBook(), { kenh: "zalo", nguoi: "k2", maTin: "b", chu: "hai", luc: "2026-09-14T10:05:00.000Z" }, AT);
  book = fileIncoming(book, { kenh: "zalo", nguoi: "k2", maTin: "a", chu: "một", luc: "2026-09-14T10:04:00.000Z" }, AT);
  assert.deepEqual(threadOf(book, "zalo:k2")?.tin.map((m) => m.chu), ["một", "hai"]);
  assert.equal(listThreads(book)[0]?.tinCuoi, "hai", "the preview is the LATEST message, not the last filed");
});

test("the same message id is never filed twice — Meta retries, OMI re-scans", () => {
  const first = fileIncoming(defaultConversationBook(), { kenh: "facebook", nguoi: "k1", maTin: "m1", chu: "alo", luc: AT }, AT);
  const again = fileIncoming(first, { kenh: "facebook", nguoi: "k1", maTin: "m1", chu: "alo", luc: AT }, AT);
  assert.equal(threadOf(again, "facebook:k1")?.tin.length, 1);
  assert.equal(threadOf(again, "facebook:k1")?.soChuaDoc, 1, "a retry must not double the unread count");
});

test("opening a thread clears its unread count, and only that thread's", () => {
  let book = fileIncoming(defaultConversationBook(), { kenh: "facebook", nguoi: "k1", maTin: "m1", chu: "a", luc: AT }, AT);
  book = fileIncoming(book, { kenh: "facebook", nguoi: "k2", maTin: "m2", chu: "b", luc: AT }, AT);
  assert.equal(unreadThreadCount(book), 2);

  book = markRead(book, "facebook:k1", AT);
  assert.equal(unreadThreadCount(book), 1);
  assert.equal(threadOf(book, "facebook:k1")?.soChuaDoc, 0);
  assert.equal(threadOf(book, "facebook:k2")?.soChuaDoc, 1);
  assert.equal(markRead(book, "khong-co-thread", AT).hoiThoai.length, 2, "an unknown thread changes nothing");
});

test("a queued message shows as `cho-gui` and becomes what really happened", () => {
  let book = fileOutgoing(defaultConversationBook(), { kenh: "zalo", nguoi: "k1", maTin: "cg_1", chu: "chào anh", luc: AT, trangThai: "cho-gui" }, AT);
  assert.equal(threadOf(book, "zalo:k1")?.tin[0]?.trangThai, "cho-gui");
  book = markOutgoingState(book, "cg_1", "da-gui", AT);
  assert.equal(threadOf(book, "zalo:k1")?.tin[0]?.trangThai, "da-gui");
  book = markOutgoingState(book, "khong-co", "hong", AT);
  assert.equal(threadOf(book, "zalo:k1")?.tin[0]?.trangThai, "da-gui", "an unknown id changes nothing");
});

test("the name OMI reads off the screen can arrive after the first message", () => {
  let book = fileIncoming(defaultConversationBook(), { kenh: "zalo", nguoi: "k1", maTin: "m1", chu: "a", luc: AT }, AT);
  assert.equal(listThreads(book)[0]?.tenNguoi, "");
  book = fileIncoming(book, { kenh: "zalo", nguoi: "k1", maTin: "m2", chu: "b", luc: AT, tenNguoi: "Chị Lan" }, AT);
  assert.equal(listThreads(book)[0]?.tenNguoi, "Chị Lan");
});

test("filters: by channel, unread only, and free text over person / name / last message", () => {
  let book = fileIncoming(defaultConversationBook(), { kenh: "facebook", nguoi: "k1", maTin: "m1", chu: "giày pegasus", luc: AT, tenNguoi: "Anh Nam" }, AT);
  book = fileIncoming(book, { kenh: "zalo", nguoi: "k2", maTin: "m2", chu: "áo khoác", luc: AT }, AT);
  book = markRead(book, "zalo:k2", AT);

  assert.deepEqual(listThreads(book, { kenh: "zalo" }).map((c) => c.ma), ["zalo:k2"]);
  assert.deepEqual(listThreads(book, { loc: "chua-doc" }).map((c) => c.ma), ["facebook:k1"]);
  assert.deepEqual(listThreads(book, { q: "pegasus" }).map((c) => c.ma), ["facebook:k1"]);
  assert.deepEqual(listThreads(book, { q: "anh nam" }).map((c) => c.ma), ["facebook:k1"], "search is case-insensitive");
  assert.deepEqual(listThreads(book, { q: "khong-co-gi" }), []);
});

test("the list carries no messages — 300 threads on one screen must stay small", () => {
  const book = fileIncoming(defaultConversationBook(), { kenh: "facebook", nguoi: "k1", maTin: "m1", chu: "a", luc: AT }, AT);
  const row = listThreads(book)[0] as Record<string, unknown>;
  assert.equal(row["soTin"], 1);
  assert.equal(row["tin"], undefined, "the thread list must not carry every message of every thread");
});

test("the book is bounded: oldest threads and oldest messages fall off", () => {
  let book = defaultConversationBook();
  for (let i = 0; i < THREAD_KEEP_MAX + 20; i += 1) {
    const minute = String(i % 60).padStart(2, "0");
    const hour = String(10 + Math.floor(i / 60)).padStart(2, "0");
    book = fileIncoming(book, { kenh: "facebook", nguoi: `k${i}`, maTin: `m${i}`, chu: "x", luc: `2026-09-14T${hour}:${minute}:00.000Z` }, AT);
  }
  assert.equal(book.hoiThoai.length, THREAD_KEEP_MAX);

  let long = defaultConversationBook();
  for (let i = 0; i < MESSAGE_KEEP_MAX + 10; i += 1) {
    const seconds = String(i % 60).padStart(2, "0");
    const minutes = String(Math.floor(i / 60)).padStart(2, "0");
    long = fileIncoming(long, { kenh: "zalo", nguoi: "k1", maTin: `m${i}`, chu: `tin ${i}`, luc: `2026-09-14T10:${minutes}:${seconds}.000Z` }, AT);
  }
  assert.equal(threadOf(long, "zalo:k1")?.tin.length, MESSAGE_KEEP_MAX);
  assert.equal(threadOf(long, "zalo:k1")?.tin.at(-1)?.chu, `tin ${MESSAGE_KEEP_MAX + 9}`, "the NEWEST messages are the ones kept");
});

// ---------- the whole path, through the kernel ----------

function build() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hoi-thoai-"));
  const logger = new MemoryLogger();
  const clock = new ManualClock();
  const http = new FakeHttpClient(() => jsonResponse({ message_id: "m.meta.1" }));
  const config: Config = { verifyToken: VERIFY, appSecret: APP_SECRET, pageToken: "token-trang" };
  const kernel = new Kernel({
    ports: {
      store: new JsonFileStore(directory, logger), logger, clock, http,
      auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }], clock }),
      rateLimiter: new FixedWindowRateLimiter(clock)
    },
    logger, modules: [inbox], config: { "hop-thu": config }
  });
  const admin = { authorization: `Bearer ${ADMIN}` };
  const threads = (query: Record<string, string> = {}) => kernel.handle({ method: "GET", path: "/api/hop-thu/hoi-thoai", query, headers: admin, ip: "1.1.1.1" });
  const thread = (id: string) => kernel.handle({ method: "GET", path: `/api/hop-thu/hoi-thoai/${id}`, query: {}, headers: admin, ip: "1.1.1.1" });
  const read = (id: string) => kernel.handle({ method: "POST", path: `/api/hop-thu/hoi-thoai/${id}/da-doc`, query: {}, headers: admin, ip: "1.1.1.1", json: async () => ({}) });
  return { kernel, admin, threads, thread, read, http };
}

function webhookRequest(text: string): IncomingRequest {
  const raw = JSON.stringify({
    object: "page",
    entry: [{ id: "trang-1", messaging: [{ sender: { id: "khach-1" }, timestamp: 1789099200000, message: { mid: `m.${text.length}`, text } }] }]
  });
  return {
    method: "POST", path: "/api/facebook/webhook", query: {},
    headers: { "x-hub-signature-256": "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(raw).digest("hex") },
    raw: async () => Buffer.from(raw, "utf8")
  };
}

const tick = () => new Promise((r) => setImmediate(r));

test("the whole path: customer writes in, we answer, the thread shows BOTH and the unread clears", async () => {
  const { kernel, admin, threads, thread, read, http } = build();

  await kernel.handle(webhookRequest("còn size 42 không shop"));
  await tick();

  let list = (await threads()).body as Body;
  assert.equal(list["soChuaDoc"], 1);
  assert.equal(list["hoiThoai"][0]["ma"], "facebook:khach-1");
  assert.equal(list["hoiThoai"][0]["tinCuoi"], "còn size 42 không shop");

  // A person in OMI answers through the same door the brain uses.
  const sent = await kernel.handle({
    method: "POST", path: "/api/hop-thu/gui", query: {}, headers: admin, ip: "1.1.1.1",
    json: async () => ({ kenh: "facebook", nguoi: "khach-1", chu: "Dạ còn size 42 ạ" })
  });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.ok(http.calls.length > 0, "the reply really went to Meta");

  const one = (await thread("facebook:khach-1")).body as Body;
  assert.deepEqual(one["hoiThoai"]["tin"].map((m: Body) => [m["chieu"], m["chu"]]), [
    ["den", "còn size 42 không shop"],
    ["di", "Dạ còn size 42 ạ"]
  ], "the answer is kept — without it the chat pane is half a conversation");
  assert.equal(one["hoiThoai"]["tin"][1]["trangThai"], "da-gui");

  assert.equal(((await read("facebook:khach-1")).body as Body)["soChuaDoc"], 0);
  list = (await threads()).body as Body;
  assert.equal(list["hoiThoai"][0]["soChuaDoc"], 0);

  assert.equal((await kernel.handle({ method: "GET", path: "/api/hop-thu/hoi-thoai", query: {}, headers: {}, ip: "1.1.1.1" })).status, 401, "threads are admin only");
  assert.equal((await thread("khong-co-thread")).status, 404);
});

test("a PUBLIC COMMENT becomes its own kind of thread, and the reply goes under the comment", async () => {
  const { kernel, admin, threads, thread, http } = build();

  const raw = JSON.stringify({
    object: "page",
    entry: [{
      id: "trang-1",
      changes: [{
        field: "feed",
        value: { item: "comment", verb: "add", comment_id: "c.1", post_id: "trang-1_99", created_time: 1789099200, message: "giá bao nhiêu shop", from: { id: "khach-9", name: "Chị Lan" } }
      }]
    }]
  });
  await kernel.handle({
    method: "POST", path: "/api/facebook/webhook", query: {},
    headers: { "x-hub-signature-256": "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(raw).digest("hex") },
    raw: async () => Buffer.from(raw, "utf8")
  });
  await tick();

  const list = (await threads()).body as Body;
  const row = list["hoiThoai"].find((c: Body) => c["kenh"] === "facebook-binh-luan");
  assert.ok(row, "a comment must not be filed as a Messenger message");
  assert.equal(row["ma"], "facebook-binh-luan:khach-9");
  assert.equal(row["tenNguoi"], "Chị Lan", "Meta gives the commenter's name — use it");

  const one = (await thread("facebook-binh-luan:khach-9")).body as Body;
  assert.equal(one["hoiThoai"]["tin"][0]["baiViet"], "trang-1_99", "the seller must see WHICH post is being asked about");
  assert.equal(one["hoiThoai"]["tin"][0]["luc"].slice(0, 4), "2026", "comment times are SECONDS; treating them as ms lands in the year 57,000");

  // No comment id (the brain sent none before 15/09/2026): the reply goes under the customer's
  // latest comment in the thread rather than failing.
  http.calls.length = 0;
  const noTarget = await kernel.handle({
    method: "POST", path: "/api/hop-thu/gui", query: {}, headers: admin, ip: "1.1.1.1",
    json: async () => ({ kenh: "facebook-binh-luan", nguoi: "khach-9", chu: "dạ 2.890.000đ ạ" })
  });
  assert.equal(noTarget.status, 200, JSON.stringify(noTarget.body));
  assert.match(String(http.calls[0]?.url), /\/c\.1\/comments/, "without an id: under the customer's latest comment");

  // Someone with no comment anywhere: nothing to answer under — refused rather than answered into the void.
  const nowhere = await kernel.handle({
    method: "POST", path: "/api/hop-thu/gui", query: {}, headers: admin, ip: "1.1.1.1",
    json: async () => ({ kenh: "facebook-binh-luan", nguoi: "khach-chua-binh-luan", chu: "dạ" })
  });
  assert.equal(nowhere.status, 502);
  assert.match(String((nowhere.body as Body)["message"]), /traLoiTin/);

  http.calls.length = 0;
  const replied = await kernel.handle({
    method: "POST", path: "/api/hop-thu/gui", query: {}, headers: admin, ip: "1.1.1.1",
    json: async () => ({ kenh: "facebook-binh-luan", nguoi: "khach-9", chu: "dạ 2.890.000đ ạ", traLoiTin: "c.1" })
  });
  assert.equal(replied.status, 200, JSON.stringify(replied.body));
  assert.match(String(http.calls[0]?.url), /\/c\.1\/comments/, "the answer goes UNDER the comment, not into the inbox");

  const after = (await thread("facebook-binh-luan:khach-9")).body as Body;
  const directions = after["hoiThoai"]["tin"].map((m: Body) => m["chieu"]);
  assert.equal(directions[0], "den");
  assert.ok(directions.length >= 2 && directions.slice(1).every((d: string) => d === "di"), `the answers are kept: ${JSON.stringify(directions)}`);
});

test("a comment the PAGE ITSELF wrote, and a deleted one, are not questions", () => {
  const page = { object: "page", entry: [{ id: "trang-1", changes: [{ field: "feed", value: { item: "comment", verb: "add", comment_id: "c.2", message: "cảm ơn anh", from: { id: "trang-1" } } }] }] };
  const removed = { object: "page", entry: [{ id: "trang-1", changes: [{ field: "feed", value: { item: "comment", verb: "remove", comment_id: "c.3", message: "x", from: { id: "khach-1" } } }] }] };
  const other = { object: "page", entry: [{ id: "trang-1", changes: [{ field: "feed", value: { item: "reaction", verb: "add", from: { id: "khach-1" } } }] }] };
  assert.deepEqual(parseWebhookComments(page), [], "our own comment would make the bot answer itself forever");
  assert.deepEqual(parseWebhookComments(removed), []);
  assert.deepEqual(parseWebhookComments(other), [], "a like is not a question");
});

test("a message OMI pushed in lands in a thread the same way", async () => {
  const { kernel, admin, threads } = build();
  await kernel.handle({
    method: "POST", path: "/api/hop-thu/tin-vao", query: {}, headers: admin, ip: "1.1.1.1",
    json: async () => ({ tin: [{ kenh: "zalo", nguoi: "nhom-1", maTin: "z1", chu: "giá bao nhiêu", luc: AT, tenNguoi: "Chị Lan" }] })
  });
  await tick();
  const list = (await threads({ kenh: "zalo" })).body as Body;
  assert.equal(list["hoiThoai"][0]["ma"], "zalo:nhom-1");
  assert.equal(list["hoiThoai"][0]["tenNguoi"], "Chị Lan");
});
