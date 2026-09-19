/**
 * OMI "Hàng hóa & Kho" v1 (18/09/2026) on real MySQL (port 3307): stock documents, the product page,
 * web prices per warehouse, "cần xử lý", the purchasing list, and the extended reads.
 *
 * Each rule with its "breaks if":
 *   - a document short of stock posts NOTHING (not the header, not the earlier lines) — khong_du_ton
 *   - a posted document's goods cannot be edited (da_ghi_so), only its paperwork
 *   - a reversal puts the shelf back and marks the original da-hoan-tac; a second reversal is refused
 *   - old book lines (PN-…, chuyen_…) read as read-only documents (cu: true)
 *   - the product page never touches stock; a size of another item is refused
 *   - a duplicated item starts at stock 0; a taken code is refused (trung_ma)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ROLE, defineModule, type IncomingRequest, type Reply } from "../dist/contract/index.js";
import { FakeHttpClient, FakeStaticFilePort, FixedWindowRateLimiter, Kernel, MemoryUploadPort, ManualClock, MemoryLogger, TokenAuth, openMysqlStore } from "../dist/kernel/index.js";
import { manifest } from "../dist/modules/hang-kho/module.js";
import { manifest as purchasing } from "../dist/modules/mua-ho/module.js";
import { SCHEMA as PURCHASING_SCHEMA, PURCHASES_TABLE, STOCK_OUTS_TABLE, PARTNERS_TABLE } from "../dist/modules/mua-ho/schema.js";

const ADMIN = "ma-quan-tri";
const URL = String(process.env["TOPRUN_MYSQL_URL"] || "").trim();
const unlessMysql = URL ? {} : { skip: "chưa đặt TOPRUN_MYSQL_URL — bỏ qua bài màn Hàng hóa & Kho" };
if (URL && /:3306\//.test(URL)) throw new Error("Cổng 3306 là dữ liệu thật của landing. Dùng 3307.");

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

const ITEMS = [
  { code: "KV1", name: "Giày kho v1", brand: "Nike", listPrice: 3000000, thumbnailImage: "/anh/kv1.jpg", sizes: [{ size: "42", qty: 4, price: 2000000, costPrice: 1500000, warehouseId: "wh_order" }, { size: "43", qty: 0, price: 2000000, warehouseId: "wh_order" }] },
  { code: "KV2", name: "Giày không ảnh", listPrice: 2000000, sizes: [{ size: "40", qty: 2, price: 0, warehouseId: "wh_order" }] }
];

test("OMI Hàng hóa & Kho v1 on real MySQL", unlessMysql, async (t) => {
  const logger = new MemoryLogger();
  const clock = new ManualClock();
  const store = await openMysqlStore({ url: URL, logger });
  await store.runSchema("hang-kho", manifest.schema ?? []);
  await store.runSchema("mua-ho", PURCHASING_SCHEMA);

  const orders: Record<string, unknown>[] = [];
  const fakeOrders = defineModule({
    id: "don-khach", name: "Đơn hàng giả", tier: "van-hanh", runsOn: "server-khach", version: "0.0.1",
    provides: { "don-khach.search": async () => orders.map((o) => ({ ...o })) }
  });
  const uploads = new MemoryUploadPort();
  const kernel = new Kernel({
    ports: {
      store, logger, clock, http: new FakeHttpClient(),
      auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }], clock }),
      rateLimiter: new FixedWindowRateLimiter(clock), uploads, staticFiles: new FakeStaticFilePort({})
    },
    logger, modules: [fakeOrders, manifest, purchasing],
    config: { "don-khach": {}, "hang-kho": {}, "mua-ho": { sessionSecret: "bi-mat-phien-doi-tac-dai-du-32-ky-tu", sessionHours: 12 } }
  });

  const TABLES = [
    "hang_kho_phieu", "hang_kho_phieu_dong", "hang_kho_phieu_nhat_ky", "hang_kho_bien_dong", "hang_kho_phieu_nhap", "hang_kho_phieu_nhap_dong",
    "hang_kho_giu_cho", "hang_kho_bien_the", "hang_kho_mon", "hang_kho_ban_chup", PURCHASES_TABLE, STOCK_OUTS_TABLE, PARTNERS_TABLE
  ];
  const DOCUMENTS = ["hang-kho-danh-muc-kho-v2", "hang-kho-chinh-sach-theo-kho-v2", "hang-kho-lich-su-nap", "hang-kho-phien-nhap-file-v2"];
  const clean = async () => {
    clock.advance(11 * 60 * 1000);
    orders.length = 0;
    for (const table of TABLES) await store.table(table).truncate();
    for (const name of DOCUMENTS) await store.document(name).write(null as never);
  };
  await clean();
  t.after(async () => { await clean(); await store.close(); });

  const admin = { authorization: `Bearer ${ADMIN}` };
  const call = (method: string, path: string, payload?: unknown, query: Record<string, string> = {}): Promise<Reply> =>
    kernel.handle({ method, path, ip: "1.1.1.1", headers: admin, query, json: async () => payload ?? {} } as IncomingRequest);
  const body = (r: Reply) => r.body as Record<string, any>;
  const shelf = async (code: string, size: string, warehouse: string) =>
    Number((await store.rows("SELECT COALESCE(SUM(ton), 0) AS n FROM hang_kho_bien_the WHERE ma_mon = ? AND size = ? AND ma_kho = ?", [code, size, warehouse]))[0]?.["n"] ?? 0);
  const count = async (table: string) => store.table(table).count();
  const setup = async () => {
    await clean();
    assert.equal((await call("PUT", "/api/hang-kho/kho/wh_san", { ten: "Kho sẵn", loai: "ready", diaChi: "Số 1 Cầu Diễn" })).status, 200);
    assert.equal((await call("PUT", "/api/hang-kho/kho/wh_order", { ten: "Kho order", loai: "order" })).status, 200);
    assert.equal((await call("POST", "/api/products", ITEMS)).status, 200);
  };
  const post = (payload: Record<string, unknown>) => call("POST", "/api/hang-kho/phieu", payload);

  await t.test("schema 006/007: the document tables and the two new columns exist", async () => {
    for (const table of ["hang_kho_phieu", "hang_kho_phieu_dong", "hang_kho_phieu_nhat_ky"]) {
      assert.equal((await store.rows("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?", [table]))[0]?.["n"], 1, table);
    }
    const columns = await store.rows("SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND column_name IN ('thuoc_tinh_json', 'khoi_luong')");
    assert.deepEqual(columns.map((r) => `${r["t"]}.${r["c"]}`).sort(), ["hang_kho_bien_the.khoi_luong", "hang_kho_mon.thuoc_tinh_json"]);
  });

  await t.test("goods in, posted at once: shelf + book + cost + log; code NK-yyMMdd-001", async () => {
    await setup();
    const r = await post({ loai: "nhap", trangThai: "hoan-thanh", khoDich: "wh_san", doiTac: "NCC A", dong: [{ ma: "KV1", size: "42", soLuong: 5, donGia: 800000 }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const phieu = body(r)["phieu"];
    assert.match(phieu.ma, /^NK-\d{6}-001$/);
    assert.deepEqual([phieu.trangThai, phieu.soLuong, phieu.tongTien, phieu.cu], ["hoan-thanh", 5, 4000000, false]);
    assert.deepEqual([phieu.dong[0].ten, phieu.dong[0].tonTruoc, phieu.dong[0].tonSau, phieu.dong[0].thanhTien], ["Giày kho v1", 0, 5, 4000000]);
    assert.equal(phieu.butToan.length, 1);
    assert.equal(phieu.butToan[0].reference, phieu.ma);
    assert.deepEqual(phieu.nhatKy.map((l: { viec: string }) => l.viec), ["tao", "ghi-so"]);
    assert.equal(await shelf("KV1", "42", "wh_san"), 5);
    const row = await store.table("hang_kho_bien_the").one({ ma_mon: "KV1", size: "42", ma_kho: "wh_san" });
    assert.deepEqual([row?.["nguon"], Number(row?.["gia_von"])], ["ready", 800000], "a ready warehouse receives ready stock at the slip's cost");
    const second = body(await post({ loai: "nhap", khoDich: "wh_san", dong: [{ ma: "KV1", size: "42", soLuong: 1 }] }))["phieu"];
    assert.match(second.ma, /-002$/);
    assert.equal(second.trangThai, "nhap", "a draft moves nothing");
    assert.equal(await shelf("KV1", "42", "wh_san"), 5);
  });

  await t.test("BREAKS IF one short line posts the rest: khong_du_ton rolls the WHOLE document back", async () => {
    await setup();
    await post({ loai: "nhap", trangThai: "hoan-thanh", khoDich: "wh_san", dong: [{ ma: "KV1", size: "42", soLuong: 5 }] });
    const [documentsBefore, movementsBefore] = [await count("hang_kho_phieu"), await count("hang_kho_bien_dong")];
    const r = await post({ loai: "xuat", trangThai: "hoan-thanh", khoNguon: "wh_san", dong: [{ ma: "KV1", size: "42", soLuong: 2 }, { ma: "KV1", size: "43", soLuong: 1 }] });
    assert.equal(r.status, 400);
    assert.deepEqual([body(r)["error"], body(r)["dong"]], ["khong_du_ton", 2]);
    assert.match(String(body(r)["message"]), /Dòng 2/);
    assert.equal(await shelf("KV1", "42", "wh_san"), 5, "line 1 was not taken either");
    assert.deepEqual([await count("hang_kho_phieu"), await count("hang_kho_bien_dong")], [documentsBefore, movementsBefore], "no header, no book line");

    // The same through PUT: a draft stays a draft.
    const draft = body(await post({ loai: "xuat", khoNguon: "wh_san", dong: [{ ma: "KV1", size: "42", soLuong: 1 }, { ma: "KV1", size: "42", soLuong: 9 }] }))["phieu"];
    const put = await call("PUT", `/api/hang-kho/phieu/${draft.ma}`, { trangThai: "hoan-thanh" });
    assert.equal(put.status, 400);
    assert.equal(body(put)["dong"], 2);
    assert.equal(body(await call("GET", `/api/hang-kho/phieu/${draft.ma}`))["phieu"].trangThai, "nhap");
    assert.equal(await shelf("KV1", "42", "wh_san"), 5);
  });

  await t.test("a posted document: goods cannot change (da_ghi_so), paperwork can; cancelling works only before posting", async () => {
    await setup();
    const phieu = body(await post({ loai: "nhap", trangThai: "hoan-thanh", khoDich: "wh_san", dong: [{ ma: "KV1", size: "42", soLuong: 3, donGia: 100 }] }))["phieu"];
    const changed = await call("PUT", `/api/hang-kho/phieu/${phieu.ma}`, { dong: [{ ma: "KV1", size: "42", soLuong: 4, donGia: 100 }] });
    assert.equal(changed.status, 409);
    assert.equal(body(changed)["error"], "da_ghi_so");
    assert.equal((await call("PUT", `/api/hang-kho/phieu/${phieu.ma}`, { trangThai: "da-huy" })).status, 409);
    // The whole body sent back unchanged, with new paperwork: accepted.
    const same = await call("PUT", `/api/hang-kho/phieu/${phieu.ma}`, {
      loai: "nhap", trangThai: "hoan-thanh", khoDich: "wh_san", dong: [{ ma: "KV1", size: "42", soLuong: 3, donGia: 100 }], ghiChu: "đã đối chiếu hoá đơn", doiTac: "NCC B", phiVanChuyen: 30000
    });
    assert.equal(same.status, 200, JSON.stringify(same.body));
    assert.deepEqual([body(same)["phieu"].ghiChu, body(same)["phieu"].doiTac, body(same)["phieu"].phiVanChuyen], ["đã đối chiếu hoá đơn", "NCC B", 30000]);
    assert.equal(await shelf("KV1", "42", "wh_san"), 3);

    const draft = body(await post({ loai: "nhap", khoDich: "wh_san", dong: [{ ma: "KV1", size: "42", soLuong: 1 }] }))["phieu"];
    const edited = body(await call("PUT", `/api/hang-kho/phieu/${draft.ma}`, { dong: [{ ma: "KV1", size: "43", soLuong: 2 }], trangThai: "cho-duyet" }))["phieu"];
    assert.deepEqual([edited.trangThai, edited.dong[0].size, edited.dong[0].soLuong], ["cho-duyet", "43", 2]);
    const cancelled = body(await call("PUT", `/api/hang-kho/phieu/${draft.ma}`, { trangThai: "da-huy" }))["phieu"];
    assert.equal(cancelled.trangThai, "da-huy");
    assert.ok(cancelled.nhatKy.some((l: { viec: string }) => l.viec === "huy"));
    assert.equal(await shelf("KV1", "43", "wh_san"), 0);
  });

  await t.test("a transfer moves both shelves; its reversal puts them back and marks the original da-hoan-tac", async () => {
    await setup();
    await post({ loai: "nhap", trangThai: "hoan-thanh", khoDich: "wh_san", dong: [{ ma: "KV1", size: "42", soLuong: 5 }] });
    const transfer = body(await post({ loai: "chuyen", trangThai: "hoan-thanh", khoNguon: "wh_san", khoDich: "wh_order", dong: [{ ma: "KV1", size: "42", soLuong: 2 }] }))["phieu"];
    assert.match(transfer.ma, /^CK-/);
    assert.deepEqual([await shelf("KV1", "42", "wh_san"), await shelf("KV1", "42", "wh_order")], [3, 6]);
    assert.deepEqual([transfer.dong[0].tonTruoc, transfer.dong[0].tonSau], [5, 3], "a transfer line shows the SOURCE shelf");

    const reversal = await call("POST", `/api/hang-kho/phieu/${transfer.ma}/dao`);
    assert.equal(reversal.status, 200, JSON.stringify(reversal.body));
    const back = body(reversal)["phieu"];
    assert.match(back.ma, /^DC-/);
    assert.deepEqual([back.loai, back.trangThai, back.maPhieuGoc, back.dong.length], ["dieu-chinh", "hoan-thanh", transfer.ma, 2]);
    assert.deepEqual(back.dong.map((l: { maKho: string; soLuong: number }) => [l.maKho, l.soLuong]), [["wh_san", 2], ["wh_order", -2]]);
    assert.deepEqual([await shelf("KV1", "42", "wh_san"), await shelf("KV1", "42", "wh_order")], [5, 4]);
    const original = body(await call("GET", `/api/hang-kho/phieu/${transfer.ma}`))["phieu"];
    assert.deepEqual([original.trangThai, original.maPhieuDao], ["da-hoan-tac", back.ma]);
    assert.equal((await call("POST", `/api/hang-kho/phieu/${transfer.ma}/dao`)).status, 409, "reversed once only");

    // Reversing goods that already left is refused whole.
    const goodsIn = body(await post({ loai: "nhap", trangThai: "hoan-thanh", khoDich: "wh_san", dong: [{ ma: "KV1", size: "44", soLuong: 3 }] }))["phieu"];
    await post({ loai: "xuat", trangThai: "hoan-thanh", khoNguon: "wh_san", dong: [{ ma: "KV1", size: "44", soLuong: 2 }] });
    const refused = await call("POST", `/api/hang-kho/phieu/${goodsIn.ma}/dao`);
    assert.equal(refused.status, 400);
    assert.equal(body(refused)["error"], "khong_du_ton");
    assert.equal(body(await call("GET", `/api/hang-kho/phieu/${goodsIn.ma}`))["phieu"].trangThai, "hoan-thanh");
    assert.equal(await shelf("KV1", "44", "wh_san"), 1);
  });

  await t.test("refusals: kind, warehouses per kind, no lines, sign of quantities", async () => {
    await setup();
    const error = async (payload: Record<string, unknown>) => { const r = await post(payload); return [r.status, body(r)["error"]]; };
    assert.deepEqual(await error({ loai: "ban", khoDich: "wh_san", dong: [{ ma: "KV1", size: "42", soLuong: 1 }] }), [400, "loai_phieu_sai"]);
    assert.deepEqual(await error({ loai: "nhap", dong: [{ ma: "KV1", size: "42", soLuong: 1 }] }), [400, "thieu_kho"]);
    assert.deepEqual(await error({ loai: "xuat", khoDich: "wh_san", dong: [{ ma: "KV1", size: "42", soLuong: 1 }] }), [400, "thieu_kho"]);
    assert.deepEqual(await error({ loai: "chuyen", khoNguon: "wh_san", khoDich: "wh_san", dong: [{ ma: "KV1", size: "42", soLuong: 1 }] }), [400, "cung_kho"]);
    assert.deepEqual(await error({ loai: "nhap", khoDich: "wh_san", dong: [] }), [400, "thieu_dong"]);
    assert.deepEqual(await error({ loai: "xuat", khoNguon: "wh_order", dong: [{ ma: "KV1", size: "42", soLuong: -1 }] }), [400, "dong_khong_hop_le"]);
    const adjust = await post({ loai: "dieu-chinh", trangThai: "hoan-thanh", khoNguon: "wh_order", dong: [{ ma: "KV1", size: "42", soLuong: -1 }] });
    assert.equal(adjust.status, 200, "an adjustment may be negative");
    assert.equal(await shelf("KV1", "42", "wh_order"), 3);
    assert.equal(await count("hang_kho_phieu"), 1);
  });

  await t.test("duplicate, attach, list with filters and counts", async () => {
    await setup();
    const original = body(await post({ loai: "nhap", trangThai: "hoan-thanh", khoDich: "wh_san", doiTac: "NCC A", dong: [{ ma: "KV1", size: "42", soLuong: 2, donGia: 1000 }] }))["phieu"];
    const copy = body(await call("POST", `/api/hang-kho/phieu/${original.ma}/nhan-ban`))["phieu"];
    assert.notEqual(copy.ma, original.ma);
    assert.deepEqual([copy.trangThai, copy.doiTac, copy.dong[0].soLuong, copy.dong[0].tonTruoc], ["nhap", "NCC A", 2, null]);
    assert.ok(copy.nhatKy.some((l: { viec: string; noiDung: string }) => l.viec === "nhan-ban" && l.noiDung.includes(original.ma)));

    const attached = await call("POST", `/api/hang-kho/phieu/${original.ma}/dinh-kem`, { anh: `data:image/png;base64,${PNG.toString("base64")}`, ten: "hoa-don.png" });
    assert.equal(attached.status, 200, JSON.stringify(attached.body));
    assert.match(String(body(attached)["url"]), new RegExp(`^/api/hang-kho/phieu/${original.ma}/dinh-kem/`));
    const withFile = body(await call("GET", `/api/hang-kho/phieu/${original.ma}`))["phieu"];
    assert.deepEqual(withFile.dinhKem, [{ url: body(attached)["url"], ten: "hoa-don.png" }]);
    assert.ok(withFile.nhatKy.some((l: { viec: string }) => l.viec === "dinh-kem"));
    assert.equal((await call("POST", "/api/hang-kho/phieu/KHONG-CO/dinh-kem", { anh: `data:image/png;base64,${PNG.toString("base64")}` })).status, 404);

    await post({ loai: "xuat", khoNguon: "wh_order", dong: [{ ma: "KV1", size: "42", soLuong: 1 }] });
    await post({ loai: "chuyen", trangThai: "cho-duyet", khoNguon: "wh_order", khoDich: "wh_san", dong: [{ ma: "KV1", size: "42", soLuong: 1 }] });
    const all = body(await call("GET", "/api/hang-kho/phieu"));
    assert.equal(all["phieu"].length, 4);
    assert.deepEqual(all["dem"], { nhapThang: 2, xuat: 1, chuyen: 1, choXacNhan: 3 });
    const onlyIn = body(await call("GET", "/api/hang-kho/phieu", undefined, { loai: "nhap", trangThai: "hoan-thanh" }))["phieu"];
    assert.deepEqual(onlyIn.map((p: { ma: string }) => p.ma), [original.ma]);
    assert.deepEqual([onlyIn[0].soDong, onlyIn[0].soLuong, onlyIn[0].tongTien, onlyIn[0].boi], [1, 2, 2000, "quan-tri"]);
    assert.equal(body(await call("GET", "/api/hang-kho/phieu", undefined, { kho: "wh_order" }))["phieu"].length, 2);
    assert.equal(body(await call("GET", "/api/hang-kho/phieu", undefined, { tuNgay: "2000-01-01", denNgay: "2000-01-02" }))["phieu"].length, 0);
  });

  await t.test("old book lines read as read-only documents (cu: true); they cannot be reversed", async () => {
    await setup();
    const slip = await call("POST", "/api/hang-kho/phieu-nhap", { nhaCungCap: "NCC cũ", dong: [{ ma: "KV1", size: "42", maKho: "wh_san", soLuong: 2, giaVon: 700000 }] });
    const slipId = String(body(slip)["id"]);
    const old = body(await call("GET", `/api/hang-kho/phieu/${slipId}`))["phieu"];
    assert.deepEqual([old.cu, old.trangThai, old.loai, old.khoDich, old.doiTac, old.dong[0].donGia, old.dong[0].tonSau], [true, "hoan-thanh", "nhap", "wh_san", "NCC cũ", 700000, 2]);
    assert.equal((await call("POST", `/api/hang-kho/phieu/${slipId}/dao`)).status, 409);

    assert.equal((await call("POST", "/api/hang-kho/chuyen-kho", { ma: "KV1", size: "42", tuKho: "wh_order", denKho: "wh_san", soLuong: 1 })).status, 200);
    const reference = String((await store.rows("SELECT ma_tham_chieu FROM hang_kho_bien_dong WHERE loai = 'chuyen-di' LIMIT 1"))[0]?.["ma_tham_chieu"]);
    const moved = body(await call("GET", `/api/hang-kho/phieu/${reference}`))["phieu"];
    assert.deepEqual([moved.cu, moved.loai, moved.khoNguon, moved.khoDich, moved.dong[0].soLuong, moved.butToan.length], [true, "chuyen", "wh_order", "wh_san", 1, 2]);

    await call("POST", "/api/hang-kho/dieu-chinh-ton", { ma: "KV1", size: "42", maKho: "wh_order", soLuong: -1 });
    const bare = await store.rows("SELECT ma FROM hang_kho_bien_dong WHERE ma_tham_chieu = '' LIMIT 1");
    const single = body(await call("GET", `/api/hang-kho/phieu/BD-${String(bare[0]?.["ma"])}`))["phieu"];
    assert.deepEqual([single.cu, single.loai, single.dong.length], [true, "dieu-chinh", 1]);
    assert.equal((await call("GET", "/api/hang-kho/phieu/KHONG-CO")).status, 404);
  });

  await t.test("bien-dong: filters by warehouse / kind / who / days, and names the item and its document", async () => {
    await setup();
    const doc = body(await post({ loai: "chuyen", trangThai: "hoan-thanh", khoNguon: "wh_order", khoDich: "wh_san", dong: [{ ma: "KV1", size: "42", soLuong: 1 }] }))["phieu"];
    await call("POST", "/api/hang-kho/dieu-chinh-ton", { ma: "KV2", size: "40", maKho: "wh_order", soLuong: 1 });
    const arriving = body(await call("GET", "/api/hang-kho/bien-dong", undefined, { kho: "wh_san", loai: "chuyen-den" }))["bienDong"];
    assert.equal(arriving.length, 1);
    assert.deepEqual([arriving[0].tenMon, arriving[0].loaiPhieu, arriving[0].trangThaiPhieu, arriving[0].reference], ["Giày kho v1", "chuyen", "hoan-thanh", doc.ma]);
    const loose = body(await call("GET", "/api/hang-kho/bien-dong", undefined, { ma: "KV2" }))["bienDong"];
    assert.deepEqual([loose.length, loose[0].loaiPhieu, loose[0].trangThaiPhieu], [1, "dieu-chinh", "hoan-thanh"]);
    assert.equal(body(await call("GET", "/api/hang-kho/bien-dong", undefined, { boi: "ai-do-khac" }))["bienDong"].length, 0);
    assert.equal(body(await call("GET", "/api/hang-kho/bien-dong", undefined, { tuNgay: "2000-01-01", denNgay: "2000-01-01" }))["bienDong"].length, 0);
    assert.equal(body(await call("GET", "/api/hang-kho/bien-dong"))["bienDong"].length, 3, "no filter = the old answer");
  });

  await t.test("GET kho: address, products (stock 0 counted), stock, updatedAt", async () => {
    await setup();
    const kho = body(await call("GET", "/api/hang-kho/kho"))["kho"] as Record<string, unknown>[];
    const order = kho.find((k) => k["id"] === "wh_order")!;
    const ready = kho.find((k) => k["id"] === "wh_san")!;
    assert.deepEqual([order["products"], order["stock"], order["pairs"]], [2, 6, 6]);
    assert.ok(String(order["updatedAt"]).endsWith("Z"));
    assert.deepEqual([ready["address"], ready["products"], ready["stock"]], ["Số 1 Cầu Diễn", 0, 0]);
  });

  await t.test("product page: item, attributes, web text and size price/cost/barcode/weight saved; stock untouched; strangers refused", async () => {
    await setup();
    await call("PUT", "/api/hang-kho/mon/KV1/noi-dung-web", { noiDung: { gioiThieuDong: "giữ lại" } });
    const item = ((await call("GET", "/api/admin/products", undefined, { q: "KV1" })).body as Record<string, any>[])[0]!;
    const size42 = item.sizes.find((s: { size: string }) => s.size === "42");
    const r = await call("PUT", "/api/hang-kho/mon/KV1/chi-tiet", {
      ten: "Giày kho v1 mới", danhMuc: "Chạy bộ", hienWeb: false, dongSanPham: "Dòng Pegasus", diemNoiBat: ["Êm", "Nhẹ"],
      thuocTinh: { skuNoiBo: "NB-01", xuatXu: "Việt Nam", khoaTrungTam: true, rac: "bỏ" },
      bienThe: [{ maBienThe: size42.variantId, sku: "KV1-42", maVach: "893000", khoiLuong: "950g", giaVon: 1600000, gia: 2100000 }]
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const mon = body(r)["mon"];
    assert.deepEqual([mon.name, mon.category, mon.status], ["Giày kho v1 mới", "Chạy bộ", "hidden"]);
    assert.deepEqual(mon.attributes, { skuNoiBo: "NB-01", xuatXu: "Việt Nam", khoaTrungTam: true, choPhepDat: true });
    assert.deepEqual([mon.webContent.gioiThieuDong, mon.webContent.dongSanPham, mon.webContent.tinhNang], ["giữ lại", "Dòng Pegasus", ["Êm", "Nhẹ"]]);
    const saved = mon.sizes.find((s: { size: string }) => s.size === "42");
    assert.deepEqual([saved.sku, saved.barcode, saved.weight, saved.costPrice, saved.price, saved.stock], ["KV1-42", "893000", "950g", 1600000, 2100000, 4]);
    assert.equal(body(await call("GET", "/api/hang-kho/hoan-tac"))["hoanTac"].nhan, "Trước khi sửa chi tiết KV1");

    const kv2 = (await store.table("hang_kho_bien_the").one({ ma_mon: "KV2" }))!;
    const stranger = await call("PUT", "/api/hang-kho/mon/KV1/chi-tiet", { bienThe: [{ maBienThe: String(kv2["ma_bien_the"]), gia: 1 }] });
    assert.deepEqual([stranger.status, body(stranger)["error"]], [400, "bien_the_sai"]);
    assert.equal((await call("PUT", "/api/hang-kho/mon/KHONG-CO/chi-tiet", { ten: "x" })).status, 404);

    const history = body(await call("GET", "/api/hang-kho/mon/KV1/lich-su"));
    assert.ok(history["banChup"].some((b: { nhan: string; daHoanTac: boolean }) => b.nhan === "Trước khi sửa chi tiết KV1" && b.daHoanTac === false));
    assert.ok(Array.isArray(history["bienDong"]));
  });

  await t.test("duplicate an item: new code, ' (bản sao)', every line at stock 0; a taken code is trung_ma", async () => {
    await setup();
    const r = await call("POST", "/api/hang-kho/mon/KV1/nhan-ban", { maMoi: "KV1-COPY" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const mon = body(r)["mon"];
    assert.deepEqual([mon.code, mon.name, mon.sizes.length, mon.sizes.every((s: { stock: number }) => s.stock === 0)], ["KV1-COPY", "Giày kho v1 (bản sao)", 2, true]);
    assert.equal(await shelf("KV1", "42", "wh_order"), 4, "the original keeps its stock");
    const taken = await call("POST", "/api/hang-kho/mon/KV1/nhan-ban", { maMoi: "KV2" });
    assert.deepEqual([taken.status, body(taken)["error"]], [409, "trung_ma"]);
  });

  await t.test("admin products ?kho=: only items with a line in that warehouse, stock 0 included, all sizes", async () => {
    await setup();
    await post({ loai: "nhap", trangThai: "hoan-thanh", khoDich: "wh_san", dong: [{ ma: "KV1", size: "44", soLuong: 1 }] });
    await post({ loai: "xuat", trangThai: "hoan-thanh", khoNguon: "wh_san", dong: [{ ma: "KV1", size: "44", soLuong: 1 }] });
    const inReady = (await call("GET", "/api/admin/products", undefined, { kho: "wh_san" })).body as Record<string, any>[];
    assert.deepEqual(inReady.map((m) => m["code"]), ["KV1"], "KV1 has a 0-stock line there, KV2 has none");
    assert.equal(inReady[0]!["sizes"].length, 3, "all sizes of every warehouse come back");
    assert.equal(((await call("GET", "/api/admin/products", undefined, { kho: "wh_order", q: "KV2" })).body as unknown[]).length, 1);
    assert.equal(((await call("GET", "/api/admin/products", undefined, { kho: "wh_san", size: "42" })).body as unknown[]).length, 0);
  });

  await t.test("web price per warehouse: cost / price now / the formula's price, surcharge; sync sets every line and is undoable", async () => {
    await setup();
    await call("PUT", "/api/hang-kho/kho/wh_order", { ten: "Kho order", loai: "order", congThucGia: { cheDo: "fixed", congThem: 100000, lamTron: 10000, nhom: { shoe: { congThem: 100000 } } } });
    await call("POST", "/api/hang-kho/kho/wh_order/chinh-sach", { tomTat: "Order", phiPhuThu: 50000 });
    const read = body(await call("GET", "/api/hang-kho/kho/wh_order/gia-web", undefined, { q: "kv1" }));
    assert.equal(read["phuPhi"], 50000);
    assert.deepEqual(read["dong"], [{ ma: "KV1", ten: "Giày kho v1", sizes: "42–43", giaVon: 1500000, giaHienTai: 2000000, giaDeXuat: 2100000 }]);
    const sync = await call("POST", "/api/hang-kho/kho/wh_order/gia-web", { dong: [{ ma: "KV1", gia: 2150000 }] });
    assert.deepEqual([sync.status, body(sync)["daDoi"]], [200, 2]);
    const prices = await store.rows("SELECT DISTINCT gia FROM hang_kho_bien_the WHERE ma_mon = 'KV1' AND ma_kho = 'wh_order'");
    assert.deepEqual(prices.map((p) => Number(p["gia"])), [2150000]);
    assert.equal((await call("POST", "/api/hang-kho/kho/wh_order/gia-web", { dong: [{ ma: "KV1", gia: 0 }] })).status, 400);
    assert.match(body(await call("GET", "/api/hang-kho/hoan-tac"))["hoanTac"].nhan, /đồng bộ giá web kho wh_order/);
  });

  await t.test("cần xử lý on the real tables: missing photo, missing price, no partner on an order warehouse", async () => {
    await setup();
    const answer = body(await call("GET", "/api/hang-kho/van-de"));
    const kinds = new Set((answer["vanDe"] as { loai: string; ma: string }[]).map((i) => `${i.loai}:${i.ma}`));
    assert.ok(kinds.has("thieu-anh:KV2"));
    assert.ok(kinds.has("thieu-gia:KV2"));
    assert.ok(kinds.has("chua-co-partner:KV1"));
    assert.equal(answer["dem"].thieuAnh, 1);
    const onlyLow = body(await call("GET", "/api/hang-kho/van-de", undefined, { mucDo: "cao" }));
    assert.ok((onlyLow["vanDe"] as { mucDo: string }[]).every((i) => i.mucDo === "cao"));
  });

  await t.test("lich-su-nap ?kho=: a file session names its warehouse, mode, counts and whether it can still be undone", async () => {
    await setup();
    const preview = await call("POST", "/api/hang-kho/phien-nhap-file/xem-truoc", { maKho: "wh_order", cheDo: "merge", mon: [{ code: "KV3", name: "Giày mới", sizes: [{ size: "41", qty: 2, price: 1000000 }] }] });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    const session = body(preview)["phien"].id;
    assert.equal((await call("POST", "/api/hang-kho/phien-nhap-file/ap-dung", { maPhien: session })).status, 200);
    const log = body(await call("GET", "/api/hang-kho/lich-su-nap", undefined, { kho: "wh_order" }))["lan"];
    assert.equal(log.length, 1);
    assert.deepEqual([log[0].maPhien, log[0].maKho, log[0].cheDo, log[0].them, log[0].capNhat, log[0].coTheHoanTac], [session, "wh_order", "merge", 1, 0, true]);
    assert.equal(body(await call("GET", "/api/hang-kho/lich-su-nap", undefined, { kho: "wh_san" }))["lan"].length, 0);
    assert.ok(body(await call("GET", "/api/hang-kho/lich-su-nap"))["lan"].length >= 2, "no filter = every import");
  });

  // ---------------- review 18/09/2026: each block below fails without its fix ----------------

  const rowsOf = async (code: string, size: string, warehouse: string) =>
    (await store.rows("SELECT CAST(BINARY ma_mon AS CHAR) AS ma_mon, nguon, ton, ma_sku, ma_vach, khoi_luong, gia_von FROM hang_kho_bien_the WHERE ma_mon = ? AND size = ? AND ma_kho = ? ORDER BY nguon", [code, size, warehouse]))
      .map((r) => ({ ma: String(r["ma_mon"]), nguon: String(r["nguon"]), ton: Number(r["ton"]), sku: String(r["ma_sku"]), vach: String(r["ma_vach"]), kl: String(r["khoi_luong"]), von: Number(r["gia_von"]) }));
  const bucket = async (source: string) => Number((await rowsOf("KV1", "42", "wh_san")).find((r) => r.nguon === source)?.ton ?? -1);

  await t.test("#1 a ready warehouse with a ready row R (0) and a campaign row C (10): goods in, out and the reversal all use R", async () => {
    await setup();
    await call("POST", "/api/hang-kho/dieu-chinh-ton", { ma: "KV1", size: "42", maKho: "wh_san", soLuong: 10, nguon: "campaign" });
    await call("POST", "/api/hang-kho/dieu-chinh-ton", { ma: "KV1", size: "42", maKho: "wh_san", soLuong: 1, nguon: "ready" });
    await call("POST", "/api/hang-kho/dieu-chinh-ton", { ma: "KV1", size: "42", maKho: "wh_san", soLuong: -1, nguon: "ready" });
    assert.deepEqual([await bucket("ready"), await bucket("campaign")], [0, 10]);
    const goodsIn = body(await post({ loai: "nhap", trangThai: "hoan-thanh", khoDich: "wh_san", dong: [{ ma: "KV1", size: "42", soLuong: 5 }] }))["phieu"];
    assert.deepEqual([await bucket("ready"), await bucket("campaign")], [5, 10]);
    assert.equal(goodsIn.dong[0].nguon, "ready", "the reply says which bucket the line landed in");
    assert.equal(goodsIn.butToan[0].source, "ready");
    const back = await call("POST", `/api/hang-kho/phieu/${goodsIn.ma}/dao`);
    assert.equal(back.status, 200, JSON.stringify(back.body));
    assert.deepEqual([await bucket("ready"), await bucket("campaign")], [0, 10], "BREAKS IF the reversal takes the 5 pairs from the campaign row");
    await post({ loai: "nhap", trangThai: "hoan-thanh", khoDich: "wh_san", dong: [{ ma: "KV1", size: "42", soLuong: 5 }] });
    assert.equal((await post({ loai: "xuat", trangThai: "hoan-thanh", khoNguon: "wh_san", dong: [{ ma: "KV1", size: "42", soLuong: 3 }] })).status, 200);
    assert.deepEqual([await bucket("ready"), await bucket("campaign")], [2, 10], "BREAKS IF goods out of a ready warehouse come from the campaign row");
  });

  await t.test("#15 posting into a size that already has an OWN row (a product made in OMI) adjusts that row, never adds a second one", async () => {
    await setup();
    assert.equal((await call("PUT", "/api/hang-kho/mon/OMI1", { code: "OMI1", name: "Giày tạo ở OMI", sizes: [{ size: "40", qty: 0, price: 1000000, warehouseId: "wh_san" }] })).status, 200);
    assert.deepEqual((await rowsOf("OMI1", "40", "wh_san")).map((r) => [r.nguon, r.ton]), [["own", 0]]);
    const adjust = body(await post({ loai: "dieu-chinh", trangThai: "hoan-thanh", khoNguon: "wh_san", dong: [{ ma: "OMI1", size: "40", soLuong: 3 }] }))["phieu"];
    assert.deepEqual((await rowsOf("OMI1", "40", "wh_san")).map((r) => [r.nguon, r.ton]), [["own", 3]]);
    assert.equal(adjust.dong[0].nguon, "own");
    await post({ loai: "nhap", trangThai: "hoan-thanh", khoDich: "wh_san", dong: [{ ma: "OMI1", size: "40", soLuong: 2 }] });
    assert.deepEqual((await rowsOf("OMI1", "40", "wh_san")).map((r) => [r.nguon, r.ton]), [["own", 5]]);
    const moves = body(await call("GET", "/api/hang-kho/bien-dong", undefined, { ma: "OMI1" }))["bienDong"];
    assert.ok(moves.length === 2 && moves.every((m: { source: string }) => m.source === "own"), "book lines carry the bucket too");
  });

  await t.test("#2 a reversal document is never reversed again", async () => {
    await setup();
    const doc = body(await post({ loai: "nhap", trangThai: "hoan-thanh", khoDich: "wh_san", dong: [{ ma: "KV1", size: "42", soLuong: 2 }] }))["phieu"];
    const reversal = body(await call("POST", `/api/hang-kho/phieu/${doc.ma}/dao`))["phieu"];
    const again = await call("POST", `/api/hang-kho/phieu/${reversal.ma}/dao`);
    assert.deepEqual([again.status, body(again)["error"], body(again)["message"]], [409, "khong_dao_duoc", "Phiếu đảo không đảo lại được — tạo phiếu mới nếu cần."]);
    assert.equal(await shelf("KV1", "42", "wh_san"), 0);
  });

  await t.test("#3/#4 documents written at the same instant each get their own code (collision retried)", async () => {
    await setup();
    const docs = await Promise.all([1, 2, 3].map(() => post({ loai: "nhap", trangThai: "hoan-thanh", khoDich: "wh_san", dong: [{ ma: "KV1", size: "42", soLuong: 1 }] })));
    assert.deepEqual(docs.map((r) => r.status), [200, 200, 200], JSON.stringify(docs.map((r) => r.body)));
    assert.equal(new Set(docs.map((r) => body(r)["phieu"].ma)).size, 3);
    const reversals = await Promise.all(docs.slice(0, 2).map((r) => call("POST", `/api/hang-kho/phieu/${body(r)["phieu"].ma}/dao`)));
    assert.deepEqual(reversals.map((r) => r.status), [200, 200], JSON.stringify(reversals.map((r) => r.body)));
    assert.notEqual(body(reversals[0]!)["phieu"].ma, body(reversals[1]!)["phieu"].ma);
    assert.equal(await shelf("KV1", "42", "wh_san"), 1);
  });

  await t.test("#5 a new size row keeps the catalogue's spelling of the code", async () => {
    await setup();
    assert.equal((await post({ loai: "nhap", trangThai: "hoan-thanh", khoDich: "wh_san", dong: [{ ma: "kv1", size: "45", soLuong: 1 }] })).status, 200);
    assert.deepEqual((await rowsOf("KV1", "45", "wh_san")).map((r) => r.ma), ["KV1"]);
  });

  await t.test("#6 goods out may not take pairs held for a customer", async () => {
    await setup();
    const row = (await store.table("hang_kho_bien_the").one({ ma_mon: "KV1", size: "42", ma_kho: "wh_order" }))!;
    const until = new Date(clock.now().getTime() + 60 * 60 * 1000).toISOString().slice(0, 23).replace("T", " ");
    await store.table("hang_kho_giu_cho").insert({ ma_phieu: "giu_test", ma_bien_the: String(row["ma_bien_the"]), ma_mon: "KV1", size: "42", so_luong: 3, cua_ai: "khach", giu_luc: until, het_han_luc: until });
    const refused = await post({ loai: "xuat", trangThai: "hoan-thanh", khoNguon: "wh_order", dong: [{ ma: "KV1", size: "42", soLuong: 2 }] });
    assert.deepEqual([refused.status, body(refused)["error"]], [400, "khong_du_ton"], "4 on the shelf, 3 held: only 1 may leave");
    assert.equal((await post({ loai: "xuat", trangThai: "hoan-thanh", khoNguon: "wh_order", dong: [{ ma: "KV1", size: "42", soLuong: 1 }] })).status, 200);
    const adjust = await post({ loai: "dieu-chinh", trangThai: "hoan-thanh", khoNguon: "wh_order", dong: [{ ma: "KV1", size: "42", soLuong: -1 }] });
    assert.equal(adjust.status, 400);
    assert.equal(await shelf("KV1", "42", "wh_order"), 3);
  });

  await t.test("#7 bounds: quantity, money, and fractional limits", async () => {
    await setup();
    const err = async (r: Promise<Reply>) => { const x = await r; return [x.status, body(x)["error"]]; };
    assert.deepEqual(await err(post({ loai: "nhap", khoDich: "wh_san", dong: [{ ma: "KV1", size: "42", soLuong: 2_000_000 }] })), [400, "dong_khong_hop_le"]);
    assert.deepEqual(await err(post({ loai: "nhap", khoDich: "wh_san", dong: [{ ma: "KV1", size: "42", soLuong: 1, donGia: 1e12 }] })), [400, "dong_khong_hop_le"]);
    assert.deepEqual(await err(post({ loai: "nhap", khoDich: "wh_san", phiVanChuyen: 1e12, dong: [{ ma: "KV1", size: "42", soLuong: 1 }] })), [400, "so_tien_sai"]);
    const size = (await store.table("hang_kho_bien_the").one({ ma_mon: "KV1", size: "42" }))!;
    assert.deepEqual(await err(call("PUT", "/api/hang-kho/mon/KV1/chi-tiet", { bienThe: [{ maBienThe: String(size["ma_bien_the"]), gia: 1e12 }] })), [400, "gia_khong_hop_le"]);
    assert.deepEqual(await err(call("POST", "/api/hang-kho/kho/wh_order/gia-web", { dong: [{ ma: "KV1", gia: 1e12 }] })), [400, "gia_khong_hop_le"]);
    assert.equal((await call("GET", "/api/hang-kho/phieu", undefined, { limit: "1.5" })).status, 200);
    assert.equal((await call("GET", "/api/hang-kho/bien-dong", undefined, { limit: "1.5" })).status, 200);
    assert.equal((await call("GET", "/api/admin/products", undefined, { kho: "wh_order", limit: "1.5" })).status, 200);
    assert.equal((await call("GET", "/api/admin/products", undefined, { size: "42", limit: "2.5" })).status, 200);
  });

  await t.test("#8 a description over 65,535 BYTES is refused before the undo snapshot", async () => {
    await setup();
    const headBefore = body(await call("GET", "/api/hang-kho/hoan-tac"))["hoanTac"];
    const r = await call("PUT", "/api/hang-kho/mon/KV1/chi-tiet", { moTa: "ệ".repeat(30000) });
    assert.deepEqual([r.status, body(r)["error"]], [400, "noi_dung_qua_dai"]);
    assert.deepEqual(body(await call("GET", "/api/hang-kho/hoan-tac"))["hoanTac"], headBefore, "no snapshot of a refused save");
    assert.equal((await call("PUT", "/api/hang-kho/mon/KV1/chi-tiet", { moTa: "ệ".repeat(20000) })).status, 200, "60,000 bytes fit");
  });

  await t.test("#9 a copy is the shop's own item: own rows, no SKU/barcode/campaign ids, and undo removes it whole", async () => {
    await setup();
    await call("POST", "/api/hang-kho/dieu-chinh-ton", { ma: "KV1", size: "42", maKho: "wh_san", soLuong: 2, nguon: "campaign" });
    const size = (await store.table("hang_kho_bien_the").one({ ma_mon: "KV1", size: "42", ma_kho: "wh_order" }))!;
    await call("PUT", "/api/hang-kho/mon/KV1/chi-tiet", { bienThe: [{ maBienThe: String(size["ma_bien_the"]), sku: "SKU-GOC", maVach: "893-GOC" }] });
    assert.equal((await call("POST", "/api/hang-kho/mon/KV1/nhan-ban", { maMoi: "KV1-B" })).status, 200);
    const copy = await store.rows("SELECT nguon, ton, ma_sku, ma_vach, ma_chien_dich, ma_dong_doi_tac FROM hang_kho_bien_the WHERE ma_mon = 'KV1-B'");
    assert.equal(copy.length, 3);
    assert.ok(copy.every((r) => r["nguon"] === "own" && Number(r["ton"]) === 0 && r["ma_sku"] === "" && r["ma_vach"] === "" && r["ma_chien_dich"] === "" && r["ma_dong_doi_tac"] === ""), JSON.stringify(copy));
    assert.equal((await store.table("hang_kho_mon").one({ ma: "KV1-B" }))?.["nguon"], "own");
    assert.equal((await call("POST", "/api/hang-kho/hoan-tac")).status, 200);
    assert.equal(await store.table("hang_kho_mon").count({ ma: "KV1-B" }), 0);
    assert.equal(await store.table("hang_kho_bien_the").count({ ma_mon: "KV1-B" }), 0, "BREAKS IF campaign/ready copies survive the undo");
  });

  await t.test("#10 attachments live in their own zone, behind an admin door; the public photo door does not serve them", async () => {
    await setup();
    const doc = body(await post({ loai: "nhap", khoDich: "wh_san", dong: [{ ma: "KV1", size: "42", soLuong: 1 }] }))["phieu"];
    const attached = await call("POST", `/api/hang-kho/phieu/${doc.ma}/dinh-kem`, { anh: `data:image/png;base64,${PNG.toString("base64")}`, ten: "hd.png" });
    const url = String(body(attached)["url"]);
    assert.match(url, new RegExp(`^/api/hang-kho/phieu/${doc.ma}/dinh-kem/[^/]+\\.png$`));
    const file = url.split("/").pop()!;
    const got = await call("GET", url);
    assert.equal(got.status, 200);
    assert.equal(got.headers?.["Cache-Control"], "private, no-store");
    const asJson = await call("GET", url, undefined, { dang: "json" });
    assert.equal(asJson.status, 200);
    assert.equal(asJson.headers?.["Cache-Control"], "private, no-store");
    assert.deepEqual([body(asJson)["ok"], body(asJson)["ten"], body(asJson)["loai"], body(asJson)["anh"]], [true, "hd.png", "image/png", `data:image/png;base64,${PNG.toString("base64")}`]);
    const anonymousJson = await kernel.handle({ method: "GET", path: url, ip: "1.1.1.1", headers: {}, query: { dang: "json" } } as IncomingRequest);
    assert.ok(anonymousJson.status === 401 || anonymousJson.status === 403, "json variant is admin-only too");
    const anonymous = await kernel.handle({ method: "GET", path: url, ip: "1.1.1.1", headers: {}, query: {} } as IncomingRequest);
    assert.ok(anonymous.status === 401 || anonymous.status === 403, `no admin, no file (${anonymous.status})`);
    assert.equal((await call("GET", `/api/hang-kho/anh/${file}`)).status, 404, "BREAKS IF the public photo door serves an invoice");
    const other = body(await post({ loai: "nhap", khoDich: "wh_san", dong: [{ ma: "KV1", size: "42", soLuong: 1 }] }))["phieu"];
    assert.equal((await call("GET", `/api/hang-kho/phieu/${other.ma}/dinh-kem/${file}`)).status, 404, "only a file the document lists");
    assert.equal((await call("GET", `/api/hang-kho/phieu/${other.ma}/dinh-kem/${file}`, undefined, { dang: "json" })).status, 404, "json variant: only a file the document lists");
  });

  await t.test("#12 a goods-in / out / transfer line cannot name another warehouse", async () => {
    await setup();
    const r = await post({ loai: "nhap", trangThai: "hoan-thanh", khoDich: "wh_san", dong: [{ ma: "KV1", size: "42", soLuong: 1, maKho: "wh_order" }] });
    assert.deepEqual([r.status, body(r)["error"], body(r)["dong"]], [400, "dong_khong_hop_le", 1]);
    assert.equal((await post({ loai: "nhap", trangThai: "hoan-thanh", khoDich: "wh_san", dong: [{ ma: "KV1", size: "42", soLuong: 1, maKho: "wh_san" }] })).status, 200);
    assert.equal((await post({ loai: "dieu-chinh", trangThai: "hoan-thanh", khoNguon: "wh_san", dong: [{ ma: "KV1", size: "42", soLuong: 1, maKho: "wh_order" }] })).status, 200, "an adjustment may");
  });

  await t.test("#13 a catalogue push keeps the SKU, barcode, weight and cost typed on a size", async () => {
    await setup();
    const rows = await store.table("hang_kho_bien_the").find({ where: { ma_mon: "KV1", ma_kho: "wh_order" } });
    const id = (size: string) => String(rows.find((r) => r["size"] === size)!["ma_bien_the"]);
    await call("PUT", "/api/hang-kho/mon/KV1/chi-tiet", { bienThe: [
      { maBienThe: id("42"), sku: "KV1-42", maVach: "893042", khoiLuong: "950g" },
      { maBienThe: id("43"), maVach: "893043", giaVon: 1200000 }
    ] });
    assert.equal((await call("POST", "/api/products", ITEMS)).status, 200);
    const [r42] = await rowsOf("KV1", "42", "wh_order");
    const [r43] = await rowsOf("KV1", "43", "wh_order");
    assert.deepEqual([r42!.sku, r42!.vach, r42!.kl, r42!.von], ["KV1-42", "893042", "950g", 1500000], "the push's own cost wins where it gives one");
    assert.deepEqual([r43!.vach, r43!.von], ["893043", 1200000]);
  });

  await t.test("mua-ho can-mua: grouped by product + size + warehouse + partner, with its states", async () => {
    await setup();
    await call("POST", "/api/admin/partners", { ma: "dt-a", ten: "Đối tác A", maCong: "cong-a" });
    const line = (id: string, extra: Record<string, unknown>) => ({ maDong: id, productCode: "KV1", productName: "Giày kho v1", size: "42", qty: 1, warehouseId: "wh_order", warehouseName: "Kho order", ...extra });
    orders.push(
      { id: "D1", status: "new", paymentStatus: "paid", createdAt: "2026-09-10T00:00:00.000Z", items: [line("D1#1", { partnerId: "dt-a" })] },
      // No partner yet, sold from wh_order (declared `order` in the warehouse book by setup): must be bought -> cho-gan.
      { id: "D2", status: "new", paymentStatus: "unpaid", createdAt: "2026-09-11T00:00:00.000Z", items: [line("D2#1", {})] },
      // No partner, sold from the READY warehouse: nothing to buy -> not listed.
      { id: "D3", status: "new", paymentStatus: "paid", createdAt: "2026-09-12T00:00:00.000Z", items: [line("D3#1", { warehouseId: "wh_san", warehouseName: "Kho sẵn" })] }
    );
    const r = await call("GET", "/api/admin/mua-ho/can-mua");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(body(r)["dem"], { tong: 2, choGan: 1, dangMua: 1, muaMotPhan: 0, choNhapKho: 0 });
    const buying = body(r)["dong"].find((d: { trangThai: string }) => d.trangThai === "dang-mua");
    assert.deepEqual([buying.tenDoiTac, buying.tenKho, buying.canMua, buying.cacDong[0].maDong], ["Đối tác A", "Kho order", 1, "D1#1"]);
    const unassigned = body(r)["dong"].find((d: { trangThai: string }) => d.trangThai === "cho-gan");
    assert.deepEqual([unassigned.maKho, unassigned.maDoiTac, unassigned.cacDong[0].maDong], ["wh_order", "", "D2#1"]);
    assert.ok(!body(r)["dong"].some((d: { cacDong: { maDon: string }[] }) => d.cacDong.some((c) => c.maDon === "D3")), "a ready-warehouse line is never on the list");

    // Bought in full by the shop on the partner's behalf: waiting to arrive, still listed.
    const bought = await call("POST", "/api/admin/mua-ho/mua-thay", { doiTac: "dt-a", maDong: "D1#1", soLuong: 1, giaVon: 1500000 });
    assert.equal(bought.status, 200, JSON.stringify(bought.body));
    const after = body(await call("GET", "/api/admin/mua-ho/can-mua"));
    assert.equal(after["dong"].find((d: { maDoiTac: string }) => d.maDoiTac === "dt-a").trangThai, "cho-nhap-kho");
  });
});
