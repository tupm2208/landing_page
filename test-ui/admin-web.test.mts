/**
 * THE WEB ADMIN, CLICKED FOR REAL — Chrome (headless) against a real landing on MySQL 3307.
 *
 * Dũng, 13/09: "tôi phải thao tác trên UI chứ?". So: the real server listens on a port, real orders
 * and partners are loaded from the running site's data files (read-only), Chrome logs in through the
 * login form, opens every tab of the copied `admin.js`, and does the everyday writes. Any JavaScript
 * exception, any red message on the page, any request the translator could not serve fails the test.
 *
 *   TOPRUN_MYSQL_URL=mysql://root:...@127.0.0.1:3307/toprun_modules_test npm run test:ui
 * Needs Chrome, MySQL 3307 and D:\projects\toprunvn\data (skips without them).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import type { AddressInfo } from "node:net";
import mysql from "mysql2/promise";

import { buildLandingApp } from "../dist/app.js";
import { MemoryLogger, createHttpServer } from "../dist/kernel/index.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const BASE_URL = String(process.env["TOPRUN_MYSQL_URL"] || "").trim();
const DATA = process.env["THU_MUC_THAT"] || "D:\\projects\\toprunvn\\data";
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find((p) => fs.existsSync(p));
const skip = !BASE_URL ? "chưa đặt TOPRUN_MYSQL_URL" : !CHROME ? "không có Chrome/Edge" : !fs.existsSync(DATA) ? `không có ${DATA}` : null;
if (BASE_URL && /:3306\//.test(BASE_URL)) throw new Error("Cổng 3306 là dữ liệu thật. Dùng 3307.");

const DB = "toprun_thu_admin_web";
const OWNER = { login: "chu", password: "mat-khau-chu-shop-thu" };
const MACHINE_KEY = "ma-may-thu-man-quan-tri";
const APP_SECRET = "bi-mat-app-meta-thu";

/** A minimal Chrome DevTools Protocol client over Node's own WebSocket. */
class Cdp {
  private id = 0;
  private readonly waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  readonly events: { method: string; params: Record<string, unknown> }[] = [];
  private readonly ws: WebSocket;
  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(String(e.data)) as { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: Record<string, unknown> };
      if (msg.id !== undefined) {
        const w = this.waiting.get(msg.id);
        this.waiting.delete(msg.id);
        if (msg.error) w?.reject(new Error(msg.error.message)); else w?.resolve(msg.result);
      } else if (msg.method) this.events.push({ method: msg.method, params: msg.params ?? {} });
    });
  }
  static async open(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => { ws.addEventListener("open", resolve); ws.addEventListener("error", reject); });
    return new Cdp(ws);
  }
  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.waiting.set(id, { resolve, reject }));
  }
  async eval<T = unknown>(expression: string): Promise<T> {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }) as { result: { value: T }; exceptionDetails?: { text: string; exception?: { description?: string } } };
    if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ""}`);
    return r.result.value;
  }
  async until(expression: string, what: string, timeoutMs = 20000): Promise<void> {
    const end = Date.now() + timeoutMs;
    for (;;) {
      if (await this.eval<boolean>(`Boolean(${expression})`).catch(() => false)) return;
      if (Date.now() > end) throw new Error(`hết giờ chờ: ${what}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  close(): void { this.ws.close(); }
}

test("the web admin, clicked for real in Chrome", { skip: skip ?? false, timeout: 300000 }, async (t) => {
  // ---- a fresh database with the running site's orders and partners ----
  const serverUrl = BASE_URL.replace(/\/[^/]*$/, "/");
  const admin = await mysql.createConnection(serverUrl);
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
  await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  const dbUrl = `${serverUrl}${DB}`;
  const toolEnv = { ...process.env, TOPRUN_MYSQL_URL: dbUrl, THU_MUC_THAT: DATA };
  for (const tool of ["import-orders", "import-partners", "import-collaborators"]) {
    const r = spawnSync(process.execPath, [path.join(ROOT, "dist", "tools", `${tool}.js`)], { env: toolEnv, encoding: "utf8" });
    assert.equal(r.status, 0, `${tool}: ${r.stderr}`);
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "admin-web-"));
  const logger = new MemoryLogger();
  const app = await buildLandingApp({
    dataDirectory: dataDir, logger, envFile: path.join(dataDir, "khong-co.env"),
    env: {
      TOPRUN_MYSQL_URL: dbUrl, ADMIN_LOGIN: OWNER.login, ADMIN_PASSWORD: OWNER.password,
      BI_MAT_PHIEN_DOI_TAC: "bi-mat-phien-doi-tac-thu", BI_MAT_PHIEN_CTV: "bi-mat-phien-ctv-thu-nghiem",
      LANDING_SITE_BASE_URL: "http://127.0.0.1", LANDING_ADMIN_TOKEN: MACHINE_KEY, FACEBOOK_APP_SECRET: APP_SECRET, FACEBOOK_VERIFY_TOKEN: "ma-xac-minh-thu"
    }
  });

  // A small catalogue and one Messenger thread, so the Products and Fanpage tabs have something to act on.
  const machine = { authorization: `Bearer ${MACHINE_KEY}` };
  const pushed = await app.kernel.handle({
    method: "POST", path: "/api/products", headers: machine, ip: "127.0.0.1",
    json: async () => [{ code: "UI-TEST-1", name: "Giày thử màn quản trị", brand: "Thử", listPrice: 2000000, sizes: [{ size: "42", qty: 3, price: 1500000, warehouseId: "wh_yen" }] }]
  });
  assert.equal(pushed.status, 200, JSON.stringify(pushed.body));
  const hook = JSON.stringify({ object: "page", entry: [{ id: "trang-thu", messaging: [{ sender: { id: "khach-ui" }, timestamp: Date.now(), message: { mid: "m.ui.1", text: "shop ơi còn size 42 không, sđt mình 0912345678" } }] }] });
  const delivered = await app.kernel.handle({
    method: "POST", path: "/api/facebook/webhook", ip: "127.0.0.1",
    headers: { "x-hub-signature-256": "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(hook).digest("hex") },
    raw: async () => Buffer.from(hook, "utf8")
  });
  assert.equal(delivered.status, 200);
  const server = createHttpServer(app.kernel);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // ---- Chrome ----
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "admin-web-chrome-"));
  const debugPort = 9300 + Math.floor(Math.random() * 500);
  const chrome: ChildProcess = spawn(CHROME!, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "--headless=new", "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  t.after(async () => {
    chrome.kill();
    server.close();
    await app.store.close();
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.end();
  });
  let targets: { type: string; webSocketDebuggerUrl: string }[] = [];
  for (let i = 0; i < 50 && targets.length === 0; i += 1) {
    await new Promise((r) => setTimeout(r, 200));
    targets = await fetch(`http://127.0.0.1:${debugPort}/json`).then((r) => r.json() as Promise<typeof targets>).then((l) => l.filter((x) => x.type === "page")).catch(() => []);
  }
  const page = await Cdp.open(targets[0]!.webSocketDebuggerUrl);
  await page.send("Runtime.enable");
  await page.send("Network.enable");
  await page.send("Page.enable");
  const exceptions = () => page.events.filter((e) => e.method === "Runtime.exceptionThrown").map((e) => JSON.stringify(e.params).slice(0, 400));
  const serverErrors = () => page.events
    .filter((e) => e.method === "Network.responseReceived")
    .map((e) => e.params["response"] as { url: string; status: number })
    .filter((r) => r.status >= 500);
  const pageMessage = () => page.eval<string>(`(() => { const m = document.getElementById("message"); return m && !m.hidden ? m.textContent : ""; })()`);
  const goto = async (url: string) => { await page.send("Page.navigate", { url }); await new Promise((r) => setTimeout(r, 300)); };

  await t.test("a stranger is sent to the login page; the owner logs in with the .env password", async () => {
    await goto(`${origin}/admin`);
    await page.until(`location.pathname === "/admin-login" && document.getElementById("admin-login-form")`, "trang đăng nhập");
    await page.eval(`(() => {
      document.getElementById("admin-login").value = ${JSON.stringify(OWNER.login)};
      document.getElementById("admin-password").value = ${JSON.stringify(OWNER.password)};
      document.querySelector("#admin-login-form button").click();
    })()`);
    await page.until(`location.pathname === "/admin"`, "vào /admin");
    await page.until(`document.querySelector("#app") && document.querySelector("#app").children.length > 0`, "nội dung admin");
    assert.deepEqual(exceptions(), []);
  });

  const TABS = ["dashboard", "products", "orders", "partners", "shipping", "fanpage", "ctv"];
  for (const tab of TABS) {
    await t.test(`tab "${tab}" opens with no error`, async () => {
      await page.eval(`document.querySelector('.admin-tabs [data-view="${tab}"]').click()`);
      await new Promise((r) => setTimeout(r, 1500));
      const message = await pageMessage();
      assert.ok(!/không|lỗi|thất bại|error/i.test(message), `tab ${tab} báo: ${message}`);
      assert.deepEqual(exceptions(), [], `tab ${tab} ném lỗi JavaScript`);
      assert.deepEqual(serverErrors(), [], `tab ${tab} làm máy chủ lỗi 500`);
      const html = await page.eval<string>(`document.getElementById("app").innerText.slice(0, 300)`);
      assert.ok(html.trim().length > 0, `tab ${tab} trống`);
      t.diagnostic(`[${tab}] ${html.replace(/\s+/g, " ").slice(0, 220)}`);
    });
  }

  await t.test("the orders tab lists the real orders, and a status button really changes the order", async () => {
    await page.eval(`document.querySelector('.admin-tabs [data-view="orders"]').click()`);
    await new Promise((r) => setTimeout(r, 1500));
    const count = await page.eval<number>(`(typeof state !== "undefined" && state.orders ? state.orders.length : -1)`);
    assert.ok(count >= 200, `admin sees ${count} orders`);
    // Choose an order that the server says may be confirmed, and confirm it through the page's own code path.
    const target = await page.eval<string>(`(async () => {
      const r = await fetch("/api/orders?limit=500", { credentials: "same-origin" }).then((x) => x.json());
      const o = r.find((x) => (x.viecLamDuoc || []).includes("xac-nhan"));
      return o ? o.id : "";
    })()`);
    t.diagnostic(`orders=${count} target=${target || "(none)"}`);
    assert.ok(target, "some real order must be confirmable");
    if (target) {
      await page.eval(`quickUpdateOrder(${JSON.stringify(target)}, "confirmed_by_customer")`).catch((e: Error) => { throw e; });
      await new Promise((r) => setTimeout(r, 1500));
      const after = await page.eval<string>(`fetch("/api/orders/${target}", { credentials: "same-origin" }).then((x) => x.json()).then((o) => (o.order || o).status)`);
      assert.equal(after, "confirmed_by_customer", await pageMessage());
    }
    assert.deepEqual(exceptions(), []);
  });

  await t.test("PRODUCTS: the inline editor saves name, price and hidden status", async () => {
    await page.eval(`document.querySelector('.admin-tabs [data-view="products"]').click()`);
    await page.until(`document.querySelector('[data-product-field="name"][data-code="UI-TEST-1"]')`, "dòng sản phẩm thử");
    await page.eval(`(async () => {
      document.querySelector('[data-product-field="name"][data-code="UI-TEST-1"]').value = "Giày thử đã đổi tên";
      document.querySelector('[data-product-field="price"][data-code="UI-TEST-1"]').value = "1.690.000";
      document.querySelector('[data-product-field="status"][data-code="UI-TEST-1"]').value = "hidden";
      await saveProduct("UI-TEST-1");
    })()`);
    assert.equal(await pageMessage(), "Đã lưu sản phẩm.");
    const item = (await app.kernel.handle({ method: "GET", path: "/api/admin/products", headers: machine, ip: "127.0.0.1", query: { q: "UI-TEST-1" } })).body as { name: string; status: string; price: number }[];
    assert.deepEqual([item[0]?.name, item[0]?.status, item[0]?.price], ["Giày thử đã đổi tên", "hidden", 1690000]);
  });

  await t.test("ORDERS: delete to the bin and restore, through the page's own lifecycle function", async () => {
    await page.eval(`window.confirm = () => true`);
    const id = await page.eval<string>(`state.orders.find((o) => !o.deletedAt && o.status === "completed").id`);
    await page.eval(`adminOrderLifecycle(${JSON.stringify(id)}, "soft_delete")`);
    let order = (await app.kernel.handle({ method: "GET", path: `/api/orders/${id}`, headers: machine, ip: "127.0.0.1" })).body as { daXoa?: boolean; order?: { daXoa: boolean } };
    assert.equal((order.order ?? order).daXoa, true, await pageMessage());
    await page.eval(`adminOrderLifecycle(${JSON.stringify(id)}, "restore")`);
    order = (await app.kernel.handle({ method: "GET", path: `/api/orders/${id}`, headers: machine, ip: "127.0.0.1" })).body as { daXoa?: boolean; order?: { daXoa: boolean } };
    assert.equal((order.order ?? order).daXoa, false, await pageMessage());
  });

  await t.test("ORDERS: picking a warehouse for a line goes to the line door and names the partner", async () => {
    const pick = await page.eval<{ id: string; lineIndex: number; code: string; size: string } | null>(`(() => {
      const o = state.orders.find((x) => !x.deletedAt && ["pending", "confirmed_by_customer"].includes(x.status) && x.items.some((l) => !l.khoaKho));
      if (!o) return null;
      const i = o.items.findIndex((l) => !l.khoaKho);
      return { id: o.id, lineIndex: i, code: o.items[i].productCode, size: o.items[i].size };
    })()`);
    if (!pick) { t.diagnostic("no open line to pick a warehouse for"); return; }
    const r = await page.eval<{ ok: boolean; message: string }>(`fetch("/api/admin/operations", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "admin_order.warehouse_selected", payload: { orderId: ${JSON.stringify(pick.id)}, lineIndex: ${pick.lineIndex}, productCode: ${JSON.stringify(pick.code)}, size: ${JSON.stringify(pick.size)}, warehouseId: "wh_yen", warehouseName: "Yến" } }) }).then((x) => x.json())`);
    assert.equal(r.ok, true, r.message);
    const order = (await app.kernel.handle({ method: "GET", path: `/api/orders/${pick.id}`, headers: machine, ip: "127.0.0.1" })).body as { items?: { partnerId: string; warehouseId: string }[]; order?: { items: { partnerId: string; warehouseId: string }[] } };
    const line = (order.order ?? order).items![pick.lineIndex]!;
    assert.deepEqual([line.warehouseId, line.partnerId], ["wh_yen", "partner_yen"]);
  });

  await t.test("CTV: create by e-mail only, pause, and delete — the page's own functions", async () => {
    await page.eval(`document.querySelector('.admin-tabs [data-view="ctv"]').click()`);
    await new Promise((r) => setTimeout(r, 800));
    const button = `{ disabled: false, dataset: {} }`;
    await page.eval(`(async () => {
      state.ctvDraft = { phone: "", email: "ctv-ui@example.com", password: "mat-khau-ctv-ui" };
      await createCtvAccount({ preventDefault() {}, currentTarget: { querySelector: () => (${button}) } });
    })()`);
    const created = await page.eval<{ id: string; active: boolean } | undefined>(`state.ctv.accounts.find((a) => a.email === "ctv-ui@example.com")`);
    assert.ok(created, await pageMessage());
    await page.eval(`updateCtvAccount(${JSON.stringify(created.id)}, { active: false }, ${button})`);
    assert.equal(await page.eval<boolean>(`state.ctv.accounts.find((a) => a.id === ${JSON.stringify(created.id)}).active`), false);
    await page.eval(`deleteCtvAccount({ disabled: false, dataset: { ctvDelete: ${JSON.stringify(created.id)}, name: "ui" } })`);
    assert.equal(await page.eval<number>(`state.ctv.accounts.filter((a) => a.id === ${JSON.stringify(created.id)}).length`), 0, await pageMessage());
  });

  await t.test("FANPAGE: the Messenger thread shows up, and the customer's phone/address is saved on it", async () => {
    await page.eval(`(async () => { const p = await fetch("/api/admin/fanpage", { credentials: "same-origin" }).then((x) => x.json()); state.fanpage = p.data; render(); })()`);
    const conv = await page.eval<{ id: string; lastMessage: string } | undefined>(`state.fanpage.conversations[0]`);
    assert.equal(conv?.id, "facebook:khach-ui");
    assert.match(conv!.lastMessage, /size 42/);
    const r = await page.eval<{ ok: boolean }>(`fetch("/api/admin/fanpage/contact", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: "facebook:khach-ui", phone: "0912345678", address: "12 Lê Lợi" }) }).then((x) => x.json())`);
    assert.equal(r.ok, true);
    const again = await page.eval<{ phone: string }>(`fetch("/api/admin/fanpage", { credentials: "same-origin" }).then((x) => x.json()).then((p) => p.data.conversations[0])`);
    assert.equal(again.phone, "0912345678");
  });

  await t.test("DASHBOARD: the payment settings save to page content", async () => {
    await page.eval(`document.querySelector('.admin-tabs [data-view="dashboard"]').click()`);
    await new Promise((r) => setTimeout(r, 800));
    const saved = await page.eval<string>(`(async () => {
      const r = await fetch("/api/content", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bankAccountName: "SHOP THU UI" }) }).then((x) => x.json());
      return r.content && r.content.bankAccountName;
    })()`);
    assert.equal(saved, "SHOP THU UI");
  });

  await t.test("the SPX export produces a real .xlsx (a zip) for the checked orders", async () => {
    const size = await page.eval<number>(`(async () => {
      const orders = state.orders.filter((o) => o.customerName && o.phone && o.address).slice(0, 3);
      const r = await fetch("/api/admin/shipping/export-spx", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orders }) });
      const b = new Uint8Array(await r.arrayBuffer());
      return b[0] === 0x50 && b[1] === 0x4b ? b.length : -1;
    })()`);
    assert.ok(size > 1000, `xlsx bytes: ${size}`);
  });

  // ---------------- the warehouse page (Sales Desk's warehouse.html) ----------------

  const shelf = async (size: string) => {
    const items = (await app.kernel.handle({ method: "GET", path: "/api/admin/products", headers: machine, ip: "127.0.0.1", query: { q: "UI-TEST-1" } })).body as { sizes: { size: string; qty: number; nguon: string; warehouseId: string }[] }[];
    return (items[0]?.sizes ?? []).filter((x) => x.size === size);
  };
  const toastText = () => page.eval<string>(`document.getElementById("toast").textContent`);

  await t.test("WAREHOUSE: the page opens for the signed-in owner and lists the real catalogue", async () => {
    await goto(`${origin}/warehouse`);
    await page.until(`typeof app !== "undefined" && app.state && app.state.products.length > 0`, "trang kho có dữ liệu");
    const product = await page.eval<{ sku: string; orderStock: number; readyStock: number }>(`app.state.products.find((p) => p.sku === "UI-TEST-1")`);
    assert.deepEqual([product.sku, product.orderStock, product.readyStock], ["UI-TEST-1", 3, 0]);
    assert.deepEqual(exceptions(), []);
  });

  await t.test("WAREHOUSE: 'Điều chỉnh nhanh' adds ready stock to ONE size, through the form", async () => {
    await page.eval(`(() => { app.view = "stock"; render(); })()`);
    await page.eval(`(() => {
      const f = document.getElementById("stock-form");
      f.productId.value = "UI-TEST-1"; f.size.value = "42"; f.warehouse.value = "ready"; f.quantity.value = "2"; f.note.value = "đếm lại kệ";
      f.requestSubmit();
    })()`);
    await page.until(`document.getElementById("toast").textContent.includes("tồn kho")`, "báo đã cập nhật");
    const rows = await shelf("42");
    assert.equal(rows.filter((r) => r.nguon === "ready").reduce((sum, r) => sum + r.qty, 0), 2, JSON.stringify(rows));
    assert.equal(await page.eval<number>(`app.state.products.find((p) => p.sku === "UI-TEST-1").readyStock`), 2);
  });

  await t.test("WAREHOUSE: a goods-in slip adds its lines; transfer order → ready moves pairs", async () => {
    const r = await page.eval<{ ok: boolean; message?: string }>(`fetch("/api/warehouse/import-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ supplier: "NCC thử", lines: [{ productId: "UI-TEST-1", sku: "UI-TEST-1", size: "43", warehouse: "order", quantity: 4, cost: 900000 }] }) }).then((x) => x.json())`);
    assert.equal(r.ok, true, r.message);
    assert.equal((await shelf("43")).reduce((sum, x) => sum + x.qty, 0), 4);
    const moved = await page.eval<{ ok: boolean; message?: string }>(`fetch("/api/warehouse/transfers/order-to-ready", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId: "UI-TEST-1", size: "43", quantity: 1 }) }).then((x) => x.json())`);
    assert.equal(moved.ok, true, moved.message);
    const after = await shelf("43");
    assert.deepEqual([after.filter((x) => x.nguon === "ready").reduce((a, x) => a + x.qty, 0), after.filter((x) => x.nguon !== "ready").reduce((a, x) => a + x.qty, 0)], [1, 3]);
  });

  await t.test("WAREHOUSE: selling from the cart creates a real order, and a return puts the pair back in READY stock", async () => {
    await page.eval(`(async () => {
      window.prompt = (question, fallback) => (/Số lượng/.test(question) ? "1" : "Khách tại quầy");
      app.cartWarehouse = "order"; app.cart = [{ productId: "UI-TEST-1", quantity: 1, price: 1500000 }];
      await createOrderFromCart();
    })()`);
    const order = await page.eval<{ id: string; lines: { size: string }[] } | undefined>(`app.state.orders.find((o) => o.customerName === "Khách tại quầy")`);
    assert.ok(order, await toastText());
    const readyBefore = (await shelf(order.lines[0]!.size)).filter((x) => x.nguon === "ready").reduce((a, x) => a + x.qty, 0);
    await page.eval(`handleReturn(${JSON.stringify(order.id)}, "UI-TEST-1")`);
    const readyAfter = (await shelf(order.lines[0]!.size)).filter((x) => x.nguon === "ready").reduce((a, x) => a + x.qty, 0);
    assert.equal(readyAfter, readyBefore + 1, await toastText());
    const again = await page.eval<{ ok: boolean; error?: string }>(`fetch("/api/warehouse/returns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: ${JSON.stringify(order.id)}, productId: "UI-TEST-1", quantity: 1 }) }).then((x) => x.json())`);
    assert.equal(again.error, "hoan_qua_so_ban", "BREAKS IF more pairs come back than were sold");
  });

  await t.test("WAREHOUSE: a customer is saved, and a product photo is uploaded and becomes the main image", async () => {
    await page.eval(`(() => { app.view = "customers"; render(); })()`);
    await page.eval(`(() => { const f = document.getElementById("customer-form"); f.elements.namedItem("name").value = "Chị Hoa"; f.phone.value = "0901 222 333"; f.address.value = "Q.3"; f.requestSubmit(); })()`);
    await page.until(`app.state.customers.some((c) => c.name === "Chị Hoa")`, "khách mới trong danh sách", 8000).catch(async (e: Error) => { throw new Error(`${e.message}; trang báo: ${await toastText()}`); });
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const up = await page.eval<{ ok: boolean; message?: string }>(`fetch("/api/warehouse/product-images", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId: "UI-TEST-1", contentType: "image/png", dataBase64: "${png}", primary: true }) }).then((x) => x.json())`);
    assert.equal(up.ok, true, up.message);
    await page.eval(`loadState()`);
    const image = await page.eval<string>(`app.state.products.find((p) => p.sku === "UI-TEST-1").imageUrl`);
    assert.match(image, /^\/api\/hang-kho\/anh\/ui-test-1-/);
    assert.equal(await page.eval<number>(`fetch(${JSON.stringify(image)}).then((x) => x.status)`), 200);
  });

  await t.test("WAREHOUSE: every tab renders without a JavaScript error", async () => {
    for (const view of ["lookup", "orderWarehouse", "orders", "products", "customers", "stock", "users"]) {
      await page.eval(`(() => { app.view = ${JSON.stringify(view)}; render(); })()`);
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.deepEqual(exceptions(), []);
    assert.deepEqual(serverErrors(), []);
  });

  // ---------------- collaborator commissions (end to end, on the real server) ----------------

  await t.test("COMMISSION: a ?ref link sets the cookie, the order it brings earns the CTV's rate, completing it approves, paying clears the debt", async () => {
    const created = await app.kernel.handle({ method: "POST", path: "/api/admin/ctv", headers: machine, ip: "127.0.0.1", json: async () => ({ ten: "CTV hoa hồng", dienThoai: "0909111222", matKhau: "mat-khau-ctv-hh", hoaHongMacDinh: "10%" }) });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const ctv = (created.body as { ctv: { ma: string; maGioiThieu: string } }).ctv;

    const landing = await fetch(`${origin}/?ref=${ctv.maGioiThieu}`, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0)" } });
    const setCookie = landing.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /landing_ctv_ref=/, "the referral cookie is set");
    const cookie = setCookie.split(";")[0]!;
    const bogus = await fetch(`${origin}/?ref=KHONG-CO-MA`, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0)" } });
    assert.equal(bogus.headers.get("set-cookie"), null, "BREAKS IF a code nobody owns sets a cookie");

    const placed = await fetch(`${origin}/api/orders`, {
      method: "POST", headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ customerName: "Khách của CTV", phone: "0911000111", address: "1 Đường Thử", items: [{ productCode: "UI-TEST-1", size: "43", qty: 1 }] })
    });
    const order = await placed.json() as { ok: boolean; id: string; total: number };
    assert.equal(order.ok, true, JSON.stringify(order));
    await new Promise((r) => setTimeout(r, 300));

    const book = async () => ((await app.kernel.handle({ method: "GET", path: "/api/admin/ctv/hoa-hong", headers: machine, ip: "127.0.0.1" })).body as { data: { commissions: { orderId: string; commissionAmount: number; status: string; attributionSource: string }[]; payments: unknown[] } }).data;
    let row = (await book()).commissions.find((c) => c.orderId === order.id);
    assert.ok(row, "the order earned a commission row");
    assert.deepEqual([row!.commissionAmount, row!.status, row!.attributionSource], [Math.round(order.total * 0.1), "pending", "affiliate_link"]);

    await app.kernel.handle({ method: "PATCH", path: `/api/orders/${order.id}`, headers: machine, ip: "127.0.0.1", json: async () => ({ status: "completed", note: "giao xong" }) });
    row = (await book()).commissions.find((c) => c.orderId === order.id);
    assert.equal(row!.status, "approved", "a completed order approves the commission — read from the order, not stored");

    const paid = await app.kernel.handle({ method: "POST", path: "/api/admin/ctv/thanh-toan", headers: machine, ip: "127.0.0.1", json: async () => ({ maCtv: ctv.ma, soTien: row!.commissionAmount, ghiChu: "trả tháng 9" }) });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    // The admin page's own numbers, through its translator.
    await goto(`${origin}/admin`);
    await page.until(`typeof state !== "undefined" && state.ctvCommissions && (state.ctvCommissions.commissions || []).length > 0 && (state.ctvCommissions.payments || []).length > 0`, "admin tải hoa hồng");
    const stats = await page.eval<{ approved: number; debt: number; paid: number }>(`ctvCommissionStatsFor(state.ctv.accounts.find((a) => a.code === ${JSON.stringify(ctv.maGioiThieu)}))`);
    assert.deepEqual([stats.approved, stats.paid, stats.debt], [row!.commissionAmount, row!.commissionAmount, 0]);
  });

  // ---------------- people & devices ----------------

  await t.test("PEOPLE: the owner creates a staff account; its first login waits; the owner approves it on the screen", async () => {
    await goto(`${origin}/admin/nguoi`);
    await page.until(`document.querySelectorAll("#people-rows tr").length > 0`, "danh sách người");
    await page.eval(`(() => { const f = document.getElementById("person-form"); f.dangNhap.value = "lan.kho"; f.ten.value = "Lan"; f.vai.value = "nhan-vien"; f.matKhau.value = "mat-khau-lan-kho"; f.requestSubmit(); })()`);
    await page.until(`[...document.querySelectorAll("#people-rows td")].some((td) => td.textContent === "lan.kho")`, "tài khoản mới hiện ra");

    const refused = await fetch(`${origin}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: "lan.kho", password: "mat-khau-lan-kho", deviceId: "may-kho-cua-lan-01", deviceName: "Máy kho" }) });
    assert.equal((await refused.json() as { error: string }).error, "device_not_approved");

    await goto(`${origin}/admin/nguoi`);
    await page.until(`[...document.querySelectorAll("#device-rows td")].some((td) => td.textContent.includes("may-kho-cua-lan-01"))`, "máy chờ duyệt");
    await page.eval(`(() => {
      const row = [...document.querySelectorAll("#device-rows tr")].find((tr) => tr.textContent.includes("may-kho-cua-lan-01"));
      [...row.querySelectorAll("button")].find((b) => b.textContent === "Duyệt").click();
    })()`);
    await page.until(`[...document.querySelectorAll("#device-rows tr")].some((tr) => tr.textContent.includes("may-kho-cua-lan-01") && tr.textContent.includes("Đã duyệt"))`, "máy đã duyệt");
    const accepted = await fetch(`${origin}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: "lan.kho", password: "mat-khau-lan-kho", deviceId: "may-kho-cua-lan-01" }) });
    assert.equal(accepted.status, 200);
    assert.deepEqual(exceptions(), []);
  });

  // ---- /admin/desk: OMI's own screens (Sales Desk layout) on the person's session (17/09/2026) ----
  const deskClick = (text: string) => page.eval(`(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === ${JSON.stringify(text)} && x.offsetParent);
    if (!b) throw new Error("không thấy nút ${text.replace(/"/g, "")}");
    b.click();
  })()`);
  const setValue = (id: string, value: string) => page.eval(`(() => {
    const e = document.getElementById(${JSON.stringify(id)});
    e.value = ${JSON.stringify(value)};
    e.dispatchEvent(new Event("input", { bubbles: true }));
    e.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  const ordersOf = async (q: string) => (await (await fetch(`${origin}/api/orders?q=${encodeURIComponent(q)}&limit=5`, { headers: machine })).json()) as { id: string; shippingFee: number; shippingNote: string; tags: string; total: number; items: { productCode: string; size: string }[] }[];

  await t.test("DESK: the web OMI opens on the owner's session and lists the orders of a tab", async () => {
    await goto(`${origin}/admin/desk`);
    await page.until(`document.querySelectorAll("tbody tr").length > 0 || document.body.textContent.includes("0 đơn.")`, "màn đơn hàng của bàn bán hàng", 30000);
    await page.until(`[...document.querySelectorAll("button")].some((b) => /Đơn mới\\s*\\d+/.test(b.textContent))`, "số đơn trên tab");
    assert.deepEqual(exceptions(), []);
  });

  await t.test("DESK: a new order typed in the Desk editor — product by size, customer, shipping fee, tags — lands with every field", async () => {
    await deskClick("+ Đơn thủ công");
    await page.until(`!document.getElementById("oe-khung").hidden`, "trình soạn đơn");
    await setValue("manageOrderSku", "UI-TEST-1");
    await page.until(`document.querySelector('[data-sku-size="UI-TEST-1|42"]')`, "gợi ý size 42");
    await page.eval(`document.querySelector('[data-sku-size="UI-TEST-1|42"]').click()`);
    await setValue("manageOrderCustomerPhoneLookup", "0987001122");
    await setValue("manageOrderCustomerName", "Khách bàn web");
    await setValue("manageOrderAddressDetail", "12 Phố Huế, Hà Nội");
    await setValue("manageOrderShippingFee", "30000");
    await setValue("manageOrderTags", "vip");
    await page.eval(`document.getElementById("oe-luu").click()`);
    await page.until(`document.getElementById("oe-khung").hidden`, "đơn đã lưu, trình soạn đóng", 20000);
    const [made] = await ordersOf("Khách bàn web");
    assert.ok(made, "đơn mới có trên máy chủ");
    assert.equal(made!.shippingFee, 30000);
    assert.equal(made!.tags, "vip");
    const goods = made!.items.reduce((sum, m) => sum + Number((m as { price?: number }).price ?? 0) * Number((m as { qty?: number }).qty ?? 1), 0);
    assert.equal(made!.total, goods + 30000, "tiền hàng + 30.000 ship");
    assert.deepEqual(made!.items.map((m) => `${m.productCode}|${m.size}`), ["UI-TEST-1|42"]);
    assert.deepEqual(exceptions(), []);
  });

  await t.test("DESK: the order opens, 'Sửa đơn' edits shipping fee and note, and the change is saved", async () => {
    const [made] = await ordersOf("Khách bàn web");
    // After "Tạo đơn hàng" the screen opens the new order's detail panel (as Desk does) — edit from there.
    await page.until(`[...document.querySelectorAll("h1,h2,h3,h4,strong,div")].some((e) => e.offsetParent && e.children.length === 0 && e.textContent.includes(${JSON.stringify(made!.id)}))`, "chi tiết đơn vừa tạo")
      .catch(async (e) => { throw new Error(`${(e as Error).message}: ${await page.eval<string>(`document.body.innerText.slice(0, 600)`)}`); });
    await deskClick("Sửa đơn");
    await page.until(`!document.getElementById("oe-khung").hidden && document.getElementById("oe-luu").textContent === "Lưu thay đổi"`, "trình soạn ở chế độ sửa");
    await setValue("manageOrderShippingFee", "50000");
    await setValue("manageOrderShippingNote", "gọi trước khi giao");
    await page.eval(`document.getElementById("oe-luu").click()`);
    await page.until(`document.getElementById("oe-khung").hidden`, "đã lưu thay đổi", 20000);
    const [after] = await ordersOf("Khách bàn web");
    assert.equal(after!.shippingFee, 50000);
    assert.equal(after!.shippingNote, "gọi trước khi giao");
    assert.equal(after!.total, made!.total + 20000, "tổng tiền theo phí ship mới");
    assert.deepEqual(exceptions(), []);
  });

  await t.test("DESK: a customer profile is created from the Khách hàng screen", async () => {
    await page.eval(`[...document.querySelectorAll(".nav-item")].find((b) => b.textContent.includes("Khách hàng") && b.offsetParent).click()`);
    await deskClick("Tạo khách hàng mới");
    await page.until(`!document.getElementById("pf-khung").hidden`, "khung hồ sơ khách");
    await setValue("profileName", "Chị Hồ Sơ Web");
    await setValue("profilePhone", "0977123456");
    await setValue("profileUsualSize", "39");
    await page.eval(`document.getElementById("pf-luu").click()`);
    await page.until(`document.getElementById("pf-khung").hidden || /^Đã lưu/.test(document.getElementById("pf-trang-thai").textContent)`, "hồ sơ đã lưu", 20000)
      .catch(async (e) => { throw new Error(`${(e as Error).message}: ${await page.eval<string>(`document.getElementById("pf-trang-thai").textContent`)}`); });
    const found = await (await fetch(`${origin}/api/admin/ho-so-khach?limit=2000`, { headers: machine })).json();
    assert.ok(JSON.stringify(found).includes("Chị Hồ Sơ Web"), `hồ sơ có trên máy chủ: ${JSON.stringify(found).slice(0, 300)}`);
    assert.deepEqual(exceptions(), []);
  });

  await t.test("DESK: 'Tạo vận đơn' for the order answers with a sentence (no carrier keys here) and breaks nothing", async () => {
    const [made] = await ordersOf("Khách bàn web");
    await page.eval(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Landing page").click()`);
    await page.eval(`[...document.querySelectorAll(".nav-item")].find((b) => b.textContent.includes("Vận đơn") && b.offsetParent).click()`);
    await page.until(`document.getElementById("vd-ma-don")`, "màn vận đơn");
    await setValue("vd-ma-don", made!.id);
    await setValue("vd-hang", "spx");
    await setValue("vd-can-nang", "1");
    const before = await page.eval<string>(`document.getElementById("vd-tao-trang-thai").textContent`);
    await page.eval(`document.getElementById("nut-van-don-tao").click()`);
    await page.until(`document.getElementById("vd-tao-trang-thai").textContent !== ${JSON.stringify(before)} && !/Đang/.test(document.getElementById("vd-tao-trang-thai").textContent)`, "câu trả lời tạo vận đơn", 20000);
    const said = await page.eval<string>(`document.getElementById("vd-tao-trang-thai").textContent`);
    assert.ok(said.trim().length > 5, said);
    assert.deepEqual(exceptions(), []);
  });

  await t.test("no request went unanswered by the translator and the server logged no module failure", async () => {
    const failures = logger.lines.filter((l) => /lỗi ở /.test(l.text)).map((l) => l.text);
    assert.deepEqual(failures, []);
    assert.deepEqual(exceptions(), []);
    assert.deepEqual(serverErrors(), []);
  });
  page.close();
});
