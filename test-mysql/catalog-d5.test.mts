/**
 * Đ5 "Hàng hoá đầy đủ" on real MySQL (port 3307): SKU + cost per size, SEO, manual vs source price,
 * undo, search by size / source, CSV + Google Sheet import, ready-stock price and policy, image copies.
 *
 * The rules, each with its "breaks if":
 *   1. cost price never reaches the public catalogue (breaks if `publicSize` starts copying fields)
 *   2. a manual price below the source price does NOT sell (breaks if the shop undercuts its own cost)
 *   3. a new upload keeps the manual price (breaks if Image Tool silently undoes OMI's price)
 *   4. undo puts descriptions and prices back but never yesterday's stock count
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ROLE, type IncomingRequest, type Reply } from "../dist/contract/index.js";
import {
  FakeHttpClient, FakeStaticFilePort, FixedWindowRateLimiter, Kernel, MemoryUploadPort, ManualClock, MemoryLogger, TokenAuth, openMysqlStore
} from "../dist/kernel/index.js";
import { manifest } from "../dist/modules/hang-kho/module.js";

const ADMIN = "ma-quan-tri";
const URL = String(process.env["TOPRUN_MYSQL_URL"] || "").trim();
const unlessMysql = URL ? {} : { skip: "chưa đặt TOPRUN_MYSQL_URL — bỏ qua bài hàng hoá Đ5" };
if (URL && /:3306\//.test(URL)) throw new Error("Cổng 3306 là dữ liệu thật của landing. Dùng 3307.");

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
const SHEET_CSV = "product_code,product_name,brand,size,stock_qty,sale_price,cost_price\nGS1,Giày từ Sheet,ASICS,US 9,4,2000000,1200000";

test("Hàng hoá Đ5 on real MySQL", unlessMysql, async (t) => {
  const logger = new MemoryLogger();
  const clock = new ManualClock();
  const store = await openMysqlStore({ url: URL, logger });
  await store.runSchema("hang-kho", manifest.schema ?? []);
  const http = new FakeHttpClient((url) => {
    if (url.startsWith("https://docs.google.com/spreadsheets/d/SHEET1/export")) return { ok: true, status: 200, json: async () => ({}), text: async () => SHEET_CSV };
    if (url.startsWith("https://docs.google.com/spreadsheets/d/RIENG/export")) return { ok: true, status: 200, json: async () => ({}), text: async () => "<!doctype html><html>login" };
    if (url === "https://cdn.doi-tac.vn/a.png") return { ok: true, status: 200, json: async () => ({}), text: async () => "", arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.length) };
    if (url === "https://cdn.doi-tac.vn/chet.png") return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
    return undefined;
  });
  const kernel = new Kernel({
    ports: {
      store, logger, clock, http,
      auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }], clock }),
      rateLimiter: new FixedWindowRateLimiter(clock), uploads: new MemoryUploadPort(), staticFiles: new FakeStaticFilePort({})
    },
    logger, modules: [manifest], config: { "hang-kho": {} }
  });
  const clean = async () => {
    clock.advance(11 * 60 * 1000);
    await store.execute("DELETE FROM so_du_lieu WHERE ten = ?", ["hang-kho-chinh-sach-hang-san"]);
    for (const table of ["hang_kho_ban_chup", "hang_kho_giu_cho", "hang_kho_bien_the", "hang_kho_mon"]) await store.table(table).truncate();
  };
  await clean();
  t.after(async () => { await clean(); await store.close(); });

  const admin = { authorization: `Bearer ${ADMIN}` };
  const call = (method: string, path: string, payload?: unknown, query: Record<string, string> = {}): Promise<Reply> =>
    kernel.handle({ method, path, ip: "1.1.1.1", headers: admin, query, ...(payload === undefined ? {} : { json: async () => payload }) } as IncomingRequest);
  const body = (r: Reply) => r.body as Record<string, any>;
  const item = async (code: string) => (body(await call("GET", "/api/admin/products", undefined, { q: code })) as unknown as Record<string, any>[]).find((m) => m["code"] === code)!;
  const ITEM = {
    code: "D5A", name: "Giày Đ5", brand: "Nike", productKind: "shoe", division: "Footwear", category: "road_running", gender: "unisex", slug: "giay-d5",
    listPrice: 3000000, seoTitle: "Giày Đ5 chính hãng", seoDescription: "Mô tả SEO", seoKeywords: "giay d5, nike", policy: "Đổi 7 ngày",
    thumbnailImage: "https://cdn.doi-tac.vn/a.png", galleryImages: ["https://cdn.doi-tac.vn/chet.png"],
    sizes: [
      { size: "42", qty: 3, price: 2500000, costPrice: 1500000, sku: "D5A-42", warehouseId: "kho_shop" },
      { size: "43", qty: 1, price: 2600000, costPrice: 1550000, sku: "D5A-43", warehouseId: "kho_shop" }
    ]
  };

  await t.test("SKU, cost per size, SEO, policy, division are stored; cost never reaches the public catalogue", async () => {
    await clean();
    const r = await call("PUT", "/api/hang-kho/mon/D5A", ITEM);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const m = await item("D5A");
    assert.deepEqual(m["sizes"].map((s: any) => [s.size, s.sku, s.costPrice]), [["42", "D5A-42", 1500000], ["43", "D5A-43", 1550000]]);
    assert.equal(m["seoKeywords"], "giay d5, nike");
    assert.equal(m["division"], "Footwear");
    assert.equal(m["policy"], "Đổi 7 ngày");
    assert.equal(m["priceMode"], "source");
    const pub = await kernel.handle({ method: "GET", path: "/api/products/D5A", ip: "1.1.1.2" });
    assert.equal(pub.status, 200);
    assert.doesNotMatch(JSON.stringify(pub.body), /costPrice|1500000|D5A-42/, "no cost, no SKU on the web");
    assert.equal(body(pub)["data"]["seoKeywords"], "giay d5, nike");
  });

  await t.test("manual price sells while not below source; source higher wins with a warning; back to source; uploads keep it", async () => {
    await clean();
    await call("PUT", "/api/hang-kho/mon/D5A", ITEM);
    await call("POST", "/api/hang-kho/sua-nhanh", { mon: [{ ma: "D5A", giaBan: 2700000, hang: "Nike Running", loai: "shoe", nhom: "trail", gioiTinh: "men" }] });
    let m = await item("D5A");
    assert.equal(m["priceMode"], "manual");
    assert.deepEqual(m["sizes"].map((s: any) => s.price), [2700000, 2700000]);
    assert.equal(m["brand"], "Nike Running");
    assert.equal(m["category"], "trail");
    assert.equal(m["gender"], "men");

    await call("POST", "/api/hang-kho/sua-nhanh", { mon: [{ ma: "D5A", giaBan: 2000000 }] });
    m = await item("D5A");
    assert.equal(m["priceMode"], "source_higher_than_manual");
    assert.match(m["priceWarning"], /Giá nguồn 2500000 cao hơn giá tay 2000000/);
    assert.deepEqual(m["sizes"].map((s: any) => s.price), [2500000, 2600000], "never below the source price");

    await call("POST", "/api/hang-kho/sua-nhanh", { mon: [{ ma: "D5A", giaBan: 2900000 }] });
    const nap = await call("POST", "/api/hang-kho/nap-them", [{ ...ITEM, sizes: [{ ...ITEM.sizes[0], price: 2550000 }, ITEM.sizes[1]] }]);
    assert.equal(nap.status, 200, JSON.stringify(nap.body));
    m = await item("D5A");
    assert.equal(m["manualPrice"], 2900000, "an upload does not drop the manual price");
    assert.deepEqual(m["sizes"].map((s: any) => s.price), [2900000, 2900000]);
    assert.equal(m["sourcePrice"], 2550000);

    const back = await call("POST", "/api/hang-kho/mon/D5A/bo-gia-tay", {});
    assert.equal(back.status, 200);
    m = await item("D5A");
    assert.equal(m["priceMode"], "source");
    assert.deepEqual(m["sizes"].map((s: any) => s.price), [2550000, 2600000]);
    assert.equal((await call("POST", "/api/hang-kho/mon/KHONG/bo-gia-tay", {})).status, 404);

    // The editor's own manual price field.
    await call("PUT", "/api/hang-kho/mon/D5A", { ...ITEM, giaTay: 2800000 });
    assert.equal((await item("D5A"))["priceMode"], "manual");
  });

  await t.test("undo: newest action first, descriptions and prices back, stock stays as the shelf says; a created item goes away", async () => {
    await clean();
    await call("PUT", "/api/hang-kho/mon/D5A", ITEM);
    await call("POST", "/api/hang-kho/sua-nhanh", { mon: [{ ma: "D5A", ten: "Tên sai", giaBan: 2800000 }] });
    await store.execute("UPDATE hang_kho_bien_the SET ton = 0 WHERE ma_mon = 'D5A' AND size = '42'");   // sold meanwhile
    const head = body(await call("GET", "/api/hang-kho/hoan-tac"))["hoanTac"];
    assert.equal(head.nhan, "Trước khi lưu sửa nhanh web");
    assert.deepEqual(head.maMon, ["D5A"]);

    const undo = await call("POST", "/api/hang-kho/hoan-tac", {});
    assert.equal(undo.status, 200, JSON.stringify(undo.body));
    let m = await item("D5A");
    assert.equal(m["name"], "Giày Đ5");
    assert.equal(m["priceMode"], "source");
    assert.equal(m["sizes"].find((s: any) => s.size === "42").price, 2500000);
    assert.equal(Number((await store.table("hang_kho_bien_the").one({ ma_mon: "D5A", size: "42" }))?.["ton"]), 0, "stock is not rolled back");
    assert.match(body(undo)["hoanTac"].nhan, /Trước khi tạo D5A/);

    await call("POST", "/api/hang-kho/hoan-tac", {});
    assert.equal(await store.table("hang_kho_mon").count({ ma: "D5A" }), 0, "undoing a create removes the item");
    const empty = await call("POST", "/api/hang-kho/hoan-tac", {});
    assert.equal(empty.status, 409);

    // A delete is undoable too.
    await call("PUT", "/api/hang-kho/mon/D5A", ITEM);
    await call("DELETE", "/api/hang-kho/mon/D5A");
    await call("POST", "/api/hang-kho/hoan-tac", {});
    assert.equal((await item("D5A"))["sizes"].length, 2, "deleted item and its sizes are back");
  });

  await t.test("web content: SEO + page text saved without touching price or stock", async () => {
    await clean();
    await call("PUT", "/api/hang-kho/mon/D5A", ITEM);
    const r = await call("PUT", "/api/hang-kho/mon/D5A/noi-dung-web", { seoTitle: "T mới", seoDescription: "D mới", seoKeywords: "k1", noiDung: { dongSanPham: "Pegasus", tinhNang: ["êm"] } });
    assert.equal(r.status, 200);
    const m = await item("D5A");
    assert.equal(m["seoTitle"], "T mới");
    assert.deepEqual(m["webContent"], { dongSanPham: "Pegasus", tinhNang: ["êm"] });
    assert.deepEqual(m["sizes"].map((s: any) => s.qty), [3, 1]);
    const pub = body(await kernel.handle({ method: "GET", path: "/api/products/D5A", ip: "1.1.1.3" }));
    assert.equal(pub["data"]["webContent"]["dongSanPham"], "Pegasus");
  });

  await t.test("search by size and by source: only items with that size / source IN STOCK", async () => {
    await clean();
    await call("PUT", "/api/hang-kho/mon/D5A", ITEM);
    await call("PUT", "/api/hang-kho/mon/D5B", { ...ITEM, code: "D5B", name: "Giày B", sizes: [{ size: "44", qty: 2, price: 1000000 }] });
    await store.table("hang_kho_bien_the").insert({ ma_bien_the: "bt-ready-d5b", ma_mon: "D5B", size: "42", ma_kho: "wh_yen", ton: 1, gia: 900000, gia_niem_yet: 0, thu_tu_kho: 1, nguon: "ready", ma_chien_dich: "", ma_dong_doi_tac: "", sua_luc: new Date() });
    const codes = async (query: Record<string, string>) => (body(await call("GET", "/api/admin/products", undefined, query)) as unknown as Record<string, any>[]).map((m) => m["code"]).sort();
    assert.deepEqual(await codes({ size: "42" }), ["D5A", "D5B"]);
    assert.deepEqual(await codes({ size: "44" }), ["D5B"]);
    assert.deepEqual(await codes({ nguon: "ready" }), ["D5B"]);
    assert.deepEqual(await codes({ size: "43", nguon: "ready" }), []);
    assert.deepEqual(await codes({ q: "giày b", size: "42" }), ["D5B"]);
    await store.execute("UPDATE hang_kho_bien_the SET ton = 0 WHERE ma_mon = 'D5A' AND size = '42'");
    assert.deepEqual(await codes({ size: "42" }), ["D5B"], "sold-out size does not count");
  });

  await t.test("import sheet: CSV preview writes nothing; Google Sheet export read; partner stock lands as campaign lines; private sheet refused", async () => {
    await clean();
    const csv = "product_code,product_name,size,stock_qty,sale_price\nCSV1,Giày CSV,UK 8,2,1500000\nCSV1,Giày CSV,UK 42,1,1500000";
    const preview = await call("POST", "/api/hang-kho/nhap-bang", { csv, heSize: "UK", nguon: "own", xemTruoc: true });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(body(preview)["daGhi"], false);
    assert.equal(body(preview)["soMonDoc"], 1);
    assert.equal(body(preview)["boQua"], 1);
    assert.equal(await store.table("hang_kho_mon").count(), 0, "preview writes nothing");

    const written = await call("POST", "/api/hang-kho/nhap-bang", { csv, heSize: "UK", nguon: "own" });
    assert.equal(body(written)["soMon"], 1);
    assert.deepEqual((await item("CSV1"))["sizes"].map((s: any) => s.size), ["42"]);

    const sheet = await call("POST", "/api/hang-kho/nhap-bang", { sheetUrl: "https://docs.google.com/spreadsheets/d/SHEET1/edit#gid=0", heSize: "US_MEN", nguon: "partner", tenNguon: "Yến" });
    assert.equal(sheet.status, 200, JSON.stringify(sheet.body));
    assert.equal(body(sheet)["nguonDoc"], "Google Sheet");
    const row = await store.table("hang_kho_bien_the").one({ ma_mon: "GS1" });
    assert.equal(row?.["nguon"], "campaign");
    assert.equal(row?.["size"], "42.5");
    assert.equal(Number(row?.["gia_von"]), 1200000);
    const pub = JSON.stringify((await kernel.handle({ method: "GET", path: "/api/products/GS1", ip: "1.1.1.4" })).body);
    assert.doesNotMatch(pub, /Yến/, "partner name never reaches the web");

    const priv = await call("POST", "/api/hang-kho/nhap-bang", { sheetUrl: "https://docs.google.com/spreadsheets/d/RIENG/edit", heSize: "EU", nguon: "own" });
    assert.equal(priv.status, 400);
    assert.match(body(priv)["message"], /không public/);
    assert.equal((await call("POST", "/api/hang-kho/nhap-bang", { csv, heSize: "JP", nguon: "own" })).status, 400);
    assert.equal((await call("POST", "/api/hang-kho/nhap-bang", { csv, heSize: "EU", nguon: "partner" })).status, 400, "partner needs a name");
    const book = body(await call("GET", "/api/hang-kho/lich-su-nap"))["lan"];
    assert.match(String(book[0].viec), /Google Sheet \(đối tác Yến, size US_MEN\)/);
  });

  await t.test("ready stock: change one line's price (source price rule runs), policy saved and shown on web items that sell ready stock", async () => {
    await clean();
    await call("PUT", "/api/hang-kho/mon/D5A", ITEM);
    await store.table("hang_kho_bien_the").insert({ ma_bien_the: "bt-ready-d5a", ma_mon: "D5A", size: "44", ma_kho: "wh_yen", ton: 1, gia: 900000, gia_niem_yet: 0, thu_tu_kho: 1, nguon: "ready", ma_chien_dich: "", ma_dong_doi_tac: "", sua_luc: new Date() });
    const r = await call("POST", "/api/hang-kho/doi-gia", { ma: "D5A", size: "44", maKho: "wh_yen", nguon: "ready", gia: 1990000 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await item("D5A"))["sizes"].find((s: any) => s.size === "44").price, 1990000);
    assert.equal((await call("POST", "/api/hang-kho/doi-gia", { ma: "D5A", size: "99", maKho: "wh_yen", nguon: "ready", gia: 1 })).status, 404);
    assert.equal((await call("POST", "/api/hang-kho/doi-gia", { ma: "D5A", size: "44", maKho: "wh_yen", gia: 0 })).status, 400);

    await call("POST", "/api/hang-kho/chinh-sach-hang-san", { tomTat: "Hàng sẵn giao ngay, không cần cọc", choCod: true, phanTramCoc: 150 });
    assert.deepEqual(body(await call("GET", "/api/hang-kho/chinh-sach-hang-san"))["chinhSach"], { tomTat: "Hàng sẵn giao ngay, không cần cọc", choCod: true, phanTramCoc: 100 });
    const pub = body(await kernel.handle({ method: "GET", path: "/api/products/D5A", ip: "1.1.1.5" }));
    assert.equal(pub["data"]["readyPolicySummary"], "Hàng sẵn giao ngay, không cần cọc");
  });

  await t.test("tải ảnh về: remote photos copied into the shop's zone, a dead link stays and is counted; undoable", async () => {
    await clean();
    await call("PUT", "/api/hang-kho/mon/D5A", ITEM);
    const r = await call("POST", "/api/hang-kho/tai-anh-ve", { ma: "D5A" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(body(r)["taiDuoc"], 1);
    assert.equal(body(r)["hong"], 1);
    const m = await item("D5A");
    assert.match(m["thumbnailImage"], /^\/api\/hang-kho\/anh\//);
    assert.deepEqual(m["galleryImages"], ["https://cdn.doi-tac.vn/chet.png"]);
    await call("POST", "/api/hang-kho/hoan-tac", {});
    assert.equal((await item("D5A"))["thumbnailImage"], "https://cdn.doi-tac.vn/a.png");
  });
});
