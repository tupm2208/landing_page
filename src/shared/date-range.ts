/**
 * @file A "từ ngày – đến ngày" window as the seller types it (Đ4, 17/09/2026).
 *
 * The seller thinks in LOCAL calendar days (Vietnam, +07:00). "Đến 17/09" means up to the end of
 * the 17th in Hanoi, not 17/09 00:00 UTC — the second quietly drops a whole working day. Both
 * money screens (Tài chính, công nợ đối tác) read their window through here so they agree.
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface DateWindow {
  /** Inclusive start, or `null` = from the beginning. */
  from: Date | null;
  /** Exclusive end, or `null` = until now. */
  to: Date | null;
}

/** Start of a local day `YYYY-MM-DD` as a UTC moment. `null` for anything else. */
export function startOfLocalDay(day: unknown, offsetMinutes = 7 * 60): Date | null {
  const m = DAY.exec(String(day ?? "").trim());
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - offsetMinutes * 60 * 1000;
  return Number.isNaN(t) ? null : new Date(t);
}

/** The window of two typed days; either side may be empty. `denNgay` is included whole. */
export function dateWindow(tuNgay: unknown, denNgay: unknown, offsetMinutes = 7 * 60): DateWindow {
  const from = startOfLocalDay(tuNgay, offsetMinutes);
  const end = startOfLocalDay(denNgay, offsetMinutes);
  return { from, to: end ? new Date(end.getTime() + 24 * 60 * 60 * 1000) : null };
}

/** Is a moment (ISO, MySQL DATETIME in UTC, or Date) inside the window? Unreadable = outside unless the window is open. */
export function inWindow(value: unknown, window: DateWindow): boolean {
  if (window.from === null && window.to === null) return true;
  const raw = value instanceof Date ? value : String(value ?? "").trim();
  if (raw === "") return false;
  const text = raw instanceof Date ? "" : raw;
  const t = raw instanceof Date ? raw : new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(text) ? text : `${text.replace(" ", "T")}Z`);
  if (Number.isNaN(t.getTime())) return false;
  if (window.from && t < window.from) return false;
  if (window.to && t >= window.to) return false;
  return true;
}
