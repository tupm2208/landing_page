/**
 * @file PICTURES FOR A POST — the cover with the hook's words, and a product card with price + sizes.
 *
 * Ported from Sales Desk `content_image_kit.js` (cover 1080×1080) and `facebook_product_card_kit.js`
 * (card 1000×1000: sale price in the accent colour, list price struck through, sizes still in stock,
 * badges, the shop's site). Rendered with `sharp` from an SVG overlay, as Desk did.
 *
 * WHAT IS NOT HARD-CODED, unlike Desk: the brand. Desk printed "TOPRUNVN · toprun.site" and an orange
 * of TopRun's; here the name, the domain, the accent and the cover colours are the SHOP'S brand
 * settings (`BrandConfig`, edited in OMI). Text width is estimated rather than measured by rendering
 * — close enough for wrapping, and it keeps one render per picture.
 *
 * `sharp` is loaded lazily: a landing that never renders a picture never loads the native library.
 */

export const BRAND_DOCUMENT = "dang-bai-thuong-hieu";

export interface BrandConfig {
  /** Printed at the foot of the cover and on cards ("TOPRUNVN"). */
  tenHienThi: string;
  /** The shop's domain, printed on cards ("toprun.site"). */
  tenMien: string;
  /** Accent colour of the sale price. */
  mauNhan: string;
  /** Cover gradients, one "#from,#to" per entry; picked by date + time so neighbours differ. */
  mauNen: string[];
  /** The fixed badge on cards ("CHÍNH HÃNG"); empty = no badge. */
  huyHieu: string;
}

export function defaultBrand(siteUrl: string): BrandConfig {
  let domain = "";
  try { domain = new URL(siteUrl).host; } catch { domain = ""; }
  return {
    tenHienThi: domain.split(".")[0]?.toUpperCase() ?? "SHOP",
    tenMien: domain,
    mauNhan: "#FF7022",
    mauNen: ["#0f2027,#2c5364", "#1c2541,#3a506b", "#134e5e,#71b280", "#232526,#414345", "#16222a,#3a6073"],
    huyHieu: "CHÍNH HÃNG"
  };
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Cleans what the owner saved; anything malformed falls back to the default. */
export function cleanBrand(raw: unknown, siteUrl: string): BrandConfig {
  const base = defaultBrand(siteUrl);
  const o = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const t = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
  const gradients = (Array.isArray(o["mauNen"]) ? o["mauNen"] : []).map((g) => t(g, 20)).filter((g) => g.split(",").every((c) => HEX.test(c.trim())));
  return {
    tenHienThi: t(o["tenHienThi"], 40) || base.tenHienThi,
    tenMien: t(o["tenMien"], 80) || base.tenMien,
    mauNhan: HEX.test(t(o["mauNhan"], 7)) ? t(o["mauNhan"], 7) : base.mauNhan,
    mauNen: gradients.length > 0 ? gradients.slice(0, 10) : base.mauNen,
    huyHieu: o["huyHieu"] === undefined ? base.huyHieu : t(o["huyHieu"], 30)
  };
}

export function escapeSvg(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Estimated width of bold text: wide capitals, narrow punctuation. */
export function textWidth(value: string, size: number): number {
  let units = 0;
  for (const ch of value) units += /[\s.,:;'!|]/.test(ch) ? 0.3 : /[A-ZĐ0-9MW]/.test(ch) ? 0.68 : 0.56;
  return units * size;
}

export function wrapWords(value: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of value.trim().split(/\s+/).filter(Boolean)) {
    const trial = current ? `${current} ${word}` : word;
    if (textWidth(trial, size) <= maxWidth || current === "") current = trial;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines;
}

/** Largest size (150 → 68) at which the text fits in `maxLines` lines. */
export function fitText(value: string, maxWidth: number, maxLines = 3, high = 150, low = 68): { size: number; lines: string[] } {
  for (let size = high; size >= low; size -= 6) {
    const lines = wrapWords(value, size, maxWidth);
    if (lines.length <= maxLines && lines.every((l) => textWidth(l, size) <= maxWidth)) return { size, lines };
  }
  return { size: low, lines: wrapWords(value, low, maxWidth) };
}

export function pickGradient(brand: BrandConfig, key: string): [string, string] {
  let sum = 0;
  for (let i = 0; i < key.length; i += 1) sum += key.charCodeAt(i);
  const chosen = (brand.mauNen[sum % Math.max(1, brand.mauNen.length)] ?? "#232526,#414345").split(",").map((c) => c.trim());
  return [chosen[0] ?? "#232526", chosen[1] ?? chosen[0] ?? "#414345"];
}

const FONT = "'Arial Black', Arial, sans-serif";

function shadowText(x: number, y: number, value: string, size: number, weight = 900, fill = "#ffffff"): string {
  const safe = escapeSvg(value);
  return `<text x="${x + 4}" y="${y + 5}" text-anchor="middle" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="#000000" fill-opacity="0.42">${safe}</text>`
    + `<text x="${x}" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}">${safe}</text>`;
}

/** The cover as SVG — pure, so the layout is testable without the native library. */
export function coverSvg(post: { main: string; sub?: string; key?: string }, brand: BrandConfig): string {
  const W = 1080;
  const SAFE = 130;
  const maxWidth = W - 2 * SAFE;
  const [from, to] = pickGradient(brand, post.key ?? post.main);
  const main = String(post.main ?? "").replace(/[‒-―−]/g, "-");
  const fitted = fitText(main, maxWidth);
  const lineHeight = Math.round(fitted.size * 1.14);
  const subLines = post.sub ? wrapWords(post.sub, 50, maxWidth) : [];
  const blockHeight = fitted.lines.length * lineHeight + (subLines.length ? 24 + subLines.length * 66 : 0);
  let y = Math.round((W - blockHeight) / 2) - 20 + Math.round(fitted.size * 0.8);
  const parts = [`<rect x="${(W - 120) / 2}" y="${Math.round((W - blockHeight) / 2) - 70}" width="120" height="10" fill="#ffffff" fill-opacity="0.92"/>`];
  for (const line of fitted.lines) { parts.push(shadowText(W / 2, y, line, fitted.size)); y += lineHeight; }
  if (subLines.length) { y += 24; for (const line of subLines) { parts.push(shadowText(W / 2, y, line, 50, 700)); y += 66; } }
  const foot = [brand.tenHienThi, brand.tenMien].filter(Boolean).join("  ·  ");
  if (foot) parts.push(shadowText(W / 2, W - SAFE + 60, foot, 36, 700));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}"><defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/></linearGradient></defs>`
    + `<rect width="${W}" height="${W}" fill="url(#bg)"/><rect width="${W}" height="${W}" fill="#000000" fill-opacity="0.26"/>${parts.join("")}</svg>`;
}

export interface CardProduct {
  code: string;
  name: string;
  salePrice: number;
  listPrice: number;
  /** Sizes still in stock, in order. */
  sizes: string[];
}

export function formatPrice(value: number): string {
  return value > 0 ? `${Math.round(value).toLocaleString("vi-VN")}đ` : "";
}

/** The overlay of a product card — pure. `dark` = the photo background is dark (text goes white). */
export function cardOverlaySvg(product: CardProduct, brand: BrandConfig, dark: boolean): string {
  const C = 1000;
  const right = C - 56;
  const fill = dark ? "#ffffff" : "#111111";
  const stroke = dark ? "#111111" : "#ffffff";
  const parts: string[] = [];
  const title = `${product.name.toUpperCase()} ${product.code.toUpperCase()}`.trim();
  let titleSize = 25;
  while (titleSize > 16 && textWidth(title, titleSize) > C - 116) titleSize -= 1;
  let y = 20 + titleSize;
  parts.push(`<text x="${right}" y="${y}" text-anchor="end" font-family="Arial" font-size="${titleSize}" font-weight="700" fill="${fill}" stroke="${stroke}" stroke-width="2" paint-order="stroke">${escapeSvg(title)}</text>`);
  const sale = formatPrice(product.salePrice);
  if (sale) {
    y += 70;
    parts.push(`<text x="${C - 58}" y="${y}" text-anchor="end" font-family="Impact, 'Arial Black'" font-size="70" font-weight="900" fill="${brand.mauNhan}" stroke="${stroke}" stroke-width="3" paint-order="stroke">${escapeSvg(sale)}</text>`);
    y += 14;
  }
  const list = product.listPrice > product.salePrice ? formatPrice(product.listPrice) : "";
  if (list) {
    y += 27;
    const width = textWidth(list, 27);
    parts.push(`<text x="${C - 58}" y="${y}" text-anchor="end" font-family="${FONT}" font-size="27" font-weight="900" fill="${fill}" stroke="${stroke}" stroke-width="2" paint-order="stroke">${escapeSvg(list)}</text>`);
    parts.push(`<line x1="${C - 58 - width - 4}" y1="${y - 8}" x2="${C - 54}" y2="${y - 8}" stroke="${fill}" stroke-width="3"/>`);
  }
  const sizes = product.sizes.slice(0, 10);
  if (sizes.length > 0) {
    const lines = wrapWords(`Size: ${sizes.join(", ")}${product.sizes.length > 10 ? "…" : ""}`, 22, C - 56 - 480).slice(0, 2);
    for (const line of lines) {
      y += 29;
      parts.push(`<text x="${right}" y="${y}" text-anchor="end" font-family="${FONT}" font-size="22" font-weight="900" fill="${fill}" stroke="${stroke}" stroke-width="2" paint-order="stroke">${escapeSvg(line)}</text>`);
    }
  }
  const badges = [brand.huyHieu, brand.tenMien ? `ĐẶT TẠI ${brand.tenMien.toUpperCase()}` : ""].filter(Boolean);
  badges.forEach((badge, i) => {
    const width = Math.round(textWidth(badge, 20) + 28);
    const top = 96 + i * 44;
    parts.push(`<rect x="18" y="${top}" width="${width}" height="34" rx="17" fill="${brand.mauNhan}"/>`);
    parts.push(`<text x="${18 + width / 2}" y="${top + 23}" text-anchor="middle" font-family="Arial" font-size="20" font-weight="700" fill="#ffffff">${escapeSvg(badge)}</text>`);
  });
  if (brand.tenHienThi) parts.push(`<text x="24" y="58" font-family="${FONT}" font-size="34" font-weight="900" fill="${fill}" stroke="${stroke}" stroke-width="2" paint-order="stroke">${escapeSvg(brand.tenHienThi)}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${C}" height="${C}">${parts.join("")}</svg>`;
}

type Sharp = (input?: Buffer | { create: { width: number; height: number; channels: 3; background: string | { r: number; g: number; b: number } } }) => SharpChain;
interface SharpChain {
  resize(w: number, h: number, o: Record<string, unknown>): SharpChain;
  composite(layers: { input: Buffer; top: number; left: number }[]): SharpChain;
  jpeg(o: { quality: number }): SharpChain;
  png(): SharpChain;
  toBuffer(): Promise<Buffer>;
  stats(): Promise<{ channels: { mean: number }[] }>;
}

let sharpLoaded: Promise<Sharp> | null = null;
async function loadSharp(): Promise<Sharp> {
  sharpLoaded ??= import("sharp").then((m) => ((m as unknown as { default?: Sharp }).default ?? (m as unknown as Sharp)));
  return sharpLoaded;
}

/** The pictures a post needs, rendered. An interface so a test can swap in a fake. */
export interface PictureRenderer {
  cover(post: { main: string; sub?: string; key?: string }, brand: BrandConfig): Promise<Buffer>;
  card(photo: Buffer, product: CardProduct, brand: BrandConfig): Promise<Buffer>;
}

export class SharpRenderer implements PictureRenderer {
  async cover(post: { main: string; sub?: string; key?: string }, brand: BrandConfig): Promise<Buffer> {
    const sharp = await loadSharp();
    return sharp(Buffer.from(coverSvg(post, brand))).jpeg({ quality: 90 }).toBuffer();
  }

  async card(photo: Buffer, product: CardProduct, brand: BrandConfig): Promise<Buffer> {
    const sharp = await loadSharp();
    const stats = await sharp(photo).stats();
    const mean = stats.channels.slice(0, 3).map((c) => Math.round(c.mean));
    const background = { r: mean[0] ?? 255, g: mean[1] ?? 255, b: mean[2] ?? 255 };
    const dark = (0.2126 * background.r + 0.7152 * background.g + 0.0722 * background.b) < 128;
    const base = await sharp(photo).resize(1000, 1000, { fit: "contain", background }).toBuffer();
    return sharp(base).composite([{ input: Buffer.from(cardOverlaySvg(product, brand, dark)), top: 0, left: 0 }]).jpeg({ quality: 92 }).toBuffer();
  }
}
