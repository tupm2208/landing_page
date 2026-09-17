/**
 * @file WEBSITE CHANNELS — the shop's storefronts, their ad pixels and how ready the catalogue is for search (Đ9).
 *
 * Sales Desk `websiteChannelsTemplate`: a list of channels (name, id, domain, industries, status) each with
 * GA4 / Meta Pixel / TikTok Pixel ids, and an "SEO data" panel counting public items missing a brand,
 * an image or a price. Desk kept the channels in the page's local state; here they are a document on the
 * landing, and the storefront reads the MAIN channel's pixel ids to load the tags.
 *
 * Pixel ids end up inside a <script> the storefront writes, so they are validated to their real shapes
 * (`G-…`, digits, `C…`) — never free text.
 */

export const CHANNELS_DOCUMENT = "thong-ke-kenh-web";

export interface Tracking { ga4MeasurementId: string; metaPixelId: string; tiktokPixelId: string }

export interface WebsiteChannel {
  id: string;
  name: string;
  siteUrl: string;
  industries: string[];
  status: "active" | "planned";
  tracking: Tracking;
  updatedAt: string;
}

export interface ChannelBook { version: 1; kenh: WebsiteChannel[] }

const text = (v: unknown, n = 300): string => String(v ?? "").trim().slice(0, n);

export function slug(value: unknown): string {
  return text(value, 200).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

/** `G-XXXXXXX` (GA4) — empty is allowed. Throws a sentence the screen shows. */
export function ga4(value: unknown): string {
  const v = text(value, 40).toUpperCase();
  if (v && !/^G-[A-Z0-9]{4,20}$/.test(v)) throw new Error("GA4 Measurement ID có dạng G-XXXXXXX.");
  return v;
}

export function metaPixel(value: unknown): string {
  const v = text(value, 40);
  if (v && !/^\d{8,20}$/.test(v)) throw new Error("Meta Pixel ID chỉ gồm 8–20 chữ số.");
  return v;
}

export function tiktokPixel(value: unknown): string {
  const v = text(value, 40).toUpperCase();
  if (v && !/^[A-Z0-9]{10,30}$/.test(v)) throw new Error("TikTok Pixel ID gồm 10–30 chữ và số (ví dụ C4ABCDEF…).");
  return v;
}

/** What `POST /api/kenh-web` accepts. Throws on a bad pixel id or a missing name. */
export function channelFrom(body: Record<string, unknown>, now: string): WebsiteChannel {
  const name = text(body["ten"], 120);
  const id = slug(text(body["ma"]) || name);
  if (!name || !id) throw new Error("Cần nhập tên và mã website channel.");
  const site = text(body["diaChi"], 300);
  if (site && !/^(https?:\/\/|\/)/i.test(site)) throw new Error("Domain public phải bắt đầu bằng http(s):// hoặc /.");
  return {
    id, name, siteUrl: site,
    industries: String(body["nganh"] ?? "").split(/[,\n]/).map((s) => text(s, 60)).filter(Boolean).slice(0, 20),
    status: body["trangThai"] === "planned" ? "planned" : "active",
    tracking: { ga4MeasurementId: ga4(body["ga4"]), metaPixelId: metaPixel(body["metaPixel"]), tiktokPixelId: tiktokPixel(body["tiktokPixel"]) },
    updatedAt: now
  };
}

/** Desk `websiteChannelList`: with nothing saved, one channel for this landing. */
export function channelsOf(book: ChannelBook | null, fallback: { name: string; siteUrl: string }): WebsiteChannel[] {
  if (book && Array.isArray(book.kenh) && book.kenh.length > 0) return book.kenh;
  return [{ id: "chinh", name: fallback.name || "Website chính", siteUrl: fallback.siteUrl || "/", industries: [], status: "active", tracking: { ga4MeasurementId: "", metaPixelId: "", tiktokPixelId: "" }, updatedAt: "" }];
}

/** Upsert; `editingId` renames an existing channel. */
export function saveChannel(list: WebsiteChannel[], channel: WebsiteChannel, editingId: string): { kenh: WebsiteChannel[]; created: boolean } {
  const from = editingId || channel.id;
  const i = list.findIndex((c) => c.id === from);
  if (i < 0) {
    if (list.some((c) => c.id === channel.id)) throw new Error(`Mã channel "${channel.id}" đã có.`);
    return { kenh: [channel, ...list], created: true };
  }
  if (channel.id !== from && list.some((c) => c.id === channel.id)) throw new Error(`Mã channel "${channel.id}" đã có.`);
  const next = [...list];
  next[i] = channel;
  return { kenh: next, created: false };
}

/** The pixel ids the storefront loads: the first ACTIVE channel's. */
export function storefrontTracking(list: WebsiteChannel[]): Tracking & { kenh: string } {
  const main = list.find((c) => c.status === "active") ?? null;
  return { kenh: main?.id ?? "", ga4MeasurementId: main?.tracking.ga4MeasurementId ?? "", metaPixelId: main?.tracking.metaPixelId ?? "", tiktokPixelId: main?.tracking.tiktokPixelId ?? "" };
}

export interface SeoItem { code?: string; name?: string; brand?: string; price?: number; status?: string; thumbnailImage?: string; highImage?: string; galleryImages?: string[]; seoTitle?: string; seoDescription?: string; slug?: string }

/** Desk "Sản phẩm đủ nền SEO" (brand + image + price) plus the SEO fields Đ5 added; a 0–100 score. */
export function seoReadiness(items: SeoItem[]): Record<string, unknown> {
  const pub = items.filter((i) => i.status !== "hidden");
  const noBrand = pub.filter((i) => !text(i.brand));
  const noImage = pub.filter((i) => !text(i.thumbnailImage) && !text(i.highImage) && !(i.galleryImages ?? []).length);
  const noPrice = pub.filter((i) => !(Number(i.price) > 0));
  const noSeoTitle = pub.filter((i) => !text(i.seoTitle));
  const noSeoDescription = pub.filter((i) => !text(i.seoDescription));
  const base = new Set([...noBrand, ...noImage, ...noPrice]);
  const ready = pub.length - base.size;
  const full = pub.filter((i) => !base.has(i) && text(i.seoTitle) && text(i.seoDescription)).length;
  // Half of the score is the Desk base (brand, image, price); half is the written SEO title + description.
  const score = pub.length === 0 ? 0 : Math.round((ready / pub.length) * 50 + (full / pub.length) * 50);
  const sample = (xs: SeoItem[]) => xs.slice(0, 20).map((i) => ({ ma: text(i.code, 80), ten: text(i.name, 200) }));
  return {
    diem: score, congKhai: pub.length, duNen: ready, duSeo: full,
    thieuHang: noBrand.length, thieuAnh: noImage.length, thieuGia: noPrice.length, thieuTieuDeSeo: noSeoTitle.length, thieuMoTaSeo: noSeoDescription.length,
    canhBao: noBrand.length + noImage.length,
    mau: { thieuHang: sample(noBrand), thieuAnh: sample(noImage), thieuGia: sample(noPrice), thieuSeo: sample(pub.filter((i) => !base.has(i) && (!text(i.seoTitle) || !text(i.seoDescription)))) }
  };
}
