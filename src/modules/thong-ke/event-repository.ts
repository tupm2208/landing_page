/**
 * @file Every statement that touches `analytics_events`, in one place.
 *
 * The report (`report.ts`) knows how to COUNT; this file knows how the rows are stored. Keeping
 * them apart is what lets the report be tested without a database.
 *
 * Two things to keep in mind when editing:
 *
 * 1. THESE ARE RAW STATEMENTS. `store.rows()` does not escape anything for us, so every value goes
 *    in through `?`. The only things interpolated are integers we computed ourselves (`LIMIT`),
 *    exactly as the order report does (`don-khach/order-repository.ts:591`).
 *
 * 2. THIS IS THE BIGGEST TABLE ON THE SITE (47,323 rows on 15/09/2026, and it only grows). Every
 *    read here is bounded by `created_at >= ?` or by a `LIMIT` — the two exceptions are called out
 *    where they happen.
 */

import type { DataStore, Row } from "../../contract";
import { isoFromMysql, toMysqlDateTime } from "../../shared/mysql-time";
import type {
  AttributionCount, AttributionProductCount, DayEventCount, DayUniqueCount,
  PeriodUniqueCount, ProductCount, ProductRange, RecentEvent, ReportReader
} from "./report";
import { EVENT_TABLE } from "./schema";

/** One event on its way into the table. */
export interface NewEvent {
  event: string;
  productCode: string;
  productName: string;
  visitorId: string;
  sessionId: string;
  path: string;
  referrer: string;
  attributionKey: string;
  attribution: Record<string, unknown>;
  userAgent: string;
  at: Date;
}

const text = (value: unknown): string => String(value ?? "");
const count = (value: unknown): number => Number(value ?? 0) || 0;
/** A positive integer safe to interpolate into a statement. */
const cap = (value: number): number => Math.max(1, Math.trunc(Number(value) || 1));

function parseJson(value: unknown): Record<string, unknown> {
  const raw = String(value ?? "").trim();
  if (raw === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export class EventRepository implements ReportReader {
  constructor(private readonly store: DataStore) {}

  /** Writes one event. The only write in the module. */
  async record(event: NewEvent): Promise<void> {
    await this.store.table(EVENT_TABLE).insert({
      event: event.event,
      product_code: event.productCode,
      product_name: event.productName,
      visitor_id: event.visitorId,
      session_id: event.sessionId,
      path: event.path,
      referrer: event.referrer,
      attribution_key: event.attributionKey,
      attribution_json: JSON.stringify(event.attribution ?? {}),
      user_agent: event.userAgent,
      created_at: toMysqlDateTime(event.at)
    });
  }

  async eventsByDay(since: string): Promise<DayEventCount[]> {
    const rows = await this.store.rows(
      `SELECT DATE(created_at) AS day, event, COUNT(*) AS so_luot
         FROM ${EVENT_TABLE}
        WHERE created_at >= ?
        GROUP BY DATE(created_at), event
        ORDER BY day ASC`,
      [since]
    );
    return rows.map((row: Row) => ({ day: text(row["day"]), event: text(row["event"]), count: count(row["so_luot"]) }));
  }

  async uniquesByDay(since: string): Promise<DayUniqueCount[]> {
    const rows = await this.store.rows(
      `SELECT DATE(created_at) AS day,
              COUNT(DISTINCT NULLIF(visitor_id, '')) AS so_khach,
              COUNT(DISTINCT NULLIF(session_id, '')) AS so_phien
         FROM ${EVENT_TABLE}
        WHERE created_at >= ?
        GROUP BY DATE(created_at)
        ORDER BY day ASC`,
      [since]
    );
    return rows.map((row: Row) => ({
      day: text(row["day"]),
      uniqueVisitors: count(row["so_khach"]),
      sessions: count(row["so_phien"])
    }));
  }

  /**
   * Distinct visitors over the WHOLE window — deliberately its own statement rather than a sum of
   * the daily counts: someone who visits on Monday and Thursday is one visitor, not two.
   */
  async uniquesInPeriod(since: string): Promise<PeriodUniqueCount> {
    const rows = await this.store.rows(
      `SELECT COUNT(DISTINCT NULLIF(visitor_id, '')) AS so_khach,
              COUNT(DISTINCT NULLIF(session_id, '')) AS so_phien
         FROM ${EVENT_TABLE}
        WHERE created_at >= ?`,
      [since]
    );
    const row = rows[0];
    return { uniqueVisitors: count(row?.["so_khach"]), sessions: count(row?.["so_phien"]) };
  }

  /**
   * The product table. NOT bounded by the report window: with no range the screen shows the
   * all-time figures per product, which is what the "Lũy kế" tab asks for. A range narrows it,
   * and `to` covers the whole of that day.
   */
  async products(range: ProductRange | null, limit: number): Promise<ProductCount[]> {
    const conditions = ["product_code <> ''"];
    const params: unknown[] = [];
    if (range?.from) {
      conditions.push("created_at >= ?");
      params.push(`${range.from} 00:00:00`);
    }
    if (range?.to) {
      conditions.push("created_at < DATE_ADD(?, INTERVAL 1 DAY)");
      params.push(`${range.to} 00:00:00`);
    }
    const rows = await this.store.rows(
      `SELECT product_code AS ma,
              MAX(product_name) AS ten,
              SUM(CASE WHEN event = 'product_view' THEN 1 ELSE 0 END) AS xem,
              SUM(CASE WHEN event = 'add_to_cart' THEN 1 ELSE 0 END) AS gio,
              SUM(CASE WHEN event = 'buy_now' THEN 1 ELSE 0 END) AS mua_ngay,
              SUM(CASE WHEN event = 'order_success' THEN 1 ELSE 0 END) AS dat,
              MAX(created_at) AS lan_cuoi
         FROM ${EVENT_TABLE}
        WHERE ${conditions.join(" AND ")}
        GROUP BY product_code
        ORDER BY (gio + mua_ngay * 2 + dat * 3 + xem * 0.1) DESC
        LIMIT ${cap(limit)}`,
      params
    );
    return rows.map((row: Row) => ({
      code: text(row["ma"]),
      name: text(row["ten"]),
      product_view: count(row["xem"]),
      add_to_cart: count(row["gio"]),
      buy_now: count(row["mua_ngay"]),
      order_success: count(row["dat"]),
      lastEventAt: isoFromMysql(row["lan_cuoi"])
    }));
  }

  /**
   * The first day product events were recorded. The screen uses it to warn that a range starting
   * earlier cannot be answered. Unbounded by design (it is a `MIN` over an indexed column).
   */
  async productCoverageFrom(): Promise<string> {
    const rows = await this.store.rows(
      `SELECT DATE(MIN(created_at)) AS tu_ngay FROM ${EVENT_TABLE} WHERE product_code <> ''`
    );
    const value = rows[0]?.["tu_ngay"];
    return value === null || value === undefined ? "" : text(value).slice(0, 10);
  }

  /** The newest events, whatever the window — this is also where `updatedAt` comes from. */
  async recent(limit: number): Promise<RecentEvent[]> {
    const rows = await this.store.rows(
      `SELECT event, created_at, product_code, path, referrer, attribution_json, user_agent
         FROM ${EVENT_TABLE}
        ORDER BY created_at DESC
        LIMIT ${cap(limit)}`
    );
    return rows.map((row: Row) => ({
      event: text(row["event"]),
      at: isoFromMysql(row["created_at"]),
      productCode: text(row["product_code"]),
      path: text(row["path"]),
      referrer: text(row["referrer"]),
      attribution: parseJson(row["attribution_json"]),
      userAgent: text(row["user_agent"])
    }));
  }

  async attribution(since: string): Promise<AttributionCount[]> {
    const rows = await this.store.rows(
      `SELECT attribution_key AS khoa,
              SUBSTRING_INDEX(MAX(CONCAT(created_at, '|', COALESCE(attribution_json, ''))), '|', -1) AS mo_ta,
              SUM(event = 'source_click') AS nhap,
              SUM(event = 'page_view') AS xem_trang,
              SUM(event = 'product_view') AS xem_hang,
              SUM(event = 'add_to_cart') AS gio,
              SUM(event = 'buy_now') AS mua_ngay,
              SUM(event = 'checkout_open') AS mo_thanh_toan,
              SUM(event = 'order_success') AS dat,
              COUNT(DISTINCT NULLIF(visitor_id, '')) AS so_khach,
              COUNT(DISTINCT NULLIF(session_id, '')) AS so_phien,
              MAX(created_at) AS lan_cuoi
         FROM ${EVENT_TABLE}
        WHERE created_at >= ? AND attribution_key <> ''
        GROUP BY attribution_key`,
      [since]
    );
    return rows.map((row: Row) => ({
      key: text(row["khoa"]),
      // The running site took MAX() of the JSON itself, which picks whichever blob sorts highest
      // as a STRING — not the newest. Pairing it with the timestamp first picks the real latest.
      metadata: parseJson(row["mo_ta"]),
      source_click: count(row["nhap"]),
      page_view: count(row["xem_trang"]),
      product_view: count(row["xem_hang"]),
      add_to_cart: count(row["gio"]),
      buy_now: count(row["mua_ngay"]),
      checkout_open: count(row["mo_thanh_toan"]),
      order_success: count(row["dat"]),
      uniqueVisitors: count(row["so_khach"]),
      sessions: count(row["so_phien"]),
      lastEventAt: isoFromMysql(row["lan_cuoi"])
    }));
  }

  async attributionProducts(since: string): Promise<AttributionProductCount[]> {
    const rows = await this.store.rows(
      `SELECT attribution_key AS khoa, product_code AS ma, MAX(product_name) AS ten,
              SUM(event = 'product_view') AS xem,
              SUM(event = 'add_to_cart') AS gio,
              SUM(event = 'buy_now') AS mua_ngay,
              SUM(event = 'order_success') AS dat
         FROM ${EVENT_TABLE}
        WHERE created_at >= ? AND attribution_key <> '' AND product_code <> ''
        GROUP BY attribution_key, product_code`,
      [since]
    );
    return rows.map((row: Row) => ({
      key: text(row["khoa"]),
      code: text(row["ma"]),
      name: text(row["ten"]),
      product_view: count(row["xem"]),
      add_to_cart: count(row["gio"]),
      buy_now: count(row["mua_ngay"]),
      order_success: count(row["dat"])
    }));
  }
}
