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
  },
  {
    /**
     * THE LINE ID BECOMES A COLUMN (16/09/2026).
     *
     * Until now a line was identified by `<order>#<variantId or position>` computed on the fly.
     * Measured on the running shop: 284 of 421 lines carry NO `variant_id`, and 47 orders have two
     * or more of them — so for most real orders the id was still the POSITION, the very trap
     * incident ORD-1788854262493 was supposed to have closed.
     *
     * `replaceLines()` deletes every line and renumbers from 1, so editing an order (dropping an
     * unbought line above a bought one) moved purchase slips onto the wrong pair of shoes.
     *
     * The backfill writes exactly the id those rows resolve to today, so every purchase slip
     * already written keeps matching. From here on the column is written once and carried across
     * rewrites — the id stops depending on anything that can move.
     */
    name: "002-ma-dong-on-dinh",
    tables: [ORDER_TABLES.items],
    sql: `
ALTER TABLE order_items
  ADD COLUMN line_id VARCHAR(160) NOT NULL DEFAULT '',
  ADD KEY idx_order_items_line (line_id);

UPDATE order_items
   SET line_id = CONCAT(order_id, '#', IF(variant_id = '', line_no, variant_id))
 WHERE line_id = '';
`
  },
  {
    /**
     * SOFT DELETE (16/09/2026). Deleting an order used to remove it for good; one slip of the
     * finger and a real customer's order was gone with its history. Now it goes to a bin it can
     * come back from, the way Sales Desk has always worked.
     *
     * `status_before_delete` is what the order goes back to. `purged_at` marks the tombstone of a
     * real delete, kept so a later sync cannot resurrect a row the owner meant to destroy.
     */
    name: "003-xoa-mem",
    tables: [ORDER_TABLES.orders],
    sql: `
ALTER TABLE orders
  ADD COLUMN deleted_at DATETIME NULL,
  ADD COLUMN purged_at DATETIME NULL,
  ADD COLUMN status_before_delete VARCHAR(48) NOT NULL DEFAULT '',
  ADD KEY idx_orders_deleted (deleted_at);
`
  },
  {
    /**
     * WHAT THE SHOP DECIDED ABOUT ONE LINE (16/09/2026) — the columns behind Sales Desk's
     * per-line buying controls.
     *
     * These belong on the line, not in the Purchasing module, because they are the SHOP's
     * decisions about its own order: which partner is to buy this pair, whether it has been
     * pushed to the buying list, what it is expected to cost. Purchasing owns something else —
     * the SLIPS a partner writes when they actually buy (`mua_ho_phieu_mua`), which stay there
     * and are counted, never copied here. A count copied onto the line goes stale the moment a
     * slip is undone, and then two screens disagree about how much was bought.
     *
     * `purchase_locked_at` is a marker, not a lock on stock: once a line has a real purchase
     * behind it the warehouse may no longer be swapped, or the partner would have bought for an
     * order line that no longer points at them.
     */
    name: "004-dong-mua-ho",
    tables: [ORDER_TABLES.items],
    sql: `
ALTER TABLE order_items
  ADD COLUMN partner_id VARCHAR(64) NOT NULL DEFAULT '',
  ADD COLUMN procurement_status VARCHAR(48) NOT NULL DEFAULT '',
  ADD COLUMN purchase_authorized TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN purchase_locked_at DATETIME NULL,
  ADD COLUMN cost_price DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN product_kind VARCHAR(32) NOT NULL DEFAULT '',
  ADD KEY idx_order_items_partner (partner_id);
`
  },
  {
    /**
     * UNDO ONE STEP (16/09/2026) — the "Hoàn tác trạng thái" button.
     *
     * Every quick status change writes down where the order was first. One step, not a history:
     * Sales Desk keeps exactly one slot too, because the button exists for the click you just
     * made by mistake, not for archaeology.
     *
     * `force_ready_to_ship` marks an order pushed to shipping while its lines were not all bought —
     * the way out when the shoes are physically on the desk but the paperwork disagrees. It is
     * remembered so reports can tell a forced order from one that went through the normal gate.
     */
    name: "005-hoan-tac-trang-thai",
    tables: [ORDER_TABLES.orders],
    sql: `
ALTER TABLE orders
  ADD COLUMN status_before_quick_update VARCHAR(48) NOT NULL DEFAULT '',
  ADD COLUMN force_ready_to_ship TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN force_ready_to_ship_at DATETIME NULL;
`
  },
  {
    /**
     * GIÁ VỐN ĐẾN TỪ ĐÂU (16/09/2026).
     *
     * Một con số giá vốn không nói được nó đáng tin đến mức nào: phiếu mua của đối tác là tiền
     * thật đã chi, người làm sổ gõ tay là một phán đoán, giá nhập trong danh mục chỉ là ước lượng.
     * Ba thứ đó cùng nằm trong một cột thì sáu tháng sau không ai phân biệt được — mà lúc đối soát
     * công nợ với đối tác thì đó chính là câu hỏi đầu tiên.
     */
    name: "006-nguon-gia-von",
    tables: [ORDER_TABLES.items],
    sql: `
ALTER TABLE order_items
  ADD COLUMN cost_source VARCHAR(32) NOT NULL DEFAULT '';
`
  },
  {
    /**
     * ĐƠN THỦ CÔNG ĐẦY ĐỦ NHƯ DESK (Đ2, 17/09/2026): chiết khấu dòng + toàn đơn, phí ship, người trả
     * ship, cách giao, nhãn, ghi chú giao, và đơn thuộc HỒ SƠ khách nào (`customer_profile_id` — sổ
     * khách của chủ shop, khác `customer_id` là tài khoản khách tự đăng ký trên web).
     *
     * `total` vẫn là "khách phải trả" (sau chiết khấu, cộng ship) — mọi chỗ đọc tiền đã đọc cột này.
     * `subtotal` giữ tổng tiền hàng trước chiết khấu để màn hình vẽ lại đúng khung tổng tiền.
     *
     * Mỗi cột một câu: bảng `orders` thừa hưởng từ web cũ đã có sẵn `shipping_fee`, và bộ chạy lược
     * đồ chỉ bỏ qua cột đã có khi câu ALTER chỉ thêm đúng một thứ.
     */
    name: "008-thanh-toan-giao-hang",
    tables: [ORDER_TABLES.orders, ORDER_TABLES.items],
    sql: `
ALTER TABLE orders ADD COLUMN subtotal DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN discount_type VARCHAR(16) NOT NULL DEFAULT 'money';
ALTER TABLE orders ADD COLUMN discount_value DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN shipping_fee DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN shipping_payer VARCHAR(16) NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN delivery_method VARCHAR(16) NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN tags VARCHAR(500) NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN shipping_note VARCHAR(500) NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN customer_profile_id VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE orders ADD KEY idx_orders_customer_profile (customer_profile_id);
ALTER TABLE order_items ADD COLUMN discount_type VARCHAR(16) NOT NULL DEFAULT 'money';
ALTER TABLE order_items ADD COLUMN discount_value DECIMAL(14,2) NOT NULL DEFAULT 0;
`
  },
  {
    /**
     * SITE SINH ĐÔI (Đ10, 17/09/2026): một landing bán trên hai website dùng chung kho (Desk: toprun.site +
     * dasbui.vn). Mỗi đơn nhớ nó đến từ site nào — rỗng = site chính; mã site thứ hai là cấu hình shop
     * (`site_doi_ma`). Danh sách đơn, đếm tab và tài khoản vận chuyển đọc theo cột này.
     */
    name: "009-site-sinh-doi",
    tables: [ORDER_TABLES.orders],
    sql: `
ALTER TABLE orders ADD COLUMN site VARCHAR(40) NOT NULL DEFAULT '';
ALTER TABLE orders ADD KEY idx_orders_site (site, created_at);
`
  }
];
