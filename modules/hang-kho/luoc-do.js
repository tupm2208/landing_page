// LUOC DO CUA MANG HANG HOA — anh Dung chot 12/09/2026: "dua het ve mysql, thiet ke chuan".
//
// THIET KE CHUAN O DAY NGHIA LA GI:
//
// Ban dang chay giu danh muc trong MOT tep JSON 14 MB, va gop "campaign doi tac" + "hang co
// san" vao luc DOC (ba ham merge chay moi lan co ai mo web). Hai cai gia phai tra:
//   - Image Tool day danh muc len = ghi lai ca 14 MB. Doc mot mon = nap ca 14 MB roi loc.
//   - Ba nguon hang nam ba cho, gop lai bang ma — lech mot dong la khong ai biet.
//
// Ban nay: MOT dong = MOT bien the co that (mon + size + kho). Hang nha, hang campaign va
// hang co san deu la dong trong CUNG mot bang, chi khac cot `nguon`. Nho vay:
//   - "con size 42 khong" la mot cau lenh SELECT, khong phai nap 14 MB
//   - khong con ba ham gop nao de lech nhau
//   - dong bo hang co san chi dung toi dong cua chinh no, khong dung toi hang nha
//
// Ten bang bat dau bang `hang_kho_` — luat cua khung: nhin ten bang la biet chu.

"use strict";

const LUOC_DO = [
  {
    ten: "001-mon-va-bien-the",
    bang: ["hang_kho_mon", "hang_kho_bien_the"],
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
        -- 'own' hang nha | 'campaign' hang chien dich doi tac | 'ready' hang co san
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
    ten: "002-ma-chan-va-giu-cho",
    bang: ["hang_kho_ma_chan", "hang_kho_giu_cho"],
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

module.exports = { LUOC_DO };
