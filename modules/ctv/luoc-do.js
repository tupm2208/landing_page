// LUOC DO MANH CONG TAC VIEN — bon bang, deu mang tien to `ctv_`.
//
// Ban dang chay giu CTV trong hai tep JSON (`ctv-accounts.json`, `ctv-commissions.json`) va mot
// tep nhat ky dong (`partner-scan-log.jsonl` cho viec khac). O day len bang, vi ba viec can no:
// tim tai khoan theo so dien thoai / email / ten dang nhap trong mot cau lenh, dem nhat ky tai
// anh, va khong mat du lieu khi hai nguoi ghi cung luc.

"use strict";

const LUOC_DO = [
  {
    ten: "001-ctv-bon-bang",
    bang: ["ctv_tai_khoan", "ctv_thiet_bi", "ctv_phien", "ctv_nhat_ky_tai"],
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
  }
];

module.exports = { LUOC_DO };
