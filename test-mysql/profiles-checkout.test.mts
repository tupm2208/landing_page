/**
 * Đ2 (17/09/2026) on REAL MySQL — the owner's customer book and the full order editor.
 *
 *   TOPRUN_MYSQL_URL=mysql://root:...@127.0.0.1:3307/toprun_modules_test \
 *     node --test --test-concurrency=1 --test-force-exit test-mysql/profiles-checkout.test.mts
 *
 * Focus: the SERVER computes what the customer owes (discounts, shipping) — a screen only sends
 * inputs; editing the address keeps last week's shipping fee; one phone = one profile; one default
 * address; a web order's buyer is linked (not duplicated) on review; a rotated lookup secret kills
 * the old one; cancelling records the deposit decision instead of leaving a to-do.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { EVENTS, ROLE, defineModule, type Reply } from "../dist/contract/index.js";
import { FakeHttpClient, FakeStaticFilePort, FixedWindowRateLimiter, Kernel, ManualClock, MemoryLogger, MemoryMailer, TokenAuth, openMysqlStore } from "../dist/kernel/index.js";
import { manifest } from "../dist/modules/don-khach/module.js";
import { computeCheckout } from "../dist/modules/don-khach/checkout.js";
import type { Order } from "../dist/modules/don-khach/order-repository.js";

const ADMIN = "ma-quan-tri";
const URL = String(process.env["TOPRUN_MYSQL_URL"] || "").trim();
const skip = URL ? {} : { skip: "TOPRUN_MYSQL_URL not set — skipping the Đ2 tests" };
if (URL && /:3306\//.test(URL)) throw new Error("Cổng 3306 là dữ liệu thật của landing. Dùng 3307.");

// Nothing in stock: the owner's lines are still sold (not strict), which is all these tests need.
const emptyInventory = defineModule({
  id: "hang-kho", name: "Kho rỗng", tier: "van-hanh", runsOn: "server-khach", version: "0.0.0",
  provides: {
    "hang-kho.reserve": () => ({ ok: false, reason: "khong_du_hang" }),
    "hang-kho.release": () => ({ ok: true }),
    "hang-kho.commit": () => ({ ok: false, reason: "khong_co_phieu" }),
    "hang-kho.restock": () => ({ ok: true })
  }
});

const body = <T,>(r: Reply): T => r.body as T;
interface ProfileBody { ok: boolean; error?: string; message?: string; taoMoi?: boolean; khach: { ma: string; ten: string; dienThoai: string; sizeQuen: string; diaChi: string } | null; diaChi: { ma: string; macDinh: boolean; tinh: string; xa: string; chiTiet: string }[]; don: { maDon: string }[] }

test("pure checkout: line discount, then order discount on what is left, then shipping; paid is capped", () => {
  const t = computeCheckout(
    [{ quantity: 2, unitPrice: 1000000, discountType: "percent", discountValue: 10 }, { quantity: 1, unitPrice: 500000, discountType: "money", discountValue: 900000 }],
    { discountType: "money", discountValue: 100000, shippingFee: 30000, paidAmount: 5000000 }
  );
  assert.equal(t.subtotal, 2500000);
  assert.equal(t.itemDiscount, 200000 + 500000, "a money discount never goes below zero on its line");
  assert.equal(t.orderDiscount, 100000);
  assert.equal(t.customerPayable, 2500000 - 700000 - 100000 + 30000);
  assert.equal(t.paidAmount, t.customerPayable, "paying more than owed is capped here; refunds are their own door");
  assert.equal(t.remainingAmount, 0);
  assert.equal(computeCheckout([{ quantity: 1, unitPrice: 1000000 }], { discountType: "percent", discountValue: 250 }).customerPayable, 0, "percent clamps at 100");
});

test("Đ2 customer book and full order editor on real MySQL", { ...skip }, async (t) => {
  const logger = new MemoryLogger();
  const clock = new ManualClock();
  const store = await openMysqlStore({ url: URL, logger });
  await store.runSchema(manifest.id, manifest.schema ?? [], { inheritedTables: manifest.inheritedTables ?? [] });
  const cleanUp = async () => {
    clock.advance(11 * 60 * 1000);
    for (const table of ["don_khach_so_khach_dia_chi", "don_khach_so_khach", "order_status_logs", "order_items", "orders"]) await store.execute(`DELETE FROM \`${table}\``);
  };
  await cleanUp();
  t.after(async () => { await cleanUp(); await store.close(); });

  const kernel = new Kernel({
    ports: {
      store, logger, clock, http: new FakeHttpClient(),
      auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }], clock }),
      rateLimiter: new FixedWindowRateLimiter(clock),
      staticFiles: new FakeStaticFilePort({}), mail: new MemoryMailer()
    },
    logger, modules: [emptyInventory, manifest], config: { "hang-kho": {}, "don-khach": { siteUrl: "https://shop.test" } }
  });
  const admin = { authorization: `Bearer ${ADMIN}` };
  const call = (method: string, full: string, json?: unknown) => {
    const [path = "", search = ""] = full.split("?");
    return kernel.handle({ method, path, query: Object.fromEntries(new URLSearchParams(search)), headers: admin, ip: "1.1.1.1", json: async () => json ?? {} });
  };
  const read = async (id: string) => body<Order>(await call("GET", `/api/orders/${id}`));

  await t.test("a manual order with discounts and shipping: the server writes the total, the order keeps the inputs", async () => {
    await cleanUp();
    const r = await call("POST", "/api/orders/thu-cong", {
      customerName: "Chị Lan", phone: "0911222333",
      discountType: "percent", discountValue: 10, shippingFee: 30000, shippingPayer: "sender", deliveryMethod: "carrier",
      tags: ["vip", " sale "], shippingNote: "gọi trước", paidAmount: 200000,
      items: [{ productCode: "A1", size: "42", qty: 2, price: 1000000, discountType: "money", discountValue: 100000 }]
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const order = await read(String((r.body as { orderId: string }).orderId));
    assert.equal(order.subtotal, 2000000);
    assert.equal(order.total, Math.round((2000000 - 100000) * 0.9) + 30000, "line discount, then 10% on the rest, then shipping");
    assert.equal(order.remainingAmount, order.total - 200000);
    assert.deepEqual([order.shippingPayer, order.deliveryMethod, order.tags, order.shippingNote], ["sender", "carrier", "vip, sale", "gọi trước"]);
    assert.deepEqual([order.items[0]?.discountType, order.items[0]?.discountValue], ["money", 100000]);

    // Editing ONLY the recipient keeps the money exactly as it was.
    const before = order.total;
    await call("PUT", `/api/orders/${order.id}`, { customerName: "Chị Lan Anh" });
    assert.equal((await read(order.id)).total, before, "an address edit must not drop the shipping fee");

    // Changing the shipping fee alone re-prices from the stored lines.
    await call("PUT", `/api/orders/${order.id}`, { shippingFee: 50000 });
    const repriced = await read(order.id);
    assert.equal(repriced.total, before + 20000);
    assert.equal(repriced.shippingFee, 50000);
    assert.equal(repriced.discountValue, 10, "untouched settings stay");
  });

  await t.test("customer book: one phone one profile, first address is default, a new default replaces it, deleting it promotes the next", async () => {
    await cleanUp();
    const made = body<ProfileBody>(await call("POST", "/api/admin/ho-so-khach", {
      ten: "Anh Nam", dienThoai: "0912 345 678", sizeQuen: "42.5", monChoi: "chạy đường dài",
      diaChiMoi: { he: "ba-cap", tinh: "Hà Nội", huyen: "Ba Đình", xa: "Giảng Võ", chiTiet: "12 Đội Cấn" }
    }));
    assert.equal(made.ok, true, JSON.stringify(made));
    assert.equal(made.khach?.dienThoai, "0912345678", "digits only");
    assert.equal(made.diaChi.length, 1);
    assert.equal(made.diaChi[0]?.macDinh, true, "the first address is the default");
    assert.match(String(made.khach?.diaChi), /12 Đội Cấn, Giảng Võ, Ba Đình, Hà Nội/, "the one-line address follows the default");

    const dup = await call("POST", "/api/admin/ho-so-khach", { ten: "Người khác", dienThoai: "0912345678" });
    assert.equal(dup.status, 409, "one phone, one profile");

    const id = String(made.khach?.ma);
    const second = body<ProfileBody>(await call("POST", `/api/admin/ho-so-khach/${id}/dia-chi`, { he: "hai-cap", tinh: "TP Hồ Chí Minh", xa: "Phường Bến Nghé", chiTiet: "1 Lê Lợi", macDinh: true }));
    assert.deepEqual(second.diaChi.map((a) => a.macDinh), [false, true], "exactly one default");
    const afterDelete = body<ProfileBody>(await call("DELETE", `/api/admin/ho-so-khach/${id}/dia-chi/${second.diaChi[1]?.ma}`));
    assert.deepEqual(afterDelete.diaChi.map((a) => a.macDinh), [true], "deleting the default promotes the remaining one");

    const byPhone = body<ProfileBody>(await call("GET", "/api/admin/ho-so-khach-theo-so?dienThoai=0912345678"));
    assert.equal(byPhone.khach?.ma, id);
    const list = body<{ khach: { ma: string; soDon: number; diaChiMacDinh: unknown }[] }>(await call("GET", "/api/admin/ho-so-khach?q=Nam"));
    assert.equal(list.khach.length, 1);
    assert.ok(list.khach[0]?.diaChiMacDinh, "the list carries the default address for the order editor");
  });

  await t.test("reviewing a web order's buyer: an unknown phone makes a profile from the order; a known phone is LINKED, not duplicated", async () => {
    await cleanUp();
    const made = body<{ orderId: string }>(await call("POST", "/api/orders/thu-cong", {
      customerName: "Khách Web", phone: "0933000111", province: "Hà Nội", district: "Cầu Giấy", ward: "Dịch Vọng", addressDetail: "5 Trần Thái Tông",
      items: [{ productCode: "A1", size: "41", qty: 1, price: 900000 }]
    }));
    const first = body<{ ok: boolean; maKhach: string; taoMoi: boolean }>(await call("POST", `/api/orders/${made.orderId}/duyet-khach`, { moi: true }));
    assert.equal(first.taoMoi, true);
    assert.equal((await read(made.orderId)).customerProfileId, first.maKhach);
    const profile = body<ProfileBody>(await call("GET", `/api/admin/ho-so-khach/${first.maKhach}`));
    assert.equal(profile.diaChi[0]?.xa, "Dịch Vọng", "the order's address becomes the first address");
    assert.deepEqual(profile.don.map((d) => d.maDon), [made.orderId]);

    const other = body<{ orderId: string }>(await call("POST", "/api/orders/thu-cong", { customerName: "Khách Web", phone: "0933000111", items: [{ productCode: "B2", size: "40", qty: 1, price: 500000 }] }));
    const again = body<{ maKhach: string; taoMoi: boolean }>(await call("POST", `/api/orders/${other.orderId}/duyet-khach`, { moi: true }));
    assert.equal(again.taoMoi, false);
    assert.equal(again.maKhach, first.maKhach, "same phone = same profile");
    assert.equal((await call("POST", `/api/orders/${other.orderId}/duyet-khach`, {})).status, 422, "must choose");
  });

  await t.test("rotating the lookup secret: a new one is shown once, the old one stops working", async () => {
    await cleanUp();
    const made = body<{ orderId: string; lookupSecret: string }>(await call("POST", "/api/orders/thu-cong", { customerName: "A", phone: "0911000000", items: [{ productCode: "A1", size: "42", qty: 1, price: 100000 }] }));
    const lookup = (secret: string) => kernel.handle({ method: "POST", path: "/api/orders/lookup", headers: {}, ip: "2.2.2.2", json: async () => ({ orderId: made.orderId, lookupSecret: secret }) });
    assert.equal((await lookup(made.lookupSecret)).status, 200, "the first secret works");
    const rotated = body<{ maBiMat: string; duongTraCuu: string }>(await call("POST", `/api/orders/${made.orderId}/ma-tra-cuu`));
    assert.match(rotated.maBiMat, /^TR-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    assert.match(rotated.duongTraCuu, /^https:\/\/shop\.test\/order-status\.html\?order=/);
    assert.equal((await lookup(rotated.maBiMat)).status, 200, "the new one works");
    assert.notEqual((await lookup(made.lookupSecret)).status, 200, "the old one does not");
  });

  await t.test("Đ3 bus → order: a PARCEL's waybill goes in its own entry; a delivery state updates the order once", async () => {
    await cleanUp();
    const made = body<{ orderId: string }>(await call("POST", "/api/orders/thu-cong", { customerName: "A", phone: "0911000009", items: [{ productCode: "A1", size: "42", qty: 1, price: 100000 }] }));
    const settle = () => new Promise((r) => setTimeout(r, 150));
    kernel.bus.emit(EVENTS.shipmentCreated, { maPhieu: `${made.orderId}-02`, maVanDon: "SPXVN77", hang: "spx" });
    await settle();
    const withParcel = await read(made.orderId);
    assert.deepEqual(withParcel.vanDonKien.map((k) => [k.maKien, k.maVanDon, k.trangThaiGiao]), [[`${made.orderId}-02`, "SPXVN77", "shipping_created"]]);
    assert.equal(withParcel.trackingCode, "", "a parcel's waybill is not the order's");

    kernel.bus.emit(EVENTS.shipmentStatusChanged, { maPhieu: `${made.orderId}-02`, trangThaiGiao: "delivered", trangThai: "Đã giao" });
    kernel.bus.emit(EVENTS.shipmentStatusChanged, { maPhieu: made.orderId, trangThaiGiao: "shipping", trangThai: "Đang giao" });
    await settle();
    kernel.bus.emit(EVENTS.shipmentStatusChanged, { maPhieu: made.orderId, trangThaiGiao: "shipping", trangThai: "Đang giao" });
    await settle();
    const after = await read(made.orderId);
    assert.equal(after.vanDonKien[0]?.trangThaiGiao, "delivered");
    assert.equal(after.fulfillmentStatus, "shipping");
    const logs = await store.table("order_status_logs").find({ where: { order_id: made.orderId } });
    assert.equal(logs.filter((l) => /Hãng báo: shipping/.test(String(l["note"]))).length, 1, "the same state twice is written once");
  });

  await t.test("cancelling with a paid deposit: the decision goes in the log instead of a to-do; filters 'chưa gán kho' work", async () => {
    await cleanUp();
    const made = body<{ orderId: string }>(await call("POST", "/api/orders/thu-cong", { customerName: "A", phone: "0911000001", paidAmount: 300000, items: [{ productCode: "A1", size: "42", qty: 1, price: 1000000 }] }));
    const unassigned = body<Order[]>(await call("GET", "/api/orders?nhom=chua-gan-kho"));
    assert.deepEqual(unassigned.map((o) => o.id), [made.orderId], "a line with no warehouse and no partner");
    assert.deepEqual(body<Order[]>(await call("GET", "/api/orders?nhom=o-doi-tac")), []);

    const ended = body<{ ok: boolean; canNguoiLam: string[]; order: Order }>(await call("POST", `/api/orders/${made.orderId}/ket-thuc`, { cach: "huy", lyDo: "khách đổi ý", giuCoc: "giu" }));
    assert.equal(ended.ok, true);
    assert.ok(!ended.canNguoiLam.some((x) => /đã trả/.test(x)), "deciding at cancel time leaves nothing to do about the money");
    const logs = await store.table("order_status_logs").find({ where: { order_id: made.orderId } });
    assert.ok(logs.some((l) => /Giữ cọc 300000đ/.test(String(l["note"]))), "the decision is in the log");
  });
});
