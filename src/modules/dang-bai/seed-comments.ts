/**
 * @file "COMMENT PHỦ LINK" — one sale link under every NEW post of the shop's pages, as pure functions.
 *
 * Ported from Sales Desk `facebook_seed_comment_kit.js` + `processFacebookSeedComments`:
 *   - the post's text picks a TOPIC by whole-word keywords, top to bottom → the filtered link;
 *   - the sentence ROTATES through variants so Facebook does not read the same words as spam;
 *   - a delay of a few minutes after the post, a daily cap, and a PAUSE on the errors that mean a
 *     person must look (368 spam block, 190 token dead, missing permission) — never a blind retry;
 *   - only posts created AFTER the owner switched it on; old posts are never touched;
 *   - a post the publish flow already commented on is skipped (no double comment).
 *
 * What changed for many shops: Desk's topics were TopRun's categories on `toprun.site`. Here the
 * default is ONE catch-all topic on the shop's own site; the owner fills in the rest.
 */

import crypto from "node:crypto";

export const SEED_DOCUMENT = "dang-bai-phu-link";
const DAY_MS = 24 * 60 * 60 * 1000;
export const SEED_POSTS_KEEP = 300;
export const SEED_PER_RUN = 5;

export interface SeedTopic { id: string; label: string; keywords: string[]; link: string }
export interface SeedSettings { enabled: boolean; pageIds: string[]; delayMinMs: number; delayMaxMs: number; maxPerDay: number; paused: boolean; pausedReason: string }
export interface SeedEntry {
  pageId: string; pageName: string; excerpt: string; permalinkUrl: string; createdAt: string;
  status: "pending" | "published" | "failed" | "skipped_desk"; dueAt: string; topicId: string; commentId: string; error: string;
  trackingId?: string; trackedLink?: string; renderedText?: string; postedAt?: string;
}
export interface SeedStore {
  version: 1;
  config: { settings: SeedSettings; topics: SeedTopic[]; variants: string[] };
  ledger: { enabledAt: string; posts: Record<string, SeedEntry>; daily: { date: string; count: number }; variantCursor: number };
}

const text = (v: unknown, n = 2000): string => String(v ?? "").trim().slice(0, n);

export function normalizeSeedText(value: unknown): string {
  return String(value ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ").trim();
}

/** First topic with a keyword appearing as WHOLE words in the post; null when none. */
export function pickSeedTopic(message: string, topics: readonly SeedTopic[]): SeedTopic | null {
  const haystack = ` ${normalizeSeedText(message)} `;
  if (haystack.trim() === "") return null;
  for (const topic of topics) {
    for (const keyword of topic.keywords) {
      const needle = normalizeSeedText(keyword);
      if (needle && haystack.includes(` ${needle} `)) return topic;
    }
  }
  return null;
}

export function fallbackSeedTopic(siteUrl: string): SeedTopic {
  const origin = text(siteUrl).replace(/\/+$/, "") || "https://shop.vn";
  return { id: "tonghop", label: "toàn bộ sản phẩm đang sale", keywords: [], link: `${origin}/?sort=sale-desc#products` };
}

export function renderSeedComment(template: string, topic: { label: string; link: string }): string {
  return String(template ?? "").replace(/\{LABEL\}/g, topic.label).replace(/\{LINK\}/g, topic.link).trim();
}

/** Rotation: the variant at the cursor, and the next cursor. */
export function pickSeedVariant(variants: readonly string[], cursor: number): { template: string; nextCursor: number } {
  const list = variants.filter((v) => text(v) !== "");
  if (list.length === 0) return { template: "", nextCursor: 0 };
  const index = Math.abs(Math.trunc(Number(cursor) || 0)) % list.length;
  return { template: list[index] ?? "", nextCursor: index + 1 };
}

/** The link with the attribution fields `thong-ke` reads (`tr_*`), signed when the shop has a secret. */
export function trackedLink(link: string, context: { pageId: string; postId: string; topicId: string; trackingId: string }, secret: string): string {
  let url: URL;
  try { url = new URL(link); } catch { return link; }
  const signature = secret === "" ? "" : crypto.createHmac("sha256", secret).update([context.pageId, context.postId, context.topicId, context.trackingId].join("|")).digest("base64url");
  const fields: Record<string, string> = {
    tr_source: "facebook", tr_medium: "comment", tr_campaign: "fb_seed_sale",
    tr_page: context.pageId, tr_post: context.postId, tr_topic: context.topicId, tr_content: context.trackingId, tr_sig: signature
  };
  for (const [key, value] of Object.entries(fields)) if (value !== "") url.searchParams.set(key, value);
  return url.toString();
}

export function defaultSeedStore(siteUrl: string): SeedStore {
  return {
    version: 1,
    config: {
      settings: { enabled: false, pageIds: [], delayMinMs: 3 * 60 * 1000, delayMaxMs: 10 * 60 * 1000, maxPerDay: 40, paused: false, pausedReason: "" },
      topics: [fallbackSeedTopic(siteUrl)],
      variants: [
        "🔥 {LABEL} đang sale sâu, mẫu giảm nhiều nhất xếp ngay đầu trang 👉 {LINK}",
        "Cả nhà xem {LABEL} đang giảm giá tại đây nha 👉 {LINK}\nCần tư vấn size cứ inbox shop 📩",
        "Săn {LABEL} giá tốt ở đây: {LINK} — bấm vào là thấy ngay mẫu giảm mạnh nhất!"
      ]
    },
    ledger: { enabledAt: "", posts: {}, daily: { date: "", count: 0 }, variantCursor: 0 }
  };
}

/** The stored document with every missing piece filled in. */
export function readSeedStore(raw: Partial<SeedStore> | null, siteUrl: string): SeedStore {
  const base = defaultSeedStore(siteUrl);
  const config = raw?.config ?? base.config;
  return {
    version: 1,
    config: {
      settings: { ...base.config.settings, ...(config.settings ?? {}) },
      topics: Array.isArray(config.topics) && config.topics.length > 0 ? config.topics : base.config.topics,
      variants: Array.isArray(config.variants) && config.variants.length > 0 ? config.variants : base.config.variants
    },
    ledger: { ...base.ledger, ...(raw?.ledger ?? {}), posts: { ...(raw?.ledger?.posts ?? {}) } }
  };
}

/** Applies what the owner saved (settings, topics, variants, on/off, resume). */
export function patchSeedConfig(store: SeedStore, body: Record<string, unknown>, at: string): SeedStore | { error: string } {
  const next: SeedStore = JSON.parse(JSON.stringify(store)) as SeedStore;
  const s = next.config.settings;
  if (typeof body["enabled"] === "boolean") {
    if (body["enabled"] && !s.enabled) next.ledger.enabledAt = at;
    s.enabled = body["enabled"];
  }
  if (body["resume"] === true) { s.paused = false; s.pausedReason = ""; }
  if (Array.isArray(body["pageIds"])) s.pageIds = body["pageIds"].map((p) => text(p, 64)).filter(Boolean).slice(0, 50);
  if (body["maxPerDay"] !== undefined) {
    const n = Number(body["maxPerDay"]);
    if (!Number.isFinite(n) || n < 1 || n > 200) return { error: "Trần comment mỗi ngày từ 1 đến 200." };
    s.maxPerDay = Math.round(n);
  }
  if (body["delayMinMinutes"] !== undefined || body["delayMaxMinutes"] !== undefined) {
    const min = Number(body["delayMinMinutes"] ?? s.delayMinMs / 60000);
    const max = Number(body["delayMaxMinutes"] ?? s.delayMaxMs / 60000);
    if (!(min >= 1 && min <= 60 && max >= min && max <= 120)) return { error: "Trễ sau bài đăng: từ 1–60 phút, đến không nhỏ hơn từ, tối đa 120." };
    s.delayMinMs = Math.round(min) * 60000;
    s.delayMaxMs = Math.round(max) * 60000;
  }
  if (Array.isArray(body["topics"])) {
    const topics = body["topics"].map((t, i) => {
      const o = (t ?? {}) as Record<string, unknown>;
      const label = text(o["label"], 120);
      const link = text(o["link"], 1000);
      const keywords = (Array.isArray(o["keywords"]) ? o["keywords"] : String(o["keywords"] ?? "").split(",")).map((k) => text(k, 60)).filter(Boolean).slice(0, 30);
      return { id: text(o["id"], 40) || `chu_de_${i + 1}`, label, keywords, link };
    }).filter((t) => t.label !== "" && /^https?:\/\//i.test(t.link));
    if (topics.length === 0) return { error: "Cần ít nhất một chủ đề có nhãn và link." };
    next.config.topics = topics.slice(0, 60);
  }
  if (body["variants"] !== undefined) {
    const variants = (Array.isArray(body["variants"]) ? body["variants"].map(String) : String(body["variants"]).split(/\n---\n|\r\n---\r\n/)).map((v) => text(v, 1000)).filter(Boolean);
    if (variants.length === 0) return { error: "Cần ít nhất một biến thể câu comment." };
    if (!variants.every((v) => v.includes("{LINK}"))) return { error: "Mỗi biến thể phải có {LINK}." };
    next.config.variants = variants.slice(0, 30);
  }
  return next;
}

export function pauseSeed(store: SeedStore, reason: string): void {
  store.config.settings.paused = true;
  store.config.settings.pausedReason = text(reason, 300) || "Meta báo lỗi cần người xem.";
}

/** Records the page's new posts; returns how many were added. `delay` picks the wait for each. */
export function recordNewPosts(store: SeedStore, page: { ma: string; ten: string }, posts: { id: string; message: string; created_time: string; permalink_url: string }[], commentedPostIds: ReadonlySet<string>, delay: () => number): number {
  const enabledAtMs = Date.parse(store.ledger.enabledAt) || 0;
  let added = 0;
  for (const post of posts) {
    const createdMs = Date.parse(post.created_time) || 0;
    if (store.ledger.posts[post.id] || createdMs < enabledAtMs) continue;
    store.ledger.posts[post.id] = {
      pageId: page.ma, pageName: page.ten || "Fanpage", excerpt: post.message.slice(0, 500), permalinkUrl: post.permalink_url, createdAt: post.created_time,
      status: commentedPostIds.has(post.id) ? "skipped_desk" : "pending", dueAt: new Date(createdMs + delay()).toISOString(), topicId: "", commentId: "", error: ""
    };
    added += 1;
  }
  return added;
}

/** Posts whose wait is over, oldest first, at most `SEED_PER_RUN`. */
export function dueEntries(store: SeedStore, nowMs: number): [string, SeedEntry][] {
  return Object.entries(store.ledger.posts)
    .filter(([, e]) => e.status === "pending" && (Date.parse(e.dueAt) || 0) <= nowMs)
    .sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt))
    .slice(0, SEED_PER_RUN);
}

/** Keeps the ledger bounded: the newest posts survive. */
export function trimLedger(store: SeedStore, nowMs: number): void {
  const entries = Object.entries(store.ledger.posts).sort((a, b) => b[1].createdAt.localeCompare(a[1].createdAt));
  const keep = entries.filter(([, e], i) => i < SEED_POSTS_KEEP || (Date.parse(e.createdAt) || 0) > nowMs - 2 * DAY_MS);
  store.ledger.posts = Object.fromEntries(keep);
}

/** What the screen may see: config, today's count, recent posts. */
export function publicSeedStore(store: SeedStore, nowIso: string): Record<string, unknown> {
  const entries = Object.entries(store.ledger.posts).map(([postId, e]) => ({ postId, ...e })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const today = nowIso.slice(0, 10);
  return {
    config: store.config,
    enabledAt: store.ledger.enabledAt,
    daily: store.ledger.daily.date === today ? store.ledger.daily : { date: today, count: 0 },
    pendingCount: entries.filter((e) => e.status === "pending").length,
    failedCount: entries.filter((e) => e.status === "failed").length,
    recent: entries.slice(0, 30)
  };
}
