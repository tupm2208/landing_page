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

/** The tables this module owns. */
export const TABLES = {
  items: "hang_kho_mon",
  variants: "hang_kho_bien_the",
  blockedCodes: "hang_kho_ma_chan",
  reservations: "hang_kho_giu_cho",
  movements: "hang_kho_bien_dong",
  receipts: "hang_kho_phieu_nhap",
  receiptLines: "hang_kho_phieu_nhap_dong",
  snapshots: "hang_kho_ban_chup"
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
  },
  {
    // THE STOCK BOOK (16/09/2026) — the warehouse page's adjust / transfer / goods-in, see
    // `stock-ledger.ts`. Movements are append-only; a slip's lines keep the cost it came in at.
    // `ma_vach` / `mau` / `ghi_chu` on a variant: the page edits a barcode, colour and note per size.
    name: "003-so-bien-dong-va-phieu-nhap",
    tables: [TABLES.movements, TABLES.receipts, TABLES.receiptLines, TABLES.variants],
    sql: `
      CREATE TABLE IF NOT EXISTS hang_kho_bien_dong (
        ma BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        ma_mon VARCHAR(128) NOT NULL,
        size VARCHAR(64) NOT NULL DEFAULT '',
        ma_kho VARCHAR(128) NOT NULL DEFAULT '',
        ma_bien_the VARCHAR(128) NOT NULL DEFAULT '',
        -- 'dieu-chinh' | 'nhap' | 'chuyen-di' | 'chuyen-den' | 'hoan-hang'
        loai VARCHAR(32) NOT NULL,
        so_luong INT NOT NULL,
        ton_truoc INT NOT NULL DEFAULT 0,
        ton_sau INT NOT NULL DEFAULT 0,
        ghi_chu VARCHAR(255) NOT NULL DEFAULT '',
        ma_tham_chieu VARCHAR(128) NOT NULL DEFAULT '',
        boi VARCHAR(190) NOT NULL DEFAULT '',
        luc DATETIME(3) NOT NULL,
        PRIMARY KEY (ma),
        KEY idx_hang_kho_bd_mon (ma_mon, luc),
        KEY idx_hang_kho_bd_tham_chieu (ma_tham_chieu)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      CREATE TABLE IF NOT EXISTS hang_kho_phieu_nhap (
        ma VARCHAR(64) NOT NULL,
        nha_cung_cap VARCHAR(190) NOT NULL DEFAULT '',
        ghi_chu VARCHAR(500) NOT NULL DEFAULT '',
        tong_so_luong INT NOT NULL DEFAULT 0,
        tong_tien DECIMAL(16,2) NOT NULL DEFAULT 0,
        boi VARCHAR(190) NOT NULL DEFAULT '',
        tao_luc DATETIME(3) NOT NULL,
        PRIMARY KEY (ma),
        KEY idx_hang_kho_pn_luc (tao_luc)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      CREATE TABLE IF NOT EXISTS hang_kho_phieu_nhap_dong (
        ma_phieu VARCHAR(64) NOT NULL,
        dong INT NOT NULL,
        ma_mon VARCHAR(128) NOT NULL,
        size VARCHAR(64) NOT NULL DEFAULT '',
        ma_kho VARCHAR(128) NOT NULL DEFAULT '',
        so_luong INT NOT NULL DEFAULT 0,
        gia_von DECIMAL(14,2) NOT NULL DEFAULT 0,
        ghi_chu VARCHAR(255) NOT NULL DEFAULT '',
        PRIMARY KEY (ma_phieu, dong)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      ALTER TABLE hang_kho_bien_the
        ADD COLUMN ma_vach VARCHAR(128) NOT NULL DEFAULT '',
        ADD COLUMN mau VARCHAR(128) NOT NULL DEFAULT '',
        ADD COLUMN ghi_chu VARCHAR(255) NOT NULL DEFAULT '',
        ADD KEY idx_hang_kho_bt_ma_vach (ma_vach);
    `
  },
  {
    // HÀNG HOÁ ĐẦY ĐỦ (Đ5, 17/09/2026) — Sales Desk's landingproducts + catalog editor.
    //   item: division ("Nhóm hàng"), SEO title / description / keywords, policy, the web content
    //         of the product page (JSON), and the MANUAL PRICE next to the SOURCE PRICE;
    //   variant: SKU and cost price per size, and the price the SOURCE wrote (`gia` is what sells).
    // Rule (Desk `applyLandingManualPricePolicy`): a manual price sells only while it is not below
    // the source price; `gia_nguon` keeps the source number so "về giá nguồn" can put it back.
    name: "004-sku-gia-von-seo-gia-tay",
    tables: [TABLES.items, TABLES.variants],
    sql: `
      ALTER TABLE hang_kho_mon
        ADD COLUMN nhom_hang VARCHAR(190) NOT NULL DEFAULT '',
        ADD COLUMN seo_tieu_de VARCHAR(255) NOT NULL DEFAULT '',
        ADD COLUMN seo_mo_ta VARCHAR(500) NOT NULL DEFAULT '',
        ADD COLUMN seo_tu_khoa VARCHAR(500) NOT NULL DEFAULT '',
        ADD COLUMN chinh_sach TEXT NULL,
        ADD COLUMN noi_dung_web_json LONGTEXT NULL,
        ADD COLUMN gia_tay DECIMAL(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN gia_nguon DECIMAL(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN gia_tay_luc DATETIME(3) NULL;

      ALTER TABLE hang_kho_bien_the
        ADD COLUMN ma_sku VARCHAR(128) NOT NULL DEFAULT '',
        ADD COLUMN gia_von DECIMAL(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN gia_nguon DECIMAL(14,2) NOT NULL DEFAULT 0,
        ADD KEY idx_hang_kho_bt_sku (ma_sku);

      UPDATE hang_kho_bien_the SET gia_nguon = gia WHERE gia_nguon = 0;
    `
  },
  {
    // UNDO of catalogue edits (Đ5): one "lần" = one action (save one item, a quick-edit batch,
    // back to source price...), one row per item it touched, holding the rows BEFORE the action
    // (`truoc_json` NULL = the item did not exist, so undo removes it). Desk kept this stack in
    // the browser; here it survives a restart and every OMI machine sees the same stack.
    name: "005-ban-chup-hoan-tac",
    tables: [TABLES.snapshots],
    sql: `
      CREATE TABLE IF NOT EXISTS hang_kho_ban_chup (
        ma BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        lan VARCHAR(64) NOT NULL,
        nhan VARCHAR(255) NOT NULL DEFAULT '',
        ma_mon VARCHAR(128) NOT NULL,
        truoc_json LONGTEXT NULL,
        boi VARCHAR(190) NOT NULL DEFAULT '',
        luc DATETIME(3) NOT NULL,
        hoan_tac_luc DATETIME(3) NULL,
        PRIMARY KEY (ma),
        KEY idx_hang_kho_bc_lan (lan),
        KEY idx_hang_kho_bc_con (hoan_tac_luc, ma)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `
  }
];
