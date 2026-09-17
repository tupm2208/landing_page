/**
 * @file Repository over the four customer-account tables.
 *
 * Every SQL detail of accounts lives here so `customer-accounts.ts` reads like the rules it
 * enforces. Column names are the running site's (on-disk contract); the methods speak English.
 * Tokens (session, reset, change) are stored HASHED — the clear text only ever sits in the
 * customer's cookie or e-mail.
 */

import type { DataStore, Row } from "../../contract";
import { toMysqlDateTime } from "../../shared/mysql-time";
import { CUSTOMER_TABLES } from "./customer-schema";

const at = (moment: Date): string => toMysqlDateTime(moment);

export interface NewCustomer {
  username: string;
  email: string;
  passwordHash: string;
  name: string;
  now: Date;
}

/** Fields a verified change request may write on the customer row. */
export interface ChangePayload {
  name?: string;
  dateOfBirth?: string;
  gender?: string;
  phone?: string;
  email?: string;
  province?: string;
  district?: string;
  ward?: string;
  addressDetail?: string;
}

export class CustomerRepository {
  constructor(private readonly store: DataStore) {}

  private get customers() { return this.store.table(CUSTOMER_TABLES.customers); }

  findById(id: unknown): Promise<Row | null> {
    return this.customers.one({ id: Number(id) });
  }

  findByUsername(username: string): Promise<Row | null> {
    return this.customers.one({ username });
  }

  findByEmail(email: string): Promise<Row | null> {
    return this.customers.one({ email });
  }

  /** Login by username OR e-mail (both normalised lower-case by the caller). */
  async findByLogin(username: string, email: string): Promise<Row | null> {
    const rows = await this.store.rows(`SELECT * FROM \`${CUSTOMER_TABLES.customers}\` WHERE username = ? OR email = ? LIMIT 1`, [username, email]);
    return rows[0] ?? null;
  }

  /** `true` when another customer already owns this e-mail. */
  async emailTakenByOther(email: string, id: unknown): Promise<boolean> {
    const rows = await this.store.rows(`SELECT id FROM \`${CUSTOMER_TABLES.customers}\` WHERE email = ? AND id <> ? LIMIT 1`, [email, Number(id)]);
    return rows.length > 0;
  }

  async insert(input: NewCustomer): Promise<number> {
    const result = await this.customers.insert({
      username: input.username, email: input.email, password_hash: input.passwordHash, email_verified: 0,
      name: input.name, phone: null, marketing_opt_in: 1, created_at: at(input.now), updated_at: at(input.now)
    });
    return Number(result.insertId);
  }

  /** An e-mail-only row (created from an order) gets a username and a password: it becomes an account. */
  async claim(input: { id: unknown; username: string; passwordHash: string; now: Date }): Promise<void> {
    await this.store.execute(
      `UPDATE \`${CUSTOMER_TABLES.customers}\` SET username = ?, password_hash = ?, name = COALESCE(NULLIF(name, ''), ?), updated_at = ? WHERE id = ?`,
      [input.username, input.passwordHash, input.username, at(input.now), Number(input.id)]
    );
  }

  // ---- sessions --------------------------------------------------------------------------------

  async createSession(input: { customerId: unknown; tokenHash: string; expiresAt: Date; now: Date }): Promise<void> {
    await this.store.table(CUSTOMER_TABLES.sessions).insert({
      customer_id: Number(input.customerId), token_hash: input.tokenHash, expires_at: at(input.expiresAt), created_at: at(input.now)
    });
  }

  /** The customer behind a live session token hash, or null. */
  async customerBySession(tokenHash: string, now: Date): Promise<Row | null> {
    const rows = await this.store.rows(
      `SELECT c.* FROM \`${CUSTOMER_TABLES.sessions}\` s JOIN \`${CUSTOMER_TABLES.customers}\` c ON c.id = s.customer_id WHERE s.token_hash = ? AND s.expires_at > ? LIMIT 1`,
      [tokenHash, at(now)]
    );
    return rows[0] ?? null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.store.table(CUSTOMER_TABLES.sessions).delete({ token_hash: tokenHash });
  }

  /** Every session of one customer — after a password reset nobody stays logged in. */
  async deleteSessionsOf(customerId: unknown): Promise<void> {
    await this.store.table(CUSTOMER_TABLES.sessions).delete({ customer_id: Number(customerId) });
  }

  // ---- password reset --------------------------------------------------------------------------

  async setResetToken(input: { id: unknown; tokenHash: string; expiresAt: Date; now: Date }): Promise<void> {
    await this.customers.update({ id: Number(input.id) }, { reset_token_hash: input.tokenHash, reset_token_expires_at: at(input.expiresAt), updated_at: at(input.now) });
  }

  async findByResetToken(tokenHash: string, now: Date): Promise<Row | null> {
    const rows = await this.store.rows(
      `SELECT * FROM \`${CUSTOMER_TABLES.customers}\` WHERE reset_token_hash = ? AND reset_token_expires_at > ? LIMIT 1`,
      [tokenHash, at(now)]
    );
    return rows[0] ?? null;
  }

  async setPassword(input: { id: unknown; passwordHash: string; now: Date }): Promise<void> {
    await this.customers.update({ id: Number(input.id) }, { password_hash: input.passwordHash, reset_token_hash: null, reset_token_expires_at: null, updated_at: at(input.now) });
  }

  // ---- addresses -------------------------------------------------------------------------------

  /** The default (or most recent) address of a customer, or null. */
  async defaultAddress(customerId: unknown): Promise<Row | null> {
    const rows = await this.store.rows(
      `SELECT * FROM \`${CUSTOMER_TABLES.addresses}\` WHERE customer_id = ? ORDER BY is_default DESC, updated_at DESC, id DESC LIMIT 1`,
      [Number(customerId)]
    );
    return rows[0] ?? null;
  }

  // ---- change requests (profile edits are confirmed by e-mail) ---------------------------------

  async insertChangeRequest(input: { customerId: unknown; tokenHash: string; changeType: string; payload: ChangePayload; expiresAt: Date; now: Date }): Promise<void> {
    await this.store.table(CUSTOMER_TABLES.changeRequests).insert({
      customer_id: Number(input.customerId), token_hash: input.tokenHash, change_type: input.changeType,
      payload_json: JSON.stringify(input.payload), expires_at: at(input.expiresAt), created_at: at(input.now)
    });
  }

  async findChangeRequest(tokenHash: string, now: Date): Promise<Row | null> {
    const rows = await this.store.rows(
      `SELECT * FROM \`${CUSTOMER_TABLES.changeRequests}\` WHERE token_hash = ? AND expires_at > ? AND applied_at IS NULL LIMIT 1`,
      [tokenHash, at(now)]
    );
    return rows[0] ?? null;
  }

  /** Applies a verified change: customer columns, a new default address when given, request marked applied. One transaction. */
  async applyChange(request: Row, payload: ChangePayload, now: Date): Promise<void> {
    const customerId = Number(request["customer_id"]);
    await this.store.transaction(async (tx) => {
      const patch: Row = {};
      if (payload.name !== undefined) patch["name"] = String(payload.name || "");
      if (payload.dateOfBirth !== undefined) patch["date_of_birth"] = payload.dateOfBirth || null;
      if (payload.gender !== undefined) patch["gender"] = String(payload.gender || "");
      if (payload.phone !== undefined) patch["phone"] = payload.phone || null;
      if (payload.email !== undefined) { patch["email"] = payload.email; patch["email_verified"] = 1; }
      if (Object.keys(patch).length > 0) {
        await tx.table(CUSTOMER_TABLES.customers).update({ id: customerId }, { ...patch, updated_at: at(now) });
      }
      if (payload.province || payload.district || payload.ward || payload.addressDetail) {
        const fullAddress = [payload.addressDetail, payload.ward, payload.district, payload.province].filter(Boolean).join(", ");
        await tx.table(CUSTOMER_TABLES.addresses).update({ customer_id: customerId }, { is_default: 0 });
        await tx.table(CUSTOMER_TABLES.addresses).insert({
          customer_id: customerId, receiver_name: payload.name || "", phone: payload.phone || "",
          province: payload.province || "", district: payload.district || "", ward: payload.ward || "",
          address_detail: payload.addressDetail || "", full_address: fullAddress, is_default: 1,
          created_at: at(now), updated_at: at(now)
        });
      }
      await tx.table(CUSTOMER_TABLES.changeRequests).update({ id: Number(request["id"]) }, { applied_at: at(now) });
    });
  }

  // ---- the owner's customer list (OMI) --------------------------------------------------------

  /** Accounts, newest first, with their order count. `q` matches name, username, e-mail or phone. */
  async listAccounts(q: string, limit: number): Promise<Row[]> {
    const like = `%${q}%`;
    const where = q ? "WHERE c.name LIKE ? OR c.username LIKE ? OR c.email LIKE ? OR c.phone LIKE ?" : "";
    const params = q ? [like, like, like, like] : [];
    return this.store.rows(
      `SELECT c.id, c.username, c.email, c.name, c.phone, c.email_verified, c.created_at,
              (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS so_don
       FROM \`${CUSTOMER_TABLES.customers}\` c ${where} ORDER BY c.created_at DESC LIMIT ?`,
      [...params, Math.min(Math.max(1, limit), 500)]
    );
  }

  /**
   * Customers as the ORDERS know them: one row per phone number, with order count, total and last
   * order — the view Sales Desk's "Khách hàng" screen shows, without requiring an account.
   */
  async listFromOrders(q: string, limit: number): Promise<Row[]> {
    const like = `%${q}%`;
    // An order in the bin must not count towards a customer's order count or spend.
    const where = q ? "WHERE deleted_at IS NULL AND (phone LIKE ? OR customer_name LIKE ?)" : "WHERE deleted_at IS NULL";
    const params = q ? [like, like] : [];
    return this.store.rows(
      `SELECT phone, MAX(customer_name) AS customer_name, MAX(email) AS email, MAX(province) AS province,
              COUNT(*) AS so_don, SUM(CASE WHEN status <> 'cancelled' THEN total ELSE 0 END) AS tong_tien,
              MAX(created_at) AS don_cuoi, MAX(customer_id) AS customer_id
       FROM orders ${where} GROUP BY phone ORDER BY don_cuoi DESC LIMIT ?`,
      [...params, Math.min(Math.max(1, limit), 500)]
    );
  }
}
