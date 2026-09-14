/**
 * @file Data access for orders: the ONE place that reads and writes `orders`, `order_items` and
 * `order_status_logs`, and the one place that maps a row to the order shape clients read.
 *
 * Why a repository: business rules (reserve stock first, the 15-minute window, money through the
 * kit) must not be tangled with column names. Every write that touches more than one table runs
 * in ONE transaction — RULE 2 of the module: before, three separate JSON files meant a power cut
 * between them left an order with lines but no head.
 *
 * RULE 3 lives here too: every order leaving `orderFromRows()` has `paidAmount` and
 * `remainingAmount` filled in by the synced order-money kit. No client derives money from
 * `paymentStatus` on its own.
 *
 * Time is written in UTC and read back as UTC through `shared/mysql-time` (a seven-hour bug once
 * closed the customer's edit window the moment an order was placed).
 */

import crypto from "node:crypto";
import type { DataStore, Row } from "../../contract";
import { annotateOrderMoneyFields } from "../../shared/order-money";
import { isoFromMysql, toMysqlDateTime } from "../../shared/mysql-time";
import { ORDER_TABLES } from "./schema";

const text = (v: unknown): string => String(v ?? "").trim();
const num = (v: unknown): number => Number(v || 0);

// ---------------------------------------------------------------------------------------------
// The order as clients (OMI, Sales Desk, the storefront) read it. Field names are WIRE FORMAT.
// ---------------------------------------------------------------------------------------------

/** One line of an order as returned to clients. `qty`/`quantity` and `warehouse`/`warehouseName` are both kept: old readers use either. */
export type OrderLine = {
  productCode: string;
  variantId: string;
  productName: string;
  size: string;
  qty: number;
  quantity: number;
  price: number;
  saleFilePrice: number;
  source: string;
  sourceName: string;
  warehouseId: string;
  warehouse: string;
  warehouseName: string;
  imageUrl: string;
};

/** One entry of the status history. */
export type StatusLog = {
  status: string;
  actorType: string;
  note: string;
  createdAt: string;
};

/** A full order with money fields already annotated by the kit (RULE 3). */
export type Order = {
  id: string;
  createdAt: string;
  updatedAt: string;
  customerName: string;
  phone: string;
  email: string;
  address: string;
  province: string;
  district: string;
  ward: string;
  addressDetail: string;
  note: string;
  total: number;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  paymentProvider: string;
  paymentReference: string;
  paymentAmount: number;
  fulfillmentStatus: string;
  /**
   * The running site's table has this column; a test table may not, in which case it stays empty
   * and the public layer computes `createdAt` + 15 minutes — the same value the running site writes.
   */
  canCancelUntil: string;
  shippingProvider: string;
  trackingCode: string;
  items: OrderLine[];
  statusLogs: StatusLog[];
  paidAmount: number;
  remainingAmount: number;
};

// ---------------------------------------------------------------------------------------------
// Input normalisation
// ---------------------------------------------------------------------------------------------

/** A line of an incoming order after normalisation — what gets reserved and written. */
export interface NormalisedLine {
  code: string;
  variantId: string;
  name: string;
  size: string;
  quantity: number;
  unitPrice: number;
  originalPrice: number;
  source: string;
  sourceName: string;
  warehouseId: string;
  warehouseName: string;
  imageUrl: string;
}

/** Normalises one line from the network. Drops lines without a product code or with quantity <= 0. */
export function normaliseLine(raw: unknown): NormalisedLine | null {
  const line = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const code = text(line["productCode"] || line["ma"]);
  const quantity = Math.max(0, Math.trunc(Number(line["qty"] ?? line["quantity"] ?? line["soLuong"] ?? 1)));
  if (!code || quantity <= 0) return null;
  return {
    code,
    variantId: text(line["variantId"] || line["maBienThe"]),
    name: text(line["productName"] || line["ten"]),
    size: text(line["size"]),
    quantity,
    unitPrice: Math.max(0, Number(line["price"] || line["donGia"] || 0)),
    originalPrice: Math.max(0, Number(line["saleFilePrice"] || line["originalSalePrice"] || 0)),
    source: text(line["source"]),
    sourceName: text(line["sourceName"]),
    warehouseId: text(line["warehouseId"]),
    warehouseName: text(line["warehouse"] || line["warehouseName"]),
    imageUrl: text(line["imageUrl"])
  };
}

/** The customer's lookup token is HASHED before storage: the clear text never sits in the database. */
export function hashLookupToken(token: string): string {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

/** `ER_DUP_ENTRY` from MySQL — the signal the order-id retry loop keys on. */
export function isDuplicateKeyError(e: unknown): boolean {
  const err = e as { code?: unknown; message?: unknown } | null;
  return err?.code === "ER_DUP_ENTRY" || /duplicate entry/i.test(String(err?.message ?? ""));
}

// ---------------------------------------------------------------------------------------------
// Row -> order
// ---------------------------------------------------------------------------------------------

function lineFromRow(d: Row): OrderLine {
  return {
    productCode: text(d["product_code"]),
    variantId: text(d["variant_id"]),
    productName: text(d["product_name"]),
    size: text(d["size"]),
    qty: Number(d["quantity"] || 1),
    quantity: Number(d["quantity"] || 1),
    price: num(d["price"]),
    saleFilePrice: num(d["sale_file_price"]),
    source: text(d["source"]),
    sourceName: text(d["source_name"]),
    warehouseId: text(d["warehouse_id"]),
    warehouse: text(d["warehouse_name"]),
    warehouseName: text(d["warehouse_name"]),
    imageUrl: text(d["image_url"])
  };
}

/** Builds the client-facing order from its rows, with money annotated by the kit (RULE 3). */
export function orderFromRows(head: Row, lines: Row[], logs: Row[] = []): Order {
  const order = {
    id: text(head["id"]),
    createdAt: isoFromMysql(head["created_at"]),
    updatedAt: isoFromMysql(head["updated_at"]),
    customerName: text(head["customer_name"]),
    phone: text(head["phone"]),
    email: text(head["email"]),
    address: text(head["address"]),
    province: text(head["province"]),
    district: text(head["district"]),
    ward: text(head["ward"]),
    addressDetail: text(head["address_detail"]),
    note: text(head["note"]),
    total: num(head["total"]),
    status: text(head["status"]),
    paymentStatus: text(head["payment_status"]),
    paymentMethod: text(head["payment_method"]),
    paymentProvider: text(head["payment_provider"]),
    paymentReference: text(head["payment_reference"]),
    paymentAmount: num(head["payment_amount"]),
    fulfillmentStatus: text(head["fulfillment_status"]),
    canCancelUntil: isoFromMysql(head["can_cancel_until"]),
    shippingProvider: text(head["shipping_provider"]),
    trackingCode: text(head["tracking_code"]),
    items: lines.map(lineFromRow),
    statusLogs: logs.map((n) => ({
      status: text(n["status"]),
      actorType: text(n["actor_type"]),
      note: text(n["note"]),
      createdAt: isoFromMysql(n["created_at"])
    }))
  };
  // RULE 3: annotate before the order leaves this file. Clients only read the fields.
  return annotateOrderMoneyFields(order);
}

// ---------------------------------------------------------------------------------------------
// Write shapes
// ---------------------------------------------------------------------------------------------

/** The recipient profile of an order — what the customer may edit in the first 15 minutes. */
export interface CustomerProfile {
  customerName: string;
  phone: string;
  email: string;
  address: string;
  province: string;
  district: string;
  ward: string;
  addressDetail: string;
  note: string;
}

/** Everything needed to write a new order in one transaction. */
export interface OrderDraft {
  id: string;
  lookupToken: string;
  total: number;
  lines: NormalisedLine[];
  profile: CustomerProfile;
  paymentMethod: string;
  placedAt: Date;
}

/** Filters of the admin order list; `since` is any date string; `limit` is clamped to 1..500. */
export interface SearchFilter {
  status?: string | null;
  phone?: string | null;
  since?: string | null;
  limit?: number | string | null;
}

/** The money columns a payment write may set. Only these; the orders module owns the row. */
export interface PaymentPatch {
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  paymentAmount?: number | null;
  paymentReference?: string | null;
}

/** A row of the report query: order head plus its lines, as the report calculator reads them. */
export interface ReportRow extends Row {
  id: string;
  total: unknown;
  status: unknown;
  payment_status: unknown;
  payment_amount: unknown;
  created_at: unknown;
  mon: Row[];
}

// ---------------------------------------------------------------------------------------------
// The repository
// ---------------------------------------------------------------------------------------------

/** Reads and writes the three inherited order tables through the store port. */
export class OrderRepository {
  constructor(private readonly store: DataStore) {}

  private get orders() { return this.store.table(ORDER_TABLES.orders); }

  /** One order with lines and status history, or null. */
  async read(id: string): Promise<Order | null> {
    const head = await this.orders.one({ id: String(id || "") });
    if (!head) return null;
    const [lines, logs] = await Promise.all([
      this.store.table(ORDER_TABLES.items).find({ where: { order_id: head["id"] as string }, orderBy: "line_no asc" }),
      this.store.table(ORDER_TABLES.statusLogs).find({ where: { order_id: head["id"] as string }, orderBy: "created_at asc" })
    ]);
    return orderFromRows(head, lines, logs);
  }

  /** Newest first, with lines but without the status history; at most 500. */
  async search({ status = null, phone = null, since = null, limit = 50 }: SearchFilter = {}): Promise<Order[]> {
    const where: Record<string, string | { ">": string }> = {};
    if (status) where["status"] = status;
    if (phone) where["phone"] = String(phone).trim();
    if (since) where["created_at"] = { ">": toMysqlDateTime(since) };
    const heads = await this.orders.find({
      where, orderBy: "created_at desc", limit: Math.min(Math.max(1, Number(limit) || 50), 500)
    });
    return Promise.all(heads.map(async (head) => {
      const lines = await this.store.table(ORDER_TABLES.items).find({ where: { order_id: head["id"] as string }, orderBy: "line_no asc" });
      return orderFromRows(head, lines, []);
    }));
  }

  /** The bare head row — for the contact lookup that must not read more than it compares. */
  async headRow(id: string): Promise<Row | null> {
    return this.orders.one({ id: String(id || "") });
  }

  /** An order by id + the customer's lookup token (hashed); null unless BOTH match. */
  async readByLookupToken(id: string, token: string): Promise<Order | null> {
    if (!id || !token) return null;
    const head = await this.orders.one({ id: String(id), order_lookup_token_hash: hashLookupToken(token) });
    if (!head) return null;
    return this.read(String(head["id"]));
  }

  /** Writes head, lines and the first log entry in ONE transaction (RULE 2). Throws on a duplicate id — the caller bumps the timestamp. */
  async insert(draft: OrderDraft): Promise<void> {
    const at = toMysqlDateTime(draft.placedAt);
    await this.store.transaction(async (tx) => {
      await tx.table(ORDER_TABLES.orders).insert({
        id: draft.id,
        customer_name: draft.profile.customerName,
        phone: draft.profile.phone,
        email: draft.profile.email,
        address: draft.profile.address,
        province: draft.profile.province,
        district: draft.profile.district,
        ward: draft.profile.ward,
        address_detail: draft.profile.addressDetail,
        note: draft.profile.note,
        total: draft.total,
        status: "pending",
        payment_status: "payment_pending",
        payment_method: draft.paymentMethod,
        payment_amount: 0,
        order_lookup_token_hash: hashLookupToken(draft.lookupToken),
        fulfillment_status: "not_assigned",
        created_at: at,
        updated_at: at
      });
      let lineNo = 0;
      for (const line of draft.lines) {
        lineNo += 1;
        await tx.table(ORDER_TABLES.items).insert({
          order_id: draft.id, line_no: lineNo,
          product_code: line.code, variant_id: line.variantId, product_name: line.name, size: line.size,
          quantity: line.quantity, price: line.unitPrice, sale_file_price: line.originalPrice,
          source: line.source, source_name: line.sourceName,
          warehouse_id: line.warehouseId, warehouse_name: line.warehouseName, image_url: line.imageUrl
        });
      }
      await tx.table(ORDER_TABLES.statusLogs).insert({
        order_id: draft.id, status: "pending", actor_type: "khach", note: "Khách đặt hàng", created_at: at
      });
    });
  }

  /** Sets the status and appends a log entry in one transaction. Returns how many orders changed (0 = no such order). */
  async changeStatus(input: { id: string; status: string; note: string; actor: string; at: Date }): Promise<number> {
    const at = toMysqlDateTime(input.at);
    return this.store.transaction(async (tx) => {
      const changed = await tx.table(ORDER_TABLES.orders).update({ id: String(input.id || "") }, { status: input.status, updated_at: at });
      if (changed === 0) return 0;
      await tx.table(ORDER_TABLES.statusLogs).insert({
        order_id: input.id, status: input.status, actor_type: input.actor, note: input.note, created_at: at
      });
      return changed;
    });
  }

  /**
   * Writes money columns and a log entry (actor `tien`) in one transaction. Returns how many orders
   * changed. Every payment write leaves a trace so later someone can tell who changed what.
   */
  async recordPayment(input: { id: string; patch: PaymentPatch; logStatus: string; note: string; at: Date }): Promise<number> {
    const columns: Row = {};
    const p = input.patch;
    if (p.paymentMethod !== undefined && p.paymentMethod !== null) columns["payment_method"] = String(p.paymentMethod);
    if (p.paymentStatus !== undefined && p.paymentStatus !== null) columns["payment_status"] = String(p.paymentStatus);
    if (p.paymentAmount !== undefined && p.paymentAmount !== null) columns["payment_amount"] = Math.max(0, Math.round(Number(p.paymentAmount) || 0));
    if (p.paymentReference !== undefined && p.paymentReference !== null) columns["payment_reference"] = String(p.paymentReference);
    if (Object.keys(columns).length === 0) return -1;
    const at = toMysqlDateTime(input.at);
    columns["updated_at"] = at;
    return this.store.transaction(async (tx) => {
      const changed = await tx.table(ORDER_TABLES.orders).update({ id: input.id }, columns);
      if (changed === 0) return 0;
      await tx.table(ORDER_TABLES.statusLogs).insert({
        order_id: input.id, status: input.logStatus, actor_type: "tien", note: input.note, created_at: at
      });
      return changed;
    });
  }

  /** Replaces the recipient profile and logs it as the customer's own edit. Lines and total are NOT touched. */
  async updateCustomerProfile(input: { id: string; profile: CustomerProfile; currentStatus: string; at: Date }): Promise<void> {
    const at = toMysqlDateTime(input.at);
    await this.store.transaction(async (tx) => {
      await tx.table(ORDER_TABLES.orders).update({ id: input.id }, {
        customer_name: input.profile.customerName,
        phone: input.profile.phone,
        email: input.profile.email,
        address: input.profile.address,
        province: input.profile.province, district: input.profile.district, ward: input.profile.ward,
        address_detail: input.profile.addressDetail,
        note: input.profile.note,
        updated_at: at
      });
      await tx.table(ORDER_TABLES.statusLogs).insert({
        order_id: input.id, status: input.currentStatus || "pending", actor_type: "khach",
        note: "Khách tự sửa thông tin người nhận", created_at: at
      });
    });
  }

  /**
   * Orders in a date window with their lines, for the report.
   *
   * TWO statements, not N+1: one for the heads, one for every line of those heads. A 14-day
   * report of a busy shop is still two round trips to the database.
   */
  async rowsForReport(since: string, cap: number): Promise<ReportRow[]> {
    const heads = await this.store.rows(
      `SELECT id, total, status, payment_status, payment_amount, created_at
         FROM ${ORDER_TABLES.orders} WHERE created_at >= ? ORDER BY created_at DESC LIMIT ${Math.max(1, Math.trunc(cap))}`,
      [since]
    );
    if (heads.length === 0) return [];
    const placeholders = heads.map(() => "?").join(", ");
    const lines = await this.store.rows(
      `SELECT order_id, product_code, product_name, quantity, price
         FROM ${ORDER_TABLES.items} WHERE order_id IN (${placeholders})`,
      heads.map((h) => h["id"])
    );
    const byOrder = new Map<string, Row[]>();
    for (const line of lines) {
      const key = String(line["order_id"]);
      const list = byOrder.get(key) ?? [];
      list.push(line);
      byOrder.set(key, list);
    }
    return heads.map((h) => ({ ...h, id: String(h["id"]), mon: byOrder.get(String(h["id"])) ?? [] }) as ReportRow);
  }
}
