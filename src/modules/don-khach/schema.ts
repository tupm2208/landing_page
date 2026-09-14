/**
 * @file Schema of the three order tables — `orders`, `order_items`, `order_status_logs`.
 *
 * These tables are INHERITED from the running site: renaming them would break Sales Desk and
 * Image Tool, so they do not follow the `don_khach_` prefix rule (the manifest lists them under
 * `inheritedTables`). Columns and column types are copied VERBATIM from the running site's
 * `api/schema.sql` — one column with a different type is one real import that silently loses data.
 *
 * ONE deliberate difference from the running site: NO foreign keys to `customers`,
 * `customer_addresses` or `warehouses`.
 *
 * Why: those tables belong to other features (Customer accounts, Inventory). A merchant may not
 * have bought Customer accounts — then `customers` does not exist, and a foreign key pointing at it
 * makes the whole orders table impossible to create. Constraints between two features are the job
 * of code (`requires`), not of MySQL. `customer_id` is kept so real data imports without loss;
 * it is simply not enforced.
 *
 * Before 12/09/2026 this file did not exist: the orders table existed only because a test created
 * it. On a fresh machine the split build started fine and then fell over on the very first order.
 */

import type { SchemaStep } from "../../contract";

/** The three inherited table names — the on-disk contract shared with Sales Desk and Image Tool. */
export const ORDER_TABLES = {
  orders: "orders",
  items: "order_items",
  statusLogs: "order_status_logs"
} as const;

/** The schema steps the module runs on a fresh database. */
export const SCHEMA: SchemaStep[] = [
  {
    name: "001-ba-bang-don",
    tables: [ORDER_TABLES.orders, ORDER_TABLES.items, ORDER_TABLES.statusLogs],
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
