/**
 * Đ4 (17/09/2026) — Tài chính + đối tác, on real MySQL (port 3307).
 *
 * What must hold:
 *   - the book of manual income/expense feeds the profit; paying a partner FOR GOODS is tracked but
 *     is NOT an expense (goods are already in cost of goods)
 *   - profit = revenue + other income − cost of goods − shipping the shop bears − expenses
 *   - a partner transfer is corrected or VOIDED, never deleted; voided money stops counting everywhere
 *   - the shop buys / reports out of stock ON BEHALF of a partner under the right partner
 *   - bought goods move between orders; a source with a live waybill is refused
 *   - "Gửi đối tác" sends each partner ITS lines with the shop's own bot
 *   - CTV payments are corrected / voided; a fixed per-product rule wins over the collaborator's rate
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FakeHttpClient, FakeStaticFilePort, FixedWindowRateLimiter, Kernel, ManualClock, MemoryLogger, MemoryMailer, TokenAuth, jsonResponse, openMysqlStore
} from "../dist/kernel/index.js";
import { ROLE, defineModule, type Reply } from "../dist/contract/index.js";
import { manifest as purchasing } from "../dist/modules/mua-ho/module.js";
import { SCHEMA as PURCHASING_SCHEMA, LEDGER_TABLE, PARTNERS_TABLE, PURCHASES_TABLE, STOCK_OUTS_TABLE } from "../dist/modules/mua-ho/schema.js";
import { manifest as money } from "../dist/modules/tien-doi-soat/module.js";
import { ENTRIES_TABLE, FINANCE_SCHEMA } from "../dist/modules/tien-doi-soat/finance-book.js";
import { manifest as collaborators } from "../dist/modules/ctv/module.js";
import { CommissionBook, computeCommission } from "../dist/modules/ctv/commissions.js";

const ADMIN = "ma-quan-tri";
const URL = String(process.env["TOPRUN_MYSQL_URL"] || "").trim();
const skip = URL ? {} : { skip: "chưa đặt TOPRUN_MYSQL_URL — bỏ qua bài Đ4" };
if (URL && /:3306\//.test(URL)) throw new Error("Cổng 3306 là dữ liệu thật của landing. Dùng 3307.");

type Body = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any -- test reads arbitrary JSON fields
const bodyOf = (r: Reply) => r.body as Body;

test("a fixed per-product rule wins over the collaborator's own percent", () => {
  const order = { id: "O1", customerName: "", total: 3000000, status: "pending", items: [{ productCode: "a1", quantity: 2, price: 1000000 }, { productCode: "B2", quantity: 1, price: 1000000 }] };
  const plain = computeCommission(order, { type: "percent", value: 5 });
  assert.equal(plain.commissionAmount, 150000);
  const ruled = computeCommission(order, { type: "percent", value: 5 }, [{ id: "r1", scope: "product", targetId: "A1", type: "fixed", value: 100000, status: "active", createdAt: "" }]);
  assert.equal(ruled.commissionAmount, 2 * 100000 + 50000, "A1 x2 at 100k fixed, B2 still 5%");
});

test("Đ4 finance + partners on real MySQL", { ...skip }, async (t) => {
  const logger = new MemoryLogger();
  const clock = new ManualClock(new Date("2026-09-17T03:00:00.000Z"));
  const store = await openMysqlStore({ url: URL, logger });
  await store.runSchema("mua-ho", PURCHASING_SCHEMA);
  await store.runSchema("tien-doi-soat", FINANCE_SCHEMA);
  await store.runSchema("ctv", collaborators.schema ?? []);

  const orders: Body[] = [];
  const shipments: Record<string, Body> = {};
  const fakeOrders = defineModule({
    id: "don-khach", name: "Đơn giả", tier: "van-hanh", runsOn: "server-khach", version: "0.0.1",
    provides: {
      "don-khach.search": async () => orders.map((o) => ({ ...o, items: o["items"].map((l: Body) => ({ ...l })) })),
      "don-khach.read": async (_c, id: string) => orders.find((o) => o["id"] === id) ?? null,
      "don-khach.readByLookupToken": async () => null,
      "don-khach.recordPayment": async () => ({ ok: true })
    }
  });
  const fakeShipping = defineModule({
    id: "van-chuyen", name: "Vận chuyển giả", tier: "van-hanh", runsOn: "server-khach", version: "0.0.1",
    provides: { "van-chuyen.shipmentBook": async () => shipments }
  });

  const telegram: { url: string; body: Body }[] = [];
  const http = new FakeHttpClient((url, init) => {
    telegram.push({ url, body: JSON.parse(String(init.body ?? "{}")) as Body });
    return jsonResponse({ ok: true });
  });

  const cleanUp = async () => {
    orders.length = 0;
    for (const k of Object.keys(shipments)) delete shipments[k];
    telegram.length = 0;
    for (const table of [LEDGER_TABLE, PURCHASES_TABLE, STOCK_OUTS_TABLE, PARTNERS_TABLE, ENTRIES_TABLE, "ctv_thanh_toan"]) await store.table(table).truncate();
    await store.execute("DELETE FROM `so_du_lieu` WHERE ten IN ('mua-ho-chinh-sach', 'ctv-cau-hinh')", []).catch(() => undefined);
  };
  await cleanUp();
  t.after(async () => { await cleanUp(); await store.close(); });

  const kernel = new Kernel({
    ports: {
      store, logger, clock, http, mail: new MemoryMailer(),
      auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }], clock }),
      rateLimiter: new FixedWindowRateLimiter(clock),
      staticFiles: new FakeStaticFilePort({})
    },
    logger, modules: [fakeOrders, fakeShipping, purchasing, money, collaborators],
    config: {
      "don-khach": {}, "mua-ho": { sessionSecret: "bi-mat-phien-doi-tac-dai" }, ctv: { sessionSecret: "bi-mat-phien-ctv-dai-hon" },
      "tien-doi-soat": { telegram: { token: "bot-token", chatId: "-100" } }
    }
  });
  const call = (method: string, path: string, payload?: unknown, query: Record<string, string> = {}) =>
    kernel.handle({ method, path, ip: "1.1.1.1", query, headers: { authorization: `Bearer ${ADMIN}` }, json: async () => payload ?? {} });

  const addPartner = (ma: string, extra: Body = {}) => call("POST", "/api/admin/partners", { ma, ten: `Đối tác ${ma}`, maCong: `cong-${ma}`, congMoiMon: 20000, congMoiDon: 0, cachTinh: "moi-mon", ...extra });
  const order = (id: string, lines: Body[], extra: Body = {}) => {
    orders.push({
      id, customerName: `Khách ${id}`, status: "partner_assigned", paymentStatus: "paid", paidAmount: 0, createdAt: "2026-09-16T02:00:00.000Z",
      total: 0, remainingAmount: 0, shippingFee: 0, shippingPayer: "", trackingCode: "", vanDonKien: [],
      items: lines.map((l, i) => ({ maDong: `${id}#${i}`, size: "42", qty: 1, price: 1000000, purchaseAuthorized: true, ...l })),
      ...extra
    });
  };

  await t.test("the book: entries, partner goods payment NOT an expense, profit formula, void", async () => {
    await cleanUp();
    await addPartner("dt-a");
    order("ORD-F1", [{ productCode: "A1", partnerId: "dt-a", costPrice: 600000, qty: 2, price: 1000000 }], { total: 2030000, paidAmount: 500000, remainingAmount: 1530000, shippingFee: 30000, shippingPayer: "sender" });
    order("ORD-F2", [{ productCode: "B2", partnerId: "", costPrice: 0, price: 500000 }], { total: 500000, paidAmount: 500000, shippingPayer: "" });
    order("ORD-HUY", [{ productCode: "C3", costPrice: 100000 }], { total: 900000, status: "cancelled" });
    order("ORD-CU", [{ productCode: "D4", costPrice: 100000 }], { total: 700000, createdAt: "2026-08-01T02:00:00.000Z" });
    shipments["ORD-F1"] = { hang: "spx", maVanDon: "SPX1", maDon: "ORD-F1", cod: 1530000, codDaThu: null, phi: 32000 };
    shipments["ORD-F2"] = { hang: "vtp", maVanDon: "VTP1", maDon: "ORD-F2", cod: 0, phi: 25000 };
    shipments["ORD-HUY"] = { hang: "spx", maVanDon: "SPX9", maDon: "ORD-HUY", phi: 99000 };

    assert.equal((await call("POST", "/api/tien/thu-chi", { loai: "chi", nhom: "advertising", soTien: 100000, ghiChu: "Ads" })).status, 200);
    assert.equal((await call("POST", "/api/tien/thu-chi", { loai: "thu", nhom: "other_income", soTien: 50000, maDon: "ORD-F2" })).status, 200);
    assert.equal((await call("POST", "/api/tien/thu-chi", { loai: "chi", nhom: "khong-co", soTien: 1 })).status, 400, "unknown group refused");
    assert.equal((await call("POST", "/api/tien/thu-chi", { loai: "chi", nhom: "packaging", soTien: 0 })).status, 400, "zero refused");
    const paid = await call("POST", "/api/tien/tra-doi-tac", { doiTac: "dt-a", soTien: 700000 });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    assert.equal(bodyOf(paid)["khoan"]["nhom"], "tien_hang_doi_tac");

    const r = await call("GET", "/api/tien/tai-chinh", undefined, { tuNgay: "2026-09-01", denNgay: "2026-09-17" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const b = bodyOf(r);
    assert.equal(b["tong"]["soDon"], 2, "cancelled and out-of-window orders are not revenue");
    assert.equal(b["tong"]["doanhThu"], 2530000);
    assert.equal(b["tong"]["giaVon"], 1200000);
    assert.equal(b["tong"]["phiHangVanChuyen"], 57000);
    assert.equal(b["tong"]["shipShopChiu"], 32000, "only the order where the shop pays");
    assert.equal(b["tong"]["chiPhi"], 100000, "partner goods payment is not an expense");
    assert.equal(b["tong"]["thuKhac"], 50000);
    assert.equal(b["tong"]["laiUocTinh"], 2530000 + 50000 - 1200000 - 32000 - 100000);
    assert.equal(b["phiShip"].length, 2);
    assert.equal(b["giaVon"].length, 2);
    const partnerRow = b["doiTac"].find((x: Body) => x["maDoiTac"] === "dt-a");
    assert.deepEqual([partnerRow["tenDoiTac"], partnerRow["tienHang"], partnerRow["daTra"], partnerRow["conLai"]], ["Đối tác dt-a", 1200000, 700000, 500000]);

    const expense = b["thuChi"].find((e: Body) => e["nhom"] === "advertising");
    assert.equal((await call("POST", "/api/tien/thu-chi/huy", { ma: expense["ma"], lyDo: "nhầm" })).status, 200);
    assert.equal((await call("POST", "/api/tien/thu-chi/huy", { ma: expense["ma"] })).status, 404, "twice = already voided");
    const after = bodyOf(await call("GET", "/api/tien/tai-chinh", undefined, { tuNgay: "2026-09-01", denNgay: "2026-09-17" }));
    assert.equal(after["tong"]["chiPhi"], 0, "a voided expense stops counting");
    assert.ok(after["thuChi"].some((e: Body) => e["huyLuc"] !== ""), "but stays in the list");
  });

  await t.test("partner ledger by period: correct and void a transfer; voided money leaves every sum", async () => {
    await cleanUp();
    await addPartner("dt-a");
    order("ORD-L1", [{ productCode: "A1", partnerId: "dt-a", costPrice: 500000, qty: 2 }]);
    const bought = await call("POST", "/api/admin/mua-ho/mua-thay", { doiTac: "dt-a", maMon: "A1", size: "42", soLuong: 2, giaVon: 510000 });
    assert.equal(bought.status, 200, JSON.stringify(bought.body));

    await call("POST", "/api/admin/mua-ho/tien", { doiTac: "dt-a", soTien: 30000, loai: "tra" });
    await call("POST", "/api/admin/mua-ho/tien", { doiTac: "dt-a", soTien: 5000, loai: "phat_sinh", ghiChu: "taxi" });
    let ledger = bodyOf(await call("GET", "/api/admin/mua-ho/so-cong-no", undefined, { doiTac: "dt-a" }));
    assert.deepEqual(
      [ledger["doiTac"][0]["phienMua"], ledger["doiTac"][0]["soMon"], ledger["doiTac"][0]["tienCong"], ledger["doiTac"][0]["chiPhiThem"], ledger["doiTac"][0]["daChuyen"], ledger["doiTac"][0]["conNo"]],
      [1, 2, 40000, 5000, 30000, 15000]
    );
    const transfer = ledger["thanhToan"][0];
    assert.equal((await call("POST", "/api/admin/mua-ho/tien/sua", { ma: transfer["ma"], soTien: 40000, ghiChu: "CK lại" })).status, 200);
    ledger = bodyOf(await call("GET", "/api/admin/mua-ho/so-cong-no", undefined, { doiTac: "dt-a" }));
    assert.equal(ledger["doiTac"][0]["conNo"], 5000);
    assert.equal((await call("POST", "/api/admin/mua-ho/tien/huy", { ma: transfer["ma"], lyDo: "Nhập nhầm" })).status, 200);
    assert.equal((await call("POST", "/api/admin/mua-ho/tien/sua", { ma: transfer["ma"], soTien: 1 })).status, 409, "a voided line cannot be edited");
    ledger = bodyOf(await call("GET", "/api/admin/mua-ho/so-cong-no", undefined, { doiTac: "dt-a" }));
    assert.equal(ledger["doiTac"][0]["daChuyen"], 0);
    assert.equal(ledger["doiTac"][0]["conNo"], 45000);
    assert.ok(ledger["thanhToan"][0]["huyLuc"], "the voided transfer is still listed");
    const portal = bodyOf(await call("GET", "/api/admin/mua-ho/portal", undefined, { doiTac: "dt-a" }));
    assert.equal(portal["payments"].length, 0, "the partner's page no longer shows it");
    assert.equal(portal["summary"]["paidAmount"], 0);

    const empty = bodyOf(await call("GET", "/api/admin/mua-ho/so-cong-no", undefined, { doiTac: "dt-a", tuNgay: "2026-09-18", denNgay: "2026-09-20" }));
    assert.equal(empty["doiTac"][0]["tienCong"], 0, "outside the window nothing counts");
  });

  await t.test("the shop acts FOR partners: confirm buys each line under its partner; out of stock reports it", async () => {
    await cleanUp();
    await addPartner("dt-a");
    await addPartner("dt-b");
    order("ORD-T1", [{ productCode: "A1", partnerId: "dt-a", costPrice: 400000 }, { productCode: "B2", partnerId: "dt-b", costPrice: 300000, qty: 2 }]);
    order("ORD-T2", [{ productCode: "C3", partnerId: "dt-a", costPrice: 200000 }]);

    const confirmed = await call("POST", "/api/admin/mua-ho/thay-doi-tac", { maDon: "ORD-T1", viec: "xac-nhan" });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    const slips = await store.table(PURCHASES_TABLE).find({ where: { ma_don: "ORD-T1" } });
    assert.deepEqual(slips.map((s) => `${s["ma_doi_tac"]}:${s["ma_dong"]}:${s["so_luong"]}:${Number(s["gia_von"])}`).sort(), ["dt-a:ORD-T1#0:1:400000", "dt-b:ORD-T1#1:2:300000"]);
    assert.equal((await call("POST", "/api/admin/mua-ho/thay-doi-tac", { maDon: "ORD-T1", viec: "xac-nhan" })).status, 409, "nothing left to confirm");

    const out = await call("POST", "/api/admin/mua-ho/thay-doi-tac", { maDon: "ORD-T2", viec: "het-hang", lyDo: "Kho hết" });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    const reports = await store.table(STOCK_OUTS_TABLE).find({ where: { ma_don: "ORD-T2" } });
    assert.deepEqual(reports.map((r) => `${r["ma_doi_tac"]}:${r["ly_do"]}`), ["dt-a:Kho hết"]);
    assert.equal((await call("POST", "/api/admin/mua-ho/thay-doi-tac", { maDon: "ORD-T2", viec: "bay" })).status, 400);
  });

  await t.test("take goods from another order: whole slip moves, a split leaves the rest; a live waybill refuses", async () => {
    await cleanUp();
    await addPartner("dt-a");
    order("ORD-SRC", [{ productCode: "A1", partnerId: "dt-a", qty: 3, costPrice: 500000 }], { createdAt: "2026-09-15T01:00:00.000Z" });
    order("ORD-DST", [{ productCode: "a1", partnerId: "", qty: 2, costPrice: 500000, purchaseAuthorized: false }]);
    order("ORD-SHIP", [{ productCode: "A1", partnerId: "dt-a", qty: 1, costPrice: 500000 }], { createdAt: "2026-09-14T01:00:00.000Z" });
    assert.equal((await call("POST", "/api/admin/mua-ho/mua-thay", { doiTac: "dt-a", maMon: "A1", size: "42", soLuong: 4, giaVon: 500000 })).status, 200);
    orders.find((o) => o["id"] === "ORD-SHIP")!["trackingCode"] = "SPX77";

    const sources = bodyOf(await call("GET", "/api/admin/mua-ho/nguon-chuyen", undefined, { maDon: "ORD-DST", maDong: "ORD-DST#0" }));
    assert.deepEqual(sources["nguon"].map((s: Body) => `${s["maDon"]}:${s["soLuong"]}:${s["coVanDon"]}`).sort(), ["ORD-SHIP:1:true", "ORD-SRC:3:false"]);

    const refused = await call("POST", "/api/admin/mua-ho/chuyen-phieu", { maDonDich: "ORD-DST", maDongDich: "ORD-DST#0", maDonNguon: "ORD-SHIP", soLuong: 1 });
    assert.equal(refused.status, 409);
    assert.match(String(bodyOf(refused)["message"]), /vận đơn/);

    const moved = await call("POST", "/api/admin/mua-ho/chuyen-phieu", { maDonDich: "ORD-DST", maDongDich: "ORD-DST#0", maDonNguon: "ORD-SRC", soLuong: 2 });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal(bodyOf(moved)["soLuong"], 2);
    const bySource = await store.table(PURCHASES_TABLE).find({ where: { ma_don: "ORD-SRC" } });
    const byTarget = await store.table(PURCHASES_TABLE).find({ where: { ma_don: "ORD-DST" } });
    assert.equal(bySource.reduce((t2, s) => t2 + Number(s["so_luong"]), 0), 1, "one pair stays on the source");
    assert.equal(byTarget.reduce((t2, s) => t2 + Number(s["so_luong"]), 0), 2);
    assert.equal((await call("POST", "/api/admin/mua-ho/chuyen-phieu", { maDonDich: "ORD-DST", maDongDich: "ORD-DST#0", maDonNguon: "ORD-SRC" })).status, 409, "target already full");

    // A slip typed under the wrong partner moves to another partner.
    await addPartner("dt-b");
    const slip = byTarget[0]!;
    const reassigned = await call("POST", "/api/admin/mua-ho/chuyen-phieu", { maPhieu: slip["ma_phieu"], doiTacMoi: "dt-b" });
    assert.equal(reassigned.status, 200, JSON.stringify(reassigned.body));
    assert.equal((await store.table(PURCHASES_TABLE).one({ ma_phieu: String(slip["ma_phieu"]) }))?.["ma_doi_tac"], "dt-b");
  });

  await t.test("Gửi đối tác: each partner gets ITS lines with the shop's bot; a partner without chat id is named", async () => {
    await cleanUp();
    await addPartner("dt-a", { telegramChatId: "111" });
    await addPartner("dt-b");
    order("ORD-G1", [{ productCode: "A1", productName: "Giày <A1>", partnerId: "dt-a" }, { productCode: "B2", partnerId: "dt-b" }, { productCode: "C3", partnerId: "" }]);
    const r = await call("POST", "/api/admin/mua-ho/gui-doi-tac", { maDon: "ORD-G1" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(bodyOf(r)["daGui"], 1);
    assert.equal(telegram.length, 1);
    assert.match(telegram[0]!.url, /botbot-token\/sendMessage$/);
    assert.equal(telegram[0]!.body["chat_id"], "111");
    assert.match(String(telegram[0]!.body["text"]), /Giày &lt;A1&gt;/);
    assert.ok(!String(telegram[0]!.body["text"]).includes("B2"), "partner A never sees partner B's line");
    const b = bodyOf(r)["ketQua"].find((x: Body) => x["maDoiTac"] === "dt-b");
    assert.match(String(b["loiNhan"]), /chat ID/);

    const partners = bodyOf(await call("GET", "/api/admin/partners")) as unknown as Body[];
    assert.equal(partners.find((p) => p["ma"] === "dt-a")?.["telegram_chat_id"], "111");
    await call("POST", "/api/admin/partners", { ma: "dt-a", ten: "Đối tác dt-a", maCong: "cong-dt-a" });
    const kept = bodyOf(await call("GET", "/api/admin/partners")) as unknown as Body[];
    assert.equal(kept.find((p) => p["ma"] === "dt-a")?.["telegram_chat_id"], "111", "a save without the field keeps it");

    order("ORD-G2", [{ productCode: "Z9", partnerId: "" }]);
    assert.equal((await call("POST", "/api/admin/mua-ho/gui-doi-tac", { maDon: "ORD-G2" })).status, 409);
  });

  await t.test("partner policies: default present, save, edit, default cannot be renamed", async () => {
    await cleanUp();
    const first = bodyOf(await call("GET", "/api/admin/mua-ho/chinh-sach"));
    assert.equal(first["chinhSach"][0]["macDinh"], true);
    const saved = await call("POST", "/api/admin/mua-ho/chinh-sach", { ten: "Yen Shop", noiDung: "Đổi trong 3 ngày", ghiChu: "Báo Zalo chị Yến" });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const list = bodyOf(saved)["chinhSach"];
    assert.equal(list.length, 2);
    const yen = list.find((p: Body) => p["ten"] === "yen_shop");
    const edited = await call("POST", "/api/admin/mua-ho/chinh-sach", { ma: yen["ma"], ten: "yen_shop", noiDung: "Đổi trong 5 ngày" });
    assert.equal(bodyOf(edited)["chinhSach"].find((p: Body) => p["ma"] === yen["ma"])["noiDung"], "Đổi trong 5 ngày");
    assert.equal((await call("POST", "/api/admin/mua-ho/chinh-sach", { ma: "mac-dinh", ten: "khac" })).status, 400);
    assert.equal((await call("POST", "/api/admin/mua-ho/chinh-sach", { ten: "" })).status, 400);
  });

  await t.test("CTV: payment corrected then voided leaves the debt; campaigns and rules are kept", async () => {
    await cleanUp();
    const book = new CommissionBook(store);
    const id = await book.pay({ collaboratorId: "ctv-x", amount: 100000, note: "T9", actor: "quan-tri", now: clock.now() });
    assert.equal((await call("POST", "/api/admin/ctv/thanh-toan/sua", { ma: id, soTien: 120000, ghiChu: "T9 sửa" })).status, 200);
    let read = await book.read(undefined, "ctv-x");
    assert.equal(read.payments[0]!["amount"], 120000);
    assert.equal(CommissionBook.summary(read).paidAmount, 120000);
    assert.equal((await call("POST", "/api/admin/ctv/thanh-toan/huy", { ma: id, lyDo: "nhầm" })).status, 200);
    assert.equal((await call("POST", "/api/admin/ctv/thanh-toan/huy", { ma: id })).status, 404);
    read = await book.read(undefined, "ctv-x");
    assert.ok(read.payments[0]!["voidedAt"]);
    assert.equal(CommissionBook.summary(read).paidAmount, 0);

    assert.equal((await call("POST", "/api/admin/ctv/chien-dich", { ten: "Nova", ma: "nova-may" })).status, 200);
    assert.equal((await call("POST", "/api/admin/ctv/chien-dich", { ten: "" })).status, 400);
    assert.equal((await call("POST", "/api/admin/ctv/quy-tac", { maSanPham: "jz1234", giaTri: 100000 })).status, 200);
    assert.equal((await call("POST", "/api/admin/ctv/quy-tac", { maSanPham: "X", giaTri: 0 })).status, 400);
    const config = bodyOf(await call("GET", "/api/admin/ctv/cau-hinh"));
    assert.equal(config["campaigns"][0]["code"], "NOVA-MAY");
    assert.equal(config["rules"][0]["targetId"], "JZ1234");
    const saved = await call("POST", "/api/admin/ctv/cau-hinh", { campaigns: config["campaigns"], rules: [] });
    assert.equal(bodyOf(saved)["rules"].length, 0);
  });
});
