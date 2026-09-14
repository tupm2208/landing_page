/**
 * Machine tickets signed by Xeon (decided 14/09/2026): the landing verifies with Xeon's public
 * key and refuses routes of features the shop has not bought.
 *
 * Tickets are SIGNED and VERIFIED through the same shared kit (`chung/ve-may.js`) so the two ends
 * can never drift apart in shape.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ACCESS, FakeHttpClient, FixedWindowRateLimiter, JsonFileStore, Kernel, ManualClock, MemoryLogger, ROLE, TokenAuth,
  generateSigningKey, signTicket, type AnyManifest, type Caller, type TicketClaims
} from "../dist/index.js";

const DESK = "ma-cua-sales-desk";
const SHOP = "toprun";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ticket-"));
const ok = () => ({ status: 200, body: { ok: true } });

function build({ registered = true } = {}) {
  const clock = new ManualClock();
  const logger = new MemoryLogger();
  const signingKey = generateSigningKey();
  const auth = new TokenAuth({
    keys: [{ token: DESK, name: "sales-desk", role: ROLE.admin }],
    xeon: registered ? { keyId: signingKey.keyId, publicKeyPem: signingKey.khoaCongPem, shop: SHOP } : null,
    clock, logger
  });
  const shipping: AnyManifest = {
    id: "van-chuyen-thu", name: "Thử VC", tier: "van-hanh", runsOn: "server-khach", version: "0.0.1", feature: "van-chuyen",
    routes: [
      { method: "GET", path: "/api/vc/rieng", access: ACCESS.admin, handle: ok },
      { method: "GET", path: "/api/vc/dich-vu", access: ACCESS.service, handle: ok },
      { method: "GET", path: "/api/vc/mien", access: ACCESS.admin, feature: false, handle: ok },
      { method: "GET", path: "/api/vc/ghi-de", access: ACCESS.admin, feature: "mua-ho", handle: ok }
    ]
  };
  const platform: AnyManifest = {
    id: "khong-manh", name: "Không mảnh", tier: "khung", runsOn: "server-khach", version: "0.0.1", ports: ["auth"],
    routes: [{ method: "GET", path: "/api/khung/toi", access: ACCESS.admin, handle: (ctx, request) => ({ status: 200, body: { ok: true, me: ctx.ports.auth.identify(request) } }) }]
  };
  const kernel = new Kernel({
    ports: { store: new JsonFileStore(tmp()), logger, clock, http: new FakeHttpClient(), auth, rateLimiter: new FixedWindowRateLimiter(clock) },
    logger, modules: [shipping, platform]
  });
  const get = (p: string, token?: string) => kernel.handle({ method: "GET", path: p, headers: token ? { authorization: `Bearer ${token}` } : {}, ip: "1.1.1.1" });
  const ticket = (claims: Partial<TicketClaims> = {}) => {
    const t = clock.now().getTime();
    return signTicket({ vai: "quan-tri", shop: SHOP, tenShop: "TopRun", maMay: "may-1-xxxxxxxxxxxxxxxxxx", tenMay: "may ban hang", manh: ["hang-kho", "van-chuyen"], truc: true, phatLuc: t, hetLuc: t + 7 * 3600 * 1000, ...claims }, signingKey);
  };
  const identify = (token: string) => auth.identify({ headers: { authorization: `Bearer ${token}` }, query: {} });
  return { kernel, get, ticket, clock, logger, auth, signingKey, identify };
}

test("a valid admin ticket enters admin routes; the caller carries shop:machine, features and duty; routes inherit the module's feature", async () => {
  const { kernel, get, ticket } = build();
  assert.equal((await get("/api/vc/rieng", ticket())).status, 200);
  const me = (await get("/api/khung/toi", ticket())).body as { me: Caller };
  assert.equal(me.me.role, "quan-tri");
  assert.equal(me.me.name, "toprun:may ban hang");
  assert.equal(me.me.via, "ve-xeon");
  assert.equal(me.me.onDuty, true);
  assert.deepEqual(me.me.features, ["hang-kho", "van-chuyen"]);
  const routes = kernel.routes();
  assert.equal(routes.find((r) => r.path === "/api/vc/rieng")!.feature, "van-chuyen", "inherits the module's feature");
  assert.equal(routes.find((r) => r.path === "/api/vc/mien")!.feature, null, "feature: false exempts");
  assert.equal(routes.find((r) => r.path === "/api/vc/ghi-de")!.feature, "mua-ho", "route overrides");
  assert.equal(routes.find((r) => r.path === "/api/khung/toi")!.feature, null);
});

test("feature gate: a ticket lacking the feature gets 403 naming it; exempt routes pass; Desk's key is not gated", async () => {
  const { get, ticket, logger } = build();
  const lacking = ticket({ manh: ["hang-kho"] });
  const r = await get("/api/vc/rieng", lacking);
  assert.equal(r.status, 403);
  assert.equal((r.body as { error: string }).error, "chua_mua_manh");
  assert.equal((r.body as { manh: string }).manh, "van-chuyen");
  assert.ok(logger.has(/chưa mua mảnh "van-chuyen"/));
  assert.equal((await get("/api/vc/mien", lacking)).status, 200);
  assert.equal((await get("/api/vc/ghi-de", ticket({ manh: ["hang-kho", "mua-ho"] }))).status, 200);
  assert.equal((await get("/api/vc/ghi-de", ticket({ manh: ["hang-kho", "van-chuyen"] }))).status, 403);
  assert.equal((await get("/api/vc/rieng", DESK)).status, 200);
});

test("a service ticket enters service routes only; an admin ticket enters both", async () => {
  const { get, ticket } = build();
  const service = ticket({ vai: "dich-vu", maMay: "xeon", tenMay: "bo-nao", truc: false });
  assert.equal((await get("/api/vc/dich-vu", service)).status, 200);
  assert.equal((await get("/api/vc/rieng", service)).status, 401);
  assert.equal((await get("/api/vc/dich-vu", ticket())).status, 200);
});

test("another shop's ticket, an expired ticket, a tampered signature, an unknown key: all 401 with the reason recorded", async () => {
  const { get, ticket, clock, identify, logger } = build();
  assert.equal((await get("/api/vc/rieng", ticket({ shop: "shop-b" }))).status, 401);
  assert.equal(identify(ticket({ shop: "shop-b" })).via, "ve-shop-khac");

  const valid = ticket();
  clock.advance(7 * 3600 * 1000 + 1000);
  assert.equal((await get("/api/vc/rieng", valid)).status, 401);
  assert.equal(identify(valid).via, "ve-het_han");
  clock.advance(-7 * 3600 * 1000);

  assert.equal(identify(`${valid.slice(0, -4)}AAAA`).via, "ve-chu_ky_sai");

  const other = generateSigningKey();
  const foreign = signTicket({ vai: "quan-tri", shop: SHOP, tenShop: "", maMay: "m", tenMay: "m", manh: [], truc: false, phatLuc: clock.now().getTime(), hetLuc: clock.now().getTime() + 1000 }, other);
  assert.equal(identify(foreign).via, "ve-khong_biet_khoa");
  assert.equal((await get("/api/vc/rieng", foreign)).status, 401);
  assert.ok(logger.has(/từ chối GET \/api\/vc\/rieng/));
});

test("before registering with Xeon every ticket is refused (fail closed); setXeon at runtime opens the door", async () => {
  const { get, ticket, auth, signingKey } = build({ registered: false });
  assert.equal(auth.hasXeon(), false);
  assert.equal(auth.identify({ headers: { authorization: `Bearer ${ticket()}` }, query: {} }).via, "chua-dang-ky-xeon");
  assert.equal((await get("/api/vc/rieng", ticket())).status, 401);
  assert.equal((await get("/api/vc/rieng", DESK)).status, 200, "long-lived keys still work");
  auth.setXeon({ keyId: signingKey.keyId, publicKeyPem: signingKey.khoaCongPem, shop: SHOP });
  assert.equal((await get("/api/vc/rieng", ticket())).status, 200);
  assert.equal(auth.shop(), SHOP);
  assert.throws(() => auth.setXeon({ keyId: "x" } as never), /setXeon needs/);
});

test("key rotation: two public keys are valid at once; tickets under the old key work until they expire", async () => {
  const { get, ticket, auth } = build();
  const fresh = generateSigningKey();
  auth.setXeon({ keyId: fresh.keyId, publicKeyPem: fresh.khoaCongPem, shop: SHOP });
  assert.equal((await get("/api/vc/rieng", ticket())).status, 200, "old key");
  const t = Date.parse("2026-09-12T00:00:00.000Z");
  const withFresh = signTicket({ vai: "quan-tri", shop: SHOP, tenShop: "", maMay: "m", tenMay: "m", manh: ["van-chuyen"], truc: false, phatLuc: t, hetLuc: t + 3600 * 1000 }, fresh);
  assert.equal((await get("/api/vc/rieng", withFresh)).status, 200, "new key");
  assert.deepEqual(auth.keyNames(), [{ name: "sales-desk", role: "quan-tri" }]);
});
