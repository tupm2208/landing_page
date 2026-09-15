/**
 * Catalogue & inventory — on REAL MySQL tables (since round 2b).
 *
 *   TOPRUN_MYSQL_URL=mysql://root:...@127.0.0.1:3307/<test db> node --test test-mysql/inventory.test.mts
 *
 * Focus: NEVER leak cost price / real stock / warehouse names into the public view; a
 * reservation never holds more than what is in stock; and the three stock sources (house,
 * campaign, ready) sync independently — syncing one must not touch another.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCESS, EVENTS, ROLE, defineModule, reply, type IncomingRequest, type Reply } from "../dist/contract/index.js";
import {
  FakeHttpClient, FixedWindowRateLimiter, Kernel, ManualClock, MemoryLogger, TokenAuth, openMysqlStore
} from "../dist/kernel/index.js";
import {
  manifest, type InventoryServices, type ReleaseInput, type ReleaseResult, type ReserveInput, type ReserveResult
} from "../dist/modules/hang-kho/module.js";
import type { StoredItem } from "../dist/modules/hang-kho/catalog-repository.js";
import type { PublicItem } from "../dist/modules/hang-kho/normalise.js";

const ADMIN = "ma-quan-tri";
const SERVICE = "ma-bo-nao";
const URL = String(process.env["TOPRUN_MYSQL_URL"] || "").trim();
const unlessMysql = URL ? {} : { skip: "chưa đặt TOPRUN_MYSQL_URL — bỏ qua bài hàng hoá" };
if (URL && /:3306\//.test(URL)) throw new Error("Cổng 3306 là dữ liệu thật của landing. Dùng 3307.");

const ITEM = {
  code: "DV1234",
  name: "Giày chạy Nike Pegasus 40",
  brand: "Nike",
  listPrice: 3500000,
  warehousePriorityIds: ["wh_yen", "wh_cau_dien"],
  sizes: [
    { size: "42", qty: 3, price: 2890000, warehouseId: "wh_cau_dien", warehouse: "Cầu Diễn" },
    { size: "42", qty: 2, price: 2890000, warehouseId: "wh_yen", warehouse: "Yên" },
    { size: "43", qty: 0, price: 2890000, warehouseId: "wh_yen", warehouse: "Yên" }
  ]
};

/** Reply bodies as the tests read them (the Vietnamese wire of the HTTP doors). */
interface SyncBody { ok: boolean; error?: string; soMon: number; soBienThe: number; biBo: number; revision?: number; revisionHienTai?: number }
interface WriteBody { ok: boolean; error?: string; mon: StoredItem; soBienThe: number }
interface DeleteBody { ok: boolean; conNguonKhac: boolean }
interface StockLineBody { maBienThe: string; size: string; soLuong: number; gia: number; maKho: string; thuTu: number }
interface StockBody { co: boolean; viSao?: string; ma?: string; ten?: string; cacDong: StockLineBody[] }
const body = <T,>(r: Reply): T => r.body as T;

// TEST MODULE: calls hang-kho's real services the way the kernel wires them.
const TEST_MODULE = defineModule<Record<string, never>, { "hang-kho": Pick<InventoryServices, "reserve" | "release" | "commit" | "restock"> }>({
  id: "thu-giu-cho", name: "Thử giữ chỗ", tier: "van-hanh", runsOn: "server-khach", version: "0.0.1",
  requires: ["hang-kho.reserve", "hang-kho.release", "hang-kho.commit", "hang-kho.restock"],
  routes: [
    {
      method: "POST", path: "/thu/giu", access: ACCESS.admin,
      handle: async (ctx, request) => reply.json(await ctx.services["hang-kho"].reserve((await request.json()) as ReserveInput))
    },
    {
      method: "POST", path: "/thu/tra", access: ACCESS.admin,
      handle: async (ctx, request) => reply.json(await ctx.services["hang-kho"].release((await request.json()) as ReleaseInput))
    },
    {
      method: "POST", path: "/thu/chot", access: ACCESS.admin,
      handle: async (ctx, request) => reply.json(await ctx.services["hang-kho"].commit((await request.json()) as { ticket: string }))
    },
    {
      method: "POST", path: "/thu/tra-lai", access: ACCESS.admin,
      handle: async (ctx, request) => reply.json(await ctx.services["hang-kho"].restock((await request.json()) as { variantId: string; quantity: number }))
    }
  ]
});

test("Catalogue on real MySQL", unlessMysql, async (t) => {
  const logger = new MemoryLogger();
  const clock = new ManualClock();
  const store = await openMysqlStore({ url: URL, logger });
  await store.runSchema("hang-kho", manifest.schema ?? []);

  // Cleans between subtests. `clock.advance` is ON PURPOSE: the catalogue door is limited to
  // 20 calls / 10 minutes and this file calls it nearly 20 times — without stepping past a window
  // the last subtests get rate-limited for real (correct block, wrong test). Stepping also expires
  // every leftover reservation ticket.
  const clean = async () => {
    clock.advance(11 * 60 * 1000);
    // Also drop the ready-stock `revision` document: it is state between two runs, and the test
    // "an old payload must not overwrite a newer one" depends on it.
    await store.execute("DELETE FROM so_du_lieu WHERE ten = ?", ["hang-kho-hang-co-san"]);
    for (const table of ["hang_kho_giu_cho", "hang_kho_bien_the", "hang_kho_mon", "hang_kho_ma_chan"]) await store.table(table).truncate();
  };
  await clean();
  t.after(async () => { await clean(); await store.close(); });

  const kernel = new Kernel({
    ports: {
      store, logger, clock, http: new FakeHttpClient(),
      auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }, { token: SERVICE, name: "bo-nao", role: ROLE.service }], clock }),
      rateLimiter: new FixedWindowRateLimiter(clock)
    },
    logger, modules: [manifest, TEST_MODULE], config: { "hang-kho": {} }
  });

  const admin = { authorization: `Bearer ${ADMIN}` };
  const call = (request: IncomingRequest) => kernel.handle({ ip: "1.1.1.1", ...request });
  const upload = (items: unknown = [ITEM], path = "/api/products") => call({ method: "POST", path, headers: admin, json: async () => items });
  const readPublic = (query: Record<string, string> = {}) => call({ method: "GET", path: "/api/products", query });
  const readHouse = () => call({ method: "GET", path: "/api/admin/products", headers: admin });
  const askStock = (code: string, size?: string) => call({
    method: "GET", path: `/api/hang-kho/ton/${code}`, query: size ? { size } : {}, headers: { authorization: `Bearer ${SERVICE}` }
  });
  const reserve = (input: ReserveInput) => call({ method: "POST", path: "/thu/giu", headers: admin, json: async () => input });
  const release = (input: ReleaseInput) => call({ method: "POST", path: "/thu/tra", headers: admin, json: async () => input });
  const hold = (code: string, size: string, quantity: number): ReserveInput => ({ code, size, quantity, heldBy: "bai-thu" });
  const publicItems = async (query?: Record<string, string>) => body<PublicItem[]>(await readPublic(query));
  const stockOf = async (code: string, size?: string) => body<StockBody>(await askStock(code, size));

  await t.test("every import is remembered: what ran, from which source, how many items — newest first", async () => {
    await clean();
    await upload([ITEM]);
    await upload([{ ...ITEM, code: "THEM01", name: "Giày nạp thêm", sizes: [{ size: "40", qty: 1, price: 900000 }] }], "/api/hang-kho/nap-them");

    const book = body<{ lan: Record<string, unknown>[] }>(await call({ method: "GET", path: "/api/hang-kho/lich-su-nap", headers: admin }));
    assert.ok(book.lan.length >= 2, "both imports are in the book");
    assert.match(String(book.lan[0]?.["viec"]), /nạp thêm/, "newest first");
    assert.equal(book.lan[0]?.["nguon"], "own");
    assert.equal(Number(book.lan[0]?.["soMon"]), 1);
    assert.ok(String(book.lan[0]?.["luc"]).length > 0, "each entry says when");
    assert.equal((await call({ method: "GET", path: "/api/hang-kho/lich-su-nap" })).status, 401, "needs the admin token");
  });

  await t.test("SỬA NHANH: bulk edit changes only price/discount/shown — never stock, sizes or names", async () => {
    await clean();
    await upload([ITEM, { ...ITEM, code: "KHAC01", name: "Giày khác", sizes: [{ size: "40", qty: 2, price: 1000000 }] }]);
    const quick = (mon: unknown) => call({ method: "POST", path: "/api/hang-kho/sua-nhanh", headers: admin, json: async () => ({ mon }) });

    const r = await quick([
      { ma: ITEM.code, giaNiemYet: 3500000, giamGia: 30 },
      { ma: "KHAC01", trangThai: "hidden" },
      { ma: "KHONG-CO", giaNiemYet: 1 }
    ]);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const done = body<{ daSua: string[]; khongThay: string[] }>(r);
    assert.deepEqual(done.daSua.sort(), [ITEM.code, "KHAC01"].sort());
    assert.deepEqual(done.khongThay, ["KHONG-CO"], "a typo is reported, never quietly created");
    assert.equal(await store.table("hang_kho_mon").count(), 2, "a code nobody knows does not become an item");

    const row = await store.table("hang_kho_mon").one({ ma: ITEM.code });
    assert.equal(Number(row?.["gia_niem_yet"]), 3500000);
    assert.equal(Number(row?.["phan_tram_giam"]), 30);
    assert.equal(String(row?.["ten"]), ITEM.name, "the name is not a field of the fast screen");
    assert.equal(await store.table("hang_kho_bien_the").count({ ma_mon: ITEM.code }), 3, "sizes untouched");
    assert.equal((await stockOf(ITEM.code, "42")).co, true, "stock untouched");
    assert.equal(String((await store.table("hang_kho_mon").one({ ma: "KHAC01" }))?.["trang_thai"]), "hidden");

    // A bulk screen with no ceiling is a bulk mistake.
    const tooMany = await quick(Array.from({ length: 1001 }, (_v, i) => ({ ma: `M${i}`, giamGia: 5 })));
    assert.equal(tooMany.status, 400);
    assert.equal(body<{ error: string }>(tooMany).error, "qua_nhieu_mon");
    assert.equal((await call({ method: "POST", path: "/api/hang-kho/sua-nhanh", json: async () => ({ mon: [] }) })).status, 401, "needs the admin token");
  });

  await t.test("one item becomes one item row plus several variant rows", async () => {
    await clean();
    const r = await upload();
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(body<SyncBody>(r).soMon, 1);
    assert.equal(body<SyncBody>(r).soBienThe, 3);
    assert.equal(await store.table("hang_kho_mon").count(), 1);
    assert.equal(await store.table("hang_kho_bien_the").count(), 3);
  });

  await t.test("OMI writes/edits/deletes ONE item (PUT/DELETE /api/hang-kho/mon/:ma) — other items untouched", async () => {
    await clean();
    await upload([ITEM, { ...ITEM, code: "KHAC01", name: "Giày khác", sizes: [{ size: "40", qty: 2, price: 1000000 }] }]);
    const write = (code: string, item: unknown) => call({ method: "PUT", path: `/api/hang-kho/mon/${code}`, headers: admin, json: async () => item });
    const remove = (code: string) => call({ method: "DELETE", path: `/api/hang-kho/mon/${code}`, headers: admin });

    // Add a new item.
    const added = await write("MOI01", { code: "MOI01", name: "Giày mới nhập tay", brand: "Asics", listPrice: 2000000, sizes: [{ size: "41", qty: 1, price: 1500000 }, { size: "42", qty: 0, price: 1500000 }] });
    assert.equal(added.status, 200, JSON.stringify(added.body));
    assert.equal(body<WriteBody>(added).mon.code, "MOI01");
    assert.equal(body<WriteBody>(added).soBienThe, 2);
    assert.equal(await store.table("hang_kho_mon").count(), 3, "the two older items are still there");

    // Edit: rename, drop a size -> that item's old variants are replaced, other items unchanged.
    const edited = await write("MOI01", { name: "Giày mới (đã sửa)", sizes: [{ size: "41", qty: 4, price: 1400000 }] });
    assert.equal(edited.status, 200);
    assert.equal(body<WriteBody>(edited).mon.name, "Giày mới (đã sửa)");
    assert.equal(body<WriteBody>(edited).mon.sizes.length, 1);
    assert.equal((await stockOf("DV1234", "42")).co, true, "the older item is still in stock");

    // The code in the path must match the code in the body; a missing name is reported clearly.
    assert.equal((await write("MOI01", { code: "KHAC", name: "x" })).status, 400);
    assert.equal(body<WriteBody>(await write("MOI02", { sizes: [] })).error, "mon_bi_bo");
    assert.equal((await call({ method: "PUT", path: "/api/hang-kho/mon/MOI01", json: async () => ({}) })).status, 401, "needs the admin token");

    // Delete: the item goes, the other stays; deleting again is 404.
    assert.equal((await remove("MOI01")).status, 200);
    assert.equal(await store.table("hang_kho_mon").count(), 2);
    assert.equal((await remove("MOI01")).status, 404);

    // Deleting an item that still has variants of ANOTHER source (ready stock): only the house part goes, the item row stays.
    await store.table("hang_kho_bien_the").insert({ ma_bien_the: "bt-ready-dv1234", ma_mon: "DV1234", size: "42", ma_kho: "wh_ready", ton: 1, gia: 2500000, gia_niem_yet: 0, thu_tu_kho: 1, nguon: "ready", ma_chien_dich: "", ma_dong_doi_tac: "", sua_luc: new Date() });
    const removed = await remove("DV1234");
    assert.equal(removed.status, 200);
    assert.equal(body<DeleteBody>(removed).conNguonKhac, true);
    assert.equal(await store.table("hang_kho_mon").count({ ma: "DV1234" }), 1, "the item row stays because ready stock still points at it");
    assert.equal(await store.table("hang_kho_bien_the").count({ ma_mon: "DV1234" }), 1, "only the ready-stock line remains");
  });

  await t.test("OMI imports from Excel (POST /api/hang-kho/nap-them): adds, never deletes existing items; same code -> the later line wins", async () => {
    await clean();
    await upload();
    const r = await call({ method: "POST", path: "/api/hang-kho/nap-them", headers: admin, json: async () => [
      { code: "EX01", name: "Excel 1", sizes: [{ size: "40", qty: 1, price: 900000 }] },
      { code: "EX02", name: "Excel 2", sizes: [{ size: "40", qty: 1, price: 900000 }] },
      { code: "EX02", name: "Excel 2 (dòng sau)", sizes: [{ size: "41", qty: 2, price: 950000 }] },
      { code: "", name: "thiếu mã" }
    ] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(body<SyncBody>(r).soMon, 2);
    assert.equal(body<SyncBody>(r).biBo, 1);
    assert.equal(await store.table("hang_kho_mon").count(), 3, "the older item DV1234 is still there");
    const ex2 = body<StoredItem[]>(await readHouse()).find((m) => m.code === "EX02");
    assert.ok(ex2);
    assert.equal(ex2.name, "Excel 2 (dòng sau)");
    assert.deepEqual(ex2.sizes.map((s) => s.size), ["41"]);
    assert.equal((await call({ method: "POST", path: "/api/hang-kho/nap-them", headers: admin, json: async () => ({ x: 1 }) })).status, 400);
  });

  await t.test("the public view carries no cost price, real stock or warehouse priority", async () => {
    await clean();
    await upload([{ ...ITEM, costPrice: 1500000, warehouseStocks: { wh_yen: 5 } }]);
    const json = JSON.stringify(await publicItems());
    assert.ok(!json.includes("costPrice"), "leaks the cost price");
    assert.ok(!json.includes("warehouseStocks"), "leaks stock per warehouse");
    assert.ok(!/Cầu Diễn|"Yên"/.test(json), "leaks warehouse names");
  });

  await t.test("the public view says in stock or sold out, NEVER how many", async () => {
    await clean(); await upload();
    const item = (await publicItems())[0]!;
    for (const s of item.sizes.filter((x) => x.size === "42")) assert.equal(s.qty, 1);
    assert.equal(item.sizes.find((x) => x.size === "43")!.available, false);
  });

  await t.test("the house view HAS real stock, and needs the admin token", async () => {
    await clean(); await upload();
    assert.equal((await call({ method: "GET", path: "/api/admin/products" })).status, 401);
    const item = body<StoredItem[]>(await readHouse())[0]!;
    assert.equal(item.sizes.filter((s) => s.size === "42").reduce((sum, s) => sum + s.qty, 0), 5);
  });

  await t.test("opening one item by code or by slug both work", async () => {
    await clean(); await upload();
    const byCode = await call({ method: "GET", path: "/api/products/DV1234" });
    assert.equal(byCode.status, 200);
    const bySlug = await call({ method: "GET", path: `/api/products/${body<PublicItem>(byCode).slug}` });
    assert.equal(body<PublicItem>(bySlug).code, "DV1234");
    assert.equal((await call({ method: "GET", path: "/api/products/khong-co" })).status, 404);
  });

  await t.test("search by name: exact code first, then name matches", async () => {
    await clean();
    await upload([ITEM, { ...ITEM, code: "PEG40", name: "Dép Nike" }]);
    const items = await publicItems({ q: "pegasus" });
    assert.equal(items.length, 1);
    assert.equal(items[0]!.code, "DV1234");
  });

  // ---------- three stock sources ----------

  await t.test("syncing READY STOCK does not touch house stock", async () => {
    await clean();
    await upload();                                  // house stock: 3 variants
    // A ready-stock warehouse must be on the declared list (wh_toprun* / wh_partner_dasbui) —
    // see RULE 1 in desk-payloads.ts. An unknown warehouse's line is dropped.
    await upload([{ code: "RS01", name: "Hàng có sẵn A", sizes: [{ size: "41", qty: 2, price: 1000000, warehouseId: "wh_toprun_yen" }] }],
      "/api/ready-stock/sync");
    assert.equal(await store.table("hang_kho_bien_the").count({ nguon: "own" }), 3, "house stock must be intact");
    assert.equal(await store.table("hang_kho_bien_the").count({ nguon: "ready" }), 1);

    // Second ready-stock sync: replaces only its own rows.
    await upload([{ code: "RS02", name: "Hàng có sẵn B", sizes: [{ size: "40", qty: 1, price: 900000, warehouseId: "wh_toprun_cau_dien" }] }],
      "/api/ready-stock/sync");
    assert.equal(await store.table("hang_kho_bien_the").count({ nguon: "own" }), 3, "a ready-stock sync must not touch house stock");
    assert.equal(await store.table("hang_kho_bien_the").count({ nguon: "ready" }), 1);
    assert.equal(await store.table("hang_kho_mon").one({ ma: "RS01" }), null, "the old ready-stock item must be replaced");
  });

  await t.test("an OLD ready-stock payload must not overwrite a newer one", async () => {
    await clean();
    const payload = (revision: number, code: string, size: string) => ({
      revision,
      branches: [{ id: "wh_toprun_yen", name: "TopRun - Yến", active: true }],
      products: [{ code, name: "Hàng có sẵn " + code, imageUrl: "a.jpg", variants: [{ size, branchId: "wh_toprun_yen", qty: 3, salePrice: 1000000 }] }]
    });

    const newer = await upload(payload(10, "RS10", "41"), "/api/ready-stock/sync");
    assert.equal(newer.status, 200, JSON.stringify(newer.body));
    assert.equal(body<SyncBody>(newer).revision, 10);

    const older = await upload(payload(9, "RS09", "42"), "/api/ready-stock/sync");
    assert.equal(older.status, 409, "revision 9 sent after revision 10 must be refused");
    assert.equal(body<SyncBody>(older).error, "goi_hang_co_san_cu");
    assert.equal(body<SyncBody>(older).revisionHienTai, 10);

    assert.ok(await store.table("hang_kho_mon").one({ ma: "RS10" }), "the newer payload's stock must be intact");
    assert.equal(await store.table("hang_kho_mon").one({ ma: "RS09" }), null);

    // The same revision passes (Desk re-sent the very same payload) — nothing is lost.
    assert.equal((await upload(payload(10, "RS10", "41"), "/api/ready-stock/sync")).status, 200);
  });

  await t.test("partner campaigns are a source of their own too", async () => {
    await clean();
    await upload();
    await upload([{ code: "CD01", name: "Hàng chiến dịch", campaignId: "sup-01", sizes: [{ size: "42", qty: 5, price: 2000000, warehouseId: "wh_sup" }] }],
      "/api/partner-campaigns");
    assert.equal(await store.table("hang_kho_bien_the").count({ nguon: "campaign" }), 1);
    assert.equal(await store.table("hang_kho_bien_the").count({ nguon: "own" }), 3);

    const items = await publicItems();
    assert.equal(items.length, 2, "both sources show on the web");
  });

  await t.test("uploading something that is not a list is refused and the old catalogue is kept", async () => {
    await clean(); await upload();
    assert.equal((await upload({ linh: "tinh" })).status, 400);
    assert.equal(await store.table("hang_kho_mon").count(), 1, "the old catalogue must be intact");
  });

  // ---------- blocked codes ----------

  await t.test("a blocked code neither reaches the web NOR is written to the table", async () => {
    await clean();
    await store.table("hang_kho_ma_chan").insert({ ma: "cam01", vi_sao: "bài kiểm tra", them_luc: "2026-09-12 00:00:00.000" });
    await upload([ITEM, { ...ITEM, code: "CAM01", name: "Món cấm bán" }]);

    assert.deepEqual((await publicItems()).map((m) => m.code), ["DV1234"]);
    assert.equal(await store.table("hang_kho_mon").count({ ma: "CAM01" }), 0, "blocked at WRITE time, not only at read time");
  });

  await t.test("blocking a code AFTER the upload removes the item from the web at once", async () => {
    await clean(); await upload();
    await store.table("hang_kho_ma_chan").insert({ ma: "dv1234", vi_sao: "", them_luc: "2026-09-12 00:00:00.000" });
    assert.equal((await publicItems()).length, 0);
  });

  // ---------- stock questions ----------

  await t.test("the brain asks for stock: right for a size in stock, right for a sold-out size", async () => {
    await clean(); await upload();
    assert.equal((await stockOf("DV1234", "42")).co, true);
    assert.equal((await stockOf("DV1234", "43")).co, false);
    assert.equal((await stockOf("DV1234")).cacDong.length, 2);
    assert.equal((await stockOf("KHONGCO")).viSao, "khong_co_ma");
  });

  await t.test("stock lines are sorted cheapest first, then by warehouse priority", async () => {
    await clean();
    await upload([{
      ...ITEM,
      warehousePriorityIds: ["wh_yen", "wh_cau_dien"],
      // Three different warehouses: one triple (item + size + warehouse) is ONE variant.
      sizes: [
        { size: "42", qty: 1, price: 2890000, warehouseId: "wh_cau_dien" },
        { size: "42", qty: 1, price: 2890000, warehouseId: "wh_yen" },
        { size: "42", qty: 1, price: 2500000, warehouseId: "wh_hang_td" }
      ]
    }]);
    const lines = (await stockOf("DV1234")).cacDong;
    assert.equal(lines[0]!.gia, 2500000, "cheapest first");
    assert.equal(lines[1]!.maKho, "wh_yen", "at the same price the higher-priority warehouse goes first");
  });

  await t.test("two DUPLICATE lines (same item + size + warehouse) must not kill the whole catalogue upload", async () => {
    await clean();
    const r = await upload([{
      ...ITEM,
      sizes: [
        { size: "42", qty: 1, price: 2890000, warehouseId: "wh_yen" },
        { size: "42", qty: 1, price: 2500000, warehouseId: "wh_yen" },   // duplicate triple
        { size: "43", qty: 2, price: 2890000, warehouseId: "wh_yen" }
      ]
    }]);
    assert.equal(r.status, 200, "one bad line must not break the whole catalogue");
    assert.equal(body<SyncBody>(r).soBienThe, 2, "the two duplicates merge into one");

    const lines = (await stockOf("DV1234", "42")).cacDong;
    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.gia, 2500000, "keeps the cheaper line");
    assert.ok(logger.has(/bị trùng/), "must log a warning so the operator knows to fix the source");
  });

  await t.test("the stock route is not open to customers", async () => {
    assert.equal((await call({ method: "GET", path: "/api/hang-kho/ton/DV1234" })).status, 401);
  });

  // ---------- reservations ----------

  await t.test("after a reservation the next customer no longer sees the pair as available", async () => {
    await clean();
    await upload([{ ...ITEM, sizes: [{ size: "42", qty: 1, price: 100000, warehouseId: "wh_yen" }] }]);
    assert.equal(body<ReserveResult>(await reserve(hold("DV1234", "42", 1))).ok, true);
    assert.equal((await publicItems())[0]!.sizes[0]!.available, false);
  });

  await t.test("NEVER reserves more than what is in stock", async () => {
    await clean();
    await upload([{ ...ITEM, sizes: [{ size: "42", qty: 1, price: 100000, warehouseId: "wh_yen" }] }]);
    assert.equal(body<ReserveResult>(await reserve(hold("DV1234", "42", 2))).ok, false, "asks for 2 when only 1 exists");
    assert.equal(body<ReserveResult>(await reserve(hold("DV1234", "42", 1))).ok, true);
    const second = body<ReserveResult>(await reserve(hold("DV1234", "42", 1)));
    assert.equal(second.ok, false);
    assert.equal(second.ok === false ? second.reason : "", "khong_du_hang");
  });

  await t.test("two people ask for the LAST pair at the same time: exactly one gets it", async () => {
    await clean();
    await upload([{ ...ITEM, sizes: [{ size: "42", qty: 1, price: 100000, warehouseId: "wh_yen" }] }]);
    const [a, b] = await Promise.all([
      reserve(hold("DV1234", "42", 1)),
      reserve(hold("DV1234", "42", 1))
    ]);
    const winners = [a, b].filter((r) => body<ReserveResult>(r).ok).length;
    assert.equal(winners, 1, "the row lock must let exactly one person hold the last pair");
  });

  await t.test("reserving the last pair emits the sold-out event", async () => {
    await clean();
    await upload([{ ...ITEM, sizes: [{ size: "42", qty: 1, price: 100000, warehouseId: "wh_yen" }] }]);
    const heard: { size?: string }[] = [];
    kernel.bus.on(EVENTS.stockOut, "bai-thu", (payload) => { heard.push(payload as { size?: string }); });
    await reserve(hold("DV1234", "42", 1));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(heard.length, 1);
    assert.equal(heard[0]!.size, "42");
  });

  await t.test("releasing a reservation makes the pair available again at once", async () => {
    await clean();
    await upload([{ ...ITEM, sizes: [{ size: "42", qty: 1, price: 100000, warehouseId: "wh_yen" }] }]);
    const held = body<ReserveResult>(await reserve(hold("DV1234", "42", 1)));
    assert.equal((await publicItems())[0]!.sizes[0]!.available, false);
    assert.equal(body<ReleaseResult>(await release({ ticket: held.ok ? held.ticket : "" })).ok, true);
    assert.equal((await publicItems())[0]!.sizes[0]!.available, true);
  });

  await t.test("an expired reservation gives the pair back by itself", async () => {
    await clean();
    await upload([{ ...ITEM, sizes: [{ size: "42", qty: 1, price: 100000, warehouseId: "wh_yen" }] }]);
    await reserve(hold("DV1234", "42", 1));
    assert.equal((await publicItems())[0]!.sizes[0]!.available, false);

    clock.advance(30 * 60 * 1000 + 1000);
    assert.equal((await publicItems())[0]!.sizes[0]!.available, true, "after 30 minutes the pair must be given back");
  });

  // ---------- Lỗ 1 (found 12/09/2026, closed 14/09): a hold that became a SALE never comes back by itself ----------

  await t.test("committing a reservation takes the pair off the shelf FOR GOOD — 30 minutes later it is still sold", async () => {
    await clean();
    await upload([{ ...ITEM, sizes: [{ size: "42", qty: 1, price: 100000, warehouseId: "wh_yen" }] }]);
    const held = body<ReserveResult>(await reserve(hold("DV1234", "42", 1)));
    assert.equal(held.ok, true);
    const committed = body<{ ok: boolean; variantId?: string; quantity?: number }>(await call({ method: "POST", path: "/thu/chot", headers: admin, json: async () => ({ ticket: held.ok ? held.ticket : "" }) }));
    assert.equal(committed.ok, true);
    assert.equal(committed.quantity, 1);
    assert.equal(await store.table("hang_kho_giu_cho").count(), 0, "the ticket is gone — nothing left to expire");
    assert.equal(Number((await store.table("hang_kho_bien_the").one({ ma_bien_the: committed.variantId ?? "" }))?.["ton"]), 0, "real stock went down");

    clock.advance(31 * 60 * 1000);
    assert.equal((await publicItems())[0]!.sizes[0]!.available, false, "THIS was the hole: the sold pair reappeared after the hold expired");
    assert.equal((await stockOf("DV1234", "42")).co, false, "the brain sees it sold out too");

    // A ticket that does not exist (already committed, or made up) is refused, not silently "ok".
    const again = body<{ ok: boolean; reason?: string }>(await call({ method: "POST", path: "/thu/chot", headers: admin, json: async () => ({ ticket: held.ok ? held.ticket : "" }) }));
    assert.equal(again.ok, false);
    assert.equal(again.reason, "khong_co_phieu");
  });

  await t.test("restocking puts the pair back and announces 'back in stock' only when it crossed zero", async () => {
    await clean();
    await upload([{ ...ITEM, sizes: [{ size: "42", qty: 1, price: 100000, warehouseId: "wh_yen" }] }]);
    const held = body<ReserveResult>(await reserve(hold("DV1234", "42", 1)));
    const variantId = held.ok ? held.variantId : "";
    await call({ method: "POST", path: "/thu/chot", headers: admin, json: async () => ({ ticket: held.ok ? held.ticket : "" }) });
    const heard: { size?: string; maBienThe?: string }[] = [];
    kernel.bus.on(EVENTS.stockBack, "bai-thu-ve-lai", (payload) => { heard.push(payload as { size?: string; maBienThe?: string }); });

    const back = body<{ ok: boolean; before?: number; after?: number }>(await call({ method: "POST", path: "/thu/tra-lai", headers: admin, json: async () => ({ variantId, quantity: 1 }) }));
    assert.equal(back.ok, true);
    assert.equal(back.before, 0);
    assert.equal(back.after, 1);
    assert.equal((await publicItems())[0]!.sizes[0]!.available, true, "cancelled order = pair on sale again");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(heard.length, 1, "crossed zero -> one 'back in stock' event");
    assert.equal(heard[0]!.maBienThe, variantId);

    // Restocking when there already was stock: no second announcement.
    await call({ method: "POST", path: "/thu/tra-lai", headers: admin, json: async () => ({ variantId, quantity: 2 }) });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(heard.length, 1);
    assert.equal(Number((await store.table("hang_kho_bien_the").one({ ma_bien_the: variantId }))?.["ton"]), 3);

    // An unknown variant is refused.
    const missing = body<{ ok: boolean; reason?: string }>(await call({ method: "POST", path: "/thu/tra-lai", headers: admin, json: async () => ({ variantId: "khong-co", quantity: 1 }) }));
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, "khong_co_bien_the");
  });
});
