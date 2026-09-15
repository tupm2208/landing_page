/**
 * @file The report Sales Desk and OMI read — assembled from counted rows, never from stored totals.
 *
 * Four rules of this file:
 *
 * 1. EVERY NUMBER HAS THREE NAMES. Sales Desk looks up "page views" as `pageViews`, `pageviews`,
 *    `page_view`, `views` or `visits` and takes the first one that is a number (`app.js:7968`).
 *    Note `page_view` — SINGULAR. Answering with only `page_views` shows a zero on a screen that
 *    has data behind it, which is worse than an error. `test/thong-ke.test.mts` pins this.
 *
 * 2. DAYS ARE CUT IN UTC. Not because UTC is right for a seller in Hanoi — it is not, the day turns
 *    at 7am local — but because the 47,323 rows already in the table were cut that way, and because
 *    Sales Desk computes the date range it asks for in UTC too (`app.js:7909`). One consistent
 *    wrong-by-7-hours beats two boundaries that disagree.
 *
 * 3. EVERY DAY IN THE WINDOW IS PRESENT, even with no traffic — a chart with holes in it reads as
 *    a broken report rather than a quiet day.
 *
 * 4. PURE. It takes a reader, so the tests feed rows by hand and what is protected is the WAY OF
 *    COUNTING, not the SQL.
 */

/** Days counted when the caller does not say (or says garbage). */
export const DEFAULT_DAYS = 14;
/** The longest window a caller may ask for — a year and a day. */
export const MAX_DAYS = 366;
export const PRODUCT_LIMIT = 50;
export const RECENT_LIMIT = 50;

/** Events summed into `totals` and into each day row. */
export const COUNTED_EVENTS: readonly string[] = [
  "page_view", "source_click", "product_view", "add_to_cart", "buy_now",
  "checkout_open", "order_submit", "order_success", "filter_change", "gallery_open", "payment_choice"
];

export interface DayEventCount { day: string; event: string; count: number }
export interface DayUniqueCount { day: string; uniqueVisitors: number; sessions: number }
export interface PeriodUniqueCount { uniqueVisitors: number; sessions: number }

export interface ProductCount {
  code: string; name: string;
  product_view: number; add_to_cart: number; buy_now: number; order_success: number;
  lastEventAt: string;
}

export interface AttributionCount {
  key: string;
  metadata: Record<string, unknown>;
  source_click: number; page_view: number; product_view: number; add_to_cart: number;
  buy_now: number; checkout_open: number; order_success: number;
  uniqueVisitors: number; sessions: number;
  lastEventAt: string;
}

export interface AttributionProductCount extends Omit<ProductCount, "lastEventAt"> { key: string }

export interface RecentEvent {
  event: string; at: string; productCode: string; path: string; referrer: string;
  attribution: Record<string, unknown>; userAgent: string;
}

/** A date range for the product table only — `daily` and `attribution` always follow `days`. */
export interface ProductRange { from: string; to: string }

/**
 * Everything the report needs from storage. `since` values are MySQL DATETIME strings in UTC.
 * Split this finely on purpose: each method is one statement, and a test can answer one by hand.
 */
export interface ReportReader {
  eventsByDay(since: string): Promise<DayEventCount[]>;
  uniquesByDay(since: string): Promise<DayUniqueCount[]>;
  /** Distinct visitors/sessions over the WHOLE window — not the sum of the daily counts. */
  uniquesInPeriod(since: string): Promise<PeriodUniqueCount>;
  products(range: ProductRange | null, limit: number): Promise<ProductCount[]>;
  productCoverageFrom(): Promise<string>;
  recent(limit: number): Promise<RecentEvent[]>;
  attribution(since: string): Promise<AttributionCount[]>;
  attributionProducts(since: string): Promise<AttributionProductCount[]>;
}

export interface DayRow extends Record<string, unknown> { day: string }

export interface AnalyticsReport {
  totals: Record<string, number>;
  daily: DayRow[];
  /** The same array under the name Sales Desk looks for first (`app.js:8050`). */
  days: DayRow[];
  products: ProductCount[];
  attribution: Record<string, unknown>[];
  recent: RecentEvent[];
  updatedAt: string;
  productCoverageFrom: string;
  productRange: ProductRange | null;
  soNgay: number;
  tuNgay: string;
  denNgay: string;
  historyAvailable: boolean;
  degraded: boolean;
  storage: string;
}

/** The UTC calendar date of a moment. */
export function dayKey(moment: Date): string {
  return moment.toISOString().slice(0, 10);
}

/** A `YYYY-MM-DD` out of whatever MySQL handed back (a Date, or a string with a time on it). */
export function toDayKey(value: unknown): string {
  if (value instanceof Date) return dayKey(value);
  const text = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : dayKey(parsed);
}

/** Garbage, a negative, or a year of days: clamped to 1..366. */
export function clampDays(days: unknown): number {
  const n = Math.trunc(Number(days));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DAYS;
  return Math.min(n, MAX_DAYS);
}

/** The UTC midnight `days - 1` days before `now` — the first moment of the window. */
export function windowStart(now: Date, days: number): Date {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start;
}

/** Every day of the window, oldest first, none missing. */
export function dayKeysOf(now: Date, days: number): string[] {
  const start = windowStart(now, days);
  const keys: string[] = [];
  for (let i = 0; i < days; i += 1) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + i);
    keys.push(dayKey(day));
  }
  return keys;
}

const num = (source: Record<string, unknown>, key: string): number => Number(source[key] ?? 0) || 0;
const perSession = (views: number, sessions: number): number =>
  sessions > 0 ? Math.round((views / sessions) * 10) / 10 : 0;

/**
 * Writes one measurement under all the names a reader may ask for. This is the file's rule 1, in
 * one place — so a new alias is added once rather than in `totals` and in every day row.
 */
function withAliases(target: Record<string, unknown>, pageViews: number, uniqueVisitors: number, sessions: number): void {
  target["page_view"] = pageViews;
  target["pageViews"] = pageViews;
  target["page_views"] = pageViews;
  target["visits"] = pageViews;
  target["uniqueVisitors"] = uniqueVisitors;
  target["unique_visitors"] = uniqueVisitors;
  target["visitors"] = uniqueVisitors;
  target["sessions"] = sessions;
  target["pages_per_session"] = perSession(pageViews, sessions);
}

export interface ReportOptions {
  reader: ReportReader;
  now: Date;
  days?: number | string | undefined;
  productRange?: ProductRange | null | undefined;
}

/** Builds the whole report for the last `days` days (UTC). */
export async function analyticsReport(
  { reader, now, days = DEFAULT_DAYS, productRange = null }: ReportOptions
): Promise<AnalyticsReport> {
  const dayCount = clampDays(days);
  const keys = dayKeysOf(now, dayCount);
  const since = `${keys[0]} 00:00:00`;

  const [events, uniques, period, products, coverageFrom, recent, attribution, attributionProducts] = await Promise.all([
    reader.eventsByDay(since),
    reader.uniquesByDay(since),
    reader.uniquesInPeriod(since),
    reader.products(productRange, PRODUCT_LIMIT),
    reader.productCoverageFrom(),
    reader.recent(RECENT_LIMIT),
    reader.attribution(since),
    reader.attributionProducts(since)
  ]);

  // Every day present, even an empty one.
  const byDay = new Map<string, Record<string, unknown>>(keys.map((day) => [day, { day }]));
  for (const row of events) {
    const target = byDay.get(toDayKey(row.day));
    if (target && row.event) target[row.event] = Number(row.count ?? 0) || 0;
  }
  const uniquesByDay = new Map<string, DayUniqueCount>();
  for (const row of uniques) uniquesByDay.set(toDayKey(row.day), row);

  const daily: DayRow[] = keys.map((day) => {
    const row = byDay.get(day) ?? { day };
    const seen = uniquesByDay.get(day);
    withAliases(row, num(row, "page_view"), Number(seen?.uniqueVisitors ?? 0), Number(seen?.sessions ?? 0));
    return row as DayRow;
  });

  const totals: Record<string, number> = {};
  for (const event of COUNTED_EVENTS) {
    totals[event] = daily.reduce((sum, row) => sum + num(row, event), 0);
  }
  // Visitors over the window are COUNTED DISTINCT over the window, not summed from the days: a
  // customer who came back on Tuesday is one person, and the running site counted them twice.
  withAliases(totals, totals["page_view"] ?? 0, period.uniqueVisitors, period.sessions);

  const productsByKey = new Map<string, AttributionProductCount[]>();
  for (const row of attributionProducts) {
    const list = productsByKey.get(row.key) ?? [];
    list.push(row);
    productsByKey.set(row.key, list);
  }

  return {
    totals,
    daily,
    days: daily,
    products,
    attribution: attribution.map((row) => ({
      // Metadata first: the counted numbers below must win over anything stored in the JSON blob.
      ...row.metadata,
      key: row.key,
      source_click: row.source_click,
      page_view: row.page_view,
      product_view: row.product_view,
      add_to_cart: row.add_to_cart,
      buy_now: row.buy_now,
      checkout_open: row.checkout_open,
      order_success: row.order_success,
      uniqueVisitors: row.uniqueVisitors,
      sessions: row.sessions,
      products: (productsByKey.get(row.key) ?? []).map(({ key: _key, ...rest }) => rest),
      lastEventAt: row.lastEventAt
    })),
    recent,
    updatedAt: recent[0]?.at ?? "",
    productCoverageFrom: coverageFrom,
    productRange,
    soNgay: dayCount,
    tuNgay: keys[0] ?? "",
    denNgay: keys[keys.length - 1] ?? "",
    // Sales Desk keeps showing its cached numbers when these say the source is unwell
    // (`app.js:45157`). MySQL is the only store now, so having any row at all means healthy.
    historyAvailable: recent.length > 0,
    degraded: false,
    storage: "mysql"
  };
}
