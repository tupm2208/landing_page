/**
 * @file "KHO MÃ" — which products deserve a post first, and the buying angles a post can take.
 *
 * Ported from Sales Desk `content_priority_kit.js` (12–13/09/2026). The pool is ranked by a
 * PRIORITY SCORE 0–100, not by "never posted": what customers care about (sold for real, engaged on
 * past posts, a hot line this week), what is a real deal (discount the customer sees), and whether
 * it can keep selling (sizes, pictures). Two FACTORS pull a score down without hiding the product:
 * posted in the last 72 hours (at most −25 %), and nearly sold out (one size left −45 %).
 *
 * The signals Desk read from its own stores come here from the landing's modules: sales from
 * `don-khach`, engagement from `dang-bai` jobs, the hot score from the trend cards. Desk's chat
 * interest and web-intent weights have no source on this landing yet and weigh zero.
 */

import { fold } from "./text-fold";

const DAY_MS = 24 * 60 * 60 * 1000;
export const RECENT_COOLDOWN_HOURS = 72;
export const ANGLE_REPEAT_DAYS = 14;

/** Desk `CONTENT_BUY_ANGLES`: why a customer buys. Keywords are multi-word on purpose (see Desk note 12/09). */
export const BUY_ANGLES: readonly { id: string; label: string; guide: string; keywords: string[] }[] = [
  { id: "nguoi_moi", label: "Người mới bắt đầu", guide: "Khách chưa tập bao giờ, sợ chọn sai. Nói dễ hiểu, không thuật ngữ, chốt một lựa chọn an toàn.", keywords: ["người mới", "mới tập", "bắt đầu chạy", "đôi đầu tiên", "chưa biết chọn"] },
  { id: "nang_can", label: "Người nặng cân", guide: "Trên 75 kg, cần đệm dày và đầm, đỡ gối.", keywords: ["nặng cân", "trên 75 kg", "trên 80 kg", "người to con", "giảm cân"] },
  { id: "chan_be", label: "Chân bè, chân bẹt, phom rộng", guide: "Nói về bề ngang mũi, phom rộng, chọn size.", keywords: ["chân bè", "chân bẹt", "phom rộng", "bản wide", "bó ngang"] },
  { id: "chay_giai", label: "Tập cho giải", guide: "Mục tiêu 21 km hoặc 42 km, cần đôi ngày đua và đôi tập dài.", keywords: ["chạy giải", "21km", "42km", "marathon", "ngày đua", "bài tốc độ"] },
  { id: "di_lam_kiem", label: "Vừa đi làm vừa tập", guide: "Một đôi dùng cả ngày: đi làm, đi bộ, chạy nhẹ. Ưu tiên dáng gọn và bền.", keywords: ["đi làm", "văn phòng", "công sở", "đi học", "đi bộ nhiều"] },
  { id: "gia_mem", label: "Tối ưu tiền", guide: "Món đáng tiền nhất trong tầm giá, nói rõ được gì và mất gì khi trả ít hơn.", keywords: ["giá mềm", "tầm giá", "đáng tiền", "tiết kiệm", "sinh viên"] },
  { id: "qua_tang", label: "Mua làm quà", guide: "Người mua không phải người dùng: chọn size an toàn, đổi được, dáng dễ hợp.", keywords: ["quà tặng", "làm quà", "tặng bạn", "tặng người yêu", "sinh nhật"] },
  { id: "phoi_do", label: "Phối đồ, đi chơi", guide: "Dáng và màu lên đồ thế nào, hợp outfit nào, đi chơi cả ngày có êm không.", keywords: ["phối đồ", "đi chơi", "lên đồ", "thời trang", "street style"] }
];

export function detectAngle(value: string): string {
  const haystack = ` ${fold(value)} `;
  let best = "";
  let bestScore = 0;
  for (const angle of BUY_ANGLES) {
    let score = 0;
    for (const kw of angle.keywords) if (haystack.includes(` ${fold(kw)} `)) score += fold(kw).split(" ").length;
    if (score > bestScore) { bestScore = score; best = angle.id; }
  }
  return best;
}

export function angleOf(id: string): { id: string; label: string; guide: string } | null {
  return BUY_ANGLES.find((a) => a.id === id) ?? null;
}

/** One pool row — the catalogue item as the ranking sees it. */
export interface PoolRow {
  code: string;
  name: string;
  brand: string;
  category: string;
  salePrice: number;
  listPrice: number;
  discountPercent: number;
  sizeCount: number;
  imageCount: number;
  galleryReady: boolean;
}

/** Signals from other modules, already folded per code. */
export interface PriorityIndex {
  nowMs: number;
  salesQty: Map<string, number>;
  engagement: Map<string, { total: number; posts: number }>;
  lastPostedAt: Map<string, number>;
  /** Hot score 0–20 from the trend cards, per code. */
  hot: Map<string, number>;
  /** Angles used per code with when — to steer away from repeating an angle within 14 days. */
  angles: Map<string, { angle: string; at: number }[]>;
}

export const emptyIndex = (nowMs: number): PriorityIndex => ({ nowMs, salesQty: new Map(), engagement: new Map(), lastPostedAt: new Map(), hot: new Map(), angles: new Map() });

const normalize = (value: number, max: number): number => (max > 0 && value > 0 ? Math.min(1, Math.sqrt(value / max)) : 0);

export interface Scored { score: number; reasons: string[]; hot: boolean }

/** Weights sum to 100: sales 30, discount 25, engagement 15, trend 15, supply 15. */
export function priorityScore(row: PoolRow, index: PriorityIndex): Scored {
  let maxSales = 0;
  for (const q of index.salesQty.values()) maxSales = Math.max(maxSales, q);
  let maxEng = 0;
  for (const e of index.engagement.values()) maxEng = Math.max(maxEng, e.total);

  const sold = index.salesQty.get(row.code) ?? 0;
  const eng = index.engagement.get(row.code);
  const hot = index.hot.get(row.code) ?? 0;
  const salesPart = 30 * normalize(sold, maxSales);
  const engagementPart = 15 * normalize(eng?.total ?? 0, maxEng);
  const trendPart = 15 * Math.min(1, hot / 20);
  const seenPct = Math.max(0, row.discountPercent || (row.listPrice > row.salePrice && row.salePrice > 0 ? (1 - row.salePrice / row.listPrice) * 100 : 0));
  const discountPart = 25 * Math.min(1, seenPct / 60);
  const supplyPart = 15 * (0.7 * Math.min(1, row.sizeCount / 12) + 0.3 * (row.galleryReady ? 1 : Math.min(1, row.imageCount / 5)));
  const stockFactor = row.sizeCount <= 1 ? 0.55 : row.sizeCount === 2 ? 0.75 : row.sizeCount <= 4 ? 0.9 : 1;
  const lastAt = index.lastPostedAt.get(row.code) ?? 0;
  const hoursSince = lastAt ? (index.nowMs - lastAt) / 3_600_000 : Infinity;
  const cooldownFactor = hoursSince >= RECENT_COOLDOWN_HOURS ? 1 : 1 - 0.25 * (1 - Math.max(0, hoursSince) / RECENT_COOLDOWN_HOURS);
  const score = Math.max(0, (salesPart + engagementPart + trendPart + discountPart + supplyPart) * stockFactor * cooldownFactor);

  const reasons: string[] = [];
  if (sold > 0) reasons.push(`bán ${sold} đôi 30 ngày`);
  if (eng && eng.total > 0) reasons.push(`tương tác ${eng.total} qua ${eng.posts} bài`);
  if (hot > 0) reasons.push(`xu hướng ${hot}/20`);
  if (seenPct > 0) reasons.push(`giảm ${Math.round(seenPct)}%`);
  if (stockFactor < 1) reasons.push(`chỉ còn ${row.sizeCount} size`);
  if (cooldownFactor < 1) reasons.push(`vừa lên bài ${Math.round(hoursSince)} giờ trước`);
  return { score: Math.round(score * 10) / 10, reasons, hot: salesPart >= 15 || engagementPart + trendPart >= 12 };
}

/** Angles not used for this code in the last 14 days (to write a used code from a new side). */
export function freeAngles(code: string, index: PriorityIndex): string[] {
  const since = index.nowMs - ANGLE_REPEAT_DAYS * DAY_MS;
  const used = new Set((index.angles.get(code) ?? []).filter((a) => a.at >= since).map((a) => a.angle));
  return BUY_ANGLES.filter((a) => !used.has(a.id)).map((a) => a.id);
}

export interface PoolFilter { query?: string; brand?: string; category?: string; gallery?: boolean; fresh?: boolean }

export function rankPool(rows: PoolRow[], index: PriorityIndex, filter: PoolFilter = {}): (PoolRow & { priorityScore: number; priorityReasons: string[]; isHotProduct: boolean; neverPosted: boolean })[] {
  const q = fold(filter.query ?? "");
  return rows
    .filter((r) => (q === "" || fold(`${r.code} ${r.name}`).includes(q))
      && (!filter.brand || r.brand === filter.brand)
      && (!filter.category || r.category === filter.category)
      && (!filter.gallery || r.galleryReady)
      && (!filter.fresh || !index.lastPostedAt.has(r.code)))
    .map((r) => {
      const s = priorityScore(r, index);
      return { ...r, priorityScore: s.score, priorityReasons: s.reasons, isHotProduct: s.hot, neverPosted: !index.lastPostedAt.has(r.code) };
    })
    .sort((a, b) => b.priorityScore - a.priorityScore || b.sizeCount - a.sizeCount);
}
