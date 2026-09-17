/**
 * @file Catalogue normalisation — behaviour ported verbatim from the old site's `server.js`.
 *
 * Two shapes of one item, never to be confused:
 *   - the HOUSE view (`normaliseItem`): cost prices, stock per warehouse, warehouse priority;
 *   - the PUBLIC view (`publicView`): all of that removed. The only shape allowed off the machine.
 *
 * RULE 1 of this file: cost prices and real stock NEVER enter the public view. The public view
 * says only "in stock" or "sold out" (qty 1 or 0), never HOW MANY — a competitor who knows the
 * shop's exact stock knows how much it sells.
 *
 * RULE 2: never tell a customer the WAREHOUSE NAME. Warehouses shrink to short labels (TR, Y,
 * CD...) — Mr Dũng, 10/09: a sentence sent to a customer must not carry a warehouse or partner name.
 *
 * Everything here is a pure function. Input from the network is `unknown` until read through
 * `String()`/`Number()` guards (exactly the old code's `String(x || "")` habit), so one malformed
 * item degrades to empty fields instead of crashing a 4,800-item upload.
 */

import { createHash } from "node:crypto";

/** An object from the network: nothing about its fields is known yet. */
export type RawRecord = Record<string, unknown>;

/** The value as a plain object, or `{}` when it is not one (arrays included). */
export function asRecord(value: unknown): RawRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as RawRecord) : {};
}

/** The value as an array — empty when it is not one. */
export function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

/** The object elements of an array. Non-objects are dropped (the old code threw on a `null` line). */
export function asRecords(value: unknown): RawRecord[] {
  return asList(value).filter((v): v is RawRecord => v !== null && typeof v === "object" && !Array.isArray(v));
}

/** `String(x || "").trim()` — the old code's reading of any text field (0 and false become ""). */
const text = (value: unknown): string => String(value || "").trim();

/** Vietnamese to ASCII: decompose, drop the combining marks (U+0300–U+036F), then đ/Đ which NFD leaves alone. */
const stripAccents = (value: string): string =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d");

/** The first `length` hex characters of the SHA-1 of `input` — stable ids for variants and campaign lines. */
export function sha1Prefix(input: string, length = 16): string {
  return createHash("sha1").update(input).digest("hex").slice(0, length);
}

/** The first value that reads as a positive number; 0 when none does. */
export function firstPositive(...values: unknown[]): number {
  for (const v of values) {
    const n = Number(v || 0);
    if (n > 0) return n;
  }
  return 0;
}

/** A warehouse name or id as a stable key: lower-case ASCII, words joined by `_`. */
export function warehouseKey(value: unknown = ""): string {
  return stripAccents(String(value || "").trim().toLowerCase())
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** The short label of a warehouse shown to customers — NOT the real warehouse name. */
export function warehouseLabel(id: unknown = "", name: unknown = ""): string {
  const key = warehouseKey(id) || warehouseKey(name);
  if (/^wh_toprun(_|$)/.test(key)) return "TR";
  const known: Record<string, string> = { wh_yen: "Y", wh_cau_dien: "CD", wh_phuong_thu: "PT", wh_toprun: "TR", wh_hang_td: "HTD" };
  const hit = known[key];
  if (hit) return hit;
  const source = String(name || id || "").replace(/^wh_/i, "").replace(/_/g, " ").trim();
  const initials = stripAccents(source).split(/\s+/).map((part) => part[0] ?? "").join("").toUpperCase();
  return initials.slice(0, 3) || source.slice(0, 3).toUpperCase();
}

/** A list of strings from an array or a comma/newline separated text; trimmed, empties and duplicates dropped. */
export function stringList(value: unknown): string[] {
  const list = Array.isArray(value) ? (value as unknown[]) : String(value || "").split(/[,\n]/);
  return [...new Set(list.map((x) => String(x || "").trim()).filter(Boolean))];
}

/** Trimmed strings without case-insensitive duplicates (first spelling wins). */
export function dedupe(values: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of asList(values)) {
    const s = String(v || "").trim();
    const key = s.toLowerCase();
    if (!s || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** Internal data-entry images (comparison thumbnails) must not leak to the web. */
export function isInternalImage(value: unknown = ""): boolean {
  const url = String(value || "").trim().toLowerCase();
  if (!url) return true;
  if (/\/assets\/thumbnails\//.test(url) || /^assets\/thumbnails\//.test(url)) return true;
  // A path segment or file-name piece that names a thumbnail / comparison image.
  if (/(^|[_/-])(thumb|thumbnail|compare|source-thumb|original-thumb)([_./-]|$)/i.test(url)) return true;
  return false;
}

/** One image URL fit for the public, or "". */
export const publicImage = (value: unknown): string => {
  const url = String(value || "").trim();
  return url && !isInternalImage(url) ? url : "";
};

/** Image URLs fit for the public. */
export const publicImages = (value: unknown): string[] => stringList(value).filter((u) => !isInternalImage(u));

/** `{ warehouseKey: quantity }` keeping only positive finite quantities. */
export function stockMap(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, qty] of Object.entries(value as RawRecord)) {
    const k = String(key || "").trim();
    const n = Number(qty || 0);
    if (k && Number.isFinite(n) && n > 0) out[k] = n;
  }
  return out;
}

export interface WarehouseMeta {
  id: string;
  name: string;
  active: boolean;
}

/** Warehouse descriptions `[{ id, name, active }]`; entries without id or name are dropped. */
export function warehouseMeta(value: unknown): WarehouseMeta[] {
  const out: WarehouseMeta[] = [];
  for (const x of asRecords(value)) {
    const id = text(x.id);
    const name = text(x.name || x.ten);
    if (!id || !name) continue;
    out.push({ id, name, active: x.active !== false });
  }
  return out;
}

export type ItemStatus = "hidden" | "orderable";

const HIDDEN_STATUSES = ["hidden", "out_of_stock", "out-of-stock", "sold_out", "sold-out", "archived", "discontinued", "inactive"];

/** Any of the "not for sale" spellings collapses to `hidden`; everything else is `orderable`. */
export function itemStatus(value: unknown): ItemStatus {
  return HIDDEN_STATUSES.includes(String(value || "").trim().toLowerCase()) ? "hidden" : "orderable";
}

/** The URL slug of an item: the given value, else "code name", as lower-case ASCII joined by `-`. */
export function itemSlug(value: unknown, code = "", name = ""): string {
  const source = String(value || `${code} ${name}`).trim();
  return stripAccents(source).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    || String(code || "").trim().toLowerCase();
}

/**
 * The variant id of one size line: the one the line carries, else a hash of (item code,
 * warehouse, raw size) — so the same triple always yields the same id, upload after upload.
 */
export function variantId(item: RawRecord, line: RawRecord): string {
  const given = text(line.variantId || line.variant_id);
  if (given) return given;
  const identity = [
    item.code || item.productCode,
    line.warehouseId || line.warehouse_id || warehouseKey(line.warehouse || line.warehouseName),
    line.rawSize || line.raw_size || line.size
  ].map((v) => String(v || "").trim().toUpperCase()).join("|");
  return `var_${sha1Prefix(identity)}`;
}

/** Which warehouse ships first — a smaller number is a higher priority; unknown = MAX_SAFE_INTEGER. */
export function warehouseRank(item: RawRecord, line: RawRecord): number {
  const lineId = String(line.warehouseId || warehouseKey(line.warehouse || line.warehouseName)).trim();
  const lineName = text(line.warehouse || line.warehouseName);
  const keys: string[] = [];
  for (const v of asList(item.warehousePriorityIds)) keys.push(String(v || "").trim());
  for (const v of asList(item.warehousePriority)) keys.push(warehouseKey(v));
  for (const m of asList(item.warehouseMeta)) {
    const meta = asRecord(m);
    keys.push(text(meta.id));
    keys.push(warehouseKey(meta.name));
  }
  const candidates = [lineId, warehouseKey(lineName)].filter(Boolean);
  const i = keys.filter(Boolean).findIndex((k) => candidates.includes(k));
  return i >= 0 ? i : Number.MAX_SAFE_INTEGER;
}

/** The HOUSE view of an item: everything the shop knows, including what must never leave the machine. */
export type NormalisedItem = {
  offerKey: string;
  originalCode: string;
  code: string;
  name: string;
  source: "own" | "partner";
  sourceName: string;
  brand: string;
  productKind: string;
  category: string;
  division: string;
  gender: string;
  /** The size lines as they arrived — the repository and the public view read them defensively. */
  sizes: RawRecord[];
  price: number;
  suggestedPrice: number;
  salePrice: number;
  preMarkupSalePrice: number;
  originalSalePrice: number;
  listPrice: number;
  saleRatio: number;
  discountPercent: number;
  discount_percent: number;
  status: ItemStatus;
  hiddenReason: string;
  thumbnailImage: string;
  highImage: string;
  galleryImages: string[];
  warehouseStocks: Record<string, number>;
  warehouseStockIds: Record<string, number>;
  warehousePriority: string[];
  warehousePriorityIds: string[];
  warehouseMeta: WarehouseMeta[];
  slug: string;
  shortDescription: string;
  description: string;
  seoTitle: string;
  seoDescription: string;
  seoKeywords: string;
  productUrl: string;
  sourcePageUrl: string;
  detailUrl: string;
  partnerCampaign: boolean;
  partnerSource: string;
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  campaignExpiresAt: string;
  policy: string;
};

/**
 * THE HOUSE VIEW. Returns `null` without a code or a name — an item without a code cannot be sold.
 *
 * Quirk kept on purpose: the item's price is the SMALLEST price across its sizes (the customer
 * sees "từ ... đ"). A sale price above the list price is bad data -> the item hides itself
 * (`invalid_price_sale_gt_list`), because shown it would read as a negative discount.
 */
export function normaliseItem(raw: unknown): NormalisedItem | null {
  const m = asRecord(raw);
  const code = text(m.code);
  const name = text(m.name);
  if (!code || !name) return null;

  const sizes = asRecords(m.sizes);
  const sizePrices = sizes
    .map((s) => firstPositive(s.suggestedPrice, s.salePrice, s.sellPrice, s.price))
    .filter((p) => p > 0);
  const price = sizePrices.length ? Math.min(...sizePrices) : firstPositive(m.suggestedPrice, m.salePrice, m.sellPrice, m.price);
  const listPrice = firstPositive(m.listPrice, m.originalPrice, m.retailPrice, m.marketPrice, m.msrp);
  const priceInvalid = listPrice > 0 && price > listPrice;

  const preMarkupPrice = firstPositive(m.preMarkupSalePrice, m.originalSalePrice, m.saleFilePrice, m.baseSalePrice, m.rawSalePrice);
  const explicitDiscount = firstPositive(m.discountPercent, m.discount_percent);
  const ratio = Number(m.saleRatio || m.sale_ratio || 0);
  const basePrice = preMarkupPrice || price;
  const discountPercent = explicitDiscount > 0
    ? Math.round(explicitDiscount)
    : (ratio > 0
      ? Math.round(ratio <= 1 ? ratio * 100 : ratio)
      : (listPrice > 0 && basePrice > 0 && basePrice < listPrice ? Math.round((1 - basePrice / listPrice) * 100) : 0));

  return {
    offerKey: text(m.offerKey),
    originalCode: String(m.originalCode || code).trim(),
    code,
    name,
    source: m.source === "partner" ? "partner" : "own",
    sourceName: text(m.sourceName) || "TopRun",
    brand: text(m.brand),
    productKind: text(m.productKind || m.kind || m.productType),
    category: text(m.category || m.sport),
    division: text(m.division || m.type),
    gender: text(m.gender),
    sizes,
    price,
    suggestedPrice: price,
    salePrice: price,
    preMarkupSalePrice: preMarkupPrice,
    originalSalePrice: preMarkupPrice,
    listPrice,
    saleRatio: discountPercent > 0 ? discountPercent / 100 : 0,
    discountPercent,
    discount_percent: discountPercent,
    status: priceInvalid ? "hidden" : itemStatus(m.status),
    hiddenReason: priceInvalid ? "invalid_price_sale_gt_list" : text(m.hiddenReason),
    thumbnailImage: publicImage(m.thumbnailImage || m.image || ""),
    highImage: publicImage(m.highImage || ""),
    galleryImages: dedupe(publicImages(m.galleryImages || m.gallery || m.images || m.localImages)),
    warehouseStocks: stockMap(m.warehouseStocks),
    warehouseStockIds: stockMap(m.warehouseStockIds),
    warehousePriority: stringList(m.warehousePriority),
    warehousePriorityIds: stringList(m.warehousePriorityIds),
    warehouseMeta: warehouseMeta(m.warehouseMeta),
    slug: itemSlug(m.slug || m.code, code, name),
    shortDescription: text(m.shortDescription || m.short_description),
    description: text(m.description || m.introduction || m.productDescription),
    seoTitle: text(m.seoTitle),
    seoDescription: text(m.seoDescription),
    seoKeywords: text(m.seoKeywords),
    productUrl: text(m.productUrl || m.product_url),
    sourcePageUrl: text(m.sourcePageUrl || m.source_page_url),
    detailUrl: text(m.detailUrl || m.detail_url),
    partnerCampaign: Boolean(m.partnerCampaign),
    partnerSource: text(m.partnerSource),
    campaignId: text(m.campaignId),
    campaignName: text(m.campaignName),
    campaignStatus: text(m.campaignStatus),
    campaignExpiresAt: text(m.campaignExpiresAt),
    policy: text(m.policy)
  };
}

/** One size line of the PUBLIC view: in stock or not, never how many. */
export type PublicSize = {
  variantId: string;
  size: string;
  available: boolean;
  /** ONLY 1 or 0 — real stock never leaks. */
  qty: 0 | 1;
  price: number;
  suggestedPrice: number;
  salePrice: number;
  listPrice: number;
  warehouseId: string;
  warehouse: string;
  warehouseName: string;
  warehouseLabel: string;
  selectionRank?: number;
  stockMode?: "ready";
  partnerCampaignLineId: string;
};

/** One size line in the PUBLIC view. `null` for a line without a size. */
export function publicSize(item: RawRecord, rawLine: unknown): PublicSize | null {
  if (!rawLine || typeof rawLine !== "object") return null;
  const line = rawLine as RawRecord;
  const size = text(line.size);
  if (!size) return null;
  const left = Math.max(0, Number(line.qty ?? line.available ?? line.stockQty ?? 0));
  // PARTNER CAMPAIGN: to the outside it is TopRun's warehouse, not the partner's. Mr Dũng
  // 10/09/2026: a sentence sent to a customer must not carry a warehouse / partner name. The
  // ledger keeps the real name — the purchasing partner must know where to buy — but this view
  // is the ONLY one that leaves the machine.
  // PER LINE: one item may carry both house lines and partner-campaign lines (same code).
  // Judged per item, a campaign line inside a house item would leak the partner name.
  const isCampaign = text(line.nguon) === "campaign" || Boolean(item.partnerCampaign);
  const warehouseId = isCampaign ? "wh_toprun" : (text(line.warehouseId) || warehouseKey(line.warehouse || line.warehouseName));
  const warehouseName = isCampaign ? "TopRun" : text(line.warehouse || line.warehouseName || warehouseId);
  const label = isCampaign ? "TopRun" : warehouseLabel(warehouseId, warehouseName);
  const price = firstPositive(line.suggestedPrice, line.salePrice, line.sellPrice, line.price);
  const listPrice = firstPositive(line.listPrice, line.originalPrice, item.listPrice, item.originalPrice);
  const rank = warehouseRank(item, line);
  return {
    variantId: variantId(item, line),
    size,
    available: left > 0,
    qty: left > 0 ? 1 : 0,
    price,
    suggestedPrice: price,
    salePrice: price,
    listPrice,
    warehouseId,
    warehouse: label,
    warehouseName: label,
    warehouseLabel: label,
    ...(rank < Number.MAX_SAFE_INTEGER ? { selectionRank: rank } : {}),
    ...(text(line.stockMode).toLowerCase() === "ready" ? { stockMode: "ready" as const } : {}),
    partnerCampaignLineId: text(line.partnerCampaignLineId)
  };
}

/** The PUBLIC view of an item: no cost price, no real stock, no warehouse name. */
export type PublicItem = {
  code: string;
  originalCode: string;
  name: string;
  source: "own" | "partner";
  sourceName: string;
  brand: string;
  productKind: string;
  category: string;
  division: string;
  gender: string;
  sizes: PublicSize[];
  price: number;
  suggestedPrice: number;
  salePrice: number;
  listPrice: number;
  saleRatio: number;
  discountPercent: number;
  discount_percent: number;
  status: ItemStatus;
  thumbnailImage: string;
  highImage: string;
  galleryImages: string[];
  slug: string;
  shortDescription: string;
  description: string;
  seoTitle: string;
  seoDescription: string;
  seoKeywords: string;
  partnerCampaign: boolean;
  policy: string;
  readyPolicySummary?: string;
  /** The product page text the shop wrote in OMI (line intro, features, SEO article). No prices, no stock. */
  webContent?: Record<string, unknown>;
};

/**
 * THE PUBLIC VIEW — the only shape that leaves the machine. Accepts the house view from
 * `normaliseItem` or from the repository; `null` for anything that is not an object.
 */
export function publicView(item: unknown): PublicItem | null {
  if (!item || typeof item !== "object") return null;
  const m = item as RawRecord;
  const sizes = asList(m.sizes).map((line) => publicSize(m, line)).filter((s): s is PublicSize => s !== null);
  // A partner-campaign item: the customer sees only "TopRun". See the note in `publicSize`.
  const isCampaign = Boolean(m.partnerCampaign);
  const price = firstPositive(m.suggestedPrice, m.salePrice, m.sellPrice, m.price);
  const listPrice = firstPositive(m.listPrice, m.originalPrice, m.retailPrice, m.marketPrice, m.msrp);
  const discountPercent = Number(m.discountPercent || m.discount_percent || 0);
  const readyPolicySummary = text(m.readyPolicySummary);
  return {
    code: text(m.code),
    originalCode: text(m.originalCode || m.code),
    name: text(m.name),
    source: (!isCampaign && m.source === "partner") ? "partner" : "own",
    sourceName: isCampaign ? "TopRun" : String(m.sourceName || "TopRun").trim(),
    brand: text(m.brand),
    productKind: text(m.productKind),
    category: text(m.category),
    division: text(m.division),
    gender: text(m.gender),
    sizes,
    price,
    suggestedPrice: price,
    salePrice: price,
    listPrice,
    saleRatio: Number(m.saleRatio || 0),
    discountPercent,
    discount_percent: discountPercent,
    // Every size sold out = the item is sold out, whatever its record says.
    status: itemStatus(sizes.some((s) => Number(s.qty || 0) > 0) ? m.status : "out_of_stock"),
    thumbnailImage: publicImage(m.thumbnailImage || m.image || ""),
    highImage: publicImage(m.highImage || ""),
    galleryImages: publicImages(m.galleryImages || m.gallery || m.images || m.localImages),
    slug: text(m.slug),
    shortDescription: text(m.shortDescription || m.short_description),
    description: text(m.description || m.introduction || m.productDescription),
    seoTitle: text(m.seoTitle),
    seoDescription: text(m.seoDescription),
    seoKeywords: text(m.seoKeywords),
    partnerCampaign: Boolean(m.partnerCampaign),
    policy: text(m.policy),
    ...(readyPolicySummary ? { readyPolicySummary } : {}),
    ...(m.webContent && typeof m.webContent === "object" && !Array.isArray(m.webContent) ? { webContent: m.webContent as Record<string, unknown> } : {})
  };
}

/** Finds an item by code, offerKey or slug — any of the three works. */
export function findByKey(items: unknown, key: unknown): RawRecord | null {
  const slug = itemSlug(key);
  const lower = String(key || "").toLowerCase();
  return asRecords(items).find((m) => {
    const code = text(m.code);
    const offer = text(m.offerKey);
    return code.toLowerCase() === lower
      || offer.toLowerCase() === lower
      || itemSlug(m.slug || code) === slug
      || itemSlug(`${code}-${String(m.name || "")}`) === slug;
  }) ?? null;
}
