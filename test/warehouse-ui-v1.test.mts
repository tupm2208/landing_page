/**
 * OMI "Hàng hóa & Kho" v1 (18/09/2026) — the rules that need no MySQL: the public view never shows the
 * new house fields, every "cần xử lý" rule produces its kind, the purchasing list sorts lines into its
 * four states, document codes count per kind per LOCAL day, and a warehouse policy keeps its old
 * versions. The routes on real tables are in `test-mysql/warehouse-ui-v1.test.mts`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROLE, type IncomingRequest, type Reply } from "../dist/contract/index.js";
import { FakeHttpClient, FakeStaticFilePort, FixedWindowRateLimiter, JsonFileStore, Kernel, ManualClock, MemoryLogger, MemoryUploadPort, TokenAuth } from "../dist/kernel/index.js";
import { manifest } from "../dist/modules/hang-kho/module.js";
import { rowsToItem } from "../dist/modules/hang-kho/catalog-repository.js";
import { publicView } from "../dist/modules/hang-kho/normalise.js";
import { findIssues } from "../dist/modules/hang-kho/issues.js";
import { isRetryableWrite, localDay, nextDocumentCode } from "../dist/modules/hang-kho/stock-documents.js";
import { buildPurchaseList } from "../dist/modules/mua-ho/purchase-list.js";

test("the public view shows NONE of the new house fields (attributes, raw stock, reserved, barcode, colour, weight, times)", () => {
  const item = rowsToItem(
    { ma: "PV1", ten: "Giày công khai", nguon: "own", trang_thai: "orderable", sua_luc: "2026-09-18 01:02:03.000", thuoc_tinh_json: JSON.stringify({ skuNoiBo: "SKU-BI-MAT", doiTacCungCap: "partner_bi_mat", choPhepDat: true }) },
    [{ ma_bien_the: "v1", ma_mon: "PV1", size: "42", ma_kho: "wh_san", ton: 7, gia: 1500000, nguon: "ready", ma_vach: "8930000000017", mau: "Đỏ-bí-mật", khoi_luong: "950g", gia_von: 900000, sua_luc: "2026-09-18 01:02:03.000" }],
    new Map([["v1", 2]])
  );
  // The house view carries them...
  assert.equal(item.attributes["skuNoiBo"], "SKU-BI-MAT");
  assert.equal(item.updatedAt, "2026-09-18T01:02:03.000Z");
  const size = item.sizes[0]!;
  assert.deepEqual([size.stock, size.reserved, size.qty, size.barcode, size.color, size.weight, size.updatedAt], [7, 2, 5, "8930000000017", "Đỏ-bí-mật", "950g", "2026-09-18T01:02:03.000Z"]);
  // ...and the public view drops every one of them. BREAKS IF publicView starts spreading the house item.
  const shown = publicView(item)!;
  const wire = JSON.stringify(shown);
  for (const secret of ["SKU-BI-MAT", "partner_bi_mat", "8930000000017", "Đỏ-bí-mật", "950g", "900000", "attributes", "updatedAt", "reserved", "barcode", "weight", "\"stock\"", "\"color\""]) {
    assert.ok(!wire.includes(secret), `public view leaks ${secret}`);
  }
  assert.equal(shown.sizes[0]!.qty, 1, "still only 1 / 0");
});

test("every 'cần xử lý' rule produces its own kind with its fixed severity; dem counts before the filter", () => {
  const at = "2026-09-18T00:00:00.000Z";
  const warehouses = new Map([
    ["wh_san", { name: "Kho sẵn", type: "ready" as const, hasDefaultPartner: false }],
    ["wh_order", { name: "Kho order", type: "order" as const, hasDefaultPartner: false }],
    ["wh_order_ok", { name: "Kho order có partner", type: "order" as const, hasDefaultPartner: true }]
  ]);
  const full = { brand: "Nike", category: "Running", gender: "Unisex", description: "Mô tả", webContent: { dongSanPham: "Giày" }, attributes: { mau: "Đen" } };
  const items = [
    { code: "NOIMG", name: "Không ảnh", image: "", updatedAt: at, ...full },
    { code: "OK", name: "Ổn", image: "/a.jpg", updatedAt: at, ...full },
    { code: "META", name: "Thiếu metadata", image: "/m.jpg", updatedAt: at, ...full, brand: "" },
    { code: "ORD", name: "Hàng order", image: "/b.jpg", updatedAt: at, ...full },
    { code: "ORD2", name: "Hàng order có nguồn", image: "/c.jpg", updatedAt: at, ...full, attributes: { ...full.attributes, doiTacCungCap: "partner_x" } }
  ];
  const v = (code: string, warehouseId: string, extra: Record<string, number> = {}) => ({ code, size: "42", warehouseId, stock: 1, reserved: 0, price: 1000000, cost: 0, updatedAt: at, ...extra });
  const variants = [
    v("NOIMG", "wh_san"), { ...v("NOIMG", "wh_san"), size: "43" },          // two sizes, ONE missing-photo row
    v("META", "wh_san"),                                                    // one missing-information row
    v("OK", "wh_san", { reserved: 3 }),                                      // held more than the shelf has
    v("OK", "wh_san", { stock: -1 }),                                        // below zero
    v("OK", "wh_san", { price: 0 }),                                         // in stock without a price
    v("OK", "wh_san", { cost: 2000000 }),                                    // sells under cost
    v("OK", "wh_san", { cost: 100000 }),                                     // more than 3x cost
    v("OK", "wh_san", { cost: 500000 }),                                     // normal: nothing
    v("ORD", "wh_order", { stock: 0 }), { ...v("ORD", "wh_order", { stock: 0 }), size: "43" }, // order warehouse, no partner: ONE row
    v("ORD2", "wh_order", { stock: 0 }),                                     // the item names its supplier: nothing
    v("ORD", "wh_order_ok", { stock: 0 })                                    // warehouse has a default partner: nothing
  ];
  const imports = [{ warehouseId: "wh_san", sessionId: "imp_1", at, problems: 4 }, { warehouseId: "wh_order", sessionId: "imp_2", at, problems: 0 }];
  const all = findIssues({ items, variants, warehouses, imports });
  assert.deepEqual(all.dem, { thieuGia: 1, thieuAnh: 1, thieuThongTin: 1, lechTon: 2, importLoi: 1, chuaCoPartner: 1, giaBatThuong: 2 });
  const severity = new Map(all.vanDe.map((i) => [i.loai, i.mucDo]));
  assert.deepEqual(Object.fromEntries(severity), { "thieu-anh": "cao", "lech-ton": "cao", "thieu-thong-tin": "trung-binh", "thieu-gia": "trung-binh", "import-loi": "trung-binh", "chua-co-partner": "trung-binh", "gia-bat-thuong": "thap" });
  assert.deepEqual(all.vanDe.map((i) => i.mucDo), [...all.vanDe.map((i) => i.mucDo)].sort((a, b) => ["cao", "trung-binh", "thap"].indexOf(a) - ["cao", "trung-binh", "thap"].indexOf(b)), "cao first");
  assert.equal(all.vanDe.find((i) => i.loai === "lech-ton")!.moTa, "Lệch tồn (thực tế ≠ hệ thống)");
  assert.equal(all.vanDe.find((i) => i.loai === "thieu-anh")!.tenKho, "Kho sẵn");

  const narrowed = findIssues({ items, variants, warehouses, imports }, { kind: "gia-bat-thuong" });
  assert.equal(narrowed.vanDe.length, 2);
  assert.deepEqual(narrowed.dem, all.dem, "dem counts the whole list, not the filtered one");
  assert.equal(findIssues({ items, variants, warehouses, imports }, { warehouseId: "wh_order" }).vanDe.length, 1);
  assert.equal(findIssues({ items, variants, warehouses, imports }, { severity: "thap" }).vanDe.every((i) => i.mucDo === "thap"), true);
});

test("the purchasing list: no partner = cho-gan, nothing bought = dang-mua, some = mua-mot-phan, all but not shipped = cho-nhap-kho", () => {
  const line = (id: string, extra: Record<string, unknown>) => ({ maDong: id, productCode: "DV1", productName: "Giày DV1", size: "42", qty: 2, warehouseId: "wh_order", warehouseName: "Kho order", ...extra });
  const orders = [
    { id: "D1", createdAt: "2026-09-10T00:00:00.000Z", status: "new", items: [line("D1#a", { purchaseAuthorized: true })] },                 // pushed, no partner
    { id: "D2", createdAt: "2026-09-11T00:00:00.000Z", status: "new", items: [line("D2#a", { partnerId: "p1" })] },                          // nothing bought
    { id: "D3", createdAt: "2026-09-12T00:00:00.000Z", status: "new", items: [line("D3#a", { partnerId: "p2" })] },                          // 1 of 2
    { id: "D4", createdAt: "2026-09-13T00:00:00.000Z", status: "new", items: [line("D4#a", { partnerId: "p3" })] },                          // 2 of 2, not shipped
    { id: "D5", createdAt: "2026-09-13T00:00:00.000Z", status: "new", fulfillmentStatus: "shipped", items: [line("D5#a", { partnerId: "p3" })] }, // shipped: gone
    { id: "D6", createdAt: "2026-09-13T00:00:00.000Z", status: "new", items: [line("D6#a", {})] },                                           // neither partner nor pushed: gone
    { id: "D7", createdAt: "2026-09-13T00:00:00.000Z", status: "new", items: [line("D7#a", { partnerId: "p4" })] },                          // reported out, nothing bought: gone
    { id: "D8", createdAt: "2026-09-13T00:00:00.000Z", status: "cancelled", items: [line("D8#a", { partnerId: "p1" })] }                    // dead order: gone
  ];
  const out = buildPurchaseList(orders, {
    purchased: new Map([["D3#a", 1], ["D4#a", 2]]), reportedOut: new Map([["D7#a", new Set(["p4"])]]), partnerNames: new Map([["p1", "Yến"], ["p2", "Cầu Diễn"], ["p3", "Phương"]])
  });
  assert.deepEqual(out.dong.map((r) => [r.cacDong[0]!.maDon, r.trangThai, r.canMua, r.daMua, r.conThieu]), [
    ["D1", "cho-gan", 2, 0, 2], ["D2", "dang-mua", 2, 0, 2], ["D3", "mua-mot-phan", 2, 1, 1], ["D4", "cho-nhap-kho", 2, 2, 0]
  ]);
  assert.deepEqual(out.dem, { tong: 4, choGan: 1, dangMua: 1, muaMotPhan: 1, choNhapKho: 1 });
  const row = out.dong[1]!;
  assert.deepEqual([row.maKho, row.tenKho, row.maDoiTac, row.tenDoiTac, row.donCuNhat, row.khoa], ["wh_order", "Kho order", "p1", "Yến", "2026-09-11T00:00:00.000Z", "dv1|42|wh_order|p1"]);

  // Two orders on the same product + size + warehouse + partner are ONE row, oldest order kept.
  const grouped = buildPurchaseList([orders[1]!, { ...orders[1]!, id: "D9", createdAt: "2026-09-01T00:00:00.000Z", items: [line("D9#a", { partnerId: "p1" })] }], { purchased: new Map([["D9#a", 2]]), reportedOut: new Map(), partnerNames: new Map() });
  assert.equal(grouped.dong.length, 1);
  assert.deepEqual([grouped.dong[0]!.canMua, grouped.dong[0]!.daMua, grouped.dong[0]!.trangThai, grouped.dong[0]!.donCuNhat, grouped.dong[0]!.cacDong.length], [4, 2, "mua-mot-phan", "2026-09-01T00:00:00.000Z", 2]);
});

test("an unassigned line from an ORDER warehouse is cho-gan; from a ready (or undeclared) warehouse it is left out", () => {
  const line = (id: string, warehouseId: string) => ({ maDong: id, productCode: "DV2", productName: "Giày DV2", size: "41", qty: 1, warehouseId });
  const orders = [
    { id: "E1", createdAt: "2026-09-10T00:00:00.000Z", status: "new", items: [line("E1#a", "wh_order")] },
    { id: "E2", createdAt: "2026-09-10T00:00:00.000Z", status: "new", items: [line("E2#a", "wh_san")] },
    { id: "E3", createdAt: "2026-09-10T00:00:00.000Z", status: "new", items: [line("E3#a", "wh_la")] },
    { id: "E4", createdAt: "2026-09-10T00:00:00.000Z", status: "new", items: [{ ...line("E4#a", "wh_order"), partnerId: "p9" }] }
  ];
  const out = buildPurchaseList(orders, { purchased: new Map(), reportedOut: new Map([["E4#a", new Set(["p9"])]]), partnerNames: new Map(), orderWarehouses: new Set(["wh_order"]) });
  assert.deepEqual(out.dong.map((r) => [r.cacDong.map((c) => c.maDon).join(","), r.trangThai, r.maDoiTac]), [["E1", "cho-gan", ""]], "E4 reported out by its partner and not bought stays out");
  // Without the warehouse book (no Warehouse piece) nothing unassigned is guessed.
  assert.equal(buildPurchaseList(orders.slice(0, 3), { purchased: new Map(), reportedOut: new Map(), partnerNames: new Map() }).dong.length, 0);
});

test("can-mua (review 18/09): exact 'left the shop' statuses, out-of-stock only by the CURRENT partner, blocked lines", () => {
  const line = (id: string, extra: Record<string, unknown>) => ({ maDong: id, productCode: "DV3", productName: "Giày DV3", size: "40", qty: 1, warehouseId: "wh_order", ...extra });
  // One size per order, so no two orders share a row.
  const order = (id: string, extra: Record<string, unknown>, lineExtra: Record<string, unknown>) => ({ id, createdAt: "2026-09-10T00:00:00.000Z", status: "new", ...extra, items: [line(`${id}#a`, { size: id, ...lineExtra })] });
  const out = buildPurchaseList([
    order("F1", { fulfillmentStatus: "shipping_created" }, { partnerId: "p1" }),     // still in the shop: listed
    order("F2", { fulfillmentStatus: "shipping_issue" }, { partnerId: "p1" }),       // still in the shop: listed
    order("F3", {}, { partnerId: "p2" }),                                              // reported by p1 earlier, now given to p2: listed
    order("F4", {}, { partnerId: "p1" }),                                              // reported by p1, still p1: out
    order("F5", {}, { partnerId: "p1", procurementStatus: "partner_out_of_stock" }),   // Orders marked it: out
    order("F6", {}, { partnerId: "p1", procurementStatus: "purchase_blocked" }),       // blocked: out
    order("F7", {}, { procurementStatus: "partner_out_of_stock" }),                    // partner cleared, order warehouse: cho-gan
    order("F8", {}, { partnerId: "p1" })                                               // reported by p1 but already bought: arriving
  ], {
    purchased: new Map([["F8#a", 1]]), reportedOut: new Map([["F3#a", new Set(["p1"])], ["F4#a", new Set(["p1"])], ["F8#a", new Set(["p1"])]]),
    partnerNames: new Map(), orderWarehouses: new Set(["wh_order"])
  });
  const listed = out.dong.flatMap((r) => r.cacDong.map((c) => `${c.maDon}:${r.trangThai}`)).sort();
  assert.deepEqual(listed, ["F1:dang-mua", "F2:dang-mua", "F3:dang-mua", "F7:cho-gan", "F8:cho-nhap-kho"]);
});

test("a document write is retried on a duplicate code or a MySQL deadlock, nothing else", () => {
  assert.equal(isRetryableWrite({ code: "ER_LOCK_DEADLOCK", errno: 1213, message: "Deadlock found when trying to get lock; try restarting transaction" }), true);
  assert.equal(isRetryableWrite({ errno: 1213, message: "x" }), true);
  assert.equal(isRetryableWrite(new Error("Duplicate entry 'NK-260918-001' for key 'PRIMARY'")), true);
  assert.equal(isRetryableWrite(new Error("Unknown column 'x'")), false);
});

test("document codes: KIND-yyMMdd-nnn, counted per kind per LOCAL (Hanoi) day", () => {
  const lateUtc = new Date("2026-09-17T18:30:00.000Z"); // 01:30 on 18/09 in Hanoi
  assert.equal(localDay(lateUtc), "2026-09-18");
  assert.equal(nextDocumentCode("nhap", lateUtc, []), "NK-260918-001");
  assert.equal(nextDocumentCode("nhap", lateUtc, ["NK-260918-001", "NK-260918-007", "XK-260918-020", "NK-260917-050"]), "NK-260918-008");
  assert.equal(nextDocumentCode("dieu-chinh", lateUtc, ["NK-260918-001"]), "DC-260918-001");
  assert.equal(nextDocumentCode("chuyen", lateUtc, []).slice(0, 3), "CK-");
  assert.equal(nextDocumentCode("xuat", lateUtc, []).slice(0, 3), "XK-");
});

function documentKernel() {
  const clock = new ManualClock();
  const logger = new MemoryLogger();
  const kernel = new Kernel({
    ports: {
      store: new JsonFileStore(fs.mkdtempSync(path.join(os.tmpdir(), "kho-v1-")), logger), logger, clock, http: new FakeHttpClient(),
      auth: new TokenAuth({ keys: [{ token: "ma-quan-tri", name: "quan-tri", role: ROLE.admin }], clock }),
      rateLimiter: new FixedWindowRateLimiter(clock), uploads: new MemoryUploadPort(), staticFiles: new FakeStaticFilePort({})
    },
    logger, modules: [manifest], config: { "hang-kho": {} }
  });
  const call = (method: string, p: string, payload?: unknown): Promise<Reply> =>
    kernel.handle({ method, path: p, ip: "1.1.1.1", headers: { authorization: "Bearer ma-quan-tri" }, query: {}, json: async () => payload } as IncomingRequest);
  return { call, clock };
}

test("a warehouse policy keeps its OLD versions (newest first, at most 50) and the three new fields", async () => {
  const { call, clock } = documentKernel();
  const body = (r: Reply) => r.body as Record<string, unknown>;
  const first = await call("POST", "/api/hang-kho/kho/wh_order/chinh-sach", { tomTat: "Order 7 ngày", choCod: false, thoiGianChuanBi: "5-7 ngày", hienThoiGian: true, doiSizeKhiVe: true });
  assert.equal(first.status, 200);
  clock.advance(1000);
  await call("POST", "/api/hang-kho/kho/wh_order/chinh-sach", { tomTat: "Order 10 ngày" });
  const read = body(await call("GET", "/api/hang-kho/kho/wh_order/chinh-sach"));
  const now = read["chinhSach"] as Record<string, unknown>;
  const history = read["lichSu"] as Record<string, unknown>[];
  assert.deepEqual([now["version"], now["summary"], now["prepTime"], now["showPrepTime"], now["swapSizeOnArrival"]], [2, "Order 10 ngày", "5-7 ngày", true, true], "not sent = kept");
  assert.deepEqual(history.map((p) => [p["version"], p["summary"], p["cod"]]), [[1, "Order 7 ngày", false]], "the replaced version is kept, not overwritten");
  // Another warehouse's history is its own.
  await call("POST", "/api/hang-kho/kho/wh_san/chinh-sach", { tomTat: "Sẵn" });
  assert.equal((body(await call("GET", "/api/hang-kho/kho/wh_san/chinh-sach"))["lichSu"] as unknown[]).length, 0);
  for (let i = 0; i < 55; i += 1) await call("POST", "/api/hang-kho/kho/wh_order/chinh-sach", { tomTat: `Lần ${i}` });
  const capped = body(await call("GET", "/api/hang-kho/kho/wh_order/chinh-sach"))["lichSu"] as Record<string, unknown>[];
  assert.equal(capped.length, 50);
  assert.equal(capped[0]!["summary"], "Lần 53", "newest first");
  assert.equal((body(await call("GET", "/api/hang-kho/kho/wh_san/chinh-sach"))["chinhSach"] as Record<string, unknown>)["summary"], "Sẵn");
});

test("a warehouse keeps its address: diaChi saved, kept when not sent, refused above 500 characters", async () => {
  const { call } = documentKernel();
  const put = (payload: Record<string, unknown>) => call("PUT", "/api/hang-kho/kho/wh_san", { ten: "Kho sẵn", loai: "ready", ...payload });
  const saved = await put({ diaChi: "Số 1 Cầu Diễn, Hà Nội" });
  assert.equal(((saved.body as Record<string, unknown>)["kho"] as Record<string, unknown>)["address"], "Số 1 Cầu Diễn, Hà Nội");
  const kept = await put({ moTa: "đổi mô tả" });
  assert.equal(((kept.body as Record<string, unknown>)["kho"] as Record<string, unknown>)["address"], "Số 1 Cầu Diễn, Hà Nội");
  const tooLong = await put({ diaChi: "x".repeat(501) });
  assert.equal(tooLong.status, 400);
  assert.equal((tooLong.body as Record<string, unknown>)["error"], "kho_khong_hop_le");
});
