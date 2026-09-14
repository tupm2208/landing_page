/**
 * The route table of the REAL modules: every door says who may call it, and the list of public
 * doors is pinned so opening a new one is a visible decision, not a quiet change.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ACCESS_LEVELS, BUILTIN_MODULES, FakeHttpClient, FakeStaticFilePort, FixedWindowRateLimiter, JsonFileStore, Kernel, ManualClock, MemoryLogger,
  ROLE, TokenAuth, validateManifest
} from "../dist/index.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "routes-"));

function realKernel() {
  const clock = new ManualClock();
  const logger = new MemoryLogger();
  return new Kernel({
    ports: {
      store: new JsonFileStore(tmp()), logger, clock, http: new FakeHttpClient(),
      auth: new TokenAuth({ keys: [{ token: "ma-quan-tri", name: "quan-tri", role: ROLE.admin }], clock }),
      rateLimiter: new FixedWindowRateLimiter(clock), staticFiles: new FakeStaticFilePort({})
    },
    logger, modules: BUILTIN_MODULES,
    config: {
      "hop-thu": { verifyToken: "v", appSecret: "s", pageToken: "t" }, "hang-kho": {}, "don-khach": {}, "khung-nen-tang": {},
      "mua-ho": { sessionSecret: "bi-mat-phien-doi-tac-dai" }, "ctv": { sessionSecret: "bi-mat-phien-ctv-dai" }
    }
  });
}

test("every manifest in the registry is valid and every module id matches its directory", () => {
  assert.ok(BUILTIN_MODULES.length >= 10);
  for (const m of BUILTIN_MODULES) {
    assert.doesNotThrow(() => validateManifest(m, m.id));
    assert.ok(fs.existsSync(path.join(import.meta.dirname, "..", "src", "modules", m.id, "module.ts")), `src/modules/${m.id}/module.ts`);
  }
});

test("every route declares an access level, and every public route has a rate limit", () => {
  const routes = realKernel().routes();
  assert.ok(routes.length >= 4);
  for (const r of routes) {
    assert.ok(ACCESS_LEVELS.includes(r.access), `${r.method} ${r.path} lacks access`);
    if (r.access === "cong-khai") assert.ok(r.rateLimit, `${r.method} ${r.path} is public without a rate limit`);
  }
});

test("THE LIST OF OPEN DOORS — this test fails whenever someone opens a new public route, on purpose", () => {
  // Why each door is open:
  //   - two Meta webhook routes: Meta calls from its own machines; protected by verify token + signature
  //   - two catalogue routes: the storefront must read them; the public view drops cost and stock counts
  //   - place order: a web customer has no token; prices come from the store, stock is reserved first
  //   - order lookup and the three customer order routes (view / edit / cancel): need the EXACT order
  //     id plus lookup token; edit and cancel only within 15 minutes, edit changes the recipient only
  //   - runtime version: returns the deploy id only; Image Tool reads it after a deploy
  //   - page content: only the allow-listed fields of khung-nen-tang/page-content — no tokens can leak
  //   - storefront (home, mobile, product page, share link, and "/*"): customers have no token; the
  //     static-file port allows by extension list, so a stray file in the web directory never leaves
  //   - four collaborator routes: collaborators are PEOPLE with no machine token; protected by a
  //     self-signed session cookie + PBKDF2 password + owner-approved devices; the image route lists images only
  //   - five partner-portal routes: partners log in with a SESSION COOKIE, not a Bearer token, which the
  //     auth port does not read; so they are public and check the session themselves (401 before reading anything)
  const open = realKernel().routes().filter((r) => r.access === "cong-khai").map((r) => `${r.method} ${r.path}`).sort();
  assert.deepEqual(open, [
    "GET /",
    "GET /*",
    "GET /api/content",
    "GET /api/ctv/anh",
    "GET /api/ctv/me",
    "GET /api/facebook/webhook",
    "GET /api/orders/public",
    "GET /api/partner-portal",
    "GET /api/products",
    "GET /api/products/:khoa",
    "GET /api/runtime-version",
    "GET /l/:token",
    "GET /mobile",
    "GET /product.html",
    "GET /product/:khoa",
    "PATCH /api/orders/public",
    "POST /api/ctv/login",
    "POST /api/ctv/logout",
    "POST /api/facebook/webhook",
    "POST /api/orders",
    "POST /api/orders/lookup",
    "POST /api/orders/public/cancel",
    "POST /api/orders/public/payment-choice",
    "POST /api/partner-portal/login",
    "POST /api/partner-portal/logout",
    "POST /api/partner-portal/out-of-stock",
    "POST /api/partner-portal/purchases"
  ]);
});
