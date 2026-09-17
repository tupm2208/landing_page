/**
 * Đ10 on REAL MySQL (port 3307): the twin-site column on orders and the stock services the shop features use.
 *
 *   1. an order remembers its site; the list and the tab counts filter by it; a web customer cannot invent a
 *      site (breaks if `site` is taken from the body without the shop's `site_doi_ma`)
 *   2. writing ONE warehouse of partner stock keeps that source's lines in other warehouses (breaks if
 *      `writeItems` replacing (code, source) wipes a second partner's sizes)
 *   3. setting an exact number goes through the stock book (breaks if the shelf and the book disagree)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ROLE, defineModule, type Reply } from "../dist/contract/index.js";
import { FakeHttpClient, FakeStaticFilePort, FixedWindowRateLimiter, Kernel, ManualClock, MemoryLogger, MemoryMailer, MemoryUploadPort, TokenAuth, openMysqlStore } from "../dist/kernel/index.js";
import { manifest as orders } from "../dist/modules/don-khach/module.js";
import { manifest as inventory } from "../dist/modules/hang-kho/module.js";
import { manifest as shopFeatures } from "../dist/modules/tinh-nang-shop/module.js";

const ADMIN = "ma-quan-tri";
const URL = String(process.env["TOPRUN_MYSQL_URL"] || "").trim();
const skip = URL ? {} : { skip: "TOPRUN_MYSQL_URL not set — skipping the Đ10 tests" };
if (URL && /:3306\//.test(URL)) throw new Error("Cổng 3306 là dữ liệu thật của landing. Dùng 3307.");

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- wire fields

test("Đ10 twin site + shop-feature stock services on real MySQL", { ...skip }, async (t) => {
  const logger = new MemoryLogger();
  const clock = new ManualClock();
  const store = await openMysqlStore({ url: URL, logger });
  await store.runSchema(inventory.id, inventory.schema ?? []);
  await store.runSchema(orders.id, orders.schema ?? [], { inheritedTables: orders.inheritedTables ?? [] });
  const cleanUp = async () => {
    clock.advance(11 * 60 * 1000);
    for (const table of ["order_status_logs", "order_items", "orders", "hang_kho_bien_dong", "hang_kho_ban_chup", "hang_kho_giu_cho", "hang_kho_bien_the", "hang_kho_mon"]) {
      await store.execute(`DELETE FROM \`${table}\``).catch(() => undefined);
    }
    await store.execute("DELETE FROM so_du_lieu WHERE ten LIKE ?", ["tinh-nang-shop-%"]).catch(() => undefined);
  };
  await cleanUp();
  t.after(async () => { await cleanUp(); await store.close(); });

  const settings = { site_doi_ma: "dasbui", site_doi_dia_chi: "https://dasbui.test" };
  const platform = defineModule({ id: "khung-nen-tang", name: "Nền giả", tier: "khung", runsOn: "server-khach", version: "0.0.1", provides: { "khung-nen-tang.settings": async () => settings } });
  const kernel = new Kernel({
    ports: {
      store, logger, clock, http: new FakeHttpClient((url: string) => {
        const json = (b: unknown) => ({ ok: true, status: 200, json: async () => b, text: async () => JSON.stringify(b) });
        if (url.startsWith("https://das.test/wp-json/wc/store/v1/products")) return json(url.includes("page=1") ? [{ id: 1, name: "Giày chạy đối tác P1", sku: "P1", prices: { price: "1200000", regular_price: "0", currency_minor_unit: 0 }, attributes: [{ name: "Size", terms: [{ name: "41" }] }], is_in_stock: true, images: [] }] : []);
        if (url.startsWith("https://runner.test/collections/all/products.json")) return json({ products: url.includes("page=1") ? [{ id: 2, title: "Giày chạy P1", handle: "p1", variants: [{ sku: "P1-42", option1: "42", price: "1100000", available: true }, { sku: "P1-43", option1: "43", price: "1100000", available: true }] }] : [] });
        throw new Error(`no fake for ${url}`);
      }),
      auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }], clock }),
      rateLimiter: new FixedWindowRateLimiter(clock), staticFiles: new FakeStaticFilePort({}), mail: new MemoryMailer(), uploads: new MemoryUploadPort()
    },
    logger, modules: [inventory, orders, platform, shopFeatures], config: { "hang-kho": {}, "don-khach": { siteUrl: "https://shop.test" } }
  });
  const admin = { authorization: `Bearer ${ADMIN}` };
  const call = (method: string, full: string, json?: unknown, headers: Record<string, string> = admin): Promise<Reply> => {
    const [path = "", search = ""] = full.split("?");
    return kernel.handle({ method, path, query: Object.fromEntries(new URLSearchParams(search)), headers, ip: "1.1.1.1", json: async () => json ?? {} });
  };

  await t.test("an order remembers its site; list and tab counts filter by it; a web customer cannot invent a site", async () => {
    await cleanUp();
    await call("PUT", "/api/hang-kho/mon/W1", { code: "W1", name: "Giày web", sizes: [{ size: "42", qty: 5, price: 1000000, warehouseId: "kho_shop" }] });
    const main = await call("POST", "/api/orders/thu-cong", { customerName: "A", phone: "0901", items: [{ productCode: "X1", size: "42", qty: 1, price: 100000 }] });
    clock.advance(5_000);
    const twin = await call("POST", "/api/orders/thu-cong", { customerName: "B", phone: "0902", site: "DasBui", items: [{ productCode: "X1", size: "42", qty: 1, price: 100000 }] });
    assert.equal(twin.status, 200, JSON.stringify(twin.body));
    const all = (await call("GET", "/api/orders?limit=50")).body as Body[];
    assert.equal(all.length, 2);
    assert.equal(all.find((o) => o.id === (twin.body as Body).orderId)!.site, "dasbui");
    assert.deepEqual(((await call("GET", "/api/orders?site=dasbui")).body as Body[]).map((o) => o.id), [(twin.body as Body).orderId]);
    assert.deepEqual(((await call("GET", "/api/orders?site=chinh")).body as Body[]).map((o) => o.id), [(main.body as Body).orderId]);
    assert.equal(((await call("GET", "/api/admin/orders/dem-quy-trinh?site=dasbui")).body as Body).tongDangHoatDong, 1);

    const web = async (body: Body, headers: Record<string, string> = {}) => {
      clock.advance(60_000);
      const r = await call("POST", "/api/orders", { customerName: "Web", phone: "0903", items: [{ productCode: "W1", size: "42", qty: 1 }], ...body }, headers);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return ((await call("GET", `/api/orders/${(r.body as Body).id}`)).body as Body).site;
    };
    assert.equal(await web({ site: "fake" }), "", "an unknown site is the main site");
    assert.equal(await web({ site: "dasbui" }), "dasbui");
    assert.equal(await web({}, { origin: "https://dasbui.test" }), "dasbui", "recognised by the twin storefront's origin");
  });

  await t.test("partner stock in one warehouse keeps the same source's other warehouse; exact numbers go through the stock book", async () => {
    await cleanUp();
    await call("POST", "/api/tinh-nang-shop/nguon", { nguon: [
      { ma: "runner", ten: "Runner", nenTang: "haravan", diaChi: "https://runner.test", cheDo: "thu-cong" },
      { ma: "das", ten: "Das", nenTang: "woocommerce", diaChi: "https://das.test" }
    ] });
    await call("PUT", "/api/hang-kho/mon/P1", { code: "P1", name: "Giày đối tác", sizes: [{ size: "40", qty: 1, price: 900000, warehouseId: "kho_shop" }] });
    // Das (web): fetched + synced into its warehouse. Runner (manual): catalogue bootstrapped into ITS warehouse.
    assert.equal((await call("POST", "/api/tinh-nang-shop/doi-tac/tai", { nguon: "das" })).status, 200);
    const synced = await call("POST", "/api/tinh-nang-shop/doi-tac/dong-bo", { nguon: "das" });
    assert.equal(synced.status, 200, JSON.stringify(synced.body));
    const boot = await call("POST", "/api/tinh-nang-shop/thu-cong/tai", { nguon: "runner" });
    assert.equal(boot.status, 200, JSON.stringify(boot.body));
    const tick = await call("POST", "/api/tinh-nang-shop/thu-cong/size", { nguon: "runner", ma: "P1", size: "42", con: true });
    assert.equal(tick.status, 200, JSON.stringify(tick.body));
    const lines = await store.rows("SELECT ma_kho, nguon, ton FROM hang_kho_bien_the WHERE ma_mon = 'P1' ORDER BY ma_kho, size");
    assert.deepEqual(lines.map((l) => [l["ma_kho"], l["nguon"], Number(l["ton"])]), [["kho_shop", "own", 1], ["wh_doi_tac_das", "campaign", 1], ["wh_doi_tac_runner", "campaign", 1], ["wh_doi_tac_runner", "campaign", 0]],
      "the runner bootstrap did not wipe das's lines of the same code");
    const book = await store.rows("SELECT ma_kho, so_luong FROM hang_kho_bien_dong WHERE ma_mon = 'P1'");
    assert.equal(book.length, 1, "the tick is a movement row");

    // The lookup sees both partner sources separately, and editing one leaves the other.
    const found = (await call("POST", "/api/tinh-nang-shop/tra-ton", { q: "P1", chiConHang: false })).body as Body;
    assert.deepEqual(found.sources.map((s: Body) => [s.source, s.variants.length]), [["kho", 1], ["runner", 2], ["das", 1]]);
    const edit = await call("POST", "/api/tinh-nang-shop/sua-ton", { nguon: "das", ma: "P1", size: "41", soLuong: 4 });
    assert.equal(edit.status, 200, JSON.stringify(edit.body));
    const after = await store.rows("SELECT ma_kho, ton FROM hang_kho_bien_the WHERE ma_mon = 'P1' AND nguon = 'campaign' ORDER BY ma_kho, size");
    assert.deepEqual(after.map((l) => [l["ma_kho"], Number(l["ton"])]), [["wh_doi_tac_das", 4], ["wh_doi_tac_runner", 1], ["wh_doi_tac_runner", 0]]);

    // Zalo command on real rows: "tồn P1 42 runner 0" picks the warehouse by a part of its id.
    const said = (await call("POST", "/api/tinh-nang-shop/lenh-ton", { nguoi: "lan", chu: "tồn P1 42 runner 0" })).body as Body;
    assert.match(said.traLoi, /wh_doi_tac_runner: 1 → 0/);
    const undo = (await call("POST", "/api/tinh-nang-shop/lenh-ton", { nguoi: "lan", chu: "hoàn" })).body as Body;
    assert.match(undo.traLoi, /0 → 1/);
  });
});
