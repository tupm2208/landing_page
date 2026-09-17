/**
 * @file Schema of the collaborator module — four tables, all prefixed `ctv_`.
 *
 * The running site keeps collaborators in two JSON files (`ctv-accounts.json`,
 * `ctv-commissions.json`) and an append-only log. Here they become tables, because three things
 * need them: finding an account by phone / email / login in one statement, counting the image
 * download log, and not losing data when two people write at the same time.
 *
 * Table and column names are the on-disk contract and stay exactly as they were.
 */

import type { SchemaStep } from "../../contract";

/** Accounts. */
export const ACCOUNT_TABLE = "ctv_tai_khoan";
/** Devices a collaborator logged in from; each must be approved by the shop owner. */
export const DEVICE_TABLE = "ctv_thiet_bi";
/** Live sessions — a row per session so switching an account off kills its sessions at once. */
export const SESSION_TABLE = "ctv_phien";
/** Image download log, one row per download call. */
export const DOWNLOAD_LOG_TABLE = "ctv_nhat_ky_tai";

/** Default reset-link life when config says nothing: 30 minutes. */
export const DEFAULT_RESET_MINUTES = 30;

/** The schema steps the kernel runs at startup (idempotent). */
export const SCHEMA: SchemaStep[] = [
  {
    name: "001-ctv-bon-bang",
    tables: [ACCOUNT_TABLE, DEVICE_TABLE, SESSION_TABLE, DOWNLOAD_LOG_TABLE],
    sql: `
CREATE TABLE IF NOT EXISTS ctv_tai_khoan (
  ma VARCHAR(64) NOT NULL,
  ten VARCHAR(190) NOT NULL DEFAULT '',
  dien_thoai VARCHAR(32) NOT NULL DEFAULT '',
  email VARCHAR(190) NOT NULL DEFAULT '',
  ten_dang_nhap VARCHAR(190) NOT NULL DEFAULT '',
  ma_gioi_thieu VARCHAR(40) NOT NULL DEFAULT '',
  dang_bat TINYINT(1) NOT NULL DEFAULT 1,
  cho_bo_logo TINYINT(1) NOT NULL DEFAULT 0,
  bam_mat_khau VARCHAR(255) NOT NULL DEFAULT '',
  bam_cap_luc DATETIME NULL,
  tao_luc DATETIME NOT NULL,
  sua_luc DATETIME NOT NULL,
  PRIMARY KEY (ma),
  KEY idx_ctv_dien_thoai (dien_thoai),
  KEY idx_ctv_email (email),
  KEY idx_ctv_ma_gioi_thieu (ma_gioi_thieu)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ctv_thiet_bi (
  ma VARCHAR(64) NOT NULL,
  ma_ctv VARCHAR(64) NOT NULL,
  bam_ma_thiet_bi VARCHAR(128) NOT NULL,
  trang_thai VARCHAR(16) NOT NULL DEFAULT 'cho-duyet',
  nhan VARCHAR(190) NOT NULL DEFAULT '',
  trinh_duyet VARCHAR(300) NOT NULL DEFAULT '',
  dia_chi_ip VARCHAR(64) NOT NULL DEFAULT '',
  xin_luc DATETIME NOT NULL,
  duyet_luc DATETIME NULL,
  PRIMARY KEY (ma),
  UNIQUE KEY uq_ctv_thiet_bi (ma_ctv, bam_ma_thiet_bi),
  KEY idx_ctv_thiet_bi_ctv (ma_ctv)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ctv_phien (
  bam_ma_phien VARCHAR(128) NOT NULL,
  ma_ctv VARCHAR(64) NOT NULL,
  ma_thiet_bi VARCHAR(64) NOT NULL DEFAULT '',
  tao_luc DATETIME NOT NULL,
  het_luc DATETIME NOT NULL,
  PRIMARY KEY (bam_ma_phien),
  KEY idx_ctv_phien_ctv (ma_ctv),
  KEY idx_ctv_phien_het (het_luc)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ctv_nhat_ky_tai (
  ma BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ma_ctv VARCHAR(64) NOT NULL,
  ma_hang VARCHAR(128) NOT NULL DEFAULT '',
  so_anh INT NOT NULL DEFAULT 0,
  dia_chi_ip VARCHAR(64) NOT NULL DEFAULT '',
  luc DATETIME NOT NULL,
  PRIMARY KEY (ma),
  KEY idx_ctv_nhat_ky_ctv (ma_ctv, luc)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`
  },
  {
    name: "002-ctv-dat-lai-mat-khau",
    tables: [ACCOUNT_TABLE],
    sql: `
ALTER TABLE ctv_tai_khoan ADD COLUMN bam_ma_dat_lai VARCHAR(128) NOT NULL DEFAULT '';
ALTER TABLE ctv_tai_khoan ADD COLUMN dat_lai_het_luc DATETIME NULL;
`
  }
];
