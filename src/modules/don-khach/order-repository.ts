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
import { orderLineId } from "../../shared/order-line-id";
import { isoFromMysql, toMysqlDateTime } from "../../shared/mysql-time";
import { ORDER_TABLES } from "./schema";

const text = (v: unknown): string => String(v ?? "").trim();
const num = (v: unknown): number => Number(v || 0);

// ---------------------------------------------------------------------------------------------
// The order as clients (OMI, Sales Desk, the storefront) read it. Field names are WIRE FORMAT.
// ---------------------------------------------------------------------------------------------

/** One line of an order as returned to clients. `qty`/`quantity` and `warehouse`/`warehouseName` are both kept: old readers use either. */
export type OrderLine = {
  /**
   * The line's STABLE id — what every purchase slip and out-of-stock report is keyed on.
   * Read from the `line_id` column; see `shared/order-line-id.ts` for why it is a column.
   */
  maDong: string;
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
  /** Đối tác được giao mua dòng này (`partner_wh_*`). Rỗng = chưa chọn kho. */
  partnerId: string;
  /** `waiting_partner_confirm` · `stock_confirmed` · `purchase_ready` · `purchase_complete` … */
  procurementStatus: string;
  /** Đã đẩy vào danh sách cần mua của đối tác. */
  purchaseAuthorized: boolean;
  /** Có phiếu mua thật rồi: không đổi kho được nữa. */
  purchaseLockedAt: string;
  /** Giá vốn chốt lúc đẩy mua. CHỈ màn của chủ shop thấy — không bao giờ ra tới khách. */
  costPrice: number;
  /** `shoe` · `apparel` · `accessory` · `bag` · `hat` · `sock` · `other`. */
  productKind: string;
  /** Chiết khấu của dòng (Đ2): `money` = đồng, `percent` = %. */
  discountType: "money" | "percent";
  discountValue: number;
};

/** A shipment of ONE parcel of a split order (`shipping_shipments_json`). */
export interface ParcelShipment { maKien: string; maVanDon: string; hang: string; trangThaiGiao: string; luc: string }

function parcelShipmentsOf(raw: unknown): ParcelShipment[] {
  if (raw === null || raw === undefined || raw === "") return [];
  try {
    const list = JSON.parse(String(raw)) as unknown;
    return (Array.isArray(list) ? list : []).map((x) => {
      const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      return { maKien: text(o["maKien"]), maVanDon: text(o["maVanDon"]), hang: text(o["hang"]), trangThaiGiao: text(o["trangThaiGiao"]), luc: text(o["luc"]) };
    }).filter((x) => x.maKien !== "");
  } catch {
    return [];
  }
}

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
  /** Tổng tiền hàng trước chiết khấu. `total` = khách phải trả (sau chiết khấu, cộng ship). */
  subtotal: number;
  discountType: "money" | "percent";
  discountValue: number;
  shippingFee: number;
  /** `sender` · `receiver` · rỗng (= người nhận trả, như Desk). */
  shippingPayer: string;
  /** `carrier` · `external` · `pickup` · `later` · rỗng. */
  deliveryMethod: string;
  tags: string;
  shippingNote: string;
  /** Hồ sơ trong sổ khách của chủ shop. Rỗng = đơn web chưa duyệt khách. */
  customerProfileId: string;
  /** Đ10: site sinh đôi đơn đến từ (mã site). Rỗng = site chính. */
  site: string;
  /** Vận đơn của từng KIỆN (`<mã đơn>-01`…), Đ3. Đơn một kiện dùng `trackingCode` như cũ. */
  vanDonKien: ParcelShipment[];
  /** In the bin: still readable, hidden from every list unless asked for by name. */
  daXoa: boolean;
  xoaLuc: string;
  /** What `khoi-phuc` puts the order back to. */
  trangThaiTruocXoa: string;
  /** Where "Hoàn tác trạng thái" goes back to. Empty = nothing to undo. */
  statusTruocDoiNhanh: string;
  /** Pushed to shipping before every line was bought. */
  epChoShip: boolean;
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
  /** Line discount (Desk's cart row): `money` = đồng off the line, `percent` = % of the line. */
  discountType: "money" | "percent";
  discountValue: number;
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
    imageUrl: text(line["imageUrl"]),
    discountType: (line["discountType"] ?? line["loaiChietKhau"]) === "percent" ? "percent" : "money",
    discountValue: Math.max(0, Number(line["discountValue"] ?? line["chietKhau"] ?? 0) || 0)
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

function lineFromRow(d: Row, orderId: string, index: number): OrderLine {
  return {
    // Falls back for rows written before `line_id` existed — to exactly the value the backfill wrote.
    maDong: orderLineId(orderId, d["line_id"], d["variant_id"], index),
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
    imageUrl: text(d["image_url"]),
    partnerId: text(d["partner_id"]),
    procurementStatus: text(d["procurement_status"]),
    purchaseAuthorized: Number(d["purchase_authorized"] || 0) === 1,
    purchaseLockedAt: isoFromMysql(d["purchase_locked_at"]),
    costPrice: num(d["cost_price"]),
    productKind: text(d["product_kind"]),
    discountType: text(d["discount_type"]) === "percent" ? "percent" : "money",
    discountValue: num(d["discount_value"])
  };
}

/** Builds the client-facing order from its rows, with money annotated by the kit (RULE 3). */
export function orderFromRows(head: Row, lines: Row[], logs: Row[] = []): Order {
  const id = text(head["id"]);
  const order = {
    id,
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
    // Đ2 (17/09/2026): the order editor's checkout and delivery panels.
    subtotal: num(head["subtotal"]),
    discountType: (text(head["discount_type"]) === "percent" ? "percent" : "money") as "money" | "percent",
    discountValue: num(head["discount_value"]),
    shippingFee: num(head["shipping_fee"]),
    shippingPayer: text(head["shipping_payer"]),
    deliveryMethod: text(head["delivery_method"]),
    tags: text(head["tags"]),
    shippingNote: text(head["shipping_note"]),
    customerProfileId: text(head["customer_profile_id"]),
    site: text(head["site"]),
    vanDonKien: parcelShipmentsOf(head["shipping_shipments_json"]),
    // Soft delete (16/09/2026): an order in the bin still reads normally — the screen decides
    // what to draw. `daXoa` is what every other reader filters on.
    daXoa: head["deleted_at"] !== null && head["deleted_at"] !== undefined,
    xoaLuc: isoFromMysql(head["deleted_at"]),
    trangThaiTruocXoa: text(head["status_before_delete"]),
    // Chỗ để nút "Hoàn tác trạng thái" quay về. Rỗng = không có gì để hoàn tác, nút không hiện.
    statusTruocDoiNhanh: text(head["status_before_quick_update"]),
    epChoShip: Number(head["force_ready_to_ship"] || 0) === 1,
    items: lines.map((line, i) => lineFromRow(line, id, i)),
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
  /** Initial status; the storefront's orders start `pending`, manual orders may start elsewhere. */
  status?: string | undefined;
  paymentStatus?: string | undefined;
  paymentAmount?: number | undefined;
  paymentReference?: string | undefined;
  fulfillmentStatus?: string | undefined;
  shippingProvider?: string | undefined;
  trackingCode?: string | undefined;
  /** Account the order belongs to (when the customer was logged in, or the owner picked one). */
  customerId?: number | null | undefined;
  /** Đ2: checkout + delivery of the owner's editor. Absent = column default. */
  extra?: OrderExtra | undefined;
  /** Who wrote it (`khach`, `quan-tri`, `sales-desk`) and the first log line. */
  actor?: string | undefined;
  logNote?: string | undefined;
}

/** Checkout + delivery head fields (Đ2). Each is optional: only given ones are written. */
export interface OrderExtra {
  subtotal?: number | undefined;
  discountType?: "money" | "percent" | undefined;
  discountValue?: number | undefined;
  shippingFee?: number | undefined;
  shippingPayer?: string | undefined;
  deliveryMethod?: string | undefined;
  tags?: string | undefined;
  shippingNote?: string | undefined;
  customerProfileId?: string | undefined;
  site?: string | undefined;
}

const EXTRA_COLUMNS: [keyof OrderExtra, string][] = [
  ["subtotal", "subtotal"], ["discountType", "discount_type"], ["discountValue", "discount_value"],
  ["shippingFee", "shipping_fee"], ["shippingPayer", "shipping_payer"], ["deliveryMethod", "delivery_method"],
  ["tags", "tags"], ["shippingNote", "shipping_note"], ["customerProfileId", "customer_profile_id"], ["site", "site"]
];

function extraColumns(extra: OrderExtra | undefined): Row {
  const out: Row = {};
  if (extra === undefined) return out;
  for (const [key, column] of EXTRA_COLUMNS) if (extra[key] !== undefined) out[column] = extra[key] as string | number;
  return out;
}

/** Head columns the owner may change on an existing order (wire names of the admin door). */
export interface HeadPatch {
  extra?: OrderExtra | undefined;
  /** Khách phải trả — tính lại ở máy chủ khi chiết khấu / ship đổi (`checkout.ts`). */
  total?: number | undefined;
  profile?: Partial<CustomerProfile> | undefined;
  status?: string | undefined;
  paymentStatus?: string | undefined;
  paymentMethod?: string | undefined;
  paymentAmount?: number | undefined;
  paymentReference?: string | undefined;
  fulfillmentStatus?: string | undefined;
  shippingProvider?: string | undefined;
  trackingCode?: string | undefined;
  customerId?: number | null | undefined;
}

/**
 * The status an order in the bin carries. WIRE VALUE — Sales Desk's `landingOrderIsCancelled` and
 * `mua-ho`'s `DEAD_STATUSES` both branch on this exact string, which is why a deleted order
 * disappears from the purchasing portal without that module needing to know about the bin at all.
 */
export const SOFT_DELETED = "soft_deleted";

/** Which side of the bin to read: live orders (default), only the bin, or both. */
export type DeletedFilter = "khong" | "chi" | "tat-ca";

/** Filters of the admin order list; `since` is any date string; `limit` is clamped to 1..500. */
export interface SearchFilter {
  status?: string | null;
  phone?: string | null;
  since?: string | null;
  limit?: number | string | null;
  /** Default `khong` — a caller that does not know about the bin never sees into it. */
  deleted?: DeletedFilter;
  /** Đ10: only orders of this site (`""` = main site). Absent = every site. */
  site?: string | null;
}

/** The money columns a payment write may set. Only these; the orders module owns the row. */
/** One line taken from stock when the order was placed. On-disk JSON (`stock_reservation_json`) — names stay Vietnamese. */
export interface StockTaken {
  maBienThe: string;
  soLuong: number;
}

/** Reads `stock_reservation_json`; anything malformed counts as "nothing taken". */
export function parseStockTaken(raw: unknown): StockTaken[] {
  if (raw === null || raw === undefined || raw === "") return [];
  let parsed: unknown;
  try { parsed = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((x) => {
      const line = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      return { maBienThe: text(line["maBienThe"]), soLuong: Math.max(0, Math.trunc(Number(line["soLuong"]) || 0)) };
    })
    .filter((l) => l.maBienThe !== "" && l.soLuong > 0);
}

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
      this.linesOf(head["id"] as string),
      this.store.table(ORDER_TABLES.statusLogs).find({ where: { order_id: head["id"] as string }, orderBy: "created_at asc" })
    ]);
    return orderFromRows(head, lines, logs);
  }

  /**
   * Newest first, with lines but without the status history; at most 500.
   *
   * ORDERS IN THE BIN ARE NOT ORDERS. `deleted` defaults to `khong`: every existing caller —
   * the purchasing portal, the report, the brain — keeps seeing only live orders without knowing
   * this column exists. Only the screen that draws the bin asks for `chi`.
   */
  async search({ status = null, phone = null, since = null, limit = 50, deleted = "khong", site = null }: SearchFilter = {}): Promise<Order[]> {
    const where: Record<string, string | null | { ">": string }> = {};
    if (status) where["status"] = status;
    if (site !== null && site !== undefined) where["site"] = String(site);
    if (phone) where["phone"] = String(phone).trim();
    if (since) where["created_at"] = { ">": toMysqlDateTime(since) };
    if (deleted === "khong") where["deleted_at"] = null;
    const cap = Math.min(Math.max(1, Number(limit) || 50), 500);
    // "Only the bin" cannot be said with `where` (the port has no IS NOT NULL), so it goes through SQL.
    const heads = deleted === "chi"
      ? await this.store.rows(
        `SELECT * FROM \`${ORDER_TABLES.orders}\` WHERE deleted_at IS NOT NULL AND purged_at IS NULL${site !== null && site !== undefined ? " AND site = ?" : ""}
          ORDER BY deleted_at DESC LIMIT ${cap}`, site !== null && site !== undefined ? [String(site)] : [])
      : await this.orders.find({ where, orderBy: "created_at desc", limit: cap });
    return Promise.all(heads.map(async (head) => {
      const lines = await this.linesOf(head["id"] as string);
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
        customer_id: draft.customerId ?? null,
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
        status: draft.status || "pending",
        payment_status: draft.paymentStatus || "payment_pending",
        payment_method: draft.paymentMethod,
        payment_reference: draft.paymentReference || "",
        payment_amount: draft.paymentAmount ?? 0,
        order_lookup_token_hash: hashLookupToken(draft.lookupToken),
        fulfillment_status: draft.fulfillmentStatus || "not_assigned",
        shipping_provider: draft.shippingProvider || "",
        tracking_code: draft.trackingCode || "",
        ...extraColumns(draft.extra),
        created_at: at,
        updated_at: at
      });
      let lineNo = 0;
      for (const line of draft.lines) {
        lineNo += 1;
        await tx.table(ORDER_TABLES.items).insert({
          order_id: draft.id, line_no: lineNo,
          // Minted ONCE, here. Everything downstream (purchase slips, out-of-stock reports) keys on it.
          line_id: orderLineId(draft.id, "", line.variantId, lineNo - 1),
          product_code: line.code, variant_id: line.variantId, product_name: line.name, size: line.size,
          quantity: line.quantity, price: line.unitPrice, sale_file_price: line.originalPrice,
          source: line.source, source_name: line.sourceName,
          warehouse_id: line.warehouseId, warehouse_name: line.warehouseName, image_url: line.imageUrl,
          discount_type: line.discountType, discount_value: line.discountValue
        });
      }
      await tx.table(ORDER_TABLES.statusLogs).insert({
        order_id: draft.id, status: draft.status || "pending", actor_type: draft.actor || "khach", note: draft.logNote || "Khách đặt hàng", created_at: at
      });
    });
  }

  /** Orders of one account, newest first (the "my orders" page). */
  async searchByCustomer(customerId: number, limit = 100): Promise<Order[]> {
    const heads = await this.orders.find({ where: { customer_id: customerId }, orderBy: "created_at desc", limit: Math.min(Math.max(1, limit), 500) });
    return Promise.all(heads.map(async (head) => {
      const lines = await this.linesOf(head["id"] as string);
      return orderFromRows(head, lines, []);
    }));
  }

  /** One order, only if it belongs to this account. */
  async readForCustomer(id: string, customerId: number): Promise<Order | null> {
    const head = await this.orders.one({ id: String(id || ""), customer_id: customerId });
    return head ? this.read(String(head["id"])) : null;
  }

  /**
   * Links an order to an account when the caller proves the order with its lookup token.
   * `other_customer` when it already belongs to someone else — never silently re-linked.
   */
  async attachCustomer(input: { id: string; token: string; customerId: number; at: Date }): Promise<"attached" | "not_found" | "other_customer"> {
    const head = await this.orders.one({ id: String(input.id || ""), order_lookup_token_hash: hashLookupToken(input.token) });
    if (!head) return "not_found";
    const owner = head["customer_id"];
    if (owner !== null && owner !== undefined && Number(owner) !== input.customerId) return "other_customer";
    await this.orders.update({ id: String(head["id"]) }, { customer_id: input.customerId, updated_at: toMysqlDateTime(input.at) });
    return "attached";
  }

  /** The owner edits head fields (recipient, money, shipping). Only given fields change; a log line is written. */
  async updateHead(input: { id: string; patch: HeadPatch; actor: string; note: string; at: Date }): Promise<number> {
    const columns: Row = {};
    const p = input.patch;
    const profile = p.profile ?? {};
    const map: [keyof CustomerProfile, string][] = [
      ["customerName", "customer_name"], ["phone", "phone"], ["email", "email"], ["address", "address"],
      ["province", "province"], ["district", "district"], ["ward", "ward"], ["addressDetail", "address_detail"], ["note", "note"]
    ];
    for (const [key, column] of map) if (profile[key] !== undefined) columns[column] = String(profile[key] ?? "");
    if (p.status !== undefined) columns["status"] = p.status;
    if (p.paymentStatus !== undefined) columns["payment_status"] = p.paymentStatus;
    if (p.paymentMethod !== undefined) columns["payment_method"] = p.paymentMethod;
    if (p.paymentAmount !== undefined) columns["payment_amount"] = p.paymentAmount;
    if (p.paymentReference !== undefined) columns["payment_reference"] = p.paymentReference;
    if (p.fulfillmentStatus !== undefined) columns["fulfillment_status"] = p.fulfillmentStatus;
    if (p.shippingProvider !== undefined) columns["shipping_provider"] = p.shippingProvider;
    if (p.trackingCode !== undefined) columns["tracking_code"] = p.trackingCode;
    if (p.customerId !== undefined) columns["customer_id"] = p.customerId;
    Object.assign(columns, extraColumns(p.extra));
    if (p.total !== undefined) columns["total"] = p.total;
    const at = toMysqlDateTime(input.at);
    return this.store.transaction(async (tx) => {
      const changed = await tx.table(ORDER_TABLES.orders).update({ id: String(input.id || "") }, { ...columns, updated_at: at });
      if (changed === 0) return 0;
      await tx.table(ORDER_TABLES.statusLogs).insert({
        order_id: input.id, status: p.status || "sua", actor_type: input.actor, note: input.note, created_at: at
      });
      return changed;
    });
  }

  /**
   * Writes one PARCEL's shipment into `shipping_shipments_json` (Đ3). Upserts by `maKien`; the row
   * is locked so two parcels created at the same moment do not overwrite each other's entry.
   * `false` = no such order.
   */
  async upsertParcelShipment(input: { id: string; entry: Partial<ParcelShipment> & { maKien: string }; actor: string; note: string; at: Date }): Promise<boolean> {
    return this.store.transaction(async (tx) => {
      const rows = await tx.rows(`SELECT shipping_shipments_json FROM ${ORDER_TABLES.orders} WHERE id = ? FOR UPDATE`, [input.id]);
      if (rows.length === 0) return false;
      const list = parcelShipmentsOf(rows[0]?.["shipping_shipments_json"]);
      const at = input.at.toISOString();
      const i = list.findIndex((x) => x.maKien === input.entry.maKien);
      const merged: ParcelShipment = { maVanDon: "", hang: "", trangThaiGiao: "", ...(i >= 0 ? list[i] : {}), ...input.entry, luc: at } as ParcelShipment;
      if (i >= 0) list[i] = merged; else list.push(merged);
      const mysqlAt = toMysqlDateTime(input.at);
      await tx.table(ORDER_TABLES.orders).update({ id: input.id }, { shipping_shipments_json: JSON.stringify(list), updated_at: mysqlAt });
      await tx.table(ORDER_TABLES.statusLogs).insert({ order_id: input.id, status: "van-don-kien", actor_type: input.actor, note: input.note, created_at: mysqlAt });
      return true;
    });
  }

  /**
   * Replaces every line of an order and its total, in one transaction. Stock moves are the caller's job.
   *
   * A LINE THAT SURVIVES KEEPS ITS ID. The rows are deleted and rewritten, so without this the
   * renumbering would hand line 2 the id of line 1 the moment line 1 is dropped — and every
   * purchase slip written against that id would silently point at a different pair of shoes.
   * Lines are matched on (product code, size), the pair a seller thinks in; a line the edit
   * introduces gets a fresh id, and an id is never given to two lines.
   */
  async replaceLines(input: { id: string; lines: NormalisedLine[]; total: number; at: Date }): Promise<void> {
    const before = await this.store.table(ORDER_TABLES.items).find({ where: { order_id: input.id }, orderBy: "line_no asc" });
    const keyOf = (code: unknown, size: unknown) => `${text(code).toLowerCase()}|${text(size).toLowerCase()}`;
    const kept = new Map<string, { id: string; procurement: Row }>();
    before.forEach((row, i) => {
      const key = keyOf(row["product_code"], row["size"]);
      // First row of a duplicated (code, size) wins; a second line of the same pair gets a new id.
      if (kept.has(key)) return;
      kept.set(key, {
        id: orderLineId(input.id, row["line_id"], row["variant_id"], i),
        // The shop's decisions about this line survive an edit of the recipient or the price.
        // Losing them would silently un-assign a partner who is already out buying.
        procurement: {
          partner_id: row["partner_id"] ?? "",
          procurement_status: row["procurement_status"] ?? "",
          purchase_authorized: row["purchase_authorized"] ?? 0,
          purchase_locked_at: row["purchase_locked_at"] ?? null,
          cost_price: row["cost_price"] ?? 0,
          product_kind: row["product_kind"] ?? ""
        }
      });
    });
    const used = new Set<string>();

    await this.store.transaction(async (tx) => {
      await tx.table(ORDER_TABLES.items).delete({ order_id: input.id });
      let lineNo = 0;
      for (const line of input.lines) {
        lineNo += 1;
        const same = kept.get(keyOf(line.code, line.size));
        const minted = orderLineId(input.id, "", line.variantId, lineNo - 1);
        const reuse = same !== undefined && !used.has(same.id);
        let lineId = reuse ? same.id : minted;
        // A fresh line's id can collide with one kept from a row that used to sit at that position
        // (`ORD-1#1`), or with another line of the same variant. Two lines sharing an id IS the bug,
        // so a collision gets a suffix — the ids stay unique and stay stable from here on.
        for (let n = 2; used.has(lineId); n += 1) lineId = `${minted}.${n}`;
        used.add(lineId);
        await tx.table(ORDER_TABLES.items).insert({
          order_id: input.id, line_no: lineNo, line_id: lineId,
          product_code: line.code, variant_id: line.variantId, product_name: line.name, size: line.size,
          quantity: line.quantity, price: line.unitPrice, sale_file_price: line.originalPrice,
          source: line.source, source_name: line.sourceName,
          warehouse_id: line.warehouseId, warehouse_name: line.warehouseName, image_url: line.imageUrl,
          discount_type: line.discountType, discount_value: line.discountValue,
          ...(reuse ? same.procurement : {})
        });
      }
      await tx.table(ORDER_TABLES.orders).update({ id: input.id }, { total: input.total, updated_at: toMysqlDateTime(input.at) });
    });
  }

  /**
   * Puts an order in the bin — ONCE.
   *
   * `false` means it was already there, and the caller must NOT return its stock a second time.
   * The row is locked for the check-and-write, so two people clicking Xoá at the same moment
   * cannot both be told they were first. Same shape as `markStockRestored` below, for the same
   * reason: a bookkeeping step that runs twice is a bookkeeping step that is wrong.
   */
  async markSoftDeleted(input: { id: string; at: Date }): Promise<boolean> {
    return this.store.transaction(async (tx) => {
      const rows = await tx.rows(
        `SELECT status, deleted_at FROM \`${ORDER_TABLES.orders}\` WHERE id = ? FOR UPDATE`, [String(input.id || "")]);
      const head = rows[0];
      if (!head || (head["deleted_at"] !== null && head["deleted_at"] !== undefined)) return false;
      const at = toMysqlDateTime(input.at);
      await tx.table(ORDER_TABLES.orders).update({ id: String(input.id || "") }, {
        deleted_at: at, purged_at: null,
        status_before_delete: text(head["status"]) || "pending",
        status: SOFT_DELETED,
        updated_at: at
      });
      await tx.table(ORDER_TABLES.statusLogs).insert({
        order_id: input.id, status: SOFT_DELETED, actor_type: "quan-tri", note: "Chủ shop xoá đơn (còn khôi phục được)", created_at: at
      });
      return true;
    });
  }

  /**
   * Takes an order back out of the bin — ONCE. `ok: false` means someone restored it already, and
   * the caller must NOT take stock a second time (the mirror image of the rule above).
   */
  async markRestored(input: { id: string; at: Date }): Promise<{ ok: boolean; status: string }> {
    return this.store.transaction(async (tx) => {
      const rows = await tx.rows(
        `SELECT deleted_at, status_before_delete FROM \`${ORDER_TABLES.orders}\` WHERE id = ? FOR UPDATE`, [String(input.id || "")]);
      const head = rows[0];
      if (!head || head["deleted_at"] === null || head["deleted_at"] === undefined) return { ok: false, status: "" };
      const status = text(head["status_before_delete"]) || "confirmed_by_customer";
      const at = toMysqlDateTime(input.at);
      await tx.table(ORDER_TABLES.orders).update({ id: String(input.id || "") }, {
        deleted_at: null, purged_at: null, status_before_delete: "", status, updated_at: at
      });
      await tx.table(ORDER_TABLES.statusLogs).insert({
        order_id: input.id, status, actor_type: "quan-tri", note: "Chủ shop khôi phục đơn", created_at: at
      });
      return { ok: true, status };
    });
  }

  /**
   * Writes the quick-action bookkeeping (`status_before_quick_update`, the forced-shipping marks).
   *
   * Separate from `updateHead` on purpose: these columns are NOT part of what the order IS, and
   * writing them must not add a line to the status history. One click, one log entry.
   */
  async updateQuickFields(input: { id: string; patch: Row }): Promise<number> {
    if (Object.keys(input.patch).length === 0) return 0;
    return this.orders.update({ id: String(input.id || "") }, input.patch);
  }

  /** Marks every line of a completed order as bought — nobody is still expected to buy for it. */
  async completeLines(input: { id: string; at: Date }): Promise<number> {
    return this.store.table(ORDER_TABLES.items).update(
      { order_id: String(input.id || "") },
      { procurement_status: "purchase_complete", purchase_locked_at: toMysqlDateTime(input.at) }
    );
  }

  /**
   * Gỡ MỘT biến thể khỏi sổ "đơn này đã lấy gì của kho", trả về số đôi thật sự gỡ được.
   *
   * Dùng khi đổi mẫu một dòng: đôi cũ về kho, đôi mới vào chỗ nó. Khác `markStockRestored` ở chỗ
   * đó trả CẢ đơn và đóng dấu `stock_restored_at` (một lần là hết); đây chỉ rút một mục ra khỏi
   * danh sách, nên lần huỷ đơn sau vẫn trả đúng những đôi còn lại.
   *
   * Khoá dòng trong lúc đọc-sửa-ghi: hai người cùng đổi mẫu một đơn không được cùng thấy đôi cũ
   * còn đó rồi cùng trả nó về kho.
   */
  async releaseLineStock(input: { id: string; variantId: string; quantity: number }): Promise<number> {
    const id = String(input.id || "");
    const variantId = String(input.variantId || "");
    if (variantId === "") return 0;
    return this.store.transaction(async (tx) => {
      const rows = await tx.rows(`SELECT stock_reservation_json FROM \`${ORDER_TABLES.orders}\` WHERE id = ? FOR UPDATE`, [id]);
      const taken = parseStockTaken(rows[0]?.["stock_reservation_json"]);
      const at = taken.findIndex((l) => l.maBienThe === variantId);
      if (at < 0) return 0;
      const give = Math.min(taken[at]!.soLuong, Math.max(0, Math.trunc(input.quantity)) || taken[at]!.soLuong);
      const left = taken[at]!.soLuong - give;
      const next = left > 0 ? taken.map((l, i) => (i === at ? { ...l, soLuong: left } : l)) : taken.filter((_, i) => i !== at);
      await tx.table(ORDER_TABLES.orders).update({ id }, { stock_reservation_json: JSON.stringify(next) });
      return give;
    });
  }

  /** Thay mẫu của MỘT dòng, giữ nguyên mã dòng (mọi phiếu mua khoá theo mã đó). */
  async swapLine(input: { orderId: string; lineId: string; line: Row; at: Date }): Promise<number> {
    return this.store.table(ORDER_TABLES.items).update(
      { order_id: String(input.orderId || ""), line_id: String(input.lineId || "") },
      input.line
    );
  }

  /** Tính lại tổng đơn từ các dòng. Đổi mẫu mà quên bước này thì COD sai ngay lần giao tới. */
  async recountTotal(input: { id: string; at: Date }): Promise<number> {
    const id = String(input.id || "");
    const lines = await this.store.table(ORDER_TABLES.items).find({ where: { order_id: id } });
    const total = lines.reduce((sum, l) => sum + num(l["price"]) * Math.max(1, Number(l["quantity"]) || 1), 0);
    await this.orders.update({ id }, { total, updated_at: toMysqlDateTime(input.at) });
    return total;
  }

  /** One line of one order by its stable id, or null. */
  async readLine(orderId: string, lineId: string): Promise<Row | null> {
    const where = { order_id: String(orderId || ""), line_id: String(lineId || "") };
    const found = await this.store.table(ORDER_TABLES.items).one(where);
    if (found) return found;
    // The screen showed this id, so it may be one computed for a row whose column is still empty: heal, then look again.
    await this.linesOf(String(orderId || ""));
    return this.store.table(ORDER_TABLES.items).one(where);
  }

  /**
   * An order's lines, oldest first — with every EMPTY `line_id` written on the spot.
   *
   * The schema step that fills `line_id` runs once, when the column is added. Rows that arrive
   * LATER by another road — the import tool, or old orders copied in with phpMyAdmin (how the
   * running site's orders reach a hosting) — have the column empty. The screen then shows a
   * computed id, and every door that looks a line up BY THE COLUMN answers "không có dòng" (found
   * by clicking the web admin, 16/09/2026). Writing the very value the screen shows closes that for
   * good, and slips written against it keep matching.
   */
  private async linesOf(orderId: string): Promise<Row[]> {
    const rows = await this.store.table(ORDER_TABLES.items).find({ where: { order_id: orderId }, orderBy: "line_no asc" });
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]!;
      if (text(row["line_id"]) !== "") continue;
      const lineId = orderLineId(orderId, "", row["variant_id"], i);
      if (row["id"] !== undefined && row["id"] !== null) {
        await this.store.table(ORDER_TABLES.items).update({ id: row["id"] as number, line_id: "" }, { line_id: lineId });
      }
      row["line_id"] = lineId;
    }
    return rows;
  }

  /** Writes the shop's decisions onto ONE line. Only the columns given change. */
  async updateLine(input: { orderId: string; lineId: string; patch: Row; at: Date }): Promise<number> {
    if (Object.keys(input.patch).length === 0) return 0;
    const changed = await this.store.table(ORDER_TABLES.items).update(
      { order_id: String(input.orderId || ""), line_id: String(input.lineId || "") }, input.patch);
    if (changed > 0) {
      await this.orders.update({ id: String(input.orderId || "") }, { updated_at: toMysqlDateTime(input.at) });
    }
    return changed;
  }

  /** Removes an order with its lines and history. Returns how many heads were removed (0 = no such order). */
  async purge(id: string): Promise<number> {
    return this.store.transaction(async (tx) => {
      await tx.table(ORDER_TABLES.items).delete({ order_id: id });
      await tx.table(ORDER_TABLES.statusLogs).delete({ order_id: id });
      return tx.table(ORDER_TABLES.orders).delete({ id });
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
  /**
   * Remembers what a placed order TOOK from stock (variant + quantity), so a cancellation can put
   * it back. Written into the inherited columns `stock_reservation_json` / `stock_reserved_at`.
   */
  async recordStockTaken(input: { id: string; lines: StockTaken[]; at: Date }): Promise<void> {
    // `stock_restored_at` is cleared: an edited order takes new pairs, which a later cancel must return.
    await this.store.table(ORDER_TABLES.orders).update(
      { id: String(input.id || "") },
      { stock_reservation_json: JSON.stringify(input.lines), stock_reserved_at: toMysqlDateTime(input.at), stock_restored_at: null }
    );
  }

  /** Replaces the lookup token/secret of an order (stored hashed). */
  async setLookupToken(input: { id: string; token: string; at: Date }): Promise<void> {
    await this.orders.update({ id: String(input.id || "") }, { order_lookup_token_hash: hashLookupToken(input.token), updated_at: toMysqlDateTime(input.at) });
  }

  /**
   * Marks the order's stock as returned and hands back what to return — ONCE. A repeated cancel,
   * or two paths cancelling at the same time, gets `null` (row locked, `stock_restored_at` set in
   * the same transaction), so pairs are never added back twice. Orders placed before 14/09/2026
   * have no `stock_reservation_json` and return `null` too: nothing was taken for them.
   */
  async markStockRestored(input: { id: string; at: Date }): Promise<StockTaken[] | null> {
    return this.store.transaction(async (tx) => {
      const rows = await tx.rows(`SELECT stock_reservation_json, stock_restored_at FROM \`${ORDER_TABLES.orders}\` WHERE id = ? FOR UPDATE`, [String(input.id || "")]);
      const head = rows[0];
      if (!head || (head["stock_restored_at"] !== null && head["stock_restored_at"] !== undefined)) return null;
      const lines = parseStockTaken(head["stock_reservation_json"]);
      if (lines.length === 0) return null;
      await tx.table(ORDER_TABLES.orders).update({ id: String(input.id || "") }, { stock_restored_at: toMysqlDateTime(input.at) });
      return lines;
    });
  }

  async rowsForReport(since: string, cap: number): Promise<ReportRow[]> {
    // An order in the bin is not revenue: it must not appear in "bán được bao nhiêu hôm nay".
    const heads = await this.store.rows(
      `SELECT id, total, status, payment_status, payment_amount, created_at
         FROM ${ORDER_TABLES.orders} WHERE created_at >= ? AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT ${Math.max(1, Math.trunc(cap))}`,
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
