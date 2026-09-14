/**
 * Rate limiting — and the tests that break it.
 *
 * The old site had it; the first split lost it while cutting modules out. This file exists so it
 * is never lost again.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ACCESS, FakeHttpClient, FixedWindowRateLimiter, JsonFileStore, Kernel, ManualClock, MemoryLogger, ROLE, TokenAuth,
  callerAddress, type Access, type RateLimitSpec
} from "../dist/index.js";

const ADMIN = "ma-quan-tri";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "rate-"));

/** `unlimited: true` = the route declares no limit. (Not `rateLimit: undefined` — a default would sneak in and test something else.) */
function build({ rateLimit = { calls: 3, windowMs: 60000 }, unlimited = false, access = ACCESS.public as Access, trustProxy = false }: { rateLimit?: RateLimitSpec; unlimited?: boolean; access?: Access; trustProxy?: boolean } = {}) {
  const clock = new ManualClock();
  const logger = new MemoryLogger();
  const limiter = new FixedWindowRateLimiter(clock);
  const kernel = new Kernel({
    ports: { store: new JsonFileStore(tmp()), logger, clock, http: new FakeHttpClient(), auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }], clock }), rateLimiter: limiter },
    logger, trustProxy,
    modules: [{
      id: "thu", name: "Thử", tier: "van-hanh", runsOn: "server-khach", version: "0.0.1",
      routes: [{ method: "POST", path: "/api/thu", access, ...(unlimited ? {} : { rateLimit }), whyPublic: "Test: fake route, reads nothing.", handle: () => ({ status: 200, body: { ok: true } }) }]
    }]
  });
  const call = (ip = "1.2.3.4", headers: Record<string, string> = {}) => kernel.handle({ method: "POST", path: "/api/thu", headers, ip, json: async () => ({}) });
  return { kernel, call, clock, logger, limiter };
}

test("past the limit: 429 with Retry-After, and the module is not called", async () => {
  const { call } = build({ rateLimit: { calls: 3, windowMs: 60000 } });
  for (let i = 0; i < 3; i += 1) assert.equal((await call()).status, 200, `call ${i + 1} must pass`);
  const fourth = await call();
  assert.equal(fourth.status, 429);
  assert.equal((fourth.body as { error: string }).error, "qua_nhieu");
  assert.ok(Number(fourth.headers!["Retry-After"]) > 0, "must say how long to wait");
});

test("the count restarts when the window ends", async () => {
  const { call, clock } = build({ rateLimit: { calls: 2, windowMs: 60000 } });
  await call(); await call();
  assert.equal((await call()).status, 429);
  clock.advance(60001);
  assert.equal((await call()).status, 200);
});

test("counted PER CALLER: a flooder does not block a real customer", async () => {
  const { call } = build({ rateLimit: { calls: 2, windowMs: 60000 } });
  await call("9.9.9.9"); await call("9.9.9.9");
  assert.equal((await call("9.9.9.9")).status, 429);
  assert.equal((await call("1.1.1.1")).status, 200);
});

test("counted PER ROUTE: blocking one route leaves another open", async () => {
  const clock = new ManualClock();
  const shared = { access: ACCESS.public, rateLimit: { calls: 1, windowMs: 60000 }, whyPublic: "Test: fake route.", handle: () => ({ status: 200, body: {} }) };
  const kernel = new Kernel({
    ports: { store: new JsonFileStore(tmp()), logger: new MemoryLogger(), clock, http: new FakeHttpClient(), auth: new TokenAuth({ clock }), rateLimiter: new FixedWindowRateLimiter(clock) },
    modules: [{ id: "thu", name: "Thử", tier: "van-hanh", runsOn: "server-khach", version: "0.0.1", routes: [{ method: "GET", path: "/api/mot", ...shared }, { method: "GET", path: "/api/hai", ...shared }] }]
  });
  const get = (p: string) => kernel.handle({ method: "GET", path: p, ip: "5.5.5.5" });
  assert.equal((await get("/api/mot")).status, 200);
  assert.equal((await get("/api/mot")).status, 429);
  assert.equal((await get("/api/hai")).status, 200);
});

test("the limit runs BEFORE auth: guessing tokens is rate limited too", async () => {
  const { call } = build({ access: ACCESS.admin, rateLimit: { calls: 2, windowMs: 60000 } });
  assert.equal((await call("7.7.7.7")).status, 401);
  assert.equal((await call("7.7.7.7")).status, 401);
  assert.equal((await call("7.7.7.7")).status, 429);
});

test("a route without a limit is never blocked", async () => {
  const { call } = build({ access: ACCESS.admin, unlimited: true });
  for (let i = 0; i < 20; i += 1) assert.notEqual((await call("8.8.8.8", { authorization: `Bearer ${ADMIN}` })).status, 429);
});

test("behind a proxy: headers are trusted only with trustProxy; first hop of x-forwarded-for wins; unknown callers still count", () => {
  const request = { ip: "10.0.0.1", headers: { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "203.0.113.9, 10.0.0.1" } };
  assert.equal(callerAddress(request, { trustProxy: false }), "10.0.0.1", "without trustProxy anyone could claim an IP");
  assert.equal(callerAddress(request, { trustProxy: true }), "203.0.113.9");
  assert.equal(callerAddress({ ip: "10.0.0.1", headers: { "x-forwarded-for": " 203.0.113.9 , 70.41.3.18 , 10.0.0.1 " } }, { trustProxy: true }), "203.0.113.9");
  assert.equal(callerAddress({ headers: {} }, { trustProxy: true }), "khong-ro");
});

test("memory stays bounded", () => {
  const limiter = new FixedWindowRateLimiter(new ManualClock(), 100);
  for (let i = 0; i < 500; i += 1) limiter.hit(`khoa-${i}`, 10, 60000);
  assert.ok(limiter.size() <= 100, `grew to ${limiter.size()}`);
});
