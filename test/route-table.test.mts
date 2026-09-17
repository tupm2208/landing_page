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
  ACCESS_LEVELS, BUILTIN_MODULES, FakeHttpClient, FakeStaticFilePort, FixedWindowRateLimiter, MemoryUploadPort, JsonFileStore, Kernel, ManualClock, MemoryLogger,
  MemoryMailer, ROLE, TokenAuth, validateManifest
} from "../dist/index.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "routes-"));

function realKernel() {
  const clock = new ManualClock();
  const logger = new MemoryLogger();
  return new Kernel({
    ports: {
      store: new JsonFileStore(tmp()), logger, clock, http: new FakeHttpClient(),
      auth: new TokenAuth({ keys: [{ token: "ma-quan-tri", name: "quan-tri", role: ROLE.admin }], clock }),
      rateLimiter: new FixedWindowRateLimiter(clock), uploads: new MemoryUploadPort(), staticFiles: new FakeStaticFilePort({}), mail: new MemoryMailer()
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
  //   - Đ9 the storefront's ad pixel ids (GA4 / Meta / TikTok) of the main website channel: they sit in
  //     every page's source anyway; three ids validated to their real shapes, nothing else is read
  //   - the analytics event door: a customer's browser has no token and reports what it did. It only
  //     WRITES one counted row and reads nothing; the event name must be on an allow-list; and
  //     `order_success` is refused here and written by the server when an order really exists, so
  //     nobody can inflate the shop's own sales figures from a browser
  //   - Đ8 album pictures of a Facebook post (cards, covers, uploads): Meta downloads them, so no token;
  //     server-named images in the module's own upload zone only, nothing listed or written
  //   - images the shop SENDS a customer on Messenger: Meta fetches them, so no token. Only files the
  //     upload port named itself (images, recognised by their bytes); nothing is listed or written
  //   - the WAREHOUSE page (/warehouse + its scripts) checks the admin session itself, like /admin; product
  //     photos the shop uploaded are public because the storefront shows them (server-named images only)
  //   - the WEB ADMIN (16/09/2026): people log in with a password, so the login door has no token yet
  //     (PBKDF2, 5-miss lockout, new devices wait for the owner, one refusal for every failure). The
  //     `/admin` shell and `/admin.js` check the session THEMSELVES and give a stranger the login page / 404;
  //     every admin API stays `ACCESS.admin` and accepts the person's session through the auth port
  //   - Đ10 the TAG-SCANNING page (/scan + scripts) and the seller's PHONE page (/m + scripts) check the admin
  //     session themselves like /warehouse; the BROWSER-EXTENSION door (POST /api/tien-ich/:viec) has no ticket,
  //     checks the shop's extension key (only a hash kept, constant-time compare) before reading anything, and
  //     answers only a fixed list of jobs (stock lookup / edit, purchase queue)
  const open = realKernel().routes().filter((r) => r.access === "cong-khai").map((r) => `${r.method} ${r.path}`).sort();
  //   - customer ACCOUNTS (two pages + eleven doors of the running site): customers are PEOPLE with no
  //     machine token; protected by a session cookie (token hashed in the table), PBKDF2 passwords, tight
  //     rate limits on register/login/forgot, and e-mail links for password reset and profile changes
  assert.deepEqual(open, [
    "GET /",
    "GET /*",
    "GET /account-manage.html",
    "GET /account-manage.js",
    "GET /account.html",
    "GET /account.js",
    "GET /admin",
    "GET /admin-api.js",
    "GET /admin-login",
    "GET /admin-login.html",
    "GET /admin-login.js",
    "GET /admin.css",
    "GET /admin.html",
    "GET /admin.js",
    "GET /admin/desk",
    "GET /admin/nguoi",
    "GET /api/account/me",
    "GET /api/account/orders",
    "GET /api/account/profile",
    "GET /api/content",
    "GET /api/ctv/anh",
    "GET /api/ctv/me",
    "GET /api/dang-bai/anh/:tep",
    "GET /api/facebook/webhook",
    "GET /api/fanpage-media/:tep",
    "GET /api/hang-kho/anh/:tep",
    "GET /api/kenh-web/theo-doi",
    "GET /api/orders/public",
    "GET /api/partner-portal",
    "GET /api/products",
    "GET /api/products/:khoa",
    "GET /api/runtime-version",
    "GET /ctv-account",
    "GET /ctv-login",
    "GET /l/:token",
    "GET /m",
    "GET /m.css",
    "GET /m.js",
    "GET /mobile",
    "GET /nguoi.js",
    "GET /omi-web/app.css",
    "GET /omi-web/app.js",
    "GET /omi-web/desk.css",
    "GET /partner",
    "GET /partner-login",
    "GET /partner-login.js",
    "GET /partner-portal.css",
    "GET /partner-portal.html",
    "GET /partner-portal.js",
    "GET /partner-scan.js",
    "GET /partner/:token",
    "GET /product.html",
    "GET /product/:khoa",
    "GET /scan",
    "GET /scan-api.js",
    "GET /scan.css",
    "GET /scan.js",
    "GET /warehouse",
    "GET /warehouse-api.js",
    "GET /warehouse.css",
    "GET /warehouse.js",
    "PATCH /api/orders/public",
    "POST /api/account/forgot-password",
    "POST /api/account/login",
    "POST /api/account/logout",
    "POST /api/account/orders/cancel",
    "POST /api/account/register",
    "POST /api/account/request-change",
    "POST /api/account/reset-password",
    "POST /api/account/verify-change",
    "POST /api/admin/login",
    "POST /api/admin/logout",
    "POST /api/analytics/event",
    "POST /api/ctv/download-log",
    "POST /api/ctv/forgot-password",
    "POST /api/ctv/login",
    "POST /api/ctv/logout",
    "POST /api/ctv/reset-password",
    "POST /api/facebook/webhook",
    "POST /api/hop-thu/telegram/webhook",
    "POST /api/orders",
    "POST /api/orders/lookup",
    "POST /api/orders/public/cancel",
    "POST /api/orders/public/payment-choice",
    "POST /api/partner-portal/login",
    "POST /api/partner-portal/logout",
    "POST /api/partner-portal/order-packing",
    "POST /api/partner-portal/out-of-stock",
    "POST /api/partner-portal/purchases",
    "POST /api/partner-portal/purchases/undo",
    "POST /api/partner-portal/scan-label",
    "POST /api/partner-portal/shipment-request",
    "POST /api/tien-ich/:viec"
  ]);
});
