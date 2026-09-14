/**
 * @file Translates the SALES DESK payloads into the item shape this module stores.
 *
 * The two Desk uploads have shapes of their OWN, unlike Image Tool's catalogue. Before 12/09/2026
 * the split build read only `sizes`, so the whole ready-stock payload (which uses `variants` +
 * `branches`) was dropped without a single error. This file is the one place that knows both shapes.
 *
 * Three rules that must not break:
 *
 * 1. READY STOCK IS THIS SHOP'S ONLY. Which warehouses may be sold is a list DECLARED UP FRONT
 *    (`allowedWarehouses`); a line from an undeclared warehouse is dropped. The Dasbui build declares
 *    a single warehouse, so TopRun's stock can never leak across. This is the steel wire in
 *    AGENTS.md, not a soft warning.
 *
 * 2. EVERY CAMPAIGN LINE GETS ITS OWN STABLE LINE ID. Incident 10/09 (order ORD-1788854262493):
 *    reporting "sold out" by line POSITION meant that once a line was replaced the wrong line was
 *    flagged and the customer got the wrong message. The line id derives from (offerKey, code,
 *    size, warehouse), so regenerating it always yields the same value.
 *
 * 3. NO PARTNER RENAMING HERE. The ledger must keep the partner's real name — without it nobody
 *    knows where to buy. Masking is the job of the PUBLIC VIEW (`publicView` in normalise.ts),
 *    one place only, with a test holding it.
 */

import { asList, asRecord, asRecords, itemSlug, sha1Prefix, type RawRecord } from "./normalise";

/** Ready-stock warehouses sold by default (the TopRun build). The Dasbui build overrides this in its config. */
export const DEFAULT_READY_WAREHOUSES: readonly string[] = ["wh_toprun*", "wh_partner_dasbui"];

/** `pattern` equals `value`, or — with a trailing `*` — is a prefix of it. Case-insensitive. */
function matches(pattern: unknown, value: unknown): boolean {
  const p = String(pattern || "").trim().toLowerCase();
  const v = String(value || "").trim().toLowerCase();
  if (!p || !v) return false;
  if (p.endsWith("*")) return v.startsWith(p.slice(0, -1));
  return v === p;
}

/** Whether a warehouse id is on the allow-list (RULE 1). */
export function warehouseAllowed(warehouseId: unknown, allowedWarehouses: unknown): boolean {
  return asList(allowedWarehouses).some((pattern) => matches(pattern, warehouseId));
}

/** The first finite positive value, rounded; 0 when none. */
function positiveRounded(...values: unknown[]): number {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return 0;
}

/** The key of one stock line: code + size + warehouse, upper-cased. */
function lineKey(code: unknown, size: unknown, warehouseId: unknown): string {
  return [code, size, warehouseId].map((x) => String(x || "").trim().toUpperCase()).join("|");
}

/** One sellable size line of a ready-stock item. */
export type ReadyStockSize = {
  variantId: "";
  size: string;
  qty: number;
  price: number;
  suggestedPrice: number;
  salePrice: number;
  listPrice: number;
  warehouseId: string;
  warehouse: string;
  warehouseName: string;
  stockMode: "ready";
};

/** A ready-stock item in the shape `normaliseItem` accepts. */
export type ReadyStockItem = {
  code: string;
  name: string;
  source: "own";
  sourceName: "TopRun";
  brand: string;
  productKind: string;
  division: string;
  category: string;
  gender: string;
  status: "orderable";
  thumbnailImage: string;
  highImage: string;
  galleryImages: unknown[];
  sizes: ReadyStockSize[];
  readyPolicySummary?: string;
};

export interface ReadyStockOptions {
  allowedWarehouses?: readonly string[];
}

/**
 * The Desk READY-STOCK payload -> a list of items.
 *
 * The real payload:
 *   { revision, policy: { summaryText }, branches: [{ id, name, active }],
 *     products: [{ code, name, imageUrl, galleryImages, variants: [{ size, branchId, qty, salePrice, listPrice }] }],
 *     pendingSales: [{ orderId, code, size, branchId, qty }] }
 */
export function convertReadyStockPayload(payload: unknown, { allowedWarehouses = DEFAULT_READY_WAREHOUSES }: ReadyStockOptions = {}): ReadyStockItem[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as RawRecord;

  const branches = new Map<string, { name: string; active: boolean }>();
  for (const b of asRecords(p.branches)) {
    const id = String(b.id || "").trim();
    if (id) branches.set(id, { name: String(b.name || "").trim(), active: b.active !== false });
  }

  // Pending: web orders already deducted but not yet booked by Desk. Keyed by (code + size + warehouse).
  const pending = new Map<string, number>();
  for (const sale of asRecords(p.pendingSales)) {
    const k = lineKey(sale.code, sale.size, sale.branchId);
    pending.set(k, (pending.get(k) ?? 0) + Math.max(0, Number(sale.qty || 0)));
  }

  const policy = String(asRecord(p.policy).summaryText || "").trim();
  const items: ReadyStockItem[] = [];

  for (const product of asRecords(p.products)) {
    const code = String(product.code || "").trim();
    const name = String(product.name || "").trim();
    if (!code || !name) continue;

    // The real Desk payload uses `variants`; some places (and the tests) push the compact form
    // with `sizes`. Both enter through this one door, so RULE 1 (declared warehouse) applies to
    // both — no shape slips past it.
    const variants = asRecords(product.variants);
    const lines = variants.length ? variants : asRecords(product.sizes);

    const sizes: ReadyStockSize[] = [];
    for (const line of lines) {
      const size = String(line.size || "").trim();
      const warehouseId = String(line.branchId || line.warehouseId || "").trim();
      if (!size || !warehouseId) continue;
      if (!warehouseAllowed(warehouseId, allowedWarehouses)) continue;    // RULE 1
      const branch = branches.get(warehouseId);
      if (branch && !branch.active) continue;                              // branch switched off
      const price = positiveRounded(line.salePrice, line.price);
      const left = Math.max(0, Math.trunc(Number(line.qty || 0)) - (pending.get(lineKey(code, size, warehouseId)) ?? 0));
      if (left <= 0 || price <= 0) continue;                               // sold out, or no known price
      const warehouseName = String(branch?.name || line.warehouseName || line.warehouse || "TopRun");
      sizes.push({
        variantId: "",
        size,
        qty: left,
        price,
        suggestedPrice: price,
        salePrice: price,
        listPrice: positiveRounded(line.listPrice),
        warehouseId,
        warehouse: warehouseName,
        warehouseName,
        stockMode: "ready"
      });
    }
    if (sizes.length === 0) continue;

    const image = String(product.imageUrl || product.thumbnailImage || "").trim();
    const gallery = Array.isArray(product.galleryImages) && product.galleryImages.length
      ? (product.galleryImages as unknown[])
      : (image ? [image] : []);

    items.push({
      code,
      name,
      source: "own",            // ready stock is the shop's own stock
      sourceName: "TopRun",
      brand: String(product.brand || "").trim(),
      productKind: String(product.productKind || "").trim(),
      division: String(product.division || "").trim(),
      category: String(product.category || "").trim(),
      gender: String(product.gender || "").trim(),
      status: "orderable",
      thumbnailImage: image,
      highImage: image,
      galleryImages: gallery,
      sizes,
      ...(policy ? { readyPolicySummary: policy } : {})
    });
  }

  return items;
}

/** A campaign line id: stable over (offerKey, code, size, warehouse, position). Regenerating yields the same value. */
export function campaignLineId(item: RawRecord, line: RawRecord, position: number): string {
  const source = [
    item.offerKey, item.code, line.size, line.warehouseId, line.warehouse || line.warehouseName, position
  ].map((x) => String(x ?? "").trim()).join("|");
  return `pcl_${sha1Prefix(source)}`;
}

/** A campaign item: the Desk product as sent, plus the fields this module sets. */
export type CampaignItem = RawRecord & {
  code: string;
  name: string;
  sizes: RawRecord[];
  slug: string;
  partnerCampaign: true;
  campaignName: unknown;
  campaignExpiresAt: unknown;
};

export interface CampaignOptions {
  now?: Date | string | number;
}

/**
 * The Desk PARTNER-CAMPAIGN payload -> a list of items.
 *
 * The real payload: { campaigns: [{ id, status, expiresAt, endsAt, name }], products: [ ... with `sizes` ... ] }
 *
 * An item is dropped when its campaign is not "active", the campaign has expired, or no size is
 * left in stock. Same as the old site — expired stock never sits on the web.
 */
export function convertCampaignPayload(payload: unknown, { now = new Date() }: CampaignOptions = {}): CampaignItem[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as RawRecord;
  const campaigns = new Map<string, RawRecord>();
  for (const c of asRecords(p.campaigns)) {
    const id = String(c.id || "").trim();
    if (id) campaigns.set(id, c);
  }
  const at = now instanceof Date ? now.getTime() : (Date.parse(String(now)) || Date.now());

  const items: CampaignItem[] = [];
  for (const product of asRecords(p.products)) {
    const code = String(product.code || "").trim();
    const name = String(product.name || "").trim();
    if (!code || !name) continue;

    const campaign = campaigns.get(String(product.campaignId || "").trim());
    if (campaign && String(campaign.status || "").trim() !== "active") continue;
    const expiresAt = Date.parse(String(product.campaignExpiresAt || campaign?.expiresAt || campaign?.endsAt || ""));
    if (Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt < at) continue;

    const sizes = asRecords(product.sizes)
      .filter((line) => Number(line.qty || 0) > 0)
      .map((line, i) => ({ ...line, partnerCampaignLineId: String(line.partnerCampaignLineId || "").trim() || campaignLineId(product, line, i) }));
    if (sizes.length === 0) continue;

    items.push({
      ...product,
      code,
      name,
      sizes,
      // Desk's slug carries the partner name ("jr5074-supersports-..."). Rebuilt from code + name:
      // the slug is what the customer sees in the address bar and must not reveal the source.
      slug: itemSlug(`${code}-${name}`, code, name),
      partnerCampaign: true,
      campaignName: product.campaignName || campaign?.name || "",
      campaignExpiresAt: product.campaignExpiresAt || campaign?.expiresAt || campaign?.endsAt || ""
    });
  }
  return items;
}
