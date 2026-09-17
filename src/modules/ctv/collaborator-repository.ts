/**
 * @file Repository over the four `ctv_*` tables: accounts, devices, sessions, download log.
 *
 * Hides SQL and column names from the route handlers so the rules of the module (device
 * approval, session re-check, no hash ever leaving the server) read as prose in `module.ts`.
 * Column names are the on-disk contract and stay Vietnamese; the JSON shapes returned by
 * `publicView`/`deviceView`/`downloadView` are wire format read by OMI and the collaborator page.
 */

import type { DataStore, Row, Where } from "../../contract";
import { isoFromMysql, toMysqlDateTime } from "../../shared/mysql-time";
import { ACCOUNT_TABLE, DEVICE_TABLE, DOWNLOAD_LOG_TABLE, SESSION_TABLE } from "./schema";

/** Status values of a device row. */
export const DEVICE_STATUS = { pending: "cho-duyet", approved: "da-duyet", blocked: "bi-chan" } as const;
export type DeviceStatus = (typeof DEVICE_STATUS)[keyof typeof DEVICE_STATUS];

/** The outward shape of an account. NEVER includes the password hash. */
export interface CollaboratorView {
  ma: string;
  ten: string;
  dienThoai: string;
  email: string;
  tenDangNhap: string;
  maGioiThieu: string;
  dangBat: boolean;
  choBoLogo: boolean;
  coMatKhau: boolean;
  /** Commission rate: "5%" of each line, or a fixed amount per pair; empty = none. */
  hoaHongMacDinh: string;
  taoLuc: string;
}

/** The outward shape of a device row (admin screen). */
export interface DeviceView {
  ma: string;
  maCtv: string;
  trangThai: string;
  nhan: string;
  trinhDuyet: string;
  diaChiIp: string;
  xinLuc: string;
  duyetLuc: string;
}

/** The outward shape of a download-log row (admin screen). */
export interface DownloadView {
  maCtv: string;
  maHang: string;
  soAnh: number;
  diaChiIp: string;
  luc: string;
}

/** A device request as written on first login from an unknown machine. */
export interface NewDevice {
  ma: string;
  ma_ctv: string;
  bam_ma_thiet_bi: string;
  nhan: string;
  trinh_duyet: string;
  dia_chi_ip: string;
  xin_luc: string;
}

/** A session row as written on a successful login. */
export interface NewSession {
  bam_ma_phien: string;
  ma_ctv: string;
  ma_thiet_bi: string;
  tao_luc: string;
  het_luc: string;
}

/** A download-log row. */
export interface NewDownload {
  ma_ctv: string;
  ma_hang: string;
  so_anh: number;
  dia_chi_ip: string;
  luc: string;
}

/** Outward view of an account row. The hash is reduced to "has a password: yes/no". */
export function publicView(row: Row = {}): CollaboratorView {
  return {
    ma: String(row["ma"] ?? ""),
    ten: String(row["ten"] ?? ""),
    dienThoai: String(row["dien_thoai"] ?? ""),
    email: String(row["email"] ?? ""),
    tenDangNhap: String(row["ten_dang_nhap"] ?? ""),
    maGioiThieu: String(row["ma_gioi_thieu"] ?? ""),
    dangBat: Number(row["dang_bat"] ?? 1) === 1,
    choBoLogo: Number(row["cho_bo_logo"] ?? 0) === 1,
    coMatKhau: String(row["bam_mat_khau"] ?? "") !== "",
    hoaHongMacDinh: String(row["hoa_hong_mac_dinh"] ?? ""),
    taoLuc: isoFromMysql(row["tao_luc"])
  };
}

/** Outward view of a device row. */
export function deviceView(row: Row): DeviceView {
  return {
    ma: String(row["ma"]), maCtv: String(row["ma_ctv"]), trangThai: String(row["trang_thai"]),
    nhan: String(row["nhan"] || ""), trinhDuyet: String(row["trinh_duyet"] || ""),
    diaChiIp: String(row["dia_chi_ip"] || ""), xinLuc: isoFromMysql(row["xin_luc"]), duyetLuc: isoFromMysql(row["duyet_luc"])
  };
}

/** Outward view of a download-log row. */
export function downloadView(row: Row): DownloadView {
  return {
    maCtv: String(row["ma_ctv"]), maHang: String(row["ma_hang"]), soAnh: Number(row["so_anh"] || 0),
    diaChiIp: String(row["dia_chi_ip"] || ""), luc: isoFromMysql(row["luc"])
  };
}

/** Data access for the collaborator module. One instance per request is fine: it holds only the store. */
export class CollaboratorRepository {
  constructor(private readonly store: DataStore) {}

  // ---- accounts ------------------------------------------------------------------------------

  /** The account row with this id, enabled or not. */
  findAccount(id: string): Promise<Row | null> {
    return this.store.table(ACCOUNT_TABLE).one({ ma: id });
  }

  /** The ENABLED account with this id — what a session must resolve to. */
  findEnabledAccount(id: string): Promise<Row | null> {
    return this.store.table(ACCOUNT_TABLE).one({ ma: id, dang_bat: 1 });
  }

  /**
   * The enabled account matching a login string: user name, email (both case-insensitive) or
   * the digits of a phone number. One statement, so the three lookups cost one round trip.
   */
  async findEnabledByLogin(login: string, phoneDigits: string): Promise<Row | null> {
    const rows = await this.store.rows(
      `SELECT * FROM ${ACCOUNT_TABLE} WHERE dang_bat = 1 AND (LOWER(ten_dang_nhap) = ? OR LOWER(email) = ? OR dien_thoai = ?) LIMIT 1`,
      [login, login, phoneDigits]
    );
    return rows[0] ?? null;
  }

  /** Every account, by name. */
  listAccounts(): Promise<Row[]> {
    return this.store.table(ACCOUNT_TABLE).find({ orderBy: "ten asc" });
  }

  /** Inserts or replaces one account row (the whole row is given). */
  async saveAccount(row: Row): Promise<void> {
    await this.store.table(ACCOUNT_TABLE).upsert(row);
  }

  // ---- devices -------------------------------------------------------------------------------

  /** The device of this collaborator with this hashed device id. */
  findDeviceByHash(collaboratorId: string, deviceHash: string): Promise<Row | null> {
    return this.store.table(DEVICE_TABLE).one({ ma_ctv: collaboratorId, bam_ma_thiet_bi: deviceHash });
  }

  /** The device row with this id. */
  findDevice(id: string): Promise<Row | null> {
    return this.store.table(DEVICE_TABLE).one({ ma: id });
  }

  /** Every device, newest request first. */
  listDevices(): Promise<Row[]> {
    return this.store.table(DEVICE_TABLE).find({ orderBy: "xin_luc desc" });
  }

  /** Records a device asking for approval. Upsert: the (collaborator, hash) pair is unique. */
  async requestDevice(device: NewDevice): Promise<void> {
    await this.store.table(DEVICE_TABLE).upsert({ ...device, trang_thai: DEVICE_STATUS.pending });
  }

  /** Approves or blocks a device, stamping the decision time. */
  async setDeviceStatus(id: string, status: DeviceStatus, decidedAt: string): Promise<void> {
    await this.store.table(DEVICE_TABLE).update({ ma: id }, { trang_thai: status, duyet_luc: decidedAt });
  }

  // ---- sessions ------------------------------------------------------------------------------

  /** The session row for this hashed session id. */
  findSession(sessionHash: string): Promise<Row | null> {
    return this.store.table(SESSION_TABLE).one({ bam_ma_phien: sessionHash });
  }

  /** Opens a session. */
  async insertSession(session: NewSession): Promise<void> {
    await this.store.table(SESSION_TABLE).insert({ ...session });
  }

  /** Ends the sessions matching `where` (one session, all of an account, all of a device). */
  async deleteSessions(where: Where): Promise<void> {
    await this.store.table(SESSION_TABLE).delete(where);
  }

  // ---- download log --------------------------------------------------------------------------

  /** Appends one download to the log. */
  async logDownload(entry: NewDownload): Promise<void> {
    await this.store.table(DOWNLOAD_LOG_TABLE).insert({ ...entry });
  }

  /** Newest downloads first, optionally of one collaborator, at most `limit` rows. */
  listDownloads(collaboratorId: string, limit: number): Promise<Row[]> {
    const where: Where = {};
    if (collaboratorId) where["ma_ctv"] = collaboratorId;
    return this.store.table(DOWNLOAD_LOG_TABLE).find({ where, orderBy: "luc desc", limit });
  }

  // ---- password reset ------------------------------------------------------------------------

  /** The ENABLED account with this email (case-insensitive). */
  async findByEmail(email: string): Promise<Row | null> {
    const rows = await this.store.rows(
      `SELECT * FROM ${ACCOUNT_TABLE} WHERE dang_bat = 1 AND LOWER(email) = ? LIMIT 1`,
      [email.toLowerCase()]
    );
    return rows[0] ?? null;
  }

  /** Stores a hashed reset token with an expiry on an account. */
  async setResetToken(opts: { id: string; tokenHash: string; expiresAt: Date; now: Date }): Promise<void> {
    await this.store.table(ACCOUNT_TABLE).update(
      { ma: opts.id },
      { bam_ma_dat_lai: opts.tokenHash, dat_lai_het_luc: toMysqlDateTime(opts.expiresAt), sua_luc: toMysqlDateTime(opts.now) }
    );
  }

  /** The ENABLED account whose reset-token hash matches and has not expired. */
  async findByResetToken(tokenHash: string, now: Date): Promise<Row | null> {
    const rows = await this.store.rows(
      `SELECT * FROM ${ACCOUNT_TABLE} WHERE dang_bat = 1 AND bam_ma_dat_lai = ? AND dat_lai_het_luc > ? LIMIT 1`,
      [tokenHash, toMysqlDateTime(now)]
    );
    return rows[0] ?? null;
  }

  /** Updates the password hash and clears the reset token. */
  async setPassword(opts: { id: string; passwordHash: string; now: Date }): Promise<void> {
    await this.store.table(ACCOUNT_TABLE).update(
      { ma: opts.id },
      { bam_mat_khau: opts.passwordHash, bam_cap_luc: toMysqlDateTime(opts.now), bam_ma_dat_lai: "", dat_lai_het_luc: null, sua_luc: toMysqlDateTime(opts.now) }
    );
  }

  /** Deletes all sessions of one collaborator. */
  async deleteSessionsOf(collaboratorId: string): Promise<void> {
    await this.store.table(SESSION_TABLE).delete({ ma_ctv: collaboratorId });
  }
}
