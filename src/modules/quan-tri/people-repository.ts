/**
 * @file Repository over the web admin's tables — people, sessions, devices.
 *
 * The password hash is read by exactly two methods (`forLogin`, `passwordHashOf`); every list goes
 * through `personOf`, which cannot carry it.
 */

import crypto from "node:crypto";
import type { DataStore, Row } from "../../contract";
import { fromMysqlDateTime, isoFromMysql, toMysqlDateTime } from "../../shared/mysql-time";
import { hashToken } from "../../shared/password";
import { DEVICES_TABLE, PEOPLE_TABLE, SESSIONS_TABLE } from "./schema";

export const OWNER = "chu-shop";
export const STAFF = "nhan-vien";
export type PersonRole = typeof OWNER | typeof STAFF;

export const DEVICE_PENDING = "pending";
export const DEVICE_APPROVED = "approved";
export const DEVICE_BLOCKED = "blocked";

/** A person as every screen sees one — never with the hash. */
export interface Person {
  id: string;
  login: string;
  name: string;
  role: PersonRole;
  active: boolean;
  createdAt: string;
}

export interface Device {
  personId: string;
  login: string;
  id: string;
  name: string;
  status: string;
  ip: string;
  userAgent: string;
  firstSeen: string;
  lastSeen: string;
}

const s = (v: unknown): string => String(v ?? "");

function personOf(row: Row): Person {
  return {
    id: s(row["ma"]), login: s(row["dang_nhap"]), name: s(row["ten"]) || s(row["dang_nhap"]),
    role: s(row["vai"]) === OWNER ? OWNER : STAFF,
    active: Number(row["dang_bat"] ?? 1) === 1,
    createdAt: isoFromMysql(row["tao_luc"])
  };
}

/** A login name as stored: trimmed, lower case. */
export function normaliseLogin(login: unknown): string {
  return s(login).trim().toLowerCase().slice(0, 190);
}

/** The ONLY session token format: 32 random bytes. The table keeps its SHA-256. */
export function newSessionToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export class PeopleRepository {
  constructor(private readonly store: DataStore) {}

  // ---- people ----

  async countPeople(): Promise<number> {
    return this.store.table(PEOPLE_TABLE).count();
  }

  async list(): Promise<Person[]> {
    const rows = await this.store.table(PEOPLE_TABLE).find({
      orderBy: "ma asc", columns: ["ma", "dang_nhap", "ten", "vai", "dang_bat", "tao_luc"]
    });
    return rows.map(personOf);
  }

  async byId(id: string): Promise<Person | null> {
    const row = await this.store.table(PEOPLE_TABLE).one({ ma: String(id || "") });
    return row ? personOf(row) : null;
  }

  async byLogin(login: string): Promise<Person | null> {
    const row = await this.store.table(PEOPLE_TABLE).one({ dang_nhap: normaliseLogin(login) });
    return row ? personOf(row) : null;
  }

  /** The person trying to log in, WITH the hash — only the login route calls this. */
  async forLogin(login: string): Promise<(Person & { passwordHash: string }) | null> {
    const name = normaliseLogin(login);
    if (!name) return null;
    const row = await this.store.table(PEOPLE_TABLE).one({ dang_nhap: name });
    return row ? { ...personOf(row), passwordHash: s(row["bam_mat_khau"]) } : null;
  }

  async passwordHashOf(id: string): Promise<string> {
    const row = await this.store.table(PEOPLE_TABLE).one({ ma: String(id) });
    return s(row?.["bam_mat_khau"]);
  }

  /** How many ACTIVE owners there are — the last one may not be switched off or demoted. */
  async activeOwners(): Promise<number> {
    return this.store.table(PEOPLE_TABLE).count({ vai: OWNER, dang_bat: 1 });
  }

  async create(input: { login: string; name: string; role: PersonRole; passwordHash: string; now: Date }): Promise<string> {
    const at = toMysqlDateTime(input.now);
    const result = await this.store.table(PEOPLE_TABLE).insert({
      dang_nhap: normaliseLogin(input.login), ten: input.name.slice(0, 190), vai: input.role,
      bam_mat_khau: input.passwordHash, bam_cap_luc: at, dang_bat: 1, tao_luc: at, sua_luc: at
    });
    return s(result.insertId);
  }

  async update(id: string, patch: { name?: string; role?: PersonRole; active?: boolean; passwordHash?: string }, now: Date): Promise<void> {
    const at = toMysqlDateTime(now);
    const values: Row = { sua_luc: at };
    if (patch.name !== undefined) values["ten"] = patch.name.slice(0, 190);
    if (patch.role !== undefined) values["vai"] = patch.role;
    if (patch.active !== undefined) values["dang_bat"] = patch.active ? 1 : 0;
    if (patch.passwordHash !== undefined) { values["bam_mat_khau"] = patch.passwordHash; values["bam_cap_luc"] = at; }
    await this.store.table(PEOPLE_TABLE).update({ ma: String(id) }, values);
  }

  // ---- sessions ----

  async createSession(input: { personId: string; token: string; deviceId: string; ip: string; now: Date; lifetimeMs: number }): Promise<void> {
    await this.store.table(SESSIONS_TABLE).insert({
      bam_token: hashToken(input.token), ma_nguoi: input.personId, ma_may: input.deviceId.slice(0, 120), ip: input.ip.slice(0, 64),
      tao_luc: toMysqlDateTime(input.now), het_han: toMysqlDateTime(new Date(input.now.getTime() + input.lifetimeMs))
    });
  }

  /** The live session behind a token: the person must still be ACTIVE and the device not blocked. */
  async personBySession(token: string, now: Date): Promise<(Person & { deviceId: string }) | null> {
    if (!token) return null;
    const rows = await this.store.rows(
      `SELECT p.ma, p.dang_nhap, p.ten, p.vai, p.dang_bat, p.tao_luc, s.ma_may, s.het_han
         FROM \`${SESSIONS_TABLE}\` s JOIN \`${PEOPLE_TABLE}\` p ON p.ma = s.ma_nguoi
        WHERE s.bam_token = ? LIMIT 1`,
      [hashToken(token)]
    );
    const row = rows[0];
    if (!row) return null;
    const expires = fromMysqlDateTime(row["het_han"]);
    if (!expires || expires.getTime() <= now.getTime()) return null;
    const person = personOf(row);
    return person.active ? { ...person, deviceId: s(row["ma_may"]) } : null;
  }

  async deleteSession(token: string): Promise<void> {
    if (token) await this.store.table(SESSIONS_TABLE).delete({ bam_token: hashToken(token) });
  }

  /** Ends every session of a person, optionally keeping the one in use. */
  async deleteSessionsOf(personId: string, keepToken = ""): Promise<number> {
    if (!keepToken) return this.store.table(SESSIONS_TABLE).delete({ ma_nguoi: String(personId) });
    const result = await this.store.execute(
      `DELETE FROM \`${SESSIONS_TABLE}\` WHERE ma_nguoi = ? AND bam_token <> ?`, [String(personId), hashToken(keepToken)]);
    return result.affectedRows;
  }

  async deleteSessionsOfDevice(personId: string, deviceId: string): Promise<void> {
    await this.store.table(SESSIONS_TABLE).delete({ ma_nguoi: String(personId), ma_may: String(deviceId) });
  }

  // ---- devices ----

  async device(personId: string, deviceId: string): Promise<Device | null> {
    const row = await this.store.table(DEVICES_TABLE).one({ ma_nguoi: String(personId), ma_may: String(deviceId) });
    return row ? this.deviceOf(row, "") : null;
  }

  async approvedDevicesOf(personId: string): Promise<number> {
    return this.store.table(DEVICES_TABLE).count({ ma_nguoi: String(personId), trang_thai: DEVICE_APPROVED });
  }

  /** First sight of a device writes it; later sights only move `lan_cuoi`. */
  async touchDevice(input: { personId: string; deviceId: string; name: string; ip: string; userAgent: string; status: string; now: Date }): Promise<void> {
    const at = toMysqlDateTime(input.now);
    const table = this.store.table(DEVICES_TABLE);
    const existing = await table.one({ ma_nguoi: input.personId, ma_may: input.deviceId });
    if (existing) {
      await table.update({ ma_nguoi: input.personId, ma_may: input.deviceId }, {
        lan_cuoi: at, ip: input.ip.slice(0, 64), ...(input.name ? { ten_may: input.name.slice(0, 190) } : {})
      });
      return;
    }
    await table.insert({
      ma_nguoi: input.personId, ma_may: input.deviceId, ten_may: input.name.slice(0, 190), trang_thai: input.status,
      ip: input.ip.slice(0, 64), trinh_duyet: input.userAgent.slice(0, 255), lan_dau: at, lan_cuoi: at
    });
  }

  async setDeviceStatus(personId: string, deviceId: string, status: string): Promise<number> {
    return this.store.table(DEVICES_TABLE).update({ ma_nguoi: String(personId), ma_may: String(deviceId) }, { trang_thai: status });
  }

  async deleteDevice(personId: string, deviceId: string): Promise<number> {
    return this.store.table(DEVICES_TABLE).delete({ ma_nguoi: String(personId), ma_may: String(deviceId) });
  }

  async listDevices(): Promise<Device[]> {
    const rows = await this.store.rows(
      `SELECT d.*, p.dang_nhap FROM \`${DEVICES_TABLE}\` d LEFT JOIN \`${PEOPLE_TABLE}\` p ON p.ma = d.ma_nguoi ORDER BY d.lan_cuoi DESC LIMIT 500`
    );
    return rows.map((row) => this.deviceOf(row, s(row["dang_nhap"])));
  }

  private deviceOf(row: Row, login: string): Device {
    return {
      personId: s(row["ma_nguoi"]), login, id: s(row["ma_may"]), name: s(row["ten_may"]), status: s(row["trang_thai"]),
      ip: s(row["ip"]), userAgent: s(row["trinh_duyet"]),
      firstSeen: isoFromMysql(row["lan_dau"]), lastSeen: isoFromMysql(row["lan_cuoi"])
    };
  }

  /** Housekeeping: sessions past their end. */
  async deleteExpiredSessions(now: Date): Promise<number> {
    const result = await this.store.execute(`DELETE FROM \`${SESSIONS_TABLE}\` WHERE het_han <= ?`, [toMysqlDateTime(now)]);
    return result.affectedRows;
  }
}
