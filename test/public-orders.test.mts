/**
 * THE PUBLIC VIEWS OF AN ORDER — what a customer sees, and what they must NOT see.
 *
 * No MySQL needed: the public layer is pure functions. But it is the layer that decides what a
 * stranger can see of someone else's order, so most of these are blocking tests.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EDIT_WINDOW_MINUTES, canEdit, detailView, editDeadline, secretView, statusLabel, statusNote, statusOnlyView, trackingUrl,
  type PublicOrderSource
} from "../dist/modules/don-khach/public-orders.js";
import { manifest } from "../dist/modules/don-khach/module.js";

const PLACED_AT = "2026-09-12T10:00:00.000Z";

function sampleOrder(extra: Partial<PublicOrderSource> = {}): PublicOrderSource {
  return {
    id: "ORD-1",
    createdAt: PLACED_AT,
    updatedAt: PLACED_AT,
    customerName: "Nguyễn Văn A",
    phone: "0912345678",
    email: "a@vd.vn",
    address: "12 Hàng Bài, Phường Hàng Bài, Quận Hoàn Kiếm, Hà Nội",
    province: "Hà Nội", district: "Quận Hoàn Kiếm", ward: "Phường Hàng Bài",
    addressDetail: "12 Hàng Bài",
    note: "Giao giờ hành chính",
    total: 3290000,
    status: "pending",
    paymentAmount: 0,
    fulfillmentStatus: "not_assigned",
    items: [{
      productCode: "JP9192", productName: "Nike Pegasus 41", size: "42", qty: 1, price: 3290000,
      warehouseId: "wh_partner_x", warehouseName: "Kho đối tác Supersports", sourceName: "Supersports",
      imageUrl: "/assets/products/JP9192/1.webp"
    }],
    ...extra
  };
}

// ---------- the 15-minute window ----------

test("editable within the first 15 minutes, not after", () => {
  const order = sampleOrder();
  const inside = new Date("2026-09-12T10:14:59.000Z");
  const outside = new Date("2026-09-12T10:15:01.000Z");
  assert.equal(canEdit(order, inside), true);
  assert.equal(canEdit(order, outside), false);
  assert.equal(editDeadline(order)?.toISOString(), "2026-09-12T10:15:00.000Z");
  assert.equal(EDIT_WINDOW_MINUTES, 15);
});

test("a cancelled order is no longer editable, even inside the 15 minutes", () => {
  assert.equal(canEdit(sampleOrder({ status: "cancelled" }), new Date("2026-09-12T10:01:00.000Z")), false);
  assert.equal(canEdit(sampleOrder({ status: "canceled" }), new Date("2026-09-12T10:01:00.000Z")), false);
});

test("an order with its own deadline column follows that column, not a recomputation", () => {
  const order = sampleOrder({ canCancelUntil: "2026-09-12T11:00:00.000Z" });
  assert.equal(editDeadline(order)?.toISOString(), "2026-09-12T11:00:00.000Z");
  assert.equal(canEdit(order, new Date("2026-09-12T10:50:00.000Z")), true);
});

test("an order with an unknown placed-at time counts as NOT editable — blocked by default", () => {
  assert.equal(editDeadline({ id: "ORD-x" }), null);
  assert.equal(canEdit({ id: "ORD-x" }, new Date()), false);
});

// ---------- the detail view ----------

test("after 15 minutes the detail view HIDES the recipient profile", () => {
  const still = detailView(sampleOrder(), { now: new Date("2026-09-12T10:05:00.000Z") });
  assert.equal(still.canEdit, true);
  assert.equal(still.customer?.phone, "0912345678");

  const over = detailView(sampleOrder(), { now: new Date("2026-09-12T11:00:00.000Z") });
  assert.equal(over.canEdit, false);
  assert.equal(over.canCancel, false);
  assert.equal(over.customer, null, "past the window the recipient profile is no longer returned");
  assert.match(over.privacyNote, /đã được ẩn/);
});

test("money on the order COMES FROM the Money module, never derived here", () => {
  const withMoney = detailView(sampleOrder(), { now: new Date(PLACED_AT), money: { daTra: 658000, conPhaiTra: 2632000 } });
  assert.equal(withMoney.paidAmount, 658000);
  assert.equal(withMoney.remainingAmount, 2632000);

  // No Money module: must NOT guess "fully paid" or "nothing paid" from paymentStatus.
  const without = detailView(sampleOrder(), { now: new Date(PLACED_AT), money: null });
  assert.equal(without.paidAmount, 0);
  assert.equal(without.remainingAmount, 3290000);
});

// ---------- the secret view: NO address, NO internal status ----------

test("the secret view leaks no address, no internal status, no price", () => {
  const view = secretView(sampleOrder({ status: "waiting_partner_confirm", fulfillmentStatus: "stock_reserved" }));
  const json = JSON.stringify(view);
  assert.equal(view.view, "secret");
  const raw = view as unknown as Record<string, unknown>;
  assert.equal(raw["status"], undefined, "the internal status must not be returned");
  assert.equal(raw["fulfillmentStatus"], undefined);
  assert.ok(view.statusLabel, "the customer still needs a readable label");
  assert.ok(!json.includes("Hàng Bài"), "must not leak the address");
  assert.ok(!json.includes("0912345678"), "must not leak the phone number");
  assert.ok(!json.includes("3290000"), "must not leak the price");
  assert.equal(view.items[0]?.["price"], undefined);
});

test("NEVER name the warehouse / the partner in the secret and status views", () => {
  // Mr Dũng, 10/09/2026: a sentence sent to a customer must not carry a warehouse or partner name.
  for (const view of [secretView(sampleOrder()), statusOnlyView(sampleOrder())]) {
    const json = JSON.stringify(view);
    assert.ok(!/Supersports/.test(json), `view "${view.view}" leaks the partner name`);
    assert.ok(!/wh_partner/.test(json), `view "${view.view}" leaks the warehouse id`);
    assert.ok(!/Kho /.test(json), `view "${view.view}" leaks the warehouse name`);
  }
});

test("the status-only view carries no lines and no money", () => {
  const view = statusOnlyView(sampleOrder()) as unknown as Record<string, unknown>;
  assert.equal(view["view"], "status");
  assert.equal(view["items"], undefined);
  assert.equal(view["total"], undefined);
  assert.equal(view["customer"], undefined);
  assert.ok(view["statusLabel"]);
});

// ---------- the labels the customer reads ----------

test("status labels: cancelled, completed, has a shipment, just placed", () => {
  assert.equal(statusLabel("cancelled"), "Đơn đã hủy");
  assert.equal(statusLabel("completed"), "Đơn đã hoàn tất");
  assert.equal(statusLabel("pending", "", "SPX123456"), "Đơn đã có vận đơn");
  assert.equal(statusLabel("pending"), "TopRun đã nhận đơn");
  assert.equal(statusLabel("payment_pending"), "Đã xác nhận có hàng");
  assert.equal(statusLabel("waiting_partner_confirm"), "TopRun đang xác nhận hàng");
  assert.match(statusNote("cancelled"), /đã được hủy/);
  assert.match(statusNote("pending"), /kiểm tra tồn kho/);
});

test("tracking link: SPX gets a link, another carrier gets an empty string rather than a guess", () => {
  assert.equal(trackingUrl({ trackingCode: "SPXVN123", shippingProvider: "spx" }), "https://spx.vn/track?SPXVN123");
  assert.equal(trackingUrl({ trackingCode: "VTP123", shippingProvider: "viettelpost" }), "");
  assert.equal(trackingUrl({}), "");
  assert.equal(trackingUrl({ trackingUrl: "https://vd.vn/x", trackingCode: "A" }), "https://vd.vn/x");
});

// ---------- route order ----------

test("the route /api/orders/public must be declared BEFORE /api/orders/:maDon", () => {
  // Reversed, GET /api/orders/public falls into the admin route and the customer gets 401 — or
  // worse: the admin route takes "public" as an order id.
  const routes = (manifest.routes ?? []).map((r) => `${r.method} ${r.path}`);
  const publicGet = routes.indexOf("GET /api/orders/public");
  const adminGet = routes.indexOf("GET /api/orders/:maDon");
  assert.ok(publicGet >= 0 && adminGet >= 0);
  assert.ok(publicGet < adminGet, "the customer's route must be declared before the parameterised one");

  const publicPatch = routes.indexOf("PATCH /api/orders/public");
  const adminPatch = routes.indexOf("PATCH /api/orders/:maDon");
  assert.ok(publicPatch < adminPatch, "the customer's PATCH must be declared before the admin PATCH");
});
