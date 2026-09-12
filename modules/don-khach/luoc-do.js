// LUOC DO BA BANG DON HANG — `orders`, `order_items`, `order_status_logs`.
//
// Ba bang nay KE THUA tu ban dang chay: doi ten chung la gay Sales Desk va Image Tool, nen
// chung khong theo luat tien to `don_khach_`. Cot va kieu cot lay Y NGUYEN tu `api/schema.sql`
// cua ban dang chay — mot cot lech kieu la mot lan nhap du lieu that bi cat mat chu.
//
// KHAC MOT DIEU so voi ban dang chay, va la co y: KHONG co rang buoc khoa ngoai sang
// `customers`, `customer_addresses`, `warehouses`.
//
// Vi sao: ba bang do thuoc manh khac (Tai khoan khach, Kho hang). Mot nha ban hang co the
// khong mua manh Tai khoan khach — khi do bang `customers` khong ton tai, va mot khoa ngoai
// tro sang no lam ca bang don khong tao duoc. Rang buoc giua hai manh phai la viec cua ma
// (`canDichVu`), khong phai viec cua MySQL. Cot `customer_id` van giu de du lieu that nhap
// sang khong mat, chi la khong co rang buoc cung.
//
// Truoc 12/09/2026 khong co tep nay: bang don chi ton tai vi bai kiem tra tu tao no. Tuc la
// tren mot may moi, ban tach khoi dong xong roi do ngay o don dau tien.

"use strict";

const LUOC_DO = [
  {
    ten: "001-ba-bang-don",
    bang: ["orders", "order_items", "order_status_logs"],
    sql: `
CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(64) NOT NULL,
  customer_id BIGINT UNSIGNED NULL,
  customer_address_id BIGINT UNSIGNED NULL,
  customer_name VARCHAR(190) NOT NULL DEFAULT '',
  phone VARCHAR(32) NOT NULL DEFAULT '',
  email VARCHAR(190) NOT NULL DEFAULT '',
  address VARCHAR(500) NOT NULL DEFAULT '',
  province VARCHAR(190) NOT NULL DEFAULT '',
  district VARCHAR(190) NOT NULL DEFAULT '',
  ward VARCHAR(190) NOT NULL DEFAULT '',
  address_detail VARCHAR(255) NOT NULL DEFAULT '',
  note TEXT NULL,
  total DECIMAL(14,2) NOT NULL DEFAULT 0,
  status VARCHAR(48) NOT NULL DEFAULT 'pending',
  payment_status VARCHAR(48) NOT NULL DEFAULT 'payment_pending',
  payment_method VARCHAR(64) NOT NULL DEFAULT '',
  payment_provider VARCHAR(64) NOT NULL DEFAULT '',
  payment_reference VARCHAR(128) NOT NULL DEFAULT '',
  payment_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  order_lookup_token_hash VARCHAR(128) NULL,
  stock_reservation_id VARCHAR(128) NULL,
  stock_reservation_json LONGTEXT NULL,
  stock_reserved_at DATETIME NULL,
  stock_restored_at DATETIME NULL,
  fulfillment_status VARCHAR(48) NOT NULL DEFAULT 'not_assigned',
  warehouse_id BIGINT UNSIGNED NULL,
  shipping_provider VARCHAR(100) NOT NULL DEFAULT '',
  tracking_code VARCHAR(100) NOT NULL DEFAULT '',
  shipping_shipments_json LONGTEXT NULL,
  can_cancel_until DATETIME NULL,
  cancelled_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_orders_created_at (created_at),
  KEY idx_orders_phone (phone),
  KEY idx_orders_email (email),
  KEY idx_orders_lookup_token (order_lookup_token_hash),
  KEY idx_orders_status (status),
  KEY idx_orders_customer (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id VARCHAR(64) NOT NULL,
  line_no INT NOT NULL DEFAULT 1,
  product_code VARCHAR(128) NOT NULL DEFAULT '',
  variant_id VARCHAR(128) NOT NULL DEFAULT '',
  product_name VARCHAR(255) NOT NULL DEFAULT '',
  size VARCHAR(64) NOT NULL DEFAULT '',
  quantity INT NOT NULL DEFAULT 1,
  price DECIMAL(14,2) NOT NULL DEFAULT 0,
  sale_file_price DECIMAL(14,2) NOT NULL DEFAULT 0,
  source VARCHAR(64) NOT NULL DEFAULT '',
  source_name VARCHAR(190) NOT NULL DEFAULT '',
  warehouse_id VARCHAR(128) NOT NULL DEFAULT '',
  warehouse_name VARCHAR(190) NOT NULL DEFAULT '',
  image_url VARCHAR(500) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY idx_order_items_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_status_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id VARCHAR(64) NOT NULL,
  status VARCHAR(48) NOT NULL,
  actor_type VARCHAR(32) NOT NULL DEFAULT 'system',
  actor_id VARCHAR(128) NOT NULL DEFAULT '',
  note TEXT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_order_status_logs_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`
  }
];

module.exports = { LUOC_DO };
