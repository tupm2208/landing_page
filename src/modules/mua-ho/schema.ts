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
import { loginLockoutTableSql } from "../../shared/login-lockout";

export const PARTNERS_TABLE = "mua_ho_doi_tac";
export const PURCHASES_TABLE = "mua_ho_phieu_mua";
export const STOCK_OUTS_TABLE = "mua_ho_bao_het";
export const PACKING_TABLE = "mua_ho_dong_goi";
export const LEDGER_TABLE = "mua_ho_so_tien";
export const SHIPMENT_REQUESTS_TABLE = "mua_ho_xin_van_don";
export const LOGIN_FAILURES_TABLE = "mua_ho_dang_nhap_sai";

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
  },
  {
    // THE PARTNER LOGS IN LIKE A PERSON (15/09/2026). Until now the portal code in the private link
    // WAS the credential: anyone who saw the link was the partner, and a leaked link could only be
    // revoked by minting a new one. Partners now get a login and a password, hashed exactly like a
    // collaborator's (`shared/password.ts`, PBKDF2-SHA256) — the portal code stays as the address of
    // their page, not as the proof of who they are.
    //
    // Both columns are added EMPTY: a partner without a password set cannot log in with one, and the
    // shop fills it in from OMI. Nothing that works today stops working when this step runs.
    //
    // `dang_nhap` IS NULL, NOT `NOT NULL DEFAULT ''`. Two names must never collide, so the column is
    // UNIQUE — and MySQL allows many NULLs in a unique index but only ONE empty string. With a `''`
    // default the SECOND partner who has no account yet would be refused. Of the eight real partners
    // four have no password; they must all sit here quietly until the shop gives them one.
    name: "003-doi-tac-dang-nhap",
    tables: [PARTNERS_TABLE],
    sql: `
      ALTER TABLE mua_ho_doi_tac
        ADD COLUMN dang_nhap VARCHAR(190) NULL DEFAULT NULL,
        ADD COLUMN bam_mat_khau VARCHAR(255) NOT NULL DEFAULT '',
        ADD COLUMN bam_cap_luc DATETIME NULL,
        ADD UNIQUE KEY uniq_mua_ho_doi_tac_dang_nhap (dang_nhap);
    `
  },
  {
    // PACKING, keyed by ORDER + PARTNER. The old site kept this inside the order document
    // (`partnerPackingStatuses[partnerId]`), which is why two partners on one order overwrote each
    // other's state. A row per (order, partner) cannot do that.
    //
    // The orders table is NOT touched: Orders owns it, and a shipping module writing into it is
    // exactly the coupling the split removed.
    name: "004-dong-goi",
    tables: [PACKING_TABLE],
    sql: `
      CREATE TABLE IF NOT EXISTS mua_ho_dong_goi (
        ma_don VARCHAR(64) NOT NULL,
        ma_doi_tac VARCHAR(64) NOT NULL,
        trang_thai VARCHAR(32) NOT NULL DEFAULT 'chua_dong',
        boi VARCHAR(190) NOT NULL DEFAULT '',
        sua_luc DATETIME(3) NOT NULL,
        PRIMARY KEY (ma_don, ma_doi_tac),
        KEY idx_mua_ho_dong_goi_doi_tac (ma_doi_tac, sua_luc)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `
  },
  {
    // WHAT THE SHOP OWES THE PARTNER. A partner is paid a fee per pair and/or per order (`cach_tinh`
    // says which), the shop transfers money now and then, and the odd extra cost is agreed on top.
    //
    // The fee RATE lives on the partner; what is OWED is never stored — it is counted from the
    // purchase slips every time it is shown. A stored total goes stale the moment a slip is undone,
    // and then two screens disagree about money, which is the one thing nobody forgives.
    name: "005-tien-cong",
    tables: [PARTNERS_TABLE, LEDGER_TABLE],
    sql: `
      ALTER TABLE mua_ho_doi_tac
        ADD COLUMN cong_moi_mon DECIMAL(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN cong_moi_don DECIMAL(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN cach_tinh VARCHAR(16) NOT NULL DEFAULT 'ca-hai';

      CREATE TABLE IF NOT EXISTS mua_ho_so_tien (
        ma VARCHAR(64) NOT NULL,
        ma_doi_tac VARCHAR(64) NOT NULL,
        -- 'tra' = the shop transferred money; 'phat_sinh' = an extra cost agreed with the partner.
        loai VARCHAR(16) NOT NULL DEFAULT 'tra',
        so_tien DECIMAL(14,2) NOT NULL DEFAULT 0,
        ghi_chu VARCHAR(255) NOT NULL DEFAULT '',
        boi VARCHAR(190) NOT NULL DEFAULT '',
        tao_luc DATETIME(3) NOT NULL,
        PRIMARY KEY (ma),
        KEY idx_mua_ho_so_tien_doi_tac (ma_doi_tac, tao_luc)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `
  },
  {
    // THE SYSTEM PRICE ON THE SLIP (16/09/2026). The portal compares what the partner paid with what
    // the system said the pair costs ("Khớp giá" / "Lệch"). Only the paid price was stored, so every
    // slip showed "Khớp". Old slips keep 0 and fall back to the paid price.
    name: "006-phieu-gia-he-thong",
    tables: [PURCHASES_TABLE],
    sql: `
      ALTER TABLE mua_ho_phieu_mua
        ADD COLUMN gia_he_thong DECIMAL(14,2) NOT NULL DEFAULT 0;
    `
  },
  {
    // OUT OF STOCK PER PARTNER (16/09/2026). The key was the line alone, so when a second partner
    // reported the same line their row overwrote the first — and the first partner's report, the
    // one that says "this shop has none", was gone.
    name: "007-bao-het-theo-doi-tac",
    tables: [STOCK_OUTS_TABLE],
    sql: `
      ALTER TABLE mua_ho_bao_het
        DROP PRIMARY KEY,
        ADD PRIMARY KEY (ma_dong, ma_doi_tac);
    `
  },
  {
    // A WAYBILL REQUEST THAT IS STILL CREATING, OR FAILED (16/09/2026). Without it a failure showed
    // once as a toast and was gone: the shipment tab had no red row, no "Thử tạo lại", and a double
    // tap could ask the carrier twice. One row per order — the last word wins.
    name: "008-xin-van-don",
    tables: [SHIPMENT_REQUESTS_TABLE],
    sql: `
      CREATE TABLE IF NOT EXISTS mua_ho_xin_van_don (
        ma_don VARCHAR(64) NOT NULL,
        ma_doi_tac VARCHAR(64) NOT NULL,
        dang_tao TINYINT(1) NOT NULL DEFAULT 0,
        loi VARCHAR(500) NOT NULL DEFAULT '',
        luc DATETIME(3) NOT NULL,
        PRIMARY KEY (ma_don),
        KEY idx_mua_ho_xin_van_don_doi_tac (ma_doi_tac)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `
  },
  {
    // WRONG PASSWORDS (16/09/2026). The running site locked a login for 15 minutes after 5 misses
    // from one address; the port only had a route rate limit, which a patient guesser sits under.
    // A table, not memory: hosting restarts the process and may run two of them.
    name: "009-dang-nhap-sai",
    tables: [LOGIN_FAILURES_TABLE],
    sql: loginLockoutTableSql(LOGIN_FAILURES_TABLE)
  },
  {
    // Đ4 (17/09/2026) — TELEGRAM + EMAIL of a partner, and a ledger line that can be CORRECTED.
    //
    // A wrong transfer is never deleted: it is VOIDED (`huy_luc` + reason) so the history still
    // shows what was typed and who undid it — Desk's `voidedAt`. An edit keeps who and when.
    name: "010-doi-tac-telegram-va-sua-so-tien",
    tables: [PARTNERS_TABLE, LEDGER_TABLE],
    sql: `
      ALTER TABLE mua_ho_doi_tac
        ADD COLUMN telegram_chat_id VARCHAR(64) NOT NULL DEFAULT '',
        ADD COLUMN email VARCHAR(190) NOT NULL DEFAULT '';

      ALTER TABLE mua_ho_so_tien
        ADD COLUMN sua_luc DATETIME(3) NULL,
        ADD COLUMN sua_boi VARCHAR(190) NOT NULL DEFAULT '',
        ADD COLUMN huy_luc DATETIME(3) NULL,
        ADD COLUMN ly_do_huy VARCHAR(255) NOT NULL DEFAULT '';
    `
  }
];

/** Document holding the partner POLICIES the bot reads (Desk's Settings → "Chính sách đối tác"). */
export const POLICIES_DOCUMENT = "mua-ho-chinh-sach";
