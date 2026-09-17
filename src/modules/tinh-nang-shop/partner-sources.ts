/**
 * @file PARTNER WEB SOURCES — Desk `partner_catalog.js`, with the source list moved into the shop's config.
 *
 * Desk hard-coded `PARTNER_SOURCES` (Dasbui, Forrest Run, Runner Chuyên Nghiệp) and which of them was
 * "ready stock". Decided 17/09/2026: every shop gets the feature, each shop lists ITS partners:
 *
 *   { ma: "runner", ten: "Runner Chuyên Nghiệp", nenTang: "haravan", diaChi: "https://…",
 *     cheDo: "thu-cong" | "web", dayKhoSan: false, maKho: "wh_doi_tac_runner", chiGiay: true }
 *
 *   - `nenTang`: how the partner's public shop answers — WooCommerce Store API (`/wp-json/wc/store/v1/products`)
 *     or Haravan / Shopify (`/collections/all/products.json`). Both are public catalogue doors.
 *   - `cheDo: "thu-cong"`: the partner has no live stock online (Desk: Runner updates by Zalo photo); the
 *     catalogue is fetched for names and pictures, stock is ticked by hand or read from a photo.
 *   - `dayKhoSan`: the partner's stock may be sold as READY stock in `maKho` (Desk: Dasbui "Đẩy kho sẵn").
 *
 * Fetching never writes: rows go back to the screen and into this module's "last fetch" document. Only
 * "Đồng bộ vào catalog" / "Đẩy kho sẵn" write, through `hang-kho` services.
 */

import type { HttpClient } from "../../contract";

export const PLATFORMS = ["woocommerce", "haravan"] as const;
export type Platform = (typeof PLATFORMS)[number];

export interface PartnerSource {
  ma: string;
  ten: string;
  nenTang: Platform;
  diaChi: string;
  cheDo: "web" | "thu-cong";
  dayKhoSan: boolean;
  maKho: string;
  chiGiay: boolean;
}

const text = (v: unknown, n = 300): string => String(v ?? "").trim().slice(0, n);
const asObject = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** One source as the screen sent it, or the reason it is refused. */
export function normaliseSource(raw: unknown): { ok: true; source: PartnerSource } | { ok: false; message: string } {
  const o = asObject(raw);
  const ma = text(o["ma"], 40).toLowerCase();
  if (!/^[a-z][a-z0-9-]{1,29}$/.test(ma)) return { ok: false, message: "Mã nguồn chỉ gồm chữ thường, số, gạch ngang (2–30 ký tự, bắt đầu bằng chữ)." };
  if (ma === "kho" || ma === "sapo" || ma === "all") return { ok: false, message: `Mã "${ma}" đã dành cho nguồn sẵn có.` };
  const ten = text(o["ten"], 80) || ma;
  const nenTang = text(o["nenTang"], 20) as Platform;
  if (!(PLATFORMS as readonly string[]).includes(nenTang)) return { ok: false, message: `Nền tảng web phải là ${PLATFORMS.join(" / ")}.` };
  let diaChi = "";
  try {
    const u = new URL(text(o["diaChi"], 300));
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("scheme");
    if (u.username || u.password) throw new Error("credentials");
    diaChi = `${u.protocol}//${u.host}`;
  } catch {
    return { ok: false, message: `Địa chỉ web của "${ten}" không hợp lệ (cần https://tên-miền).` };
  }
  const maKho = text(o["maKho"], 60) || `wh_doi_tac_${ma.replace(/-/g, "_")}`;
  if (!/^[a-z0-9_*-]{2,60}$/i.test(maKho)) return { ok: false, message: "Mã kho chỉ gồm chữ, số, gạch dưới." };
  return { ok: true, source: { ma, ten, nenTang, diaChi, cheDo: o["cheDo"] === "thu-cong" ? "thu-cong" : "web", dayKhoSan: o["dayKhoSan"] === true, maKho, chiGiay: o["chiGiay"] !== false } };
}

/** One variant row of a partner's web shop (Desk row names, the partner table reads them). */
export interface PartnerRow {
  partner: string;
  source: string;
  productId: string;
  code: string;
  sku: string;
  name: string;
  brand: string;
  category: string;
  tags: string;
  size: string;
  stockQty: number | null;
  available: boolean;
  price: number;
  regularPrice: number;
  productUrl: string;
  imageUrl: string;
  allImageUrls: string[];
}

const BRANDS = ["nike", "asics", "adidas", "babolat", "wilson", "skechers", "new balance", "lacoste", "hoka", "saucony", "brooks", "puma", "mizuno", "yonex", "fila", "on"];

export function inferBrand(code: string, name: string): string {
  const t = ` ${`${name} ${code}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")} `;
  const found = BRANDS.find((b) => t.includes(` ${b} `) || (b.length > 3 && t.includes(b)));
  if (!found) return "";
  if (found === "on") return "On Running";
  return found.split(" ").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

const money = (v: unknown): number => {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** A product code in a title or handle: letters + digits (`DV7480`, `1041A370-106`). */
export function codeFromText(value: unknown): string {
  return String(value ?? "").toUpperCase().match(/\b[A-Z0-9]{2,6}\d{2,6}[A-Z0-9-]*\b/)?.[0] ?? "";
}

function stripSizeSuffix(value: string): string {
  return value.trim().replace(/[-_\s]*(?:2[2-9][05]|3[5-9]|4[0-9](?:[.,]5)?|5[0-2](?:[.,]5)?|XS|S|M|L|XL|XXL|2XL|3XL|4XL)$/i, "").trim();
}

/** WooCommerce Store API product → one row (sizes joined, as Desk). WooCommerce prices come in minor units when `currency_minor_unit` > 0. */
export function wooRows(source: PartnerSource, product: Record<string, unknown>): PartnerRow[] {
  const prices = asObject(product["prices"]);
  const minor = Number(prices["currency_minor_unit"] ?? 0);
  const scale = minor > 0 ? 10 ** minor : 1;
  const images = (Array.isArray(product["images"]) ? product["images"] : []).map((i) => text(asObject(i)["src"], 1000)).filter(Boolean);
  const sizes: string[] = [];
  for (const attr of Array.isArray(product["attributes"]) ? product["attributes"] : []) {
    const a = asObject(attr);
    const n = text(a["name"]).toLowerCase();
    if (!n.includes("size") && !n.includes("kích") && !n.includes("kich")) continue;
    for (const term of Array.isArray(a["terms"]) ? a["terms"] : []) sizes.push(typeof term === "object" ? text(asObject(term)["name"] ?? asObject(term)["slug"], 20) : text(term, 20));
  }
  const sku = text(product["sku"], 80);
  const code = sku || codeFromText(`${text(product["name"])} ${text(product["slug"])}`) || `P-${text(product["id"], 40)}`;
  const name = text(product["name"], 300) || code;
  const inStock = product["is_in_stock"] === true;
  return [{
    partner: source.ten, source: source.ma, productId: text(product["id"], 40), code, sku, name,
    brand: inferBrand(code, name) || "Chưa rõ",
    category: (Array.isArray(product["categories"]) ? product["categories"] : []).map((c) => text(asObject(c)["name"], 80)).filter(Boolean).join(", "),
    tags: "", size: [...new Set(sizes.filter(Boolean))].join(", "), stockQty: null,
    available: inStock && product["is_purchasable"] !== false,
    price: Math.round(money(prices["price"]) / scale), regularPrice: Math.round(money(prices["regular_price"]) / scale),
    productUrl: text(product["permalink"], 1000), imageUrl: images[0] ?? "", allImageUrls: images
  }];
}

/** Haravan / Shopify `products.json` product → one row per variant. */
export function haravanRows(source: PartnerSource, product: Record<string, unknown>): PartnerRow[] {
  const title = text(product["title"], 300);
  const handle = text(product["handle"], 300);
  const images = (Array.isArray(product["images"]) ? product["images"] : []).map((i) => text(asObject(i)["src"], 1000)).filter(Boolean);
  const variants = (Array.isArray(product["variants"]) && product["variants"].length ? product["variants"] : [{}]).map(asObject);
  let code = codeFromText(`${title} ${handle}`);
  if (!code) for (const v of variants) { const stripped = stripSizeSuffix(text(v["sku"], 80)); code = codeFromText(stripped) || stripped; if (code) break; }
  if (!code) code = `P-${text(product["id"], 40)}`;
  const tags = Array.isArray(product["tags"]) ? product["tags"].map((t) => text(t, 60)).join(", ") : text(product["tags"], 500);
  return variants.map((v) => {
    const qty = Number(v["inventory_quantity"]);
    const hasQty = Number.isFinite(qty) && v["inventory_quantity"] !== undefined && v["inventory_quantity"] !== null;
    return {
      partner: source.ten, source: source.ma, productId: text(product["id"], 40), code, sku: text(v["sku"], 80), name: title || code,
      brand: inferBrand(code, `${text(product["vendor"])} ${title}`) || text(product["vendor"], 60) || "Chưa rõ",
      category: text(product["product_type"], 80), tags, size: text(v["option1"] ?? v["title"], 20),
      stockQty: hasQty ? Math.max(0, qty) : null,
      available: v["available"] === true || (hasQty && qty > 0),
      price: money(v["price"]), regularPrice: money(v["compare_at_price"]),
      productUrl: handle ? `${source.diaChi}/products/${handle}` : source.diaChi,
      imageUrl: images[0] ?? text(asObject(product["image"])["src"], 1000), allImageUrls: images
    };
  });
}

const BLOCKED_WORDS = ["ao", "quan", "shirt", "short", "shorts", "sock", "socks", "vo", "bag", "balo", "backpack", "tui", "cap", "mu", "non", "phu kien", "accessory", "accessories"];
const SHOE_WORDS = ["giay", "shoe", "shoes", "sneaker", "running", "trainer", "court", "trail", "pickleball", "tennis"];
const fold = (v: string) => ` ${v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ")} `;

/** Desk `isShoeRow`, loosened to words any shoe shop uses. A source with `chiGiay: false` skips it. */
export function isShoeRow(row: PartnerRow): boolean {
  const name = fold(row.name);
  const all = fold(`${row.name} ${row.category} ${row.tags} ${row.productUrl}`);
  const shoe = SHOE_WORDS.some((w) => all.includes(` ${w} `) || all.includes(` ${w}`));
  const blocked = BLOCKED_WORDS.some((w) => name.includes(` ${w} `));
  return shoe && !blocked;
}

/** Fetches one source's whole public catalogue. Never throws: failures come back as log lines. */
export async function fetchSourceRows(http: HttpClient, source: PartnerSource, { maxPages = 40 } = {}): Promise<{ rows: PartnerRow[]; logs: string[]; ok: boolean }> {
  const rows: PartnerRow[] = [];
  const logs: string[] = [];
  const get = async (url: string) => {
    const r = await http.fetch(url, { method: "GET", timeoutMs: 30_000, headers: { Accept: "application/json", "User-Agent": "OMI-Landing/1.0" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };
  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const url = source.nenTang === "woocommerce"
        ? `${source.diaChi}/wp-json/wc/store/v1/products?per_page=100&page=${page}`
        : `${source.diaChi}/collections/all/products.json?limit=250&page=${page}`;
      const body = await get(url);
      const products = (source.nenTang === "woocommerce" ? (Array.isArray(body) ? body : []) : (Array.isArray(asObject(body)["products"]) ? asObject(body)["products"] as unknown[] : [])).map(asObject);
      if (products.length === 0) break;
      logs.push(`${source.ten} trang ${page}: ${products.length} sản phẩm`);
      for (const p of products) rows.push(...(source.nenTang === "woocommerce" ? wooRows(source, p) : haravanRows(source, p)));
      if (products.length < (source.nenTang === "woocommerce" ? 100 : 250)) break;
    }
    return { rows, logs, ok: true };
  } catch (e) {
    logs.push(`${source.ten}: ${e instanceof Error ? e.message : String(e)}`);
    return { rows, logs, ok: rows.length > 0 };
  }
}

/** One partner product, grouped by code (Desk `groupRowsToProducts`): sizes with a count (1 = "còn" when the web shows no number). */
export interface PartnerProduct {
  code: string;
  name: string;
  source: string;
  sourceName: string;
  brand: string;
  category: string;
  price: number;
  listPrice: number;
  sizes: { size: string; qty: number }[];
  imageUrl: string;
  images: string[];
  productUrl: string;
  available: boolean;
}

export function groupRows(rows: PartnerRow[]): PartnerProduct[] {
  const byKey = new Map<string, { row: PartnerRow; sizes: Map<string, number>; images: string[]; available: boolean }>();
  for (const row of rows) {
    const key = `${row.source}|${(row.code || row.productId || row.sku).toUpperCase()}`;
    if (!key.split("|")[1]) continue;
    const entry = byKey.get(key) ?? { row, sizes: new Map<string, number>(), images: [], available: false };
    for (const size of row.size.split(/[,;/\n]+/).map((s) => s.trim()).filter(Boolean)) {
      const add = row.stockQty !== null ? row.stockQty : row.available ? 1 : 0;
      entry.sizes.set(size, (entry.sizes.get(size) ?? 0) + add);
    }
    for (const url of row.allImageUrls.length ? row.allImageUrls : [row.imageUrl]) if (url && !entry.images.includes(url)) entry.images.push(url);
    entry.available = entry.available || row.available;
    byKey.set(key, entry);
  }
  return [...byKey.values()].map(({ row, sizes, images, available }) => ({
    code: (row.code || row.sku || row.productId).toUpperCase(), name: row.name, source: row.source, sourceName: row.partner,
    brand: row.brand, category: row.category, price: row.price, listPrice: row.regularPrice > row.price ? row.regularPrice : 0,
    sizes: [...sizes.entries()].map(([size, qty]) => ({ size, qty })), imageUrl: images[0] ?? "", images: images.slice(0, 12),
    productUrl: row.productUrl, available: available || [...sizes.values()].some((q) => q > 0)
  }));
}

/** A grouped product as `hang-kho` writes it (campaign or ready source, the source's warehouse). */
export function catalogueItemOf(product: PartnerProduct, source: PartnerSource, { manual = false } = {}): Record<string, unknown> {
  return {
    code: product.code, name: product.name, brand: product.brand, category: product.category, source: "partner", sourceName: source.ten,
    listPrice: product.listPrice, thumbnailImage: product.imageUrl, highImage: product.imageUrl, galleryImages: product.images.slice(1),
    productUrl: product.productUrl, sourcePageUrl: product.productUrl,
    policy: manual ? `${source.ten} cập nhật tồn thủ công; kiểm lại còn/hết trước khi tư vấn.` : "Hàng đối tác: cần xác nhận lại tồn trước khi chốt đơn.",
    sizes: product.sizes.map((s) => ({ size: s.size, qty: manual ? (s.qty > 0 ? 1 : 0) : Math.max(0, s.qty), price: product.price, listPrice: product.listPrice }))
  };
}
