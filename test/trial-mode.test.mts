/**
 * Trial mode — the trial build must do NOTHING real outside.
 *
 * Decided 12/09/2026: run on real data, read Graph API live, but never answer customers. This
 * file keeps that promise. (The end-to-end checks through the inbox and shipping modules live in
 * `trial-mode-modules.test.mts`.)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryLogger, TrialModeBlockedError, TrialModeHttpClient, jsonResponse } from "../dist/kernel/index.js";
import type { HttpClient, HttpRequestInit } from "../dist/contract/index.js";

function build() {
  const logger = new MemoryLogger();
  const realCalls: { url: string; init: HttpRequestInit }[] = [];
  const real: HttpClient = { async fetch(url, init = {}) { realCalls.push({ url: String(url), init }); return jsonResponse({ ok: true }); } };
  return { client: new TrialModeHttpClient({ real, logger }), logger, realCalls };
}

test("BLOCKS messaging a customer — the most important promise", async () => {
  const { client, realCalls } = build();
  await assert.rejects(
    () => client.fetch("https://graph.facebook.com/v21.0/me/messages?access_token=x", { method: "POST", body: JSON.stringify({ recipient: { id: "khach-1" }, message: { text: "xin chào" } }) }),
    (e: unknown) => e instanceof TrialModeBlockedError && /gửi tin cho khách/.test(e.action)
  );
  assert.equal(realCalls.length, 0);
});

test("LETS THROUGH reading from Meta — live data is allowed", async () => {
  const { client, realCalls } = build();
  const r = await client.fetch("https://graph.facebook.com/v21.0/me?fields=id,name&access_token=x");
  assert.equal(r.ok, true);
  assert.equal(realCalls.length, 1);
});

test("BLOCKS Telegram, SPX and Viettel Post", async () => {
  const { client, realCalls } = build();
  for (const url of ["https://api.telegram.org/bot123/sendMessage", "https://spx.vn/open/api/v1/order/create_order", "https://partner.viettelpost.vn/v2/order/createOrderNlp"]) {
    await assert.rejects(() => client.fetch(url, { method: "POST", body: "{}" }), (e: unknown) => (e as TrialModeBlockedError).trialMode === true);
  }
  assert.equal(realCalls.length, 0);
});

test("BLOCK BY DEFAULT: a brand-new destination is blocked too; a POST to Graph that is not messaging is blocked too", async () => {
  const { client, realCalls } = build();
  await assert.rejects(
    () => client.fetch("https://mot-doi-tac-moi-nao-do.vn/api/gui", { method: "POST" }),
    (e: unknown) => (e as TrialModeBlockedError).trialMode === true && /mot-doi-tac-moi-nao-do\.vn/.test((e as TrialModeBlockedError).action)
  );
  await assert.rejects(() => client.fetch("https://graph.facebook.com/v21.0/me/photos", { method: "POST" }), (e: unknown) => (e as TrialModeBlockedError).trialMode === true);
  assert.equal(realCalls.length, 0);
});

test("NEVER SILENT: a blocked call throws, it does not return ok", async () => {
  const { client } = build();
  let result: unknown = null;
  try { result = await client.fetch("https://api.telegram.org/bot1/sendMessage", { method: "POST" }); } catch { /* expected */ }
  assert.equal(result, null, "returning ok would make the brain believe it sent the message");
});

test("records what was blocked, for comparison with the real build", async () => {
  const { client, logger } = build();
  await assert.rejects(() => client.fetch("https://api.telegram.org/bot1/sendMessage", { method: "POST", body: '{"text":"co tien"}' }));
  assert.equal(client.blocked.length, 1);
  assert.match(client.blocked[0]!.action, /Telegram/);
  assert.match(client.blocked[0]!.body, /co tien/);
  assert.ok(logger.has(/CHẶN/));
});

test("extra allow rules (our own Xeon) pass; everything else stays blocked", async () => {
  const logger = new MemoryLogger();
  const real: HttpClient = { async fetch() { return jsonResponse({ ok: true }); } };
  const client = new TrialModeHttpClient({ real, logger, allowAlso: [{ label: "Xeon", matches: (url) => url.startsWith("https://xeon.test/") }] });
  assert.equal((await client.fetch("https://xeon.test/tin-den", { method: "POST", body: "{}" })).ok, true);
  await assert.rejects(() => client.fetch("https://api.telegram.org/bot1/sendMessage", { method: "POST" }), /Chế độ thử/);
});
