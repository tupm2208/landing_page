/**
 * @file Time between JavaScript and MySQL — one place converts in both directions.
 *
 * WHY THIS FILE EXISTS (a real bug, found 12/09/2026):
 * MySQL's DATETIME carries no time zone. The store reads with `dateStrings: true`, so an order
 * placed at 10:00 UTC comes back as "2026-09-12 10:00:00". Handing that to `new Date(...)` makes
 * Node read it as 10:00 LOCAL — in Hanoi (UTC+7) that is 03:00 UTC. An order placed a second ago
 * became an order placed SEVEN HOURS ago: the "customer may edit within 15 minutes" window closed
 * at once, and `createdAt` shown to Sales Desk was off by seven hours.
 *
 * So: WRITE in UTC, READ back as UTC. The two must travel together and live only here.
 */

/** A moment as a MySQL DATETIME string in UTC. `ms` keeps the milliseconds. */
export function toMysqlDateTime(moment: Date | string | number, { ms = false } = {}): string {
  const t = moment instanceof Date ? moment : new Date(moment);
  return t.toISOString().slice(0, ms ? 23 : 19).replace("T", " ");
}

/**
 * A DATETIME value from MySQL as a `Date`. A string without a zone is read as UTC — exactly how
 * it was written. Returns `null` when unreadable (never an Invalid Date).
 */
export function fromMysqlDateTime(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  if (!text) return null;
  // Already zoned ("Z" or "+07:00")? Keep it. Otherwise pin it to UTC.
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/.test(text);
  const t = new Date(zoned ? text : `${text.replace(" ", "T")}Z`);
  return Number.isNaN(t.getTime()) ? null : t;
}

/** A DATETIME from MySQL as an ISO string for clients. Empty string when unreadable. */
export function isoFromMysql(value: unknown): string {
  const t = fromMysqlDateTime(value);
  return t ? t.toISOString() : "";
}
