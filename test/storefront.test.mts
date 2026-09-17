/**
 * STOREFRONT — the web face. This suite keeps two promises:
 *
 *   1. The catch-all "/*" route must NOT swallow another module's API routes.
 *   2. The static-file port serves only files with a DECLARED extension, inside the module's own
 *      directory — every "..", every hidden file, every piece of server code dropped into the web
 *      directory stays in.
 *
 * Serving files is where files leak, so most tests here are blocking tests.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ACCESS, defineModule, type AnyManifest, type IncomingRequest } from "../dist/contract/index.js";
import {
  DiskStaticFilePort, FakeStaticFilePort, FixedWindowRateLimiter, Kernel, ManualClock, MemoryLogger,
  createRequestListener, parseRequestPath
} from "../dist/kernel/index.js";
import { manifest as storefront } from "../dist/modules/gian-hang/module.js";
import { injectOpenGraph, productKeyFromRequest } from "../dist/modules/gian-hang/open-graph.js";

const WEB_FILES: Record<string, string | Buffer> = {
  "index.html": "<!doctype html><title>TopRun</title><h1>May tinh</h1>",
  "mobile.html": "<!doctype html><title>TopRun mobile</title><h1>Dien thoai</h1>",
  "product.html": "<!doctype html><head><title>San pham</title></head><body>khung</body>",
  "styles.css": "body{color:#111}",
  "app.js": "console.log('web')",
  "assets/toprun-product-1.png": Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  // two files that must NOT come out: server code dropped into the web directory, and an internal note
  "server.js": "const biMat = 1;",
  "ghi-chu.md": "# noi bo"
};

const base = { name: "Hàng kho giả", tier: "van-hanh" as const, runsOn: "server-khach" as const, version: "0.0.1" };

/** A fake inventory module whose `hang-kho.read` answers with `product` (or throws, when given a function). */
function fakeInventory(read: () => Promise<Record<string, unknown> | null>): AnyManifest {
  return defineModule({ ...base, id: "hang-kho", provides: { "hang-kho.read": () => read() } });
}

function buildKernel({ files = WEB_FILES, config = {}, product = undefined, extraModules = [] as AnyManifest[] }: {
  files?: Record<string, string | Buffer>;
  config?: Record<string, unknown>;
  product?: Record<string, unknown> | null | undefined;
  extraModules?: AnyManifest[];
} = {}) {
  const logger = new MemoryLogger();
  const clock = new ManualClock();
  const staticFiles = new FakeStaticFilePort(Object.fromEntries(Object.entries(files).map(([k, v]) => [`gian-hang/goc/${k}`, v])));
  const modules: AnyManifest[] = [storefront, ...extraModules];
  if (product !== undefined) modules.push(fakeInventory(async () => product));
  const kernel = new Kernel({
    ports: { staticFiles, logger, clock, rateLimiter: new FixedWindowRateLimiter(clock) },
    logger, modules, config: { "gian-hang": config }
  });
  return { kernel, logger };
}

const get = (path: string, { ua = "Mozilla/5.0 (Windows NT 10.0)", query = {} as Record<string, string> } = {}): IncomingRequest =>
  ({ method: "GET", path, query, headers: { "user-agent": ua }, ip: "1.2.3.4" });

const text = (reply: { file?: { data: Buffer | string } }) => String(reply.file?.data ?? "");

// ---------- the right page ----------

test("a desktop on / sees the home page; a phone is sent to /mobile", async () => {
  const { kernel } = buildKernel();

  const desktop = await kernel.handle(get("/"));
  assert.equal(desktop.status, 200);
  assert.equal(desktop.file?.type, "text/html; charset=utf-8");
  assert.match(text(desktop), /May tinh/);

  const phone = await kernel.handle(get("/", { ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile Safari" }));
  assert.equal(phone.status, 302);
  assert.equal(phone.redirect, "/mobile");
});

test("a phone on / with a filter carries the filter to /mobile", async () => {
  const { kernel } = buildKernel();
  const r = await kernel.handle(get("/", { ua: "Android 14; Mobile Safari", query: { brand: "Nike", size: "42" } }));
  assert.equal(r.redirect, "/mobile?brand=Nike&size=42");
});

test("static files come with a content type and a cache lifetime", async () => {
  const { kernel } = buildKernel();

  const css = await kernel.handle(get("/styles.css"));
  assert.equal(css.status, 200);
  assert.equal(css.file?.type, "text/css; charset=utf-8");
  assert.match(String(css.headers?.["Cache-Control"]), /max-age=3600/);

  const image = await kernel.handle(get("/assets/toprun-product-1.png"));
  assert.equal(image.status, 200);
  assert.equal(image.file?.type, "image/png");
  assert.match(String(image.headers?.["Cache-Control"]), /max-age=604800/);

  const html = await kernel.handle(get("/mobile"));
  assert.equal(html.headers?.["Cache-Control"], "no-cache", "HTML must be revalidated every time, or customers keep the old build after a deploy");
});

// ---------- blocking tests ----------

test("BLOCKS server code even when it sits right in the web directory", async () => {
  const { kernel } = buildKernel();
  const r = await kernel.handle(get("/server.js"));
  assert.equal(r.status, 404, "server.js is in the web directory and still must not be served");
});

test("BLOCKS an undeclared extension — blocked by default", async () => {
  const { kernel } = buildKernel();
  assert.equal((await kernel.handle(get("/ghi-chu.md"))).status, 404);
});

test("BLOCKS paths leaving the directory: .., encoded paths, hidden files", () => {
  for (const p of [
    "/../chay.js", "/goc/../../chay.js", "/%2e%2e/%2e%2e/chay.js",
    "/.env", "/a/.env", "/data/khach.json", "/node_modules/x/index.js"
  ]) {
    assert.equal(parseRequestPath(p), null, `path "${p}" must be refused`);
  }
});

test("the REAL static port: reads inside the zone, never outside it", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tep-tinh-"));
  fs.mkdirSync(path.join(tmp, "gian-hang", "goc"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "gian-hang", "goc", "index.html"), "<title>that</title>");
  fs.writeFileSync(path.join(tmp, "bi-mat.js"), "const token = 1;");

  const zone = new DiskStaticFilePort(tmp).open("gian-hang/goc");
  assert.match(String((await zone.read("/index.html"))?.data), /that/);
  assert.equal(await zone.read("/../../bi-mat.js"), null);
  assert.equal(await zone.exists("/index.html"), true);
  assert.equal(await zone.exists("/khong-co.html"), false);

  assert.throws(() => new DiskStaticFilePort(tmp).open("../.."), /outside the root directory/);
});

// ---------- the "*" route must not swallow API routes ----------

test("the catch-all route does NOT swallow another module's API route, even when loaded first", async () => {
  const fakeApi = defineModule({
    ...base, id: "hang-kho-api", name: "API giả",
    routes: [{
      method: "GET", path: "/api/products", access: ACCESS.public,
      whyPublic: "Test: a fake route to see who receives this request.",
      rateLimit: { calls: 100, windowMs: 60000 },
      handle: async () => ({ status: 200, body: { ok: true, tu: "hang-kho" } })
    }]
  });
  // The storefront loads FIRST — if the router went by load order it would win.
  const { kernel } = buildKernel({ extraModules: [fakeApi] });
  const r = await kernel.handle(get("/api/products"));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, tu: "hang-kho" }, "the API route must reach the API module, not the storefront");
});

test("an API path nobody owns is a 404, never a file", async () => {
  const { kernel } = buildKernel();
  const r = await kernel.handle(get("/api/khong-co"));
  assert.equal(r.status, 404);
  assert.equal(r.file, undefined);
});

// ---------- Open Graph tags ----------

test("the product page carries OG tags: name, price, image — the crawler runs no JS", async () => {
  const { kernel } = buildKernel({
    config: { siteUrl: "https://thu.toprun.site" },
    product: {
      code: "JP9192", name: "Nike Pegasus 41", brand: "Nike", slug: "nike-pegasus-41",
      price: 3290000, suggestedPrice: 3290000, status: "active",
      highImage: "assets/toprun-product-1.png", shortDescription: "Giay chay bo em chan"
    }
  });
  const r = await kernel.handle(get("/product/nike-pegasus-41"));
  assert.equal(r.status, 200);
  const html = text(r);
  assert.match(html, /<meta property="og:title" content="Nike Nike Pegasus 41 JP9192 - TopRun">/);
  assert.match(html, /<meta property="product:price:amount" content="3290000">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/thu\.toprun\.site\/assets\/toprun-product-1\.png">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/thu\.toprun\.site\/product\/nike-pegasus-41">/);
  assert.equal(r.headers?.["X-Robots-Tag"], undefined);
});

test("an unknown product still gets a page, marked noindex", async () => {
  const { kernel } = buildKernel({ product: null });
  const r = await kernel.handle(get("/product/khong-co-ma-nay"));
  assert.equal(r.status, 200, "a customer on an old link must still see the page, not a 404");
  assert.match(String(r.headers?.["X-Robots-Tag"]), /noindex/);
});

test("a broken product read still returns the product page, only the OG tags are lost", async () => {
  const { kernel, logger } = buildKernel({
    files: { "product.html": "<head><title>San pham</title></head>" },
    extraModules: [fakeInventory(async () => { throw new Error("MySQL chet"); })]
  });
  const r = await kernel.handle(get("/product/JP9192"));
  assert.equal(r.status, 200);
  assert.ok(logger.has(/khong doc duoc mon/), "must be logged, not silent");
});

test("without the inventory module the product page still works (no OG data)", async () => {
  const { kernel } = buildKernel();   // hang-kho not loaded
  const r = await kernel.handle(get("/product.html", { query: { p: "JP9192" } }));
  assert.equal(r.status, 200);
  assert.match(text(r), /og:site_name/);
});

test("the product key is read both from the pretty path and from ?p=", () => {
  assert.equal(productKeyFromRequest({ path: "/product/nike-pegasus-41" }), "nike-pegasus-41");
  assert.equal(productKeyFromRequest({ path: "/product.html", query: { p: "JP9192" } }), "JP9192");
  assert.equal(productKeyFromRequest({ path: "/product.html", query: {} }), "");
});

test("OG tags escape quotes and HTML inside the product name", async () => {
  const { html } = await injectOpenGraph({
    template: "<head><title>x</title></head>",
    product: { code: "A1", name: 'Giay "xin" <b>nhat</b>', price: 100000, status: "active" },
    key: "A1", siteUrl: "https://thu.vn", fileExists: async () => false
  });
  assert.ok(!/<b>nhat<\/b>/.test(html), "HTML inside the product name must be escaped");
  assert.match(html, /&quot;xin&quot;/);
});

// ---------- images on the real site ----------

test("a missing image: with realImageOrigin set it 302s to the real site, without it 404", async () => {
  const withOrigin = buildKernel({ config: { realImageOrigin: "https://toprun.site" } });
  const r = await withOrigin.kernel.handle(get("/assets/products/JP9192/1.webp"));
  assert.equal(r.status, 302);
  assert.equal(r.redirect, "https://toprun.site/assets/products/JP9192/1.webp");

  const withoutOrigin = buildKernel();
  assert.equal((await withoutOrigin.kernel.handle(get("/assets/products/JP9192/1.webp"))).status, 404);
});

test("NEVER an open redirect: only image paths under /assets/ are forwarded", async () => {
  const { kernel } = buildKernel({ config: { realImageOrigin: "https://toprun.site" } });
  for (const p of ["/khong-phai-anh.html", "/assets/../bi-mat.js", "/assets/x.md", "/data/khach.json"]) {
    const r = await kernel.handle(get(p));
    assert.notEqual(r.status, 302, `path "${p}" must not be redirected anywhere`);
  }
});

// ---------- HEAD ----------

test("HEAD returns GET's headers and no body", async () => {
  const { kernel } = buildKernel();
  const listener = createRequestListener(kernel);
  const written = { status: 0, headers: {} as Record<string, string>, body: [] as unknown[] };
  const fakeResponse = {
    writeHead(status: number, headers: Record<string, string>) { written.status = status; written.headers = headers; },
    end(body?: unknown) { if (body) written.body.push(body); }
  } as unknown as ServerResponse;
  const fakeRequest = {
    method: "HEAD", url: "/styles.css", headers: { host: "localhost" }, socket: { remoteAddress: "1.2.3.4" }, on() { /* no body */ }
  } as unknown as IncomingMessage;
  await listener(fakeRequest, fakeResponse);
  assert.equal(written.status, 200);
  assert.equal(written.headers["Content-Type"], "text/css; charset=utf-8");
  assert.equal(written.headers["Content-Length"], String(Buffer.byteLength("body{color:#111}")));
  assert.equal(written.body.length, 0, "HEAD must not send a body");
});

// ---------- share links ----------

test("share link /l/<token> 302s to the filter; a garbage token goes to the home page", async () => {
  const { kernel } = buildKernel();
  const token = Buffer.from("brand=Nike&size=42&khoa_la=x").toString("base64url");
  const r = await kernel.handle(get(`/l/${token}`));
  assert.equal(r.status, 302);
  assert.equal(r.redirect, "/?brand=Nike&size=42");
  assert.equal((await kernel.handle(get("/l/khong-phai-base64-@@@"))).redirect, "/");
});

test("the route table keeps the exact public paths of the old site", () => {
  const { kernel } = buildKernel();
  const paths = kernel.routes().filter((r) => r.moduleId === "gian-hang").map((r) => `${r.method} ${r.path}`).sort();
  // /ctv-login and /ctv-account: the old site mapped them too, and the collaborator pages navigate there.
  assert.deepEqual(paths, ["GET /", "GET /*", "GET /ctv-account", "GET /ctv-login", "GET /l/:token", "GET /mobile", "GET /product.html", "GET /product/:khoa"]);
});

test("an OLD partner link /partner-<code> still arrives: 301 to /partner/<code>, and nothing else is caught", async () => {
  const { kernel } = buildKernel();
  const r = await kernel.handle(get("/partner-link-rieng-cua-doi-tac"));
  assert.equal(r.status, 301);
  assert.equal(r.redirect, "/partner/link-rieng-cua-doi-tac");
  // A short name or a file is not a partner link.
  assert.equal((await kernel.handle(get("/partner-abc"))).status, 404);
  assert.equal((await kernel.handle(get("/partner-portal.css"))).status, 404);
});
