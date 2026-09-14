/**
 * REAL PAYLOADS — the shapes Sales Desk and Image Tool ACTUALLY send, not the shapes we guessed.
 * Taken from the files on Mr Dũng's machine on 12/09/2026:
 *
 *   data/published-products.json  4,834 items -> POST /api/products          (Image Tool)
 *   data/ready-stock.json            80 items -> POST /api/ready-stock/sync  (Desk)
 *   data/partner-campaigns.json     253 items -> POST /api/partner-campaigns (Desk)
 *
 * This was the biggest remaining risk of the split build: before this file no real payload had
 * been checked against it. Two differences surfaced on the very first comparison:
 *
 *   1. Ready stock uses `variants: [{ size, branchId, qty, salePrice }]` plus a separate
 *      `branches` list, NOT `sizes`. The split build read only `sizes` -> 80 items dropped, no error.
 *   2. Partner campaigns carry the real partner name ("Supersports (supersports.com.vn)"). The
 *      old site REPLACED it with "TopRun" before answering the web. The split build returned the
 *      partner name -> leaked to customers, against the rule Mr Dũng set on 10/09.
 *
 * Also here: the pure normalisation rules (no MySQL needed) and the body limits of the three
 * catalogue doors.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseItem, publicView, warehouseLabel } from "../dist/modules/hang-kho/normalise.js";
import { convertCampaignPayload, convertReadyStockPayload } from "../dist/modules/hang-kho/desk-payloads.js";
import { manifest } from "../dist/modules/hang-kho/module.js";

// ---------- pure normalisation ----------

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

test("an item's price is the SMALLEST price across its sizes (the customer sees 'từ ... đ')", () => {
  const m = normaliseItem({ ...ITEM, sizes: [{ size: "42", price: 3200000 }, { size: "43", price: 2890000 }] });
  assert.ok(m);
  assert.equal(m.price, 2890000);
});

test("a sale price above the list price is bad data — the item hides itself", () => {
  const m = normaliseItem({ code: "X1", name: "Món lỗi giá", listPrice: 1000000, sizes: [{ size: "40", price: 1500000 }] });
  assert.ok(m);
  assert.equal(m.status, "hidden");
  assert.equal(m.hiddenReason, "invalid_price_sale_gt_list");
});

test("an item without a code or without a name is dropped", () => {
  assert.equal(normaliseItem({ name: "Không có mã" }), null);
  assert.equal(normaliseItem({ code: "A1" }), null);
});

test("internal data-entry images never reach the public view", () => {
  const m = normaliseItem({ ...ITEM, thumbnailImage: "/assets/thumbnails/x.jpg", galleryImages: ["/assets/thumbnails/y.jpg", "/anh/that.jpg"] });
  assert.ok(m);
  assert.equal(m.thumbnailImage, "");
  assert.deepEqual(m.galleryImages, ["/anh/that.jpg"]);
});

test("warehouse names shrink to short labels — a customer is never told the warehouse", () => {
  assert.equal(warehouseLabel("wh_cau_dien", "Cầu Diễn"), "CD");
  assert.equal(warehouseLabel("wh_toprun_ha_noi", ""), "TR");
});

test("every size sold out = the item is sold out, even if its record says 'orderable'", () => {
  const view = publicView(normaliseItem({ ...ITEM, status: "orderable", sizes: [{ size: "42", qty: 0, price: 100000 }] }));
  assert.ok(view);
  assert.equal(view.status, "hidden");
});

// ---------- the real READY-STOCK payload (trimmed from data/ready-stock.json) ----------

const READY_STOCK = {
  version: 1,
  revision: 412,
  updatedAt: "2026-09-06T15:20:11.000Z",
  policy: {
    summaryText: "Hang san TopRun: giao ngay 24-48h, duoc kiem tra hang truoc khi gui.",
    codAllowed: true,
    depositPercent: 0
  },
  branches: [
    { id: "wh_toprun_yen", name: "TopRun - Yen", active: true },
    { id: "wh_toprun_cau_dien", name: "TopRun - Cau Dien", active: true },
    { id: "wh_toprun_nghi_viec", name: "TopRun - Da nghi", active: false },
    { id: "wh_partner_dasbui", name: "Dasbui", active: true }
  ],
  products: [
    {
      code: "KI0784",
      name: "Giày Adidas GameCourt 2",
      brand: "adidas",
      productKind: "shoe",
      category: "Tennis",
      division: "",
      gender: "",
      imageUrl: "assets/products/ki0784.jpg",
      galleryImages: ["assets/products/ki0784.jpg", "assets/products/ki0784_gallery_02.jpg"],
      variants: [
        { size: "42", branchId: "wh_toprun_yen", qty: 6, salePrice: 1650000, listPrice: 2200000 },
        { size: "43", branchId: "wh_toprun_nghi_viec", qty: 4, salePrice: 1650000, listPrice: 2200000 },
        { size: "44", branchId: "wh_ai_do_khong_khai", qty: 9, salePrice: 1650000, listPrice: 2200000 },
        { size: "45", branchId: "wh_toprun_cau_dien", qty: 0, salePrice: 1650000, listPrice: 2200000 },
        { size: "46", branchId: "wh_toprun_cau_dien", qty: 2, salePrice: 0, listPrice: 2200000 }
      ]
    }
  ],
  pendingSales: [{ orderId: "ORD-1", code: "KI0784", size: "42", branchId: "wh_toprun_yen", qty: 2 }]
};

test("the REAL ready-stock payload: variants + branches become an item with sizes", () => {
  const items = convertReadyStockPayload(READY_STOCK);
  assert.equal(items.length, 1, "the 80 real items must not be dropped as before");
  const m = items[0]!;
  assert.equal(m.code, "KI0784");
  assert.equal(m.source, "own", "ready stock is the shop's own stock, not partner stock");
  assert.equal(m.sourceName, "TopRun");
  assert.equal(m.thumbnailImage, "assets/products/ki0784.jpg", "the real payload uses `imageUrl`");
  assert.equal(m.readyPolicySummary, READY_STOCK.policy.summaryText);

  assert.deepEqual(m.sizes.map((s) => s.size), ["42"], "only size 42 is sellable");
  const first = m.sizes[0]!;
  assert.equal(first.qty, 4, "6 in stock minus 2 pending (pendingSales) = 4");
  assert.equal(first.price, 1650000);
  assert.equal(first.listPrice, 2200000);
  assert.equal(first.warehouseId, "wh_toprun_yen");
  assert.equal(first.warehouseName, "TopRun - Yen", "the warehouse name comes from `branches`");
  assert.equal(first.stockMode, "ready");
});

test("ready stock: DROPS lines of a switched-off branch, an undeclared warehouse, zero stock, or no price", () => {
  const m = convertReadyStockPayload(READY_STOCK)[0]!;
  const has = (size: string) => m.sizes.some((s) => s.size === size);
  assert.equal(has("43"), false, "a branch with active:false is not sold");
  assert.equal(has("44"), false, "an unknown warehouse outside the allow-list is not sold");
  assert.equal(has("45"), false, "sold out is not sold");
  assert.equal(has("46"), false, "no price is not sold — selling a pair for 0 đồng loses money");
});

test("ready stock is TopRun's ONLY: the Dasbui build may take only its own warehouse", () => {
  // Rule in AGENTS.md: ready stock defaults to TopRun only; `wh_partner_dasbui` alone goes to
  // Dasbui, every other `wh_toprun_*` warehouse is FORBIDDEN to port. This test is the steel wire.
  const payload = {
    ...READY_STOCK,
    pendingSales: [],
    products: [{
      code: "KI0784", name: "Giày Adidas GameCourt 2", imageUrl: "a.jpg",
      variants: [
        { size: "42", branchId: "wh_toprun_yen", qty: 5, salePrice: 1650000 },
        { size: "43", branchId: "wh_partner_dasbui", qty: 5, salePrice: 1650000 }
      ]
    }]
  };

  const toprun = convertReadyStockPayload(payload);
  assert.deepEqual(toprun[0]!.sizes.map((s) => s.size).sort(), ["42", "43"], "on TopRun both warehouses are allowed");

  const dasbui = convertReadyStockPayload(payload, { allowedWarehouses: ["wh_partner_dasbui"] });
  assert.deepEqual(dasbui[0]!.sizes.map((s) => s.size), ["43"], "on Dasbui the wh_toprun_* warehouse is dropped");
});

test("an empty or malformed ready-stock payload yields an empty list, never a throw", () => {
  assert.deepEqual(convertReadyStockPayload(null), []);
  assert.deepEqual(convertReadyStockPayload({}), []);
  assert.deepEqual(convertReadyStockPayload({ products: [{ code: "", name: "", variants: [] }] }), []);
  assert.deepEqual(convertReadyStockPayload({ products: [{ code: "A", name: "B", variants: [] }] }), [],
    "an item with no sellable size does not go on the web");
});

// ---------- the real PARTNER-CAMPAIGN payload (trimmed from data/partner-campaigns.json) ----------

const CAMPAIGNS = {
  version: 1,
  updatedAt: "2026-09-06T22:50:04.000Z",
  source: "toprun-sales-desk",
  campaigns: [
    { id: "cd_song", source: "Supersports (supersports.com.vn)", name: "Supersports campaign", status: "active", expiresAt: "2126-09-13T22:50:04" },
    { id: "cd_da_tat", source: "MaxxSport", name: "MaxxSport campaign", status: "paused", expiresAt: "2126-09-13T22:50:04" },
    { id: "cd_het_han", source: "MaxxSport", name: "MaxxSport cu", status: "active", expiresAt: "2026-01-01T00:00:00" }
  ],
  products: [
    {
      offerKey: "supersports:cd_song:JR5074",
      originalCode: "JR5074", code: "JR5074",
      name: "Giày Chạy Bộ Nam Adidas Adizero Sl2",
      source: "partner", sourceName: "Supersports (supersports.com.vn)",
      brand: "adidas", category: "Giày Chạy Bộ", division: "Giay",
      sizes: [
        { variantId: "", size: "UK 6.5", qty: 1, price: 2090000, salePrice: 2090000, saleFilePrice: 1800000, listPrice: 3000000, warehouseId: "supersports_supersports_com_vn", warehouse: "Supersports (supersports.com.vn)", warehouseName: "Supersports (supersports.com.vn)" },
        { variantId: "", size: "UK 10.5", qty: 1, price: 2090000, salePrice: 2090000, saleFilePrice: 1800000, listPrice: 3000000, warehouseId: "supersports_supersports_com_vn", warehouse: "Supersports (supersports.com.vn)", warehouseName: "Supersports (supersports.com.vn)" }
      ],
      price: 2090000, suggestedPrice: 2090000, salePrice: 2090000, listPrice: 3000000,
      status: "orderable",
      thumbnailImage: "https://cdn.shopify.com/x/JR5074-1.jpg",
      slug: "jr5074-supersports-cd_song",
      partnerCampaign: true, partnerSource: "Supersports (supersports.com.vn)",
      campaignId: "cd_song", campaignName: "Supersports campaign"
    },
    {
      offerKey: "maxx:cd_da_tat:AB1234", code: "AB1234", name: "Áo MaxxSport",
      source: "partner", sourceName: "MaxxSport",
      sizes: [{ size: "M", qty: 3, price: 490000, warehouseId: "maxxsport", warehouseName: "MaxxSport" }],
      partnerCampaign: true, campaignId: "cd_da_tat", status: "orderable"
    },
    {
      offerKey: "maxx:cd_het_han:CD5678", code: "CD5678", name: "Quần MaxxSport",
      source: "partner", sourceName: "MaxxSport",
      sizes: [{ size: "L", qty: 3, price: 390000, warehouseId: "maxxsport", warehouseName: "MaxxSport" }],
      partnerCampaign: true, campaignId: "cd_het_han", status: "orderable"
    },
    {
      offerKey: "maxx:cd_song:EF9012", code: "EF9012", name: "Tất MaxxSport",
      source: "partner", sourceName: "MaxxSport",
      sizes: [{ size: "L", qty: 0, price: 90000, warehouseId: "maxxsport", warehouseName: "MaxxSport" }],
      partnerCampaign: true, campaignId: "cd_song", status: "orderable"
    }
  ]
};

const NOW = new Date("2026-09-12T00:00:00.000Z");

test("the REAL campaign payload: drops switched-off campaigns, expired campaigns and sold-out items", () => {
  const items = convertCampaignPayload(CAMPAIGNS, { now: NOW });
  assert.deepEqual(items.map((m) => m.code), ["JR5074"]);
});

test("campaigns: every line gets its OWN line id — a sell-out report is keyed by this id", () => {
  // Trap of 10/09 (incident ORD-1788854262493): reporting a sell-out by line POSITION marks the
  // wrong order once a line is replaced. So every line has its own stable id, the same on every run.
  const first = convertCampaignPayload(CAMPAIGNS, { now: NOW })[0]!;
  const second = convertCampaignPayload(CAMPAIGNS, { now: NOW })[0]!;

  const ids = first.sizes.map((s) => s.partnerCampaignLineId);
  assert.equal(ids.length, 2);
  for (const id of ids) assert.match(String(id), /^pcl_[0-9a-f]{16}$/);
  assert.equal(new Set(ids).size, 2, "two sizes must get two different ids");
  assert.deepEqual(second.sizes.map((s) => s.partnerCampaignLineId), ids, "regenerating must give the same ids");
});

test("campaigns: the partner name must NOT leak into the public view", () => {
  // Mr Dũng 10/09/2026: a sentence sent to a customer must not carry a warehouse / partner name.
  // The old site replaced the partner name with "TopRun" before answering the web — the split
  // build must do exactly the same.
  const item = convertCampaignPayload(CAMPAIGNS, { now: NOW })[0]!;
  const view = publicView(normaliseItem(item));
  assert.ok(view);
  const json = JSON.stringify(view);
  assert.ok(!/Supersports/i.test(json), `the public view leaks the partner name: ${json.slice(0, 300)}`);
  assert.ok(!/supersports_supersports_com_vn/i.test(json), "the partner's warehouse id must not leak");
  assert.equal(view.sourceName, "TopRun");
  assert.equal(view.source, "own");
  for (const s of view.sizes) {
    assert.equal(s.warehouseName, "TopRun");
    assert.equal(s.warehouseId, "wh_toprun");
  }
});

test("ONE REAL LEAK, not patched: the partner's image URL", () => {
  // 22 of the 253 campaign items use images hosted on `supersports.com.vn`. The OLD SITE returns
  // that URL to the web too, so a customer viewing the page source can read where TopRun sources
  // its stock. Not a bug of the split build — but not something that has been patched either, so
  // it is written down here so nobody assumes the test above covers it. The real fix is to
  // download the image to our own machine (Image Tool's job), not to mask the string.
  const item = convertCampaignPayload({
    campaigns: [],
    products: [{
      code: "IF1156", name: "Giày adidas", partnerCampaign: true,
      thumbnailImage: "https://supersports.com.vn/cdn/shop/files/IF1156-1.jpg",
      sizes: [{ size: "42", qty: 1, price: 100000, warehouseId: "supersports", warehouseName: "Supersports" }]
    }]
  })[0]!;
  const view = publicView(normaliseItem(item));
  assert.ok(view);
  assert.match(view.thumbnailImage, /supersports\.com\.vn/, "records today's truth, not a promise");
  assert.equal(view.sizes[0]!.warehouseName, "TopRun", "the warehouse name, at least, is masked");
});

test("campaigns: INSIDE, the real partner name is kept — the purchasing partner must know where to buy", () => {
  // Renaming to "TopRun" is the PUBLIC VIEW's job, not the payload converter's. The ledger must
  // keep the real partner name: without it nobody knows where to place the purchase.
  const item = convertCampaignPayload(CAMPAIGNS, { now: NOW })[0]!;
  assert.equal(item.sourceName, "Supersports (supersports.com.vn)");
  assert.equal(item.sizes[0]!.warehouseId, "supersports_supersports_com_vn");
  assert.equal(item.sizes[0]!.saleFilePrice, 1800000, "the cost price is kept for reconciliation — it just never reaches the web");
});

test("an empty campaign payload yields an empty list, never a throw", () => {
  assert.deepEqual(convertCampaignPayload(null), []);
  assert.deepEqual(convertCampaignPayload({ products: [] }), []);
  assert.deepEqual(convertCampaignPayload({ products: [{ code: "A", name: "B", sizes: [] }] }), []);
});

test("an item naming no campaign still goes on the web (there is no campaign table to check)", () => {
  const payload = {
    campaigns: [],
    products: [{
      code: "ZZ1", name: "Mon le", sizes: [{ size: "M", qty: 2, price: 100000, warehouseId: "kho_la", warehouseName: "Kho la" }],
      partnerCampaign: true
    }]
  };
  assert.deepEqual(convertCampaignPayload(payload).map((m) => m.code), ["ZZ1"]);
});

// ---------- body limits of the three catalogue doors ----------

test("the three big-upload doors of the catalogue declare limits wide enough for the real payloads", () => {
  const limits = new Map((manifest.routes ?? []).map((r) => [`${r.method} ${r.path}`, r.bodyLimit]));
  // The real catalogue measured 10.2 MB (4,834 items) — the old site capped at 10 MB, right at the edge.
  assert.ok((limits.get("POST /api/products") ?? 0) >= 11 * 1024 * 1024, "the catalogue door must be wider than the measured payload");
  assert.equal(limits.get("POST /api/partner-campaigns"), 5 * 1024 * 1024);
  assert.equal(limits.get("POST /api/ready-stock/sync"), 2 * 1024 * 1024);
});
