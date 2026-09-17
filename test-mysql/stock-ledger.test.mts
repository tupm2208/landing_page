/**
 * The stock book (warehouse page) on real MySQL (port 3307): adjust, transfer, goods-in, returns.
 *
 * The two rules, each with its "breaks if":
 *   1. stock never goes below zero, and a transfer larger than the source is refused WHOLE
 *   2. every write lands with its movement row, or not at all
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ROLE, type IncomingRequest, type Reply } from "../dist/contract/index.js";
import { FakeHttpClient, FakeStaticFilePort, FixedWindowRateLimiter, Kernel, MemoryUploadPort, ManualClock, MemoryLogger, TokenAuth, openMysqlStore } from "../dist/kernel/index.js";
import { manifest } from "../dist/modules/hang-kho/module.js";

const ADMIN = "ma-quan-tri";
const URL = String(process.env["TOPRUN_MYSQL_URL"] || "").trim();
const unlessMysql = URL ? {} : { skip: "chưa đặt TOPRUN_MYSQL_URL — bỏ qua bài sổ kho" };
if (URL && /:3306\//.test(URL)) throw new Error("Cổng 3306 là dữ liệu thật của landing. Dùng 3307.");

const ITEM = {
  code: "KHO1", name: "Giày thử sổ kho", listPrice: 2000000,
  sizes: [{ size: "42", qty: 3, price: 1500000, warehouseId: "wh_order" }]
};

test("The stock book on real MySQL", unlessMysql, async (t) => {
  const logger = new MemoryLogger();
  const clock = new ManualClock();
  const store = await openMysqlStore({ url: URL, logger });
  await store.runSchema("hang-kho", manifest.schema ?? []);
  const kernel = new Kernel({
    ports: {
      store, logger, clock, http: new FakeHttpClient(),
      auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }], clock }),
      rateLimiter: new FixedWindowRateLimiter(clock), uploads: new MemoryUploadPort(), staticFiles: new FakeStaticFilePort({})
    },
    logger, modules: [manifest], config: { "hang-kho": {} }
  });
  const clean = async () => {
    clock.advance(11 * 60 * 1000);
    for (const table of ["hang_kho_bien_dong", "hang_kho_phieu_nhap", "hang_kho_phieu_nhap_dong", "hang_kho_giu_cho", "hang_kho_bien_the", "hang_kho_mon"]) {
      await store.table(table).truncate();
    }
  };
  await clean();
  t.after(async () => { await clean(); await store.close(); });

  const admin = { authorization: `Bearer ${ADMIN}` };
  const post = (path: string, payload: unknown): Promise<Reply> => kernel.handle({ method: "POST", path, ip: "1.1.1.1", headers: admin, json: async () => payload } as IncomingRequest);
  const get = (path: string, query: Record<string, string> = {}): Promise<Reply> => kernel.handle({ method: "GET", path, ip: "1.1.1.1", headers: admin, query });
  const shelf = async (warehouse: string, size = "42") => Number((await store.table("hang_kho_bien_the").one({ ma_mon: "KHO1", size, ma_kho: warehouse }))?.["ton"] ?? -1);
  const body = (r: Reply) => r.body as Record<string, unknown>;
  const setup = async () => { await clean(); assert.equal((await post("/api/products", [ITEM])).status, 200); };

  await t.test("adjust adds and takes, writes the book, and CREATES the row for a size the warehouse never held", async () => {
    await setup();
    assert.equal((await post("/api/hang-kho/dieu-chinh-ton", { ma: "KHO1", size: "42", maKho: "wh_order", soLuong: -1, ghiChu: "hỏng" })).status, 200);
    assert.equal(await shelf("wh_order"), 2);
    assert.equal((await post("/api/hang-kho/dieu-chinh-ton", { ma: "KHO1", size: "43", maKho: "wh_san", soLuong: 4 })).status, 200);
    assert.equal(await shelf("wh_san", "43"), 4);
    const row = await store.table("hang_kho_bien_the").one({ ma_mon: "KHO1", size: "43", ma_kho: "wh_san" });
    assert.equal(Number(row?.["gia"]), 1500000, "a new size sells at the item's own price");

    const book = body(await get("/api/hang-kho/bien-dong", { ma: "KHO1" }))["bienDong"] as { quantity: number; before: number; after: number; note: string; actor: string }[];
    assert.equal(book.length, 2);
    assert.deepEqual([book[1]!.quantity, book[1]!.before, book[1]!.after, book[1]!.note, book[1]!.actor], [-1, 3, 2, "hỏng", "quan-tri"]);
  });

  await t.test("RULE 1 — BREAKS IF stock goes below zero, or an unknown item grows a shelf", async () => {
    await setup();
    const r = await post("/api/hang-kho/dieu-chinh-ton", { ma: "KHO1", size: "42", maKho: "wh_order", soLuong: -5 });
    assert.equal(r.status, 400);
    assert.equal((body(r)["ketQua"] as { reason: string }[])[0]?.reason, "khong_du_ton");
    assert.equal(await shelf("wh_order"), 3);
    const ghost = await post("/api/hang-kho/dieu-chinh-ton", { ma: "KHONG-CO", size: "42", maKho: "wh_san", soLuong: 1 });
    assert.equal((body(ghost)["ketQua"] as { reason: string }[])[0]?.reason, "khong_co_mon");
    assert.equal(await store.table("hang_kho_bien_dong").count(), 0, "a refusal writes nothing");
  });

  await t.test("transfer moves pairs between warehouses in one go; too many is refused WHOLE", async () => {
    await setup();
    assert.equal((await post("/api/hang-kho/chuyen-kho", { ma: "KHO1", size: "42", tuKho: "wh_order", denKho: "wh_san", soLuong: 2 })).status, 200);
    assert.deepEqual([await shelf("wh_order"), await shelf("wh_san")], [1, 2]);

    const tooMany = await post("/api/hang-kho/chuyen-kho", { ma: "KHO1", size: "42", tuKho: "wh_order", denKho: "wh_san", soLuong: 5 });
    assert.equal(tooMany.status, 400);
    assert.deepEqual([await shelf("wh_order"), await shelf("wh_san")], [1, 2], "nothing moved");
    assert.equal(body(await post("/api/hang-kho/chuyen-kho", { ma: "KHO1", size: "42", tuKho: "wh_san", denKho: "wh_san", soLuong: 1 }))["reason"], "cung_kho");
    assert.equal(await store.table("hang_kho_bien_dong").count(), 2, "one transfer = two book lines");
  });

  await t.test("RULE 2 — a goods-in slip with one bad line adds NOTHING, a good one adds every line", async () => {
    await setup();
    const bad = await post("/api/hang-kho/phieu-nhap", { nhaCungCap: "NCC", dong: [
      { ma: "KHO1", size: "44", maKho: "wh_san", soLuong: 2, giaVon: 900000 },
      { ma: "KHONG-CO", size: "44", maKho: "wh_san", soLuong: 1 }
    ] });
    assert.equal(bad.status, 400);
    assert.equal(body(bad)["line"], 2);
    assert.equal(await shelf("wh_san", "44"), -1, "the first line was rolled back with the second");
    assert.equal(await store.table("hang_kho_phieu_nhap").count(), 0);

    const good = await post("/api/hang-kho/phieu-nhap", { nhaCungCap: "NCC", dong: [
      { ma: "KHO1", size: "44", maKho: "wh_san", soLuong: 2, giaVon: 900000 },
      { ma: "KHO1", size: "42", maKho: "wh_san", soLuong: 1, giaVon: 950000 }
    ] });
    assert.equal(good.status, 200, JSON.stringify(good.body));
    assert.equal(body(good)["totalCost"], 2 * 900000 + 950000);
    assert.deepEqual([await shelf("wh_san", "44"), await shelf("wh_san", "42")], [2, 1]);
    const slips = body(await get("/api/hang-kho/phieu-nhap"))["phieu"] as { lines: unknown[] }[];
    assert.equal(slips[0]?.lines.length, 2);
    const kho = body(await get("/api/hang-kho/kho"))["kho"] as { id: string }[];
    assert.deepEqual(kho.map((k) => k.id), ["wh_order", "wh_san"]);
  });
});
