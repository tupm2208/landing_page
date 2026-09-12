// LUOC DO MANG MUA HO — doi tac mua ho, phieu bao da mua, phieu bao het hang.
//
// BAY PHAI GIU (su co ORD-1788854262493 ngay 10/09/2026): phieu bao HET HANG cua doi tac
// truoc day ap lai theo VI TRI DONG trong don, va ap lai moi 15 giay. Thay mot dong don la
// dong khac tut vao dung vi tri do va bi danh "het hang" — khach nhan tin bao sai.
// Ban nay khoa theo MA DONG (`ma_dong`), khong bao gio theo vi tri.

"use strict";

const LUOC_DO = [
  {
    ten: "001-doi-tac",
    bang: ["mua_ho_doi_tac"],
    sql: `
      CREATE TABLE IF NOT EXISTS mua_ho_doi_tac (
        ma VARCHAR(64) NOT NULL,
        ten VARCHAR(190) NOT NULL,
        -- Link rieng cua doi tac. Doi tac mo link nay la vao duoc cong; doi ma la cat quyen.
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
    ten: "002-phieu-mua-va-bao-het",
    bang: ["mua_ho_phieu_mua", "mua_ho_bao_het"],
    sql: `
      CREATE TABLE IF NOT EXISTS mua_ho_phieu_mua (
        ma_phieu VARCHAR(64) NOT NULL,
        ma_doi_tac VARCHAR(64) NOT NULL,
        ma_don VARCHAR(64) NOT NULL DEFAULT '',
        -- MA DONG cua don, KHONG phai vi tri dong (bay 10/09).
        ma_dong VARCHAR(128) NOT NULL DEFAULT '',
        ma_mon VARCHAR(128) NOT NULL DEFAULT '',
        size VARCHAR(64) NOT NULL DEFAULT '',
        so_luong INT NOT NULL DEFAULT 0,
        gia_von DECIMAL(14,2) NOT NULL DEFAULT 0,
        -- Ma lenh do doi tac gui kem: gui lai cung ma thi KHONG ghi hai lan.
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

module.exports = { LUOC_DO };
