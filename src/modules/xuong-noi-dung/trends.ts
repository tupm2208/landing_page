/**
 * @file THE TREND CARDS — how hot each product line is this week (Desk `content-trend-kit.js`).
 *
 * Xeon researches (`/noi-dung/xu-huong`); the landing keeps the cards and CLAMPS the change: a hot
 * score may move at most ±5 per run in 0–20 (Desk decided 05/08/2026 — one noisy answer must not
 * swing the whole plan). The research runs again when the last run is older than 7 days; the
 * heartbeat (`/api/noi-dung/nhip`) checks that.
 */

import { fold } from "./text-fold";

export const TREND_DOCUMENT = "xuong-noi-dung-xu-huong";
export const TREND_EVERY_DAYS = 7;

export interface TrendCard {
  key: string;
  hang: string;
  dong: string;
  hotScore: number;
  trendStatus: "rising" | "stable" | "cooling";
  trendReason: string;
  story: string;
  styling: string[];
  sampleCaptions: string[];
  confidence: number;
  lastResearchedAt: string;
}

export interface TrendBook {
  version: 1;
  cards: TrendCard[];
  lastRunAt: string;
  lastStatus: "" | "ok" | "partial" | "error" | "skipped";
  lastSummary: string;
  lastError: string;
}

export const defaultTrendBook = (): TrendBook => ({ version: 1, cards: [], lastRunAt: "", lastStatus: "", lastSummary: "", lastError: "" });

/** The model line of a product name: the brand dropped, colour/gender words dropped, first two words kept. */
export function modelLineOf(name: string, brand: string): string {
  const drop = new Set([...fold(brand).split(" "), "giay", "nam", "nu", "unisex", "men", "women", "m", "w", "shoes", "running"]);
  const words = fold(name).split(" ").filter((w) => w !== "" && !drop.has(w) && !/^\d{3,}$/.test(w));
  return words.slice(0, 2).join(" ");
}

export const trendKey = (brand: string, line: string): string => `${fold(brand).replace(/ /g, "-")}-${fold(line).replace(/ /g, "-")}`.replace(/^-+|-+$/g, "");

export interface UniverseLine { key: string; hang: string; dong: string; tenMau: string[]; soMa: number; tongTon: number; giamToiDa: number; codes: string[] }

/** The shop's catalogue grouped into model lines — what Xeon is asked about. Biggest lines first. */
export function buildUniverse(items: { code: string; name: string; brand: string; qty: number; discountPercent: number }[], max = 40): UniverseLine[] {
  const byKey = new Map<string, UniverseLine>();
  for (const item of items) {
    const line = modelLineOf(item.name, item.brand);
    if (line === "") continue;
    const key = trendKey(item.brand, line);
    const entry = byKey.get(key) ?? { key, hang: item.brand, dong: line, tenMau: [], soMa: 0, tongTon: 0, giamToiDa: 0, codes: [] };
    entry.soMa += 1;
    entry.tongTon += item.qty;
    entry.giamToiDa = Math.max(entry.giamToiDa, item.discountPercent);
    entry.codes.push(item.code);
    if (entry.tenMau.length < 4) entry.tenMau.push(item.name);
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort((a, b) => b.tongTon - a.tongTon).slice(0, max);
}

export function clampHot(previous: number | null, requested: number): { value: number; clamped: boolean } {
  const target = Math.max(0, Math.min(20, Math.round(Number(requested) || 0)));
  if (previous === null) return { value: target, clamped: false };
  const value = Math.max(Math.max(0, previous - 5), Math.min(Math.min(20, previous + 5), target));
  return { value, clamped: value !== target };
}

/** Folds Xeon's answer into the book. Returns the new book and what changed. */
export function applyResearch(book: TrendBook, answer: Omit<TrendCard, "lastResearchedAt">[], at: string): { book: TrendBook; updated: number; created: number; clamped: number } {
  const cards = [...book.cards];
  let updated = 0;
  let created = 0;
  let clamped = 0;
  for (const a of answer) {
    const index = cards.findIndex((c) => c.key === a.key);
    const previous = index >= 0 ? cards[index]!.hotScore : null;
    const hot = clampHot(previous, a.hotScore);
    if (hot.clamped) clamped += 1;
    const card: TrendCard = { ...a, hotScore: hot.value, lastResearchedAt: at };
    if (index >= 0) { cards[index] = { ...cards[index]!, ...card, hang: card.hang || cards[index]!.hang, dong: card.dong || cards[index]!.dong }; updated += 1; }
    else { cards.push(card); created += 1; }
  }
  return { book: { ...book, cards }, updated, created, clamped };
}

export function researchDue(book: TrendBook, nowMs: number): boolean {
  const last = Date.parse(book.lastRunAt) || 0;
  return nowMs - last >= TREND_EVERY_DAYS * 24 * 60 * 60 * 1000;
}

/** Hot score per product code, through the code's model line. */
export function hotByCode(book: TrendBook, items: { code: string; name: string; brand: string }[]): Map<string, number> {
  const byKey = new Map(book.cards.map((c) => [c.key, c.hotScore]));
  const out = new Map<string, number>();
  for (const item of items) {
    const hot = byKey.get(trendKey(item.brand, modelLineOf(item.name, item.brand)));
    if (hot !== undefined) out.set(item.code, hot);
  }
  return out;
}
