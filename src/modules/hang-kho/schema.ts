/**
 * @file The catalogue schema — Mr Dũng decided 12/09/2026: "everything to MySQL, designed properly".
 *
 * WHAT "DESIGNED PROPERLY" MEANS HERE:
 *
 * The old site kept the catalogue in ONE 14 MB JSON file and merged "partner campaigns" and
 * "ready stock" into it at READ time (three merge functions ran every time someone opened the
 * web). Two prices were paid for that:
 *   - Image Tool pushing the catalogue = rewriting all 14 MB. Reading one item = loading 14 MB and filtering.
 *   - Three stock sources lived in three places, merged by code — one line off and nobody knew.
 *
 * This version: ONE row = ONE real variant (item + size + warehouse). House stock, campaign stock
 * and ready stock are all rows in the SAME table, differing only in the `nguon` column. Hence:
 *   - "is size 42 in stock" is one SELECT, not a 14 MB load
 *   - there are no merge functions left to drift apart
 *   - syncing ready stock touches only its own rows, never the house catalogue
 *
 * Table names start with `hang_kho_` — the kernel's rule: the table name says who owns it.
 * Names and columns are on-disk contract and stay Vietnamese.
 */

import type { SchemaStep } from "../../contract";

/** The four tables this module owns. */
export const TABLES = {
  items: "hang_kho_mon",
  variants: "hang_kho_bien_the",
  blockedCodes: "hang_kho_ma_chan",
  reservations: "hang_kho_giu_cho"
} as const;

/** The schema steps, run once each by the store's schema history. */
export const SCHEMA: SchemaStep[] = [
  {
    name: "001-mon-va-bien-the",
    tables: [TABLES.items, TABLES.variants],
    sql: `
      CREATE TABLE IF NOT EXISTS hang_kho_mon (
        ma VARCHAR(128) NOT NULL,
        ma_goc VARCHAR(128) NOT NULL DEFAULT '',
        ten VARCHAR(255) NOT NULL,
        hang VARCHAR(190) NOT NULL DEFAULT '',
        loai VARCHAR(190) NOT NULL DEFAULT '',
        nhom VARCHAR(190) NOT NULL DEFAULT '',
        gioi_tinh VARCHAR(64) NOT NULL DEFAULT '',
        duong_dan VARCHAR(255) NOT NULL DEFAULT '',
        gia_niem_yet DECIMAL(14,2) NOT NULL DEFAULT 0,
        phan_tram_giam INT NOT NULL DEFAULT 0,
        trang_thai VARCHAR(32) NOT NULL DEFAULT 'orderable',
        vi_sao_an VARCHAR(190) NOT NULL DEFAULT '',
        anh_dai_dien VARCHAR(500) NOT NULL DEFAULT '',
        anh_lon VARCHAR(500) NOT NULL DEFAULT '',
        anh_khac_json LONGTEXT NULL,
        mo_ta_ngan TEXT NULL,
        mo_ta TEXT NULL,
        uu_tien_kho_json TEXT NULL,
        nguon VARCHAR(32) NOT NULL DEFAULT 'own',
        ten_nguon VARCHAR(190) NOT NULL DEFAULT '',
        sua_luc DATETIME(3) NOT NULL,
        PRIMARY KEY (ma),
        KEY idx_hang_kho_mon_ten (ten(100)),
        KEY idx_hang_kho_mon_hang (hang),
        KEY idx_hang_kho_mon_trang_thai (trang_thai)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      CREATE TABLE IF NOT EXISTS hang_kho_bien_the (
        ma_bien_the VARCHAR(128) NOT NULL,
        ma_mon VARCHAR(128) NOT NULL,
        size VARCHAR(64) NOT NULL DEFAULT '',
        ma_kho VARCHAR(128) NOT NULL DEFAULT '',
        ton INT NOT NULL DEFAULT 0,
        gia DECIMAL(14,2) NOT NULL DEFAULT 0,
        gia_niem_yet DECIMAL(14,2) NOT NULL DEFAULT 0,
        thu_tu_kho INT NOT NULL DEFAULT 2147483647,
        -- 'own' house stock | 'campaign' partner campaign stock | 'ready' ready stock
        nguon VARCHAR(32) NOT NULL DEFAULT 'own',
        ma_chien_dich VARCHAR(128) NOT NULL DEFAULT '',
        ma_dong_doi_tac VARCHAR(128) NOT NULL DEFAULT '',
        sua_luc DATETIME(3) NOT NULL,
        PRIMARY KEY (ma_bien_the),
        KEY idx_hang_kho_bt_mon (ma_mon),
        KEY idx_hang_kho_bt_mon_size (ma_mon, size),
        KEY idx_hang_kho_bt_nguon (nguon),
        KEY idx_hang_kho_bt_con (ma_mon, ton)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `
  },
  {
    name: "002-ma-chan-va-giu-cho",
    tables: [TABLES.blockedCodes, TABLES.reservations],
    sql: `
      CREATE TABLE IF NOT EXISTS hang_kho_ma_chan (
        ma VARCHAR(128) NOT NULL,
        vi_sao VARCHAR(255) NOT NULL DEFAULT '',
        them_luc DATETIME(3) NOT NULL,
        PRIMARY KEY (ma)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      CREATE TABLE IF NOT EXISTS hang_kho_giu_cho (
        ma_phieu VARCHAR(64) NOT NULL,
        ma_bien_the VARCHAR(128) NOT NULL,
        ma_mon VARCHAR(128) NOT NULL DEFAULT '',
        size VARCHAR(64) NOT NULL DEFAULT '',
        so_luong INT NOT NULL DEFAULT 1,
        cua_ai VARCHAR(190) NOT NULL DEFAULT '',
        giu_luc DATETIME(3) NOT NULL,
        het_han_luc DATETIME(3) NOT NULL,
        PRIMARY KEY (ma_phieu),
        KEY idx_hang_kho_giu_bt (ma_bien_the, het_han_luc),
        KEY idx_hang_kho_giu_han (het_han_luc)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `
  }
];
