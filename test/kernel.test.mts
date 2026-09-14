/**
 * The kernel's guard chain and loading rules — each with the test that breaks it when violated.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ACCESS, ERROR_CODES, FakeHttpClient, FixedWindowRateLimiter, JsonFileStore, Kernel, ManualClock, MemoryLogger, ROLE,
  TokenAuth, defineModule, type AnyManifest, type IncomingRequest, type KernelPorts
} from "../dist/index.js";

const ADMIN = "ma-quan-tri";
const SERVICE = "ma-dich-vu";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "kernel-"));

function fakePorts(overrides: Partial<KernelPorts> = {}): KernelPorts {
  const clock = new ManualClock();
  return {
    store: new JsonFileStore(tmp()), logger: new MemoryLogger(), clock, http: new FakeHttpClient(),
    auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }, { token: SERVICE, name: "bo-nao", role: ROLE.service }], clock }),
    rateLimiter: new FixedWindowRateLimiter(clock),
    ...overrides
  };
}

const ok = () => ({ status: 200, body: { ok: true } });
const base = { id: "thu", name: "Thử", tier: "van-hanh" as const, runsOn: "server-khach" as const, version: "0.0.1" };
const get = (path: string, token?: string): IncomingRequest => ({ method: "GET", path, headers: token ? { authorization: `Bearer ${token}` } : {} });

test("admin route: no token 401, service token 401, admin token passes", async () => {
  const kernel = new Kernel({ ports: fakePorts(), modules: [{ ...base, routes: [{ method: "GET", path: "/api/rieng", access: ACCESS.admin, handle: ok }] }] });
  assert.equal((await kernel.handle(get("/api/rieng"))).status, 401);
  assert.equal((await kernel.handle(get("/api/rieng", SERVICE))).status, 401, "the brain must not enter an admin route");
  assert.equal((await kernel.handle(get("/api/rieng", ADMIN))).status, 200);
});

test("service route: the brain passes, admin passes too, nobody else", async () => {
  const kernel = new Kernel({ ports: fakePorts(), modules: [{ ...base, routes: [{ method: "GET", path: "/api/bo-nao", access: ACCESS.service, handle: ok }] }] });
  assert.equal((await kernel.handle(get("/api/bo-nao"))).status, 401);
  assert.equal((await kernel.handle(get("/api/bo-nao", SERVICE))).status, 200);
  assert.equal((await kernel.handle(get("/api/bo-nao", ADMIN))).status, 200, "admin is the higher level");
});

test("a wrong token fails even at the right length; three credential places all work", async () => {
  const kernel = new Kernel({ ports: fakePorts(), modules: [{ ...base, routes: [{ method: "GET", path: "/api/rieng", access: ACCESS.admin, handle: ok }] }] });
  assert.equal((await kernel.handle(get("/api/rieng", "ma-quan-TRI"))).status, 401);
  assert.equal((await kernel.handle(get("/api/rieng", "x".repeat(ADMIN.length)))).status, 401);
  assert.equal((await kernel.handle({ method: "GET", path: "/api/rieng", headers: { "x-landing-token": ADMIN } })).status, 200);
  assert.equal((await kernel.handle({ method: "GET", path: "/api/rieng", query: { token: ADMIN } })).status, 200);
});

test("no key configured at all: everything is refused (fail closed)", async () => {
  const clock = new ManualClock();
  const kernel = new Kernel({ ports: fakePorts({ auth: new TokenAuth({ clock }) }), modules: [{ ...base, routes: [{ method: "GET", path: "/api/rieng", access: ACCESS.admin, handle: ok }] }] });
  assert.equal((await kernel.handle(get("/api/rieng", ADMIN))).status, 401);
});

test("a public route is reachable without a token", async () => {
  const kernel = new Kernel({ ports: fakePorts(), modules: [{ ...base, routes: [{ method: "GET", path: "/api/mo", access: ACCESS.public, whyPublic: "Test: reads no shop data.", rateLimit: { calls: 100, windowMs: 60000 }, handle: ok }] }] });
  assert.equal((await kernel.handle(get("/api/mo"))).status, 200);
});

test("404 for an unknown path, 405 for a wrong method", async () => {
  const kernel = new Kernel({ ports: fakePorts(), modules: [{ ...base, routes: [{ method: "GET", path: "/api/co", access: ACCESS.public, whyPublic: "Test: fake route.", rateLimit: { calls: 100, windowMs: 60000 }, handle: ok }] }] });
  assert.equal((await kernel.handle(get("/api/khong"))).status, 404);
  assert.equal((await kernel.handle({ method: "POST", path: "/api/co" })).status, 405);
});

test("a crashing module answers 500 and is logged; the kernel survives", async () => {
  const logger = new MemoryLogger();
  const kernel = new Kernel({
    ports: fakePorts({ logger }), logger,
    modules: [{ ...base, routes: [{ method: "GET", path: "/api/no", access: ACCESS.public, whyPublic: "Test: fake route.", rateLimit: { calls: 100, windowMs: 60000 }, handle: () => { throw new Error("vo"); } }] }]
  });
  const r = await kernel.handle(get("/api/no"));
  assert.equal(r.status, 500);
  assert.equal((r.body as { error: string }).error, ERROR_CODES.internal);
  assert.ok(logger.has(/vo/));
});

test("BREAKS when two modules declare the same route", () => {
  const routes: AnyManifest["routes"] = [{ method: "GET", path: "/api/thu", access: ACCESS.public, whyPublic: "Test: fake route.", rateLimit: { calls: 100, windowMs: 60000 }, handle: ok }];
  assert.throws(
    () => new Kernel({ ports: fakePorts(), modules: [{ ...base, id: "mot", routes }, { ...base, id: "hai", routes }] }),
    /declared twice/
  );
});

test("BREAKS when a module asks for a port the kernel lacks; an undeclared port throws at the line using it", async () => {
  assert.throws(
    () => new Kernel({ ports: { logger: new MemoryLogger() }, modules: [{ ...base, ports: ["store"] }] }),
    /asks for port "store"/
  );
  let caught = "";
  const kernel = new Kernel({
    ports: fakePorts(),
    modules: [{ ...base, ports: ["logger"], routes: [{ method: "GET", path: "/api/len", access: ACCESS.public, whyPublic: "Test: fake route.", rateLimit: { calls: 100, windowMs: 60000 }, handle: (ctx) => { try { ctx.ports.store.document("x"); } catch (e) { caught = (e as Error).message; } return ok(); } }] }]
  });
  await kernel.handle(get("/api/len"));
  assert.match(caught, /without declaring it/);
});

test("BREAKS when a module emits an event it did not declare", async () => {
  let caught = "";
  const kernel = new Kernel({
    ports: fakePorts(),
    modules: [{ ...base, ports: ["bus"], events: { emits: ["thu.viec-a"] }, routes: [{ method: "GET", path: "/api/phat", access: ACCESS.public, whyPublic: "Test: fake route.", rateLimit: { calls: 100, windowMs: 60000 }, handle: (ctx) => { try { ctx.bus.emit("thu.viec-la", {}); } catch (e) { caught = (e as Error).message; } return ok(); } }] }]
  });
  await kernel.handle(get("/api/phat"));
  assert.match(caught, /without declaring it in `events.emits`/);
});

test("BREAKS when a module requires a service of a module that is off; optional services just switch the part off", () => {
  assert.throws(
    () => new Kernel({ ports: fakePorts(), modules: [{ ...base, requires: ["hai.read"] }] }),
    /requires service "hai\.read"/
  );
  const logger = new MemoryLogger();
  assert.doesNotThrow(() => new Kernel({ ports: fakePorts({ logger }), logger, modules: [{ ...base, requiresOptional: ["hai.read"] }] }));
  assert.ok(logger.has(/"hai\.read" không có/));
});

test("services are wired even when the provider loads AFTER the consumer, with the provider's ctx bound in", async () => {
  interface HaiServices { "hai": { read(code: string): { code: string; text: string } } }
  const mot = defineModule<Record<string, never>, HaiServices>({
    ...base, id: "mot", requires: ["hai.read"],
    routes: [{ method: "GET", path: "/api/hoi", access: ACCESS.public, whyPublic: "Test: fake route.", rateLimit: { calls: 100, windowMs: 60000 }, handle: (ctx) => ({ status: 200, body: ctx.services.hai.read("D1") }) }]
  });
  const hai = defineModule({ ...base, id: "hai", provides: { "hai.read": (ctx, code: string) => ({ code, text: `don ${code} cua ${ctx.id}` }) } });
  const kernel = new Kernel({ ports: fakePorts(), modules: [mot, hai] });
  assert.deepEqual((await kernel.handle(get("/api/hoi"))).body, { code: "D1", text: "don D1 cua hai" });
  assert.deepEqual(kernel.serviceTable(), [{ name: "hai.read", moduleId: "hai" }]);
});

test("BREAKS when two modules claim the same table", () => {
  assert.throws(
    () => new Kernel({ ports: fakePorts(), modules: [{ ...base, id: "mot", inheritedTables: ["orders"] }, { ...base, id: "hai", inheritedTables: ["orders"] }] }),
    /claimed by two modules/
  );
});

test("the kernel refuses a module that does not run on the merchant server", () => {
  assert.throws(() => new Kernel({ ports: fakePorts(), modules: [{ ...base, runsOn: "omi" }] }), /runs on "omi"/);
});

test("route params: one segment and the wildcard rest; wildcard routes never swallow exact ones", async () => {
  const kernel = new Kernel({
    ports: fakePorts(),
    modules: [{
      ...base,
      routes: [
        { method: "GET", path: "/*", access: ACCESS.public, whyPublic: "Test: fake storefront.", rateLimit: { calls: 100, windowMs: 60000 }, handle: (_c, r) => ({ status: 200, body: { rest: r.params["rest"] } }) },
        { method: "GET", path: "/api/products/:code", access: ACCESS.public, whyPublic: "Test: fake route.", rateLimit: { calls: 100, windowMs: 60000 }, handle: (_c, r) => ({ status: 200, body: { code: r.params["code"] } }) }
      ]
    }]
  });
  assert.deepEqual((await kernel.handle(get("/api/products/DV%201"))).body, { code: "DV 1" });
  assert.deepEqual((await kernel.handle(get("/assets/x/y.png"))).body, { rest: "assets/x/y.png" });
});

test("default status: 200 for a body, 302 for a redirect; the bus delivers to listeners", async () => {
  const seen: unknown[] = [];
  const kernel = new Kernel({
    ports: fakePorts(),
    modules: [{
      ...base, ports: ["bus"], events: { emits: ["thu.x"], listens: { "thu.x": (_ctx, payload) => { seen.push(payload); } } },
      routes: [
        { method: "GET", path: "/di", access: ACCESS.public, whyPublic: "Test: fake route.", rateLimit: { calls: 100, windowMs: 60000 }, handle: () => ({ redirect: "/x" }) },
        { method: "GET", path: "/phat", access: ACCESS.public, whyPublic: "Test: fake route.", rateLimit: { calls: 100, windowMs: 60000 }, handle: (ctx) => { ctx.bus.emit("thu.x", { a: 1 }); return { body: { ok: true } }; } }
      ]
    }]
  });
  assert.equal((await kernel.handle(get("/di"))).status, 302);
  assert.equal((await kernel.handle(get("/phat"))).status, 200);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(seen, [{ a: 1 }]);
  assert.deepEqual(kernel.bus.listenerMap(), { "thu.x": ["thu"] });
});
