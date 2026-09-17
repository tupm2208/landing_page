/**
 * The partner portal's PURE RULES — no MySQL, no kernel: the screen builder and the label reader.
 *
 * These are the parts where a mistake is silent. A wrong quantity in `buildNeeds` sends a partner
 * to buy a pair nobody ordered; a too-generous match in `matchReading` buys the wrong size. Both
 * are guarded here, and both halves are tested: the right answer AND the refusal.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildNeeds, buildOrderLines, buildParcels, buildSessions, buildSummary, feeForSlips, lineIdOf, normaliseFeeMode, openLines, unitCostOf
} from "../dist/modules/mua-ho/portal-state.js";
import {
  candidateSizes, editDistanceAtMostOne, matchReading, normaliseCode, normaliseSize, readLabel, sizesEqual, sizeToNumber
} from "../dist/modules/mua-ho/scan-label.js";
import type { PortalOrder, PortalView } from "../dist/modules/mua-ho/portal-state.js";
import type { Partner, PurchaseSlip, ShipmentRequestState } from "../dist/modules/mua-ho/purchase-repository.js";
import type { HttpClient } from "../dist/contract/index.js";

const PARTNER: Partner = { id: "dt-a", name: "Đối tác A", portalCode: "cong-a", login: "doi-tac-a", feePerItem: 20000, feePerOrder: 5000, feeMode: "ca-hai" };

type LineSpec = { code: string; size: string; qty: number; cost?: number; costPrice?: number; variantId?: string; partnerId?: string; pushed?: boolean; procurementStatus?: string };

/**
 * An order as Orders hands it over: `saleFilePrice` is the shop's cost, `price` the customer's.
 * By default PAID and given to partner A — the ordinary case; tests that are about the gate say otherwise.
 */
function order(id: string, lines: LineSpec[], extra: Partial<PortalOrder> = {}): PortalOrder {
  return {
    id, createdAt: "2026-09-15T01:00:00.000Z", customerName: "Khách", status: "partner_assigned", paymentStatus: "paid",
    items: lines.map((l, i) => ({
      variantId: l.variantId ?? `v${i + 1}`, productCode: l.code, productName: `Món ${l.code}`,
      size: l.size, qty: l.qty, saleFilePrice: l.cost ?? 1000000, costPrice: l.costPrice ?? 0,
      partnerId: l.partnerId ?? "dt-a", purchaseAuthorized: l.pushed ?? false, procurementStatus: l.procurementStatus ?? ""
    })),
    ...extra
  };
}

/** What partner A (or the shop, with `partnerId: ""`) is looking at. */
function view(over: Partial<PortalView> & { bought?: [string, number][]; mine?: [string, number][] } = {}): PortalView {
  const bought = new Map(over.bought ?? []);
  return {
    partnerId: "dt-a",
    purchasedByAnyone: bought,
    purchasedByPartner: new Map(over.mine ?? over.bought ?? []),
    reportedOut: new Set(),
    packing: new Map(),
    now: new Date("2026-09-16T10:00:00.000Z"),
    ...over
  };
}

const slip = (over: Partial<PurchaseSlip> = {}): PurchaseSlip => ({
  maPhieu: "mua_1", maDoiTac: "dt-a", maDon: "ORD-1", maDong: "ORD-1#v1", maMon: "DV1234", size: "42",
  soLuong: 1, giaVon: 900000, giaHeThong: 0, maLenh: "", ghiChu: "", taoLuc: "2026-09-15 08:00:00.000", ...over
});

// ---------------- what is still to buy ----------------

test("the line id is order + VARIANT, never the line's position (the trap of 10/09)", () => {
  const o = order("ORD-1", [{ code: "A", size: "42", qty: 1, variantId: "v9" }]);
  assert.equal(lineIdOf(o, o.items![0]!, 0), "ORD-1#v9");
  // Without a variant it falls back to the line number given AT CREATION, not the current index.
  assert.equal(lineIdOf({ id: "ORD-2" }, {}, 3), "ORD-2#4");
});

test("needs are grouped by product AND size, and count what is still missing", () => {
  const orders = [
    order("ORD-1", [{ code: "DV1234", size: "42", qty: 2, cost: 900000 }]),
    order("ORD-2", [{ code: "DV1234", size: "42", qty: 1, cost: 900000 }, { code: "DV1234", size: "43", qty: 1 }])
  ];
  const needs = buildNeeds(orders, view());
  assert.equal(needs.length, 2, "42 and 43 are different shoes");

  const size42 = needs.find((n) => n.size === "42")!;
  assert.equal(size42.missingQty, 3, "2 + 1 across two orders");
  assert.equal(size42.unitCost, 900000);
  assert.equal(size42.orders.length, 2);
  assert.equal(size42.status, "pending");
});

test("a partly bought line becomes BACKLOG, an untouched one stays NEW — the partner plans the day on this", () => {
  const orders = [order("ORD-1", [{ code: "A", size: "42", qty: 3 }]), order("ORD-2", [{ code: "A", size: "42", qty: 2 }])];
  const row = buildNeeds(orders, view({ bought: [["ORD-1#v1", 1]] }))[0]!;
  assert.equal(row.backlogQty, 2, "ORD-1 still wants 2 and was already started");
  assert.equal(row.newQty, 2, "ORD-2 was never started");
  assert.equal(row.missingQty, 4);
  assert.equal(row.status, "partial");
});

test("a line bought in full, and a cancelled or shipped order, are nobody's work any more", () => {
  assert.deepEqual(buildNeeds([order("ORD-1", [{ code: "A", size: "42", qty: 2 }])], view({ bought: [["ORD-1#v1", 2]] })), []);
  for (const status of ["cancelled", "shipped", "completed", "ready_to_ship"]) {
    assert.deepEqual(buildNeeds([order("ORD-9", [{ code: "A", size: "42", qty: 1 }], { status })], view()), [], `${status} is not bought for`);
  }
  assert.deepEqual(buildNeeds([order("ORD-8", [{ code: "A", size: "42", qty: 1 }], { daXoa: true })], view()), [], "an order in the bin is not bought for");
});

test("a line reported OUT OF STOCK leaves the list, but one already part-bought stays", () => {
  const orders = [order("ORD-1", [{ code: "A", size: "42", qty: 2 }])];
  assert.deepEqual(buildNeeds(orders, view({ reportedOut: new Set(["ORD-1#v1"]) })), [], "reported out, nothing bought: gone");
  assert.equal(buildNeeds(orders, view({ bought: [["ORD-1#v1", 1]], reportedOut: new Set(["ORD-1#v1"]) }))[0]?.missingQty, 1, "half bought: still work");
});

test("BREAKS IF a partner sees another partner's lines — or lines given to nobody", () => {
  const orders = [order("ORD-1", [
    { code: "MINE", size: "42", qty: 1 },
    { code: "THEIRS", size: "42", qty: 1, partnerId: "dt-b" },
    { code: "NOBODY", size: "42", qty: 1, partnerId: "" }
  ])];
  assert.deepEqual(buildNeeds(orders, view()).map((n) => n.productCode), ["MINE"]);
  assert.deepEqual(buildOrderLines(orders, view()).map((l) => l.productCode), ["MINE"]);
  // The shop's own view sees every partner's lines, but still not a line given to nobody.
  assert.deepEqual(buildNeeds(orders, view({ partnerId: "" })).map((n) => n.productCode).sort(), ["MINE", "THEIRS"]);
});

test("BREAKS IF an unpaid order is bought for — unless the shop pushed the line on purpose", () => {
  const unpaid = { paymentStatus: "pending", paidAmount: 0 };
  assert.deepEqual(buildNeeds([order("ORD-1", [{ code: "A", size: "42", qty: 1 }], unpaid)], view()), [], "no money, not pushed: wait");
  assert.equal(buildNeeds([order("ORD-1", [{ code: "A", size: "42", qty: 1, pushed: true }], unpaid)], view()).length, 1, "pushed: buy");
  assert.equal(buildNeeds([order("ORD-1", [{ code: "A", size: "42", qty: 1 }], { paymentStatus: "pending", paidAmount: 200000 })], view()).length, 1, "a deposit counts as paid");
  assert.deepEqual(buildNeeds([order("ORD-1", [{ code: "A", size: "42", qty: 1, pushed: true, procurementStatus: "partner_out_of_stock" }])], view()), [], "blocked lines never");
});

test("what is MISSING counts every partner's purchases; 'you bought' counts only this partner's", () => {
  const orders = [order("ORD-1", [{ code: "A", size: "42", qty: 3 }])];
  const row = buildNeeds(orders, view({ bought: [["ORD-1#v1", 2]], mine: [] }))[0]!;
  assert.equal(row.missingQty, 1, "someone else already bought two");
  assert.equal(row.purchasedQty, 0, "but not this partner");
});

test("the system price falls back to the cost locked on the line — a Desk order is not 'Thiếu giá'", () => {
  assert.equal(unitCostOf({ saleFilePrice: 0, costPrice: 850000 }), 850000);
  assert.equal(unitCostOf({ saleFilePrice: 900000, costPrice: 850000 }), 850000, "the locked cost wins");
  assert.equal(unitCostOf({ saleFilePrice: 900000 }), 900000);
  const row = buildNeeds([order("MAN-1", [{ code: "A", size: "42", qty: 1, cost: 0, costPrice: 850000 }])], view())[0]!;
  assert.equal(row.unitCost, 850000);
});

test("the newest waiting order comes first, as on the running site", () => {
  const needs = buildNeeds([
    order("ORD-1", [{ code: "OLD", size: "42", qty: 1 }], { createdAt: "2026-09-10T01:00:00.000Z" }),
    order("ORD-2", [{ code: "NEW", size: "42", qty: 1 }], { createdAt: "2026-09-15T01:00:00.000Z" })
  ], view());
  assert.deepEqual(needs.map((n) => n.productCode), ["NEW", "OLD"]);
  // …while the lines themselves are served oldest first (the customer who waited longest).
  assert.deepEqual(openLines([order("B", [{ code: "X", size: "1", qty: 1 }], { createdAt: "2026-09-15" }), order("A", [{ code: "X", size: "1", qty: 1 }], { createdAt: "2026-09-10" })], view()).map((l) => l.order.id), ["A", "B"]);
});

test("a price that moved since the order is flagged, not hidden", () => {
  const row = buildNeeds([order("ORD-1", [{ code: "A", size: "42", qty: 1, cost: 900000 }])], view({ currentCost: new Map([["a|42", 950000]]) }))[0]!;
  assert.equal(row.priceChanged, true);
  assert.equal(row.priceDelta, 50000);
});

test("THE CUSTOMER'S PRICE NEVER REACHES THE PARTNER — only the shop's cost does", () => {
  const o = order("ORD-1", [{ code: "A", size: "42", qty: 1, cost: 900000 }]);
  // The customer's price rides along on the line, as Orders sends it.
  (o.items![0] as Record<string, unknown>)["price"] = 2890000;
  const payload = JSON.stringify({
    needs: buildNeeds([o], view()),
    orders: buildOrderLines([o], view()),
    parcels: buildParcels([o], view({ bought: [["ORD-1#v1", 1]] }))
  });
  assert.ok(!payload.includes("2890000"), `the selling price leaked: ${payload}`);
  assert.ok(payload.includes("900000"), "the cost price is what the partner works from");
});

// ---------------- packing and waybills ----------------

test("a parcel is listed once it is bought IN FULL, and cannot be packed before it has a waybill", () => {
  const o = order("ORD-1", [{ code: "A", size: "42", qty: 2 }]);
  assert.deepEqual(buildParcels([o], view({ bought: [["ORD-1#v1", 1]] })), [], "half bought: not a parcel yet");

  const ready = buildParcels([o], view({ bought: [["ORD-1#v1", 2]] }))[0]!;
  assert.equal(ready.purchaseComplete, true);
  assert.equal(ready.canRequest, true, "no waybill yet: the button to ask for one is open");
  assert.equal(ready.canPack, false, "nothing is sealed before the courier has a label");
  assert.equal(ready.packingStatusLabel, "Chờ vận đơn");
});

test("with a tracking code the parcel may be packed, and asking for a waybill is closed", () => {
  const o = order("ORD-1", [{ code: "A", size: "42", qty: 1 }], { trackingCode: "SPX123", shippingProvider: "spx" });
  const parcel = buildParcels([o], view({ bought: [["ORD-1#v1", 1]] }))[0]!;
  assert.equal(parcel.canPack, true);
  assert.equal(parcel.canRequest, false, "it already has one");
  assert.equal(parcel.trackingCode, "SPX123");

  const packed = buildParcels([o], view({ bought: [["ORD-1#v1", 1]], packing: new Map([["ORD-1", { maDon: "ORD-1", trangThai: "packed", boi: "A", suaLuc: "" }]]) }))[0]!;
  assert.equal(packed.packingStatusLabel, "Đã đóng hàng");
});

test("an order shipped OUTSIDE a carrier can be packed without a waybill, and never asks for one", () => {
  const parcel = buildParcels([order("ORD-1", [{ code: "A", size: "42", qty: 1 }], { shippingProvider: "external" })], view({ bought: [["ORD-1#v1", 1]] }))[0]!;
  assert.equal(parcel.externalShip, true);
  assert.equal(parcel.canPack, true);
  assert.equal(parcel.canRequest, false);
});

test("a parcel the carrier already has leaves the packing list", () => {
  const shipped = order("ORD-1", [{ code: "A", size: "42", qty: 1 }], { trackingCode: "SPX1", fulfillmentStatus: "in_transit" });
  assert.deepEqual(buildParcels([shipped], view({ bought: [["ORD-1#v1", 1]] })), []);
});

test("a parcel lists only THIS partner's lines, and is complete when those are bought", () => {
  const o = order("ORD-1", [{ code: "MINE", size: "42", qty: 1 }, { code: "THEIRS", size: "42", qty: 1, partnerId: "dt-b" }]);
  const parcel = buildParcels([o], view({ bought: [["ORD-1#v1", 1]] }))[0]!;
  assert.equal(parcel.products.length, 1);
  assert.match(parcel.products[0]!, /MINE/);
  assert.deepEqual(buildParcels([o], view({ partnerId: "dt-c", bought: [["ORD-1#v1", 1]] })), [], "a partner with no line on it has no parcel");
});

test("a waybill request still creating locks the button; a failed one shows its reason; an old one may be retried", () => {
  const o = order("ORD-1", [{ code: "A", size: "42", qty: 1 }]);
  const at = (minutesAgo: number, state: Partial<ShipmentRequestState>): Map<string, ShipmentRequestState> =>
    new Map([["ORD-1", { maDon: "ORD-1", maDoiTac: "dt-a", dangTao: false, loi: "", luc: new Date(Date.parse("2026-09-16T10:00:00.000Z") - minutesAgo * 60000).toISOString(), ...state }]]);
  const pending = buildParcels([o], view({ bought: [["ORD-1#v1", 1]], shipmentRequests: at(2, { dangTao: true }) }))[0]!;
  assert.equal(pending.requestPending, true);
  assert.equal(pending.canRequest, false, "a second tap must not ask the carrier twice");

  const stale = buildParcels([o], view({ bought: [["ORD-1#v1", 1]], shipmentRequests: at(20, { dangTao: true }) }))[0]!;
  assert.equal(stale.requestStale, true);
  assert.equal(stale.canRequest, true);

  const failed = buildParcels([o], view({ bought: [["ORD-1#v1", 1]], shipmentRequests: at(1, { loi: "Thiếu địa chỉ" }) }))[0]!;
  assert.equal(failed.requestError, "Thiếu địa chỉ");
});

// ---------------- money ----------------

test("the fee follows the agreed mode, and what is owed is COUNTED, never stored", () => {
  const slips = [slip({ soLuong: 2, maDon: "ORD-1" }), slip({ maPhieu: "mua_2", soLuong: 1, maDon: "ORD-2" })];
  // ca-hai: 3 pairs x 20,000 + 2 orders x 5,000
  assert.equal(feeForSlips(slips, PARTNER), 3 * 20000 + 2 * 5000);
  assert.equal(feeForSlips(slips, { ...PARTNER, feeMode: "moi-mon" }), 3 * 20000);
  assert.equal(feeForSlips(slips, { ...PARTNER, feeMode: "moi-don" }), 2 * 5000);

  const summary = buildSummary(slips, PARTNER, 30000, 10000);
  assert.equal(summary.purchasedQty, 3);
  assert.equal(summary.orderCount, 2);
  assert.equal(summary.debtAmount, summary.feeAmount + 10000 - 30000);

  // Undoing a slip must move the debt by itself — that is why nothing is stored.
  assert.ok(buildSummary([slips[0]!], PARTNER, 30000, 10000).feeAmount < summary.feeAmount);
});

test("BREAKS IF the running site's fee names are misread — a 'product' partner must not be paid per order too", () => {
  const slips = [slip({ soLuong: 2, maDon: "ORD-1" })];
  assert.equal(feeForSlips(slips, { ...PARTNER, feeMode: "product" }), 2 * 20000);
  assert.equal(feeForSlips(slips, { ...PARTNER, feeMode: "order" }), 5000);
  assert.equal(normaliseFeeMode("both"), "ca-hai");
});

test("the fee is counted PER SESSION, as on the running site — an order bought in two sessions earns its order fee twice", () => {
  const slips = [
    slip({ maPhieu: "m1", maLenh: "phien-1#0", maDon: "ORD-1", soLuong: 1 }),
    slip({ maPhieu: "m2", maLenh: "phien-2#0", maDon: "ORD-1", soLuong: 1 })
  ];
  // 2 pairs x 20,000 + (1 order in session 1 + 1 order in session 2) x 5,000
  assert.equal(buildSummary(slips, PARTNER, 0, 0).feeAmount, 2 * 20000 + 2 * 5000);
});

test("what is owed never goes negative, however much was paid", () => {
  assert.equal(buildSummary([slip()], PARTNER, 999999999, 0).debtAmount, 0);
});

test("one TAP is one session: slips of one command group together, with the system price beside the paid one", () => {
  const sessions = buildSessions([
    slip({ maPhieu: "mua_1", maLenh: "lenh-7#0", maDon: "ORD-1", soLuong: 1, giaHeThong: 950000 }),
    slip({ maPhieu: "mua_2", maLenh: "lenh-7#1", maDon: "ORD-2", maDong: "ORD-2#v1", soLuong: 2, giaHeThong: 950000 }),
    slip({ maPhieu: "mua_xyz" })
  ], PARTNER);
  assert.equal(sessions.length, 2);
  const tap = sessions.find((x) => x["id"] === "lenh-7")!;
  assert.equal(tap["quantity"], 3);
  assert.equal(tap["unitCost"], 950000, "what the system said");
  assert.equal(tap["actualCostPrice"], 900000, "what the partner paid — the page shows 'Lệch'");
  assert.deepEqual((tap["allocations"] as { orderId: string }[]).map((a) => a.orderId), ["ORD-1", "ORD-2"]);
  // A slip without a command is its own session, named by the slip.
  assert.ok(sessions.some((x) => x["id"] === "mua_xyz"));
});

// ---------------- reading a label ----------------

test("codes and sizes are normalised the way the labels are actually printed", () => {
  assert.equal(normaliseCode("im-7681"), "IM7681");
  assert.equal(normaliseSize("A/XL"), "XL");
  assert.equal(normaliseSize("xxl"), "2XL");
  assert.equal(sizeToNumber("43 1/3").toFixed(2), "43.33");
  assert.ok(sizesEqual("43 1/3", "43.33"));
  assert.ok(!sizesEqual("42", "43"), "42 and 43 are different shoes");
});

test("ONE character of slack on the code, NONE beyond it", () => {
  assert.ok(editDistanceAtMostOne("IM7681", "IM768I"), "a misread digit still finds the row");
  assert.ok(editDistanceAtMostOne("IM7681", "IM76811"), "one extra character");
  assert.ok(!editDistanceAtMostOne("IM7681", "IM7699"), "two characters apart is a different shoe");
});

test("UK and US sizes on the label are converted to the EU sizes the catalogue uses", () => {
  assert.ok(candidateSizes({ code: "X", kind: "shoe", sizes: { uk: "9" }, confidence: 1 }).includes("43 1/3"), "adidas UK 9");
  assert.ok(candidateSizes({ code: "X", kind: "shoe", sizes: { us: "10" }, confidence: 1 }).includes("44"), "Nike US 10");
});

const candidates = [
  { maDong: "ORD-1#v1", maMon: "IM7681", ten: "Giày A", size: "42", soLuong: 2 },
  { maDong: "ORD-2#v1", maMon: "IM7681", ten: "Giày A", size: "43", soLuong: 1 }
];

test("a label that matches a waiting line comes back as a MATCH", () => {
  const m = matchReading({ code: "IM7681", kind: "shoe", sizes: { eu: "42" }, confidence: 0.9 }, candidates);
  assert.equal(m.trangThai, "khop");
  assert.equal(m.trangThai === "khop" && m.dong.maDong, "ORD-1#v1");
});

test("RIGHT CODE, WRONG SIZE is a warning naming the sizes that ARE wanted — never a purchase", () => {
  const m = matchReading({ code: "IM7681", kind: "shoe", sizes: { eu: "45" }, confidence: 0.9 }, candidates);
  assert.equal(m.trangThai, "sai_size");
  if (m.trangThai !== "sai_size") return;
  assert.deepEqual(m.sizeCanMua.map((s) => s.size).sort(), ["42", "43"]);
});

test("a code nobody ordered is refused by name, and an unreadable label asks for a better photo", () => {
  const stranger = matchReading({ code: "ZZ9999", kind: "shoe", sizes: { eu: "42" }, confidence: 0.9 }, candidates);
  assert.equal(stranger.trangThai, "khong_trong_danh_sach");

  const blurred = matchReading({ code: "", kind: "", sizes: {}, confidence: 0 }, candidates);
  assert.equal(blurred.trangThai, "khong_doc_duoc");
});

test("a line already bought in full is not offered to the scanner", () => {
  const done = matchReading({ code: "IM7681", kind: "shoe", sizes: { eu: "42" }, confidence: 1 }, [{ ...candidates[0]!, soLuong: 0 }, candidates[1]!]);
  assert.equal(done.trangThai, "sai_size", "42 is finished; only 43 is still wanted");
});

// ---------------- the label reader's own refusals ----------------

const neverCalled: HttpClient = { fetch: async () => { throw new Error("must not be called"); } };

test("WITHOUT A KEY the scanner says so — it never guesses and never calls out", async () => {
  const r = await readLabel(neverCalled, {}, "data:image/jpeg;base64,AAAA");
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.viSao, "chua_cau_hinh");
});

test("only a real image data URL is sent on — never a URL the caller chose", async () => {
  for (const bad of ["https://ke-gian.example/anh.jpg", "data:text/html;base64,AAAA", "", null]) {
    const r = await readLabel(neverCalled, { apiKey: "k" }, bad);
    assert.equal(r.ok === false && r.viSao, "anh_khong_hop_le", `accepted: ${String(bad)}`);
  }
});

test("a blocked or broken call is reported, never silently treated as 'no label'", async () => {
  const blocked: HttpClient = { fetch: async () => { throw new Error("Chế độ thử: chặn gọi ra ngoài"); } };
  const r = await readLabel(blocked, { apiKey: "k" }, "data:image/jpeg;base64,AAAA");
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.loiNhan : "", /Chế độ thử/);
});

test("the model's answer is parsed even when it wraps the JSON in chatter", async () => {
  const chatty: HttpClient = {
    fetch: async () => ({
      ok: true, status: 200, text: async () => "",
      json: async () => ({ choices: [{ message: { content: 'Đây ạ: {"productCode":"IM7681","kind":"shoe","sizes":{"eu":"42"},"confidence":0.8} xong.' } }] })
    })
  };
  const r = await readLabel(chatty, { apiKey: "k" }, "data:image/jpeg;base64,AAAA");
  assert.equal(r.ok, true);
  assert.equal(r.ok === true && r.reading.code, "IM7681");
});
