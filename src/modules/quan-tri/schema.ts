/**
 * @file Schema of the web admin: the people who log in, their sessions, their devices.
 *
 * Table and column names are on-disk format; step names are recorded in the schema history.
 */

import type { SchemaStep } from "../../contract";
import { loginLockoutTableSql } from "../../shared/login-lockout";

export const PEOPLE_TABLE = "quan_tri_nguoi";
export const SESSIONS_TABLE = "quan_tri_phien";
export const DEVICES_TABLE = "quan_tri_thiet_bi";
export const LOGIN_FAILURES_TABLE = "quan_tri_dang_nhap_sai";

export const SCHEMA: SchemaStep[] = [
  {
    // PEOPLE, not machines (16/09/2026). The running site had ONE admin account for everyone, so
    // nothing said who did what. Each person has their own login; `vai` says whether they may manage
    // other people and devices (`chu-shop`) or only work (`nhan-vien`).
    name: "001-nguoi",
    tables: [PEOPLE_TABLE],
    sql: `
      CREATE TABLE IF NOT EXISTS quan_tri_nguoi (
        ma BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        dang_nhap VARCHAR(190) NOT NULL,
        ten VARCHAR(190) NOT NULL DEFAULT '',
        vai VARCHAR(16) NOT NULL DEFAULT 'nhan-vien',
        bam_mat_khau VARCHAR(255) NOT NULL DEFAULT '',
        bam_cap_luc DATETIME NULL,
        dang_bat TINYINT(1) NOT NULL DEFAULT 1,
        tao_luc DATETIME NOT NULL,
        sua_luc DATETIME NOT NULL,
        PRIMARY KEY (ma),
        UNIQUE KEY uniq_quan_tri_nguoi_dang_nhap (dang_nhap)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `
  },
  {
    // A SESSION IS A ROW. The cookie carries a random token; the table keeps only its hash. Logging
    // out, switching a person off, blocking a device or changing a password deletes rows — and the
    // session is dead on the very next request. The running site's self-signed cookie lived ten
    // years and could not be revoked at all.
    name: "002-phien-va-thiet-bi",
    tables: [SESSIONS_TABLE, DEVICES_TABLE],
    sql: `
      CREATE TABLE IF NOT EXISTS quan_tri_phien (
        bam_token CHAR(64) NOT NULL,
        ma_nguoi BIGINT UNSIGNED NOT NULL,
        ma_may VARCHAR(120) NOT NULL DEFAULT '',
        ip VARCHAR(64) NOT NULL DEFAULT '',
        tao_luc DATETIME NOT NULL,
        het_han DATETIME NOT NULL,
        PRIMARY KEY (bam_token),
        KEY idx_quan_tri_phien_nguoi (ma_nguoi),
        KEY idx_quan_tri_phien_het_han (het_han)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      CREATE TABLE IF NOT EXISTS quan_tri_thiet_bi (
        ma_nguoi BIGINT UNSIGNED NOT NULL,
        ma_may VARCHAR(120) NOT NULL,
        ten_may VARCHAR(190) NOT NULL DEFAULT '',
        -- 'pending' (waiting for the owner) · 'approved' · 'blocked'
        trang_thai VARCHAR(16) NOT NULL DEFAULT 'pending',
        ip VARCHAR(64) NOT NULL DEFAULT '',
        trinh_duyet VARCHAR(255) NOT NULL DEFAULT '',
        lan_dau DATETIME NOT NULL,
        lan_cuoi DATETIME NOT NULL,
        PRIMARY KEY (ma_nguoi, ma_may),
        KEY idx_quan_tri_thiet_bi_trang_thai (trang_thai)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `
  },
  {
    name: "003-dang-nhap-sai",
    tables: [LOGIN_FAILURES_TABLE],
    sql: loginLockoutTableSql(LOGIN_FAILURES_TABLE)
  }
];
