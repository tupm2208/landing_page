/**
 * @file Schema of the customer-account tables — `customers`, `customer_sessions`,
 * `customer_change_requests`, `customer_addresses`.
 *
 * Inherited from the running site (`api/schema.sql`), columns VERBATIM: real customers import
 * without loss and Sales Desk keeps reading `orders.customer_id`. The foreign keys between these
 * four tables are kept — all four belong to this module, so the rule "no constraints between two
 * features" is not broken. `orders.customer_id` stays unenforced (see `schema.ts`).
 */

import type { SchemaStep } from "../../contract";

/** The four inherited customer tables. */
export const CUSTOMER_TABLES = {
  customers: "customers",
  sessions: "customer_sessions",
  changeRequests: "customer_change_requests",
  addresses: "customer_addresses"
} as const;

export const CUSTOMER_SCHEMA: SchemaStep[] = [
  {
    name: "002-tai-khoan-khach",
    tables: [CUSTOMER_TABLES.customers, CUSTOMER_TABLES.sessions, CUSTOMER_TABLES.changeRequests, CUSTOMER_TABLES.addresses],
    sql: `
CREATE TABLE IF NOT EXISTS customers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  firebase_uid VARCHAR(128) NULL,
  google_email VARCHAR(190) NULL,
  username VARCHAR(64) NULL,
  email VARCHAR(190) NULL,
  password_hash VARCHAR(255) NULL,
  email_verified TINYINT(1) NOT NULL DEFAULT 0,
  reset_token_hash VARCHAR(128) NULL,
  reset_token_expires_at DATETIME NULL,
  name VARCHAR(190) NOT NULL DEFAULT '',
  date_of_birth DATE NULL,
  gender VARCHAR(32) NOT NULL DEFAULT '',
  phone VARCHAR(32) NULL,
  marketing_opt_in TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_customers_phone (phone),
  UNIQUE KEY uniq_customers_username (username),
  UNIQUE KEY uniq_customers_email (email),
  KEY idx_customers_google_email (google_email),
  KEY idx_customers_firebase_uid (firebase_uid),
  KEY idx_customers_reset_token (reset_token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  token_hash VARCHAR(128) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_customer_sessions_token (token_hash),
  KEY idx_customer_sessions_customer (customer_id),
  CONSTRAINT fk_customer_sessions_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_change_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  token_hash VARCHAR(128) NOT NULL,
  change_type VARCHAR(48) NOT NULL,
  payload_json TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  applied_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_customer_change_token (token_hash),
  KEY idx_customer_change_customer (customer_id),
  CONSTRAINT fk_customer_change_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_addresses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  receiver_name VARCHAR(190) NOT NULL DEFAULT '',
  phone VARCHAR(32) NOT NULL DEFAULT '',
  province VARCHAR(190) NOT NULL DEFAULT '',
  district VARCHAR(190) NOT NULL DEFAULT '',
  ward VARCHAR(190) NOT NULL DEFAULT '',
  address_detail VARCHAR(255) NOT NULL DEFAULT '',
  full_address VARCHAR(500) NOT NULL DEFAULT '',
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_customer_addresses_customer (customer_id),
  CONSTRAINT fk_customer_addresses_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`
  }
];
