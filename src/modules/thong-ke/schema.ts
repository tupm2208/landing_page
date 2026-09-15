/**
 * @file Schema of the web-analytics module — ONE table, `analytics_events`.
 *
 * The name does NOT carry the module prefix (`thong_ke_`) on purpose: this table already exists on
 * the running landing with 47,323 rows (04/07 → 15/09/2026) and Image Tool reads it directly. It is
 * declared in `inheritedTables` instead, exactly as Đơn hàng does with `orders`.
 *
 * Columns are VERBATIM from the running site (`chua-cat/server.js:4799`), including the two the
 * shared `api/schema.sql` forgot — `attribution_key` and `attribution_json`. They carry the Facebook
 * comment-link tracing: dropping them would make the "Hiệu quả comment link" table empty forever.
 *
 * One row per event. No aggregate is ever stored: every number in a report is counted from here, so
 * a wrong report can always be traced back to the rows that made it.
 */

import type { SchemaStep } from "../../contract";

/** One row per browser event. Inherited from the running site — the name is the contract. */
export const EVENT_TABLE = "analytics_events";

/**
 * The schema steps the kernel runs at startup (idempotent).
 *
 * NOTE: no `;` may appear inside a string literal here — the store splits statements on it
 * (`mysql-store.ts:42`), because the driver runs with `multipleStatements` off.
 */
export const SCHEMA: SchemaStep[] = [
  {
    name: "001-thong-ke-su-kien",
    tables: [EVENT_TABLE],
    sql: `
CREATE TABLE IF NOT EXISTS analytics_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event VARCHAR(48) NOT NULL,
  product_code VARCHAR(80) NOT NULL DEFAULT '',
  product_name VARCHAR(190) NOT NULL DEFAULT '',
  visitor_id VARCHAR(128) NOT NULL DEFAULT '',
  session_id VARCHAR(128) NOT NULL DEFAULT '',
  path VARCHAR(255) NOT NULL DEFAULT '',
  referrer VARCHAR(500) NOT NULL DEFAULT '',
  attribution_key VARCHAR(160) NOT NULL DEFAULT '',
  attribution_json TEXT NULL,
  user_agent VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_analytics_events_created (created_at),
  KEY idx_analytics_events_event_created (event, created_at),
  KEY idx_analytics_events_product (product_code, created_at),
  KEY idx_analytics_events_visitor (visitor_id, created_at),
  KEY idx_analytics_events_session (session_id, created_at),
  KEY idx_analytics_events_attribution (attribution_key, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`
  }
];
