/**
 * The landing registers with Xeon by its licence key — at install time and at runtime.
 *
 * After registering: the auth port verifies tickets, the inbox pushes messages to the right Xeon
 * with the private inbox token, and the admin screen shows which shop this landing is WITHOUT
 * showing the token.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  FixedWindowRateLimiter, MemoryUploadPort, MemoryMailer, JsonFileStore, Kernel, ManualClock, MemoryLogger, ROLE, TokenAuth, TrialModeHttpClient, buildLandingApp,
  generateSigningKey, jsonResponse, loadEnvFile, readXeonRegistration, registerWithXeon, saveXeonRegistration, signTicket, summariseXeonRegistration,
  type HttpClient, type HttpRequestInit, type IncomingRequest, type SigningKeyPair
} from "../dist/index.js";
import { manifest as platform } from "../dist/modules/khung-nen-tang/module.js";
import { manifest as inbox } from "../dist/modules/hop-thu/module.js";

const ADMIN = "ma-quan-tri";
const KEY = "TR-ABCD-EFGH-JKLM-NPQR";
const XEON = "https://xeon.test";
const APP_SECRET = "app-secret-thu";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "xeon-reg-"));

/** A fake Xeon: answers registration with a public key + inbox token, records every call. */
function fakeXeon({ signingKey = generateSigningKey(), refuse = null as string | null } = {}) {
  const calls: { url: string; init: HttpRequestInit }[] = [];
  const http: HttpClient = {
    async fetch(url, init = {}) {
      calls.push({ url: String(url), init });
      if (String(url) === `${XEON}/license/landing-dang-ky`) {
        const body = JSON.parse(String(init.body || "{}")) as { key: string };
        if (refuse) return jsonResponse({ ok: false, viSao: refuse }, 403);
        return jsonResponse({ ok: true, shop: "toprun", tenShop: "TopRun", keyId: signingKey.keyId, khoaCongPem: signingKey.khoaCongPem, maNhanTin: `nt-${body.key.slice(-4)}-xxxxxxxxxxxxxxxxxxxx`, diaChiXeon: XEON });
      }
      return jsonResponse({ ok: true });
    }
  };
  return { signingKey, calls, http };
}

test("registerWithXeon: validates input, calls the right door, returns the full record; a refusal names the reason", async () => {
  const x = fakeXeon();
  await assert.rejects(() => registerWithXeon({ http: x.http, xeonAddress: "ftp://x", key: KEY, landingAddress: "https://shop.vn" }), /Địa chỉ Xeon/);
  await assert.rejects(() => registerWithXeon({ http: x.http, xeonAddress: XEON, key: "sai", landingAddress: "https://shop.vn" }), /License key/);
  await assert.rejects(() => registerWithXeon({ http: x.http, xeonAddress: XEON, key: KEY, landingAddress: "" }), /LANDING_SITE_BASE_URL/);
  assert.equal(x.calls.length, 0, "bad input never touches the network");

  const r = await registerWithXeon({ http: x.http, xeonAddress: `${XEON}/`, key: ` ${KEY.toLowerCase()} `, landingAddress: "https://shop.vn/" });
  assert.equal(x.calls[0]!.url, `${XEON}/license/landing-dang-ky`);
  assert.deepEqual(JSON.parse(String(x.calls[0]!.init.body)), { key: KEY, diaChi: "https://shop.vn" });
  assert.equal(r.shop, "toprun");
  assert.equal(r.keyId, x.signingKey.keyId);
  assert.match(r.maNhanTin, /^nt-/);
  assert.equal(r.diaChiXeon, XEON);
  assert.equal(r.key, KEY);

  const refused = fakeXeon({ refuse: "key_bi_khoa" });
  await assert.rejects(() => registerWithXeon({ http: refused.http, xeonAddress: XEON, key: KEY, landingAddress: "https://shop.vn" }), /key_bi_khoa/);
});

test("the stored registration round-trips; the summary carries neither the inbox token nor the key", async () => {
  const store = new JsonFileStore(tmp());
  assert.equal(await readXeonRegistration(store), null);
  await saveXeonRegistration(store, { key: KEY, shop: "toprun", tenShop: "", keyId: "ky-1", khoaCongPem: "PEM", maNhanTin: "nt-bi-mat", diaChiXeon: XEON, diaChiLanding: "https://shop.vn" }, new Date("2026-09-14T00:00:00.000Z"));
  const doc = await readXeonRegistration(store);
  assert.equal(doc!.maNhanTin, "nt-bi-mat");
  assert.equal(doc!.dangKyLuc, "2026-09-14T00:00:00.000Z");
  const summary = JSON.stringify(summariseXeonRegistration(doc));
  assert.ok(!summary.includes("nt-bi-mat"));
  assert.ok(!summary.includes(KEY));
});

function buildKernel({ http, store = new JsonFileStore(tmp()) }: { http: HttpClient; store?: JsonFileStore }) {
  const clock = new ManualClock();
  const logger = new MemoryLogger();
  const auth = new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }], clock, logger });
  const kernel = new Kernel({
    ports: { store, logger, clock, http, auth, rateLimiter: new FixedWindowRateLimiter(clock), uploads: new MemoryUploadPort(), mail: new MemoryMailer() },
    logger, modules: [platform, inbox],
    config: {
      "khung-nen-tang": { deployId: "thu", xeonAddress: XEON, landingAddress: "https://shop.vn" },
      "hop-thu": { verifyToken: "v", appSecret: APP_SECRET, pageToken: "tk" }
    }
  });
  const call = (method: string, p: string, { token = ADMIN as string | null, body }: { token?: string | null; body?: unknown } = {}) => kernel.handle({
    method, path: p, ip: "1.1.1.1", headers: token ? { authorization: `Bearer ${token}` } : {}, json: async () => body ?? {}
  });
  return { kernel, call, clock, logger, auth, store };
}

/** Every delivery is a NEW message: the inbox files a message id once and never answers it twice. */
let metaWebhookCount = 0;

/** A Meta webhook delivery signed with the app secret. Timestamp near the fake clock: older than 24 h is deliberately not forwarded. */
function metaWebhook(text = "còn size 42 không"): IncomingRequest {
  const at = Date.parse("2026-09-12T00:00:00.000Z");
  metaWebhookCount += 1;
  const payload = { object: "page", entry: [{ id: "trang-1", time: at, messaging: [{ sender: { id: "khach-1" }, recipient: { id: "trang-1" }, timestamp: at, message: { mid: `m.${metaWebhookCount}`, text } }] }] };
  const raw = Buffer.from(JSON.stringify(payload), "utf8");
  const signature = `sha256=${crypto.createHmac("sha256", APP_SECRET).update(raw).digest("hex")}`;
  return { method: "POST", path: "/api/facebook/webhook", ip: "3.3.3.3", headers: { "x-hub-signature-256": signature }, raw: async () => raw, json: async () => payload };
}

test("full loop: register through the admin screen -> auth gets Xeon's key -> tickets enter -> the inbox pushes to Xeon with the private token", async () => {
  const x = fakeXeon();
  const { kernel, call, clock, auth } = buildKernel({ http: x.http });

  const before = await call("GET", "/api/admin/xeon");
  assert.equal(before.status, 200);
  assert.equal((before.body as { xeon: unknown }).xeon, null);
  assert.equal((before.body as { toi: { bang: string } }).toi.bang, "khoa-dai-han");

  // A ticket before registration: refused.
  const t = clock.now().getTime();
  const ticket = signTicket({ vai: "quan-tri", shop: "toprun", tenShop: "TopRun", maMay: "may-1-xxxxxxxxxxxxxxxx", tenMay: "may 1", manh: ["hop-thu"], truc: true, phatLuc: t, hetLuc: t + 3600 * 1000 }, x.signingKey);
  assert.equal((await call("GET", "/api/admin/xeon", { token: ticket })).status, 401);

  // The inbox has no Xeon yet: nothing is pushed.
  assert.equal((await kernel.handle(metaWebhook())).status, 200);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(x.calls.filter((c) => c.url.endsWith("/tin-den")).length, 0);

  const registered = await call("POST", "/api/admin/xeon/dang-ky", { body: { key: KEY } });
  assert.equal(registered.status, 200, JSON.stringify(registered.body));
  assert.equal((registered.body as { xeon: { shop: string } }).xeon.shop, "toprun");
  assert.ok(!JSON.stringify(registered.body).includes("nt-"), "the inbox token never reaches the screen");
  assert.equal(auth.hasXeon(), true);

  const after = await call("GET", "/api/admin/xeon", { token: ticket });
  assert.equal(after.status, 200, "the ticket enters once registered");
  const me = (after.body as { toi: { bang: string; manh: string[]; truc: boolean }; xeon: { diaChiXeon: string } });
  assert.equal(me.toi.bang, "ve-xeon");
  assert.deepEqual(me.toi.manh, ["hop-thu"]);
  assert.equal(me.toi.truc, true);
  assert.equal(me.xeon.diaChiXeon, XEON);

  assert.equal((await kernel.handle(metaWebhook())).status, 200);
  await new Promise((r) => setTimeout(r, 20));
  const pushed = x.calls.find((c) => c.url.endsWith("/tin-den"));
  assert.ok(pushed, "the message must be pushed to Xeon");
  assert.equal(pushed.url, `${XEON}/tin-den`);
  assert.match(String(pushed.init.headers?.["Authorization"]), /^Bearer nt-/);
  assert.equal((JSON.parse(String(pushed.init.body)) as { tenant: string }).tenant, "toprun");

  // Registering again with a bad key: 502, the old registration stays.
  assert.equal((await call("POST", "/api/admin/xeon/dang-ky", { body: { key: "sai" } })).status, 502);
  assert.equal(((await call("GET", "/api/admin/xeon")).body as { xeon: { shop: string } }).xeon.shop, "toprun");
});

test("trial mode: calls to our own Xeon pass; other destinations stay blocked", async () => {
  const x = fakeXeon();
  const wrapped = new TrialModeHttpClient({ real: x.http, logger: new MemoryLogger(), allowAlso: [{ label: "Xeon", matches: (url) => url.startsWith(`${XEON}/`) }] });
  assert.equal((await wrapped.fetch(`${XEON}/tin-den`, { method: "POST", body: "{}" })).ok, true);
  await assert.rejects(() => wrapped.fetch("https://api.telegram.org/bot1/sendMessage", { method: "POST" }), /Chế độ thử/);
});

test("real startup (buildLandingApp): reads .env, registers with LICENSE_KEY, does not re-register with the same key, re-registers when the key changes", async () => {
  const dir = tmp();
  const envFile = path.join(dir, ".env");
  fs.writeFileSync(envFile, `LICENSE_KEY="${KEY}"\nXEON_DIA_CHI=${XEON}\nLANDING_SITE_BASE_URL=https://shop.vn\n# ghi chu\nLANDING_ADMIN_TOKEN=${ADMIN}\n`);
  const env: Record<string, string | undefined> = {};
  assert.equal(loadEnvFile(envFile, env), 4);
  assert.equal(env["LICENSE_KEY"], KEY, "quotes are stripped");

  // The app registers through the real FetchHttpClient, which resolves `globalThis.fetch` at call time.
  const originalFetch = globalThis.fetch;
  const calls: { url: string; body: { key: string } }[] = [];
  const signingKey: SigningKeyPair = generateSigningKey();
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body || "{}")) });
    return new Response(JSON.stringify({ ok: true, shop: "toprun", tenShop: "TopRun", keyId: signingKey.keyId, khoaCongPem: signingKey.khoaCongPem, maNhanTin: "nt-thu-xxxxxxxxxxxxxxxxxxxx", diaChiXeon: XEON }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const quiet = new MemoryLogger();
  try {
    const missing = path.join(dir, "khong-co.env");
    const first = await buildLandingApp({ dataDirectory: dir, env: { ...env }, envFile: missing, logger: quiet });
    assert.equal(calls.length, 1);
    assert.equal(first.xeon!.shop, "toprun");
    assert.equal(first.auth.hasXeon(), true);

    const second = await buildLandingApp({ dataDirectory: dir, env: { ...env }, envFile: missing, logger: quiet });
    assert.equal(calls.length, 1, "same key: no second registration");
    assert.equal(second.xeon!.keyId, signingKey.keyId);

    const third = await buildLandingApp({ dataDirectory: dir, env: { ...env, LICENSE_KEY: "TR-ZZZZ-ZZZZ-ZZZZ-ZZZZ" }, envFile: missing, logger: quiet });
    assert.equal(calls.length, 2, "a changed key registers again");
    assert.equal(calls[1]!.body.key, "TR-ZZZZ-ZZZZ-ZZZZ-ZZZZ");
    assert.equal(third.xeon!.key, "TR-ZZZZ-ZZZZ-ZZZZ-ZZZZ");

    // No key at all: the server still starts and only reports what is OFF.
    const fourth = await buildLandingApp({ dataDirectory: tmp(), env: {}, envFile: missing, logger: quiet });
    assert.equal(fourth.xeon, null);
    assert.equal(fourth.auth.hasXeon(), false);
    assert.ok(quiet.has(/ĐANG TẮT: OMI/));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Xeon forgot our inbox token (registered again elsewhere): the inbox registers again and resends once; spaced out so two landings cannot fight in a loop", async () => {
  const signingKey = generateSigningKey();
  let issued = 0;
  let valid = "";
  const calls: { url: string; init: HttpRequestInit }[] = [];
  const http: HttpClient = {
    async fetch(url, init = {}) {
      calls.push({ url: String(url), init });
      if (String(url) === `${XEON}/license/landing-dang-ky`) {
        issued += 1;
        valid = `nt-lan-${issued}-xxxxxxxxxxxxxxxxxxxx`;
        return jsonResponse({ ok: true, shop: "toprun", tenShop: "TopRun", keyId: signingKey.keyId, khoaCongPem: signingKey.khoaCongPem, maNhanTin: valid, diaChiXeon: XEON });
      }
      if (String(url) === `${XEON}/tin-den`) {
        return String(init.headers?.["Authorization"]) === `Bearer ${valid}` ? jsonResponse({ ok: true }) : jsonResponse({ ok: false, error: "thieu_ma" }, 401);
      }
      return jsonResponse({ ok: true });
    }
  };
  const { kernel, call, clock, logger, store } = buildKernel({ http });
  assert.equal((await call("POST", "/api/admin/xeon/dang-ky", { body: { key: KEY } })).status, 200);

  // Someone else registers the same key: Xeon now holds a token this landing never saw.
  valid = "nt-cua-landing-khac-xxxxxxxxxxxx";
  const pushes = () => calls.filter((c) => c.url.endsWith("/tin-den")).map((c) => String(c.init.headers?.["Authorization"]));

  assert.equal((await kernel.handle(metaWebhook())).status, 200);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(pushes(), ["Bearer nt-lan-1-xxxxxxxxxxxxxxxxxxxx", "Bearer nt-lan-2-xxxxxxxxxxxxxxxxxxxx"], "refused once, registered again, resent with the new token");
  assert.equal((await readXeonRegistration(store))!.maNhanTin, "nt-lan-2-xxxxxxxxxxxxxxxxxxxx", "the new token is stored");
  assert.ok(!logger.has(/bo nao tu choi tin/), "the resend went through");

  // Taken again right away: no second re-registration inside the gap — the message is only refused.
  valid = "nt-lai-bi-lay-xxxxxxxxxxxxxxxxxx";
  assert.equal((await kernel.handle(metaWebhook())).status, 200);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(issued, 2);
  assert.ok(logger.has(/bo nao tu choi tin: HTTP 401/));

  // After the gap it recovers again.
  clock.advance(61 * 1000);
  assert.equal((await kernel.handle(metaWebhook())).status, 200);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(issued, 3);
  assert.equal(pushes().at(-1), "Bearer nt-lan-3-xxxxxxxxxxxxxxxxxxxx");
});
