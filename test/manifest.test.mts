/**
 * The manifest validator: every rule has a test that breaks when the rule is dropped.
 *
 * Decided 12/09/2026: each route declares who may call it. The price is one line per route; the
 * gain is that nobody ever forgets an access check again, and one table shows every open door.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCESS, validateManifest, tablePrefixFor, type AnyManifest } from "../dist/contract/index.js";

const ok = () => ({ status: 200, body: { ok: true } });
const base: AnyManifest = { id: "thu", name: "Thử", tier: "van-hanh", runsOn: "server-khach", version: "0.0.1" };
const check = (extra: Partial<AnyManifest>) => () => validateManifest({ ...base, ...extra }, "thu");

test("BREAKS when a route forgets `access`", () => {
  assert.throws(check({ routes: [{ method: "GET", path: "/api/quen", handle: ok } as never] }), /must declare `access`/);
});

test("BREAKS when a public route cannot say why it is safe", () => {
  assert.throws(check({ routes: [{ method: "GET", path: "/api/mo", access: ACCESS.public, handle: ok }] }), /must explain its own protection/);
});

test("BREAKS when a public route has no rate limit", () => {
  assert.throws(
    check({ routes: [{ method: "GET", path: "/api/mo", access: ACCESS.public, whyPublic: "Test: fake route, reads nothing.", handle: ok }] }),
    /MUST declare `rateLimit`/
  );
});

test("BREAKS when the rate limit has the wrong shape", () => {
  const withLimit = (rateLimit: unknown) => check({ routes: [{ method: "GET", path: "/api/rieng", access: ACCESS.admin, rateLimit: rateLimit as never, handle: ok }] });
  assert.throws(withLimit({ calls: 0, windowMs: 1000 }), /rateLimit\.calls must be a positive integer/);
  assert.throws(withLimit({ calls: 10 }), /rateLimit\.windowMs must be a positive integer/);
  assert.throws(withLimit({ calls: 1.5, windowMs: 1000 }), /rateLimit\.calls must be a positive integer/);
  assert.doesNotThrow(withLimit({ calls: 10, windowMs: 1000 }));
});

test("BREAKS when `access` is a value outside the contract", () => {
  assert.throws(check({ routes: [{ method: "GET", path: "/api/la", access: "ai-cung-duoc" as never, handle: ok }] }), /must declare `access`/);
});

test("BREAKS when `bodyLimit` is not a positive integer", () => {
  const withLimit = (bodyLimit: unknown) => check({ routes: [{ method: "POST", path: "/api/x", access: ACCESS.admin, bodyLimit: bodyLimit as never, handle: ok }] });
  for (const bad of [0, -1, 1.5, "10MB"]) assert.throws(withLimit(bad), /bodyLimit/);
  assert.doesNotThrow(withLimit(10 * 1024 * 1024));
});

test("feature ids: module and route must be feature ids; `feature: false` exempts a route", () => {
  assert.throws(check({ feature: "Sai Manh" }), /module `feature`/);
  assert.throws(check({ routes: [{ method: "GET", path: "/x", access: ACCESS.admin, feature: 5 as never, handle: ok }] }), /`feature` must be a feature id or false/);
  assert.doesNotThrow(check({ feature: "van-chuyen", routes: [{ method: "GET", path: "/x", access: ACCESS.admin, feature: false, handle: ok }] }));
});

test("BREAKS when a bot tool carries the money effect", () => {
  assert.throws(check({ botTools: [{ ten: "chuyen_khoan", hieuUng: "tien" }] }), /must never spend money/);
  assert.doesNotThrow(check({ botTools: [{ ten: "tra_cuu", hieuUng: "doc" }] }));
});

test("services: names look like <own id>.<name>; a module cannot require its own service or list one twice", () => {
  assert.throws(check({ provides: { "khac.read": () => 1 } }), /must start with the module's own id/);
  assert.throws(check({ provides: { "thu.Read": () => 1 } }), /must look like/);
  assert.throws(check({ requires: ["thu.read"] }), /requires its own service/);
  assert.throws(check({ requires: ["hai.read"], requiresOptional: ["hai.read"] }), /both required and optional/);
  assert.doesNotThrow(check({ provides: { "thu.read": () => 1 }, requires: ["hai.read"], requiresOptional: ["ba.read"] }));
});

test("tables: new tables carry the module prefix, inherited ones must be declared, step names are unique", () => {
  assert.equal(tablePrefixFor("hang-kho"), "hang_kho_");
  assert.throws(check({ schema: [{ name: "001", tables: ["orders"], sql: "SELECT 1" }] }), /must start with "thu_"/);
  assert.doesNotThrow(check({ inheritedTables: ["orders"], schema: [{ name: "001", tables: ["orders", "thu_x"], sql: "SELECT 1" }] }));
  assert.throws(check({ inheritedTables: ["orders", "orders"] }), /declared twice/);
  assert.throws(check({ schema: [{ name: "001", tables: ["thu_a"], sql: "SELECT 1" }, { name: "001", tables: ["thu_b"], sql: "SELECT 1" }] }), /share the name/);
  assert.throws(check({ schema: [{ name: "001", tables: [], sql: "SELECT 1" }] }), /must list the `tables`/);
});

test("ports and identity: unknown port, bad tier, bad run target, bad id", () => {
  assert.throws(check({ ports: ["disk" as never] }), /unknown port/);
  assert.throws(check({ tier: "vip" as never }), /`tier` must be one of/);
  assert.throws(check({ runsOn: "laptop" as never }), /`runsOn` must be one of/);
  assert.throws(check({ id: "Thu Module" }), /id must be lower-case-hyphenated/);
  assert.throws(() => validateManifest(null, "x"), /not an object/);
});
