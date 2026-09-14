/**
 * @file Schema of the Purchasing feature: partners, purchase slips, out-of-stock reports.
 *
 * TRAP TO KEEP (incident ORD-1788854262493, 10/09/2026): a partner's OUT-OF-STOCK report used to
 * be applied by the LINE'S POSITION in the order, and re-applied every 15 seconds. Removing one
 * line let another line slide into that position and be marked "out of stock" — the customer got
 * a wrong message. This version keys by LINE ID (`ma_dong`), never by position.
 *
 * Table and column names are on-disk format; step names are recorded in the schema history.
 */

import type { SchemaStep } from "../../contract";

export const PARTNERS_TABLE = "mua_ho_doi_tac";
export const PURCHASES_TABLE = "mua_ho_phieu_mua";
export const STOCK_OUTS_TABLE = "mua_ho_bao_het";

export const SCHEMA: SchemaStep[] = [
  {
    name: "001-doi-tac",
    tables: [PARTNERS_TABLE],
    sql: `
      CREATE TABLE IF NOT EXISTS mua_ho_doi_tac (
        ma VARCHAR(64) NOT NULL,
        ten VARCHAR(190) NOT NULL,
        -- The partner's private link. Opening it enters the portal; changing it revokes access.
        ma_cong VARCHAR(128) NOT NULL,
        trang_thai VARCHAR(32) NOT NULL DEFAULT 'active',
        dien_thoai VARCHAR(32) NOT NULL DEFAULT '',
        tinh VARCHAR(190) NOT NULL DEFAULT '',
        huyen VARCHAR(190) NOT NULL DEFAULT '',
        xa VARCHAR(190) NOT NULL DEFAULT '',
        dia_chi_chi_tiet VARCHAR(255) NOT NULL DEFAULT '',
        sua_luc DATETIME(3) NOT NULL,
        PRIMARY KEY (ma),
        UNIQUE KEY uniq_mua_ho_doi_tac_cong (ma_cong),
        KEY idx_mua_ho_doi_tac_trang_thai (trang_thai)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `
  },
  {
    name: "002-phieu-mua-va-bao-het",
    tables: [PURCHASES_TABLE, STOCK_OUTS_TABLE],
    sql: `
      CREATE TABLE IF NOT EXISTS mua_ho_phieu_mua (
        ma_phieu VARCHAR(64) NOT NULL,
        ma_doi_tac VARCHAR(64) NOT NULL,
        ma_don VARCHAR(64) NOT NULL DEFAULT '',
        -- The order LINE ID, NOT the line position (trap of 10/09).
        ma_dong VARCHAR(128) NOT NULL DEFAULT '',
        ma_mon VARCHAR(128) NOT NULL DEFAULT '',
        size VARCHAR(64) NOT NULL DEFAULT '',
        so_luong INT NOT NULL DEFAULT 0,
        gia_von DECIMAL(14,2) NOT NULL DEFAULT 0,
        -- Command id sent by the partner: the same id again is NOT written twice.
        ma_lenh VARCHAR(128) NOT NULL DEFAULT '',
        ghi_chu VARCHAR(255) NOT NULL DEFAULT '',
        tao_luc DATETIME(3) NOT NULL,
        PRIMARY KEY (ma_phieu),
        UNIQUE KEY uniq_mua_ho_phieu_lenh (ma_doi_tac, ma_lenh),
        KEY idx_mua_ho_phieu_doi_tac (ma_doi_tac, tao_luc),
        KEY idx_mua_ho_phieu_don (ma_don)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      CREATE TABLE IF NOT EXISTS mua_ho_bao_het (
        ma_dong VARCHAR(128) NOT NULL,
        ma_doi_tac VARCHAR(64) NOT NULL,
        ma_don VARCHAR(64) NOT NULL DEFAULT '',
        ma_mon VARCHAR(128) NOT NULL DEFAULT '',
        size VARCHAR(64) NOT NULL DEFAULT '',
        ly_do VARCHAR(255) NOT NULL DEFAULT '',
        bao_luc DATETIME(3) NOT NULL,
        PRIMARY KEY (ma_dong),
        KEY idx_mua_ho_bao_het_don (ma_don)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `
  }
];
