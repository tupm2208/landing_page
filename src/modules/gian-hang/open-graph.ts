/**
 * @file OPEN GRAPH tags for the product page.
 *
 * Why: the crawlers of Facebook / Zalo / Messenger do NOT run JavaScript. If the HTML is only a
 * shell that JavaScript later fills with the product, a link a customer shares shows blank —
 * no name, no image, no price. So the server injects the tags into `<head>` before returning
 * the HTML.
 *
 * Everything here is pure: product + site origin in, HTML out. No disk, no network — so the
 * tests call it directly.
 */

/** Site name shown in `og:site_name` and page titles. */
export const SITE_NAME = "TopRun";
/** Image used when a product has none the crawler can reach. */
export const FALLBACK_IMAGE = "/assets/toprun-product-1.png";

/** A product as `hang-kho.read` returns it; only the keys the tags use are named. */
export type ProductLike = Record<string, unknown>;

/** Escapes the five HTML-significant characters for attribute and text positions. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function plainText(value: unknown): string {
  return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function firstText(product: ProductLike | null, keys: string[]): string {
  for (const key of keys) {
    const text = plainText(product?.[key]);
    if (text) return text;
  }
  return "";
}

/** Cuts a description to `max` characters with an ellipsis. */
export function truncate(text: unknown, max = 190): string {
  const value = String(text || "");
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

/** "<brand> <name> <code>", each part dropped when another part already contains it. */
export function productTitle(product: ProductLike): string {
  const main = firstText(product, ["seoTitle", "name", "productName"]);
  const brand = firstText(product, ["brand"]);
  const code = firstText(product, ["code", "productCode"]);
  const parts: string[] = [];
  for (const part of [brand, main, code]) {
    if (!part) continue;
    if (parts.some((x) => x.toLowerCase().includes(part.toLowerCase()))) continue;
    parts.push(part);
  }
  return parts.join(" ").trim();
}

/** The first positive price among the price fields; 0 when none. */
export function productPrice(product: ProductLike): number {
  for (const key of ["suggestedPrice", "salePrice", "price"]) {
    const price = Number(product?.[key] || 0);
    if (price > 0) return price;
  }
  return 0;
}

/** The product lookup key from a web path: `/product/<slug>` or `/product.html?p=<code>`. */
export function productKeyFromRequest({ path = "", query = {} }: { path?: string; query?: Record<string, string | undefined> } = {}): string {
  if (path === "/product.html") {
    for (const key of ["p", "code", "slug"]) {
      const value = String(query[key] || "").trim();
      if (value) return value;
    }
    return "";
  }
  const last = String(path).split("/").filter(Boolean).pop() || "";
  try { return decodeURIComponent(last).trim(); } catch { return last.trim(); }
}

/**
 * Picks the image for `og:image`.
 *
 * `fileExists(path)` asks the static-file port "is this file here?" — the image is not read
 * just to learn that it exists. An absolute image (http…) is used as is.
 */
export async function chooseImage(
  product: ProductLike, siteUrl: string, fileExists: (path: string) => Promise<boolean>, realImageOrigin = ""
): Promise<string> {
  const candidates = [
    product["highImage"], product["image"],
    ...(Array.isArray(product["galleryImages"]) ? (product["galleryImages"] as unknown[]) : []),
    product["thumbnailImage"]
  ];
  for (const candidate of candidates) {
    const image = String(candidate || "").trim();
    if (!image) continue;
    if (image.toLowerCase().includes("/assets/thumbnails/")) continue;   // a thumbnail shares badly
    if (/^https?:\/\//i.test(image)) return image;
    const relative = `/${image.split("\\").join("/").replace(/^\/+/, "")}`;
    if (await fileExists(relative)) return `${siteUrl}${relative}`;
    // The trial build does not carry the 7.6 GB of product images. When the image is not here
    // but `realImageOrigin` is set, point straight at the real site — the crawler gets the
    // image and the trial machine stores nothing.
    if (realImageOrigin) return `${realImageOrigin}${relative}`;
  }
  return `${siteUrl}${FALLBACK_IMAGE}`;
}

export interface InjectInput {
  /** The product.html template. */
  template: string;
  /** The product, or `null` when not found. */
  product: ProductLike | null;
  /** The lookup key from the URL (used for the canonical link when the product is unknown). */
  key: string;
  siteUrl: string;
  fileExists: (path: string) => Promise<boolean>;
  realImageOrigin?: string;
}

export interface InjectResult {
  html: string;
  /** `false` when the product was not found: the caller adds `X-Robots-Tag: noindex`. */
  found: boolean;
}

/**
 * Injects the tags into the template. Returns `{ html, found }`.
 *
 * An unknown product still gets a page (so the customer never sees a 404) but the caller
 * marks it `X-Robots-Tag: noindex` — like the running site.
 */
export async function injectOpenGraph({ template, product, key, siteUrl, fileExists, realImageOrigin = "" }: InjectInput): Promise<InjectResult> {
  const found = product !== null;
  const pathKey = found ? String(product["slug"] || product["code"] || key) : key;
  const canonical = `${siteUrl}/product/${encodeURIComponent(pathKey)}`;
  const name = found ? productTitle(product) : "";
  const title = name ? `${name} - ${SITE_NAME}` : `${SITE_NAME} - Giày và đồ thể thao chính hãng`;
  const price = found ? productPrice(product) : 0;

  let description = found ? firstText(product, ["seoDescription", "shortDescription", "description"]) : "";
  if (!description && found) {
    const prefix = price > 0 ? `Giá ${Math.round(price).toLocaleString("vi-VN")}đ. ` : "";
    description = `${prefix}Xem hình ảnh, size còn hàng và đặt sản phẩm trực tiếp tại ${SITE_NAME}.`;
  }
  description = truncate(description || `Xem sản phẩm giày và đồ thể thao chính hãng tại ${SITE_NAME}.`);
  const image = found ? await chooseImage(product, siteUrl, fileExists, realImageOrigin) : `${siteUrl}${FALLBACK_IMAGE}`;

  const lines = [
    `  <link rel="canonical" href="${escapeHtml(canonical)}">`,
    `  <meta name="description" content="${escapeHtml(description)}">`,
    `  <meta property="og:type" content="product">`,
    `  <meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">`,
    `  <meta property="og:title" content="${escapeHtml(title)}">`,
    `  <meta property="og:description" content="${escapeHtml(description)}">`,
    `  <meta property="og:image" content="${escapeHtml(image)}">`,
    `  <meta property="og:image:alt" content="${escapeHtml(title)}">`,
    `  <meta property="og:url" content="${escapeHtml(canonical)}">`,
    price > 0 ? `  <meta property="product:price:amount" content="${Math.round(price)}">` : "",
    price > 0 ? `  <meta property="product:price:currency" content="VND">` : "",
    `  <meta name="twitter:card" content="summary_large_image">`,
    `  <meta name="twitter:title" content="${escapeHtml(title)}">`,
    `  <meta name="twitter:description" content="${escapeHtml(description)}">`,
    `  <meta name="twitter:image" content="${escapeHtml(image)}">`
  ].filter(Boolean).join("\n");

  const html = String(template).replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escapeHtml(title)}</title>\n${lines}`);
  return { html, found };
}
