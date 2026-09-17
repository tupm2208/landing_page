/**
 * @file Wrong passwords in a row lock a login for a while — one rule for every door where a person
 * types a password (partner portal, web admin).
 *
 * The running site locked a login for 15 minutes after 5 misses from one address. A route rate
 * limit alone does not do that: a patient guesser sits under it forever. The count lives in a
 * TABLE, not in memory — hosting restarts the process and may run two of them.
 *
 * The key is `<ip>|<login>`: a guesser behind one address cannot lock the real person out of
 * their own phone.
 */

import type { DataStore } from "../contract";
import { fromMysqlDateTime, toMysqlDateTime } from "./mysql-time";

export const MAX_LOGIN_FAILURES = 5;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;

/** The `CREATE TABLE` of a lockout table. Each module owns its own (table prefixes are per module). */
export function loginLockoutTableSql(table: string): string {
  return `
    CREATE TABLE IF NOT EXISTS ${table} (
      khoa VARCHAR(255) NOT NULL,
      so_lan INT NOT NULL DEFAULT 0,
      dau_luc DATETIME(3) NOT NULL,
      khoa_den DATETIME(3) NULL,
      PRIMARY KEY (khoa)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
}

export class LoginLockout {
  constructor(private readonly store: DataStore, private readonly table: string) {}

  /** Until when this key is locked, or `null`. */
  async lockedUntil(key: string, now: Date): Promise<Date | null> {
    const row = await this.store.table(this.table).one({ khoa: key.slice(0, 255) });
    const until = row ? fromMysqlDateTime(row["khoa_den"]) : null;
    return until && until.getTime() > now.getTime() ? until : null;
  }

  /** Counts one wrong password; the fifth inside the window locks the key. */
  async recordFailure(key: string, now: Date): Promise<void> {
    const table = this.store.table(this.table);
    const id = key.slice(0, 255);
    const row = await table.one({ khoa: id });
    const firstAt = row ? fromMysqlDateTime(row["dau_luc"]) : null;
    const fresh = !firstAt || now.getTime() - firstAt.getTime() > LOGIN_LOCK_MS;
    const count = fresh ? 1 : Number(row?.["so_lan"] || 0) + 1;
    await table.upsert({
      khoa: id, so_lan: count,
      dau_luc: toMysqlDateTime(fresh || !firstAt ? now : firstAt, { ms: true }),
      khoa_den: count >= MAX_LOGIN_FAILURES ? toMysqlDateTime(new Date(now.getTime() + LOGIN_LOCK_MS), { ms: true }) : null
    });
  }

  /** A good login forgets the failures. */
  async clear(key: string): Promise<void> {
    await this.store.table(this.table).delete({ khoa: key.slice(0, 255) });
  }

  /** "Thử lại sau N phút." */
  static minutesLeft(until: Date, now: Date): number {
    return Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60000));
  }
}
