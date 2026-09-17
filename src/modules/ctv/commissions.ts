/**
 * @file THE COMMISSION BOOK — what a collaborator earned on the orders they brought in (16/09/2026).
 *
 * On the running site Sales Desk computed commissions and pushed them down; the landing only
 * displayed them. A shop on OMI has no Desk, so the landing keeps the book itself, with Desk's rules:
 *
 *   - WHO BROUGHT THE ORDER: the collaborator logged in on the site when the order was placed
 *     (`affiliate_ctv_session`), else the referral cookie a `?ref=CODE` link set for 30 days
 *     (`affiliate_link`). Captured AT PLACEMENT and written with the order id — a cookie read later
 *     could belong to someone else.
 *   - HOW MUCH: the collaborator's own rate (`hoa_hong_mac_dinh`: "5%" of each line, or "50000" per
 *     pair), frozen on the row when the order is placed. Changing a rate later does not rewrite the past.
 *   - WHICH STATE: NOT stored. `pending` while the order runs, `approved` once it is completed or
 *     delivered, `void` when it is cancelled or returned — READ from the order every time the book is
 *     shown (Desk's `reconcileAffiliateCommissionStatus`). A status kept in a second table drifts the
 *     first time an order changes through a door that forgot to tell this one.
 *   - WHAT IS OWED: approved minus paid, counted from the payment rows.
 */

import crypto from "node:crypto";
import type { DataStore, Headers, SchemaStep } from "../../contract";
import { isoFromMysql, toMysqlDateTime } from "../../shared/mysql-time";
import { readCookie } from "../../shared/session-cookie";
import { ACCOUNT_TABLE } from "./schema";

export const COMMISSIONS_TABLE = "ctv_hoa_hong";
export const PAYMENTS_TABLE = "ctv_thanh_toan";

/** The running site's referral cookie: name and 30-day life kept. */
export const REFERRAL_COOKIE = "landing_ctv_ref";
export const REFERRAL_DAYS = 30;

export const COMMISSION_SCHEMA: SchemaStep[] = [
  {
    name: "003-ctv-hoa-hong",
    tables: [ACCOUNT_TABLE, COMMISSIONS_TABLE, PAYMENTS_TABLE],
    sql: `
ALTER TABLE ctv_tai_khoan ADD COLUMN hoa_hong_mac_dinh VARCHAR(16) NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS ctv_hoa_hong (
  ma_don VARCHAR(64) NOT NULL,
  ma_ctv VARCHAR(64) NOT NULL,
  ma_gioi_thieu VARCHAR(40) NOT NULL DEFAULT '',
  nguon VARCHAR(32) NOT NULL DEFAULT 'affiliate_link',
  ten_khach VARCHAR(190) NOT NULL DEFAULT '',
  tong_don DECIMAL(14,2) NOT NULL DEFAULT 0,
  tien_goc DECIMAL(14,2) NOT NULL DEFAULT 0,
  tien_hoa_hong DECIMAL(14,2) NOT NULL DEFAULT 0,
  quy_tac VARCHAR(16) NOT NULL DEFAULT '',
  chi_tiet_json TEXT NULL,
  tao_luc DATETIME NOT NULL,
  PRIMARY KEY (ma_don),
  KEY idx_ctv_hoa_hong_ctv (ma_ctv, tao_luc)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ctv_thanh_toan (
  ma VARCHAR(64) NOT NULL,
  ma_ctv VARCHAR(64) NOT NULL,
  so_tien DECIMAL(14,2) NOT NULL DEFAULT 0,
  ghi_chu VARCHAR(255) NOT NULL DEFAULT '',
  boi VARCHAR(190) NOT NULL DEFAULT '',
  tao_luc DATETIME NOT NULL,
  PRIMARY KEY (ma),
  KEY idx_ctv_thanh_toan_ctv (ma_ctv, tao_luc)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`
  },
  {
    // Đ4 (17/09/2026): a payment typed wrong is CORRECTED or VOIDED, never deleted (Desk
    // `edit-affiliate-payment` / `void-affiliate-payment`). A voided payment stays in the history.
    name: "004-ctv-sua-huy-thanh-toan",
    tables: [PAYMENTS_TABLE],
    sql: `
ALTER TABLE ctv_thanh_toan
  ADD COLUMN sua_luc DATETIME NULL,
  ADD COLUMN huy_luc DATETIME NULL,
  ADD COLUMN ly_do_huy VARCHAR(255) NOT NULL DEFAULT '';
`
  }
];

/** Campaigns and fixed per-product commission rules (Desk `affiliateCampaigns` / `affiliateRules`). */
export const AFFILIATE_CONFIG_DOCUMENT = "ctv-cau-hinh";

export interface AffiliateCampaign { id: string; name: string; code: string; scope: string; note: string; status: string; createdAt: string }
export interface AffiliateRule { id: string; scope: string; targetId: string; type: "fixed" | "percent"; value: number; status: string; createdAt: string }
export interface AffiliateConfig { campaigns: AffiliateCampaign[]; rules: AffiliateRule[] }

/** The config as stored, always with both lists. */
export async function readAffiliateConfig(store: DataStore): Promise<AffiliateConfig> {
  const doc = await store.document<Partial<AffiliateConfig>>(AFFILIATE_CONFIG_DOCUMENT).read({});
  return { campaigns: Array.isArray(doc?.campaigns) ? doc!.campaigns : [], rules: Array.isArray(doc?.rules) ? doc!.rules : [] };
}

/** Changes the config in one step (the document is locked on MySQL while `change` runs). */
export async function updateAffiliateConfig(store: DataStore, change: (config: AffiliateConfig) => AffiliateConfig): Promise<AffiliateConfig> {
  let out: AffiliateConfig = { campaigns: [], rules: [] };
  await store.document<Partial<AffiliateConfig>>(AFFILIATE_CONFIG_DOCUMENT).update((current) => {
    out = change({ campaigns: Array.isArray(current?.campaigns) ? current!.campaigns : [], rules: Array.isArray(current?.rules) ? current!.rules : [] });
    return out;
  }, {});
  return out;
}

const text = (v: unknown): string => String(v ?? "").trim();
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Who brought an order in, as captured when it was placed. Wire field names (the order event carries it). */
export interface Attribution {
  maCtv: string;
  maGioiThieu: string;
  nguon: "affiliate_ctv_session" | "affiliate_link";
}

/** A rate as the owner types it: "5%" = percent of each line, "50000" = per pair; empty = 0. */
export function parseRate(value: unknown): { type: "percent" | "fixed"; value: number } {
  const raw = text(value);
  if (!raw) return { type: "percent", value: 0 };
  const n = Number(raw.replace(/[^\d.]/g, ""));
  return { type: raw.includes("%") ? "percent" : "fixed", value: Number.isFinite(n) ? n : 0 };
}

export interface OrderForCommission {
  id: string;
  customerName: string;
  total: number;
  status: string;
  fulfillmentStatus?: string;
  daXoa?: boolean;
  items: { productCode: string; quantity: number; price: number }[];
}

/** The commission of one order at one rate — Desk's per-line breakdown. */
export function computeCommission(order: OrderForCommission, rate: { type: "percent" | "fixed"; value: number }, rules: readonly AffiliateRule[] = []) {
  const breakdown = order.items.map((item) => {
    const quantity = Math.max(1, num(item.quantity));
    const baseAmount = Math.max(0, num(item.price)) * quantity;
    const code = text(item.productCode).toUpperCase();
    // A fixed rule for THIS product wins over the collaborator's own rate (Desk "Hoa hồng cố định theo sản phẩm").
    const rule = rules.find((r) => r.status !== "inactive" && r.scope === "product" && text(r.targetId).toUpperCase() === code && code !== "");
    const lineRate = rule ? { type: rule.type, value: num(rule.value) } : rate;
    const amount = lineRate.type === "fixed" ? Math.round(lineRate.value) * quantity : Math.round(baseAmount * lineRate.value / 100);
    return { productCode: code, quantity, unitPrice: num(item.price), baseAmount, commissionAmount: amount, ...(rule ? { rule: rule.id } : {}) };
  });
  return {
    baseAmount: breakdown.reduce((s, b) => s + b.baseAmount, 0),
    commissionAmount: breakdown.reduce((s, b) => s + b.commissionAmount, 0),
    breakdown
  };
}

/** Desk's rule, read from the order as it is NOW. */
export function commissionStatus(order: Pick<OrderForCommission, "status" | "fulfillmentStatus" | "daXoa"> | null): "pending" | "approved" | "void" {
  if (!order || order.daXoa) return "void";
  const status = text(order.status).toLowerCase();
  if (["cancelled", "canceled", "refunded", "returned", "returned_to_stock", "soft_deleted"].includes(status)) return "void";
  if (["completed", "delivered"].includes(status) || text(order.fulfillmentStatus).toLowerCase() === "delivered") return "approved";
  return "pending";
}

export class CommissionBook {
  constructor(private readonly store: DataStore) {}

  /** The active collaborator behind a referral code, or null. */
  async accountByCode(code: unknown): Promise<{ ma: string; maGioiThieu: string; rate: string } | null> {
    const clean = text(code).toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 40);
    if (!clean) return null;
    const row = await this.store.table(ACCOUNT_TABLE).one({ ma_gioi_thieu: clean, dang_bat: 1 });
    return row ? { ma: text(row["ma"]), maGioiThieu: text(row["ma_gioi_thieu"]), rate: text(row["hoa_hong_mac_dinh"]) } : null;
  }

  /** `Set-Cookie` for a valid `?ref=` code (30 days), or null for a code nobody owns. */
  async referralCookie(code: unknown, https: boolean): Promise<Record<string, string> | null> {
    const account = await this.accountByCode(code);
    if (!account) return null;
    return {
      "Set-Cookie": `${REFERRAL_COOKIE}=${encodeURIComponent(account.maGioiThieu)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${REFERRAL_DAYS * 86400}${https ? "; Secure" : ""}`
    };
  }

  /** The referral in a request's cookie, if its code still belongs to an active collaborator. */
  async referralFromCookie(headers: Headers): Promise<Attribution | null> {
    const account = await this.accountByCode(readCookie(headers, REFERRAL_COOKIE));
    return account ? { maCtv: account.ma, maGioiThieu: account.maGioiThieu, nguon: "affiliate_link" } : null;
  }

  /** Writes the commission row of a new order, ONCE (a replayed event changes nothing). */
  async record(order: OrderForCommission, attribution: Attribution, now: Date): Promise<boolean> {
    if (await this.store.table(COMMISSIONS_TABLE).one({ ma_don: order.id })) return false;
    const account = await this.store.table(ACCOUNT_TABLE).one({ ma: attribution.maCtv });
    if (!account) return false;
    const rateText = text(account["hoa_hong_mac_dinh"]);
    const computed = computeCommission(order, parseRate(rateText), (await readAffiliateConfig(this.store)).rules);
    await this.store.table(COMMISSIONS_TABLE).insert({
      ma_don: order.id, ma_ctv: attribution.maCtv, ma_gioi_thieu: text(account["ma_gioi_thieu"]), nguon: attribution.nguon,
      ten_khach: text(order.customerName).slice(0, 190), tong_don: num(order.total),
      tien_goc: computed.baseAmount, tien_hoa_hong: computed.commissionAmount, quy_tac: rateText.slice(0, 16),
      chi_tiet_json: JSON.stringify(computed.breakdown), tao_luc: toMysqlDateTime(now)
    });
    return true;
  }

  /**
   * The book as the pages read it (the running site's field names): commissions with their status
   * derived from the orders NOW, payments, and the affiliates. `readOrder` is Orders' service.
   */
  async read(readOrder: ((id: string) => Promise<OrderForCommission | null>) | undefined, collaboratorId = ""): Promise<{
    affiliates: Record<string, unknown>[]; commissions: Record<string, unknown>[]; payments: Record<string, unknown>[]; syncedAt: string;
  }> {
    const where = collaboratorId ? { where: { ma_ctv: collaboratorId } } : {};
    const [rows, pays, accounts] = await Promise.all([
      this.store.table(COMMISSIONS_TABLE).find({ ...where, orderBy: "tao_luc desc", limit: 2000 }),
      this.store.table(PAYMENTS_TABLE).find({ ...where, orderBy: "tao_luc desc", limit: 2000 }),
      this.store.table(ACCOUNT_TABLE).find({ ...(collaboratorId ? { where: { ma: collaboratorId } } : {}), columns: ["ma", "ma_gioi_thieu", "ten", "hoa_hong_mac_dinh", "dang_bat"] })
    ]);
    const commissions = await Promise.all(rows.map(async (r) => {
      const order = readOrder ? await readOrder(text(r["ma_don"])).catch(() => null) : null;
      return {
        orderId: text(r["ma_don"]), affiliateId: text(r["ma_ctv"]), affiliateCode: text(r["ma_gioi_thieu"]),
        attributionSource: text(r["nguon"]), customerName: text(r["ten_khach"]),
        orderTotal: num(r["tong_don"]), baseAmount: num(r["tien_goc"]), commissionAmount: num(r["tien_hoa_hong"]),
        rule: text(r["quy_tac"]), status: readOrder ? commissionStatus(order) : "pending",
        orderStatus: order ? order.status : "", createdAt: isoFromMysql(r["tao_luc"])
      };
    }));
    return {
      affiliates: accounts.map((a) => ({ id: text(a["ma"]), code: text(a["ma_gioi_thieu"]), name: text(a["ten"]), defaultCommission: text(a["hoa_hong_mac_dinh"]), active: Number(a["dang_bat"]) === 1 })),
      commissions,
      payments: pays.map((p) => ({
        id: text(p["ma"]), affiliateId: text(p["ma_ctv"]), amount: num(p["so_tien"]), note: text(p["ghi_chu"]), actor: text(p["boi"]), createdAt: isoFromMysql(p["tao_luc"]),
        ...(p["sua_luc"] ? { updatedAt: isoFromMysql(p["sua_luc"]) } : {}),
        ...(p["huy_luc"] ? { voidedAt: isoFromMysql(p["huy_luc"]), voidReason: text(p["ly_do_huy"]) } : {})
      })),
      syncedAt: new Date().toISOString()
    };
  }

  /** The money box of one collaborator (running site's `commissionSummary`). */
  static summary(book: { commissions: Record<string, unknown>[]; payments: Record<string, unknown>[] }) {
    const sum = (list: Record<string, unknown>[]) => list.reduce((s, c) => s + Math.max(0, num(c["commissionAmount"])), 0);
    const approvedAmount = sum(book.commissions.filter((c) => c["status"] === "approved"));
    // A voided payment is history, not money.
    const paidAmount = book.payments.filter((p) => !p["voidedAt"]).reduce((s, p) => s + Math.max(0, num(p["amount"])), 0);
    return {
      pendingAmount: sum(book.commissions.filter((c) => c["status"] === "pending")),
      approvedAmount, paidAmount, debtAmount: Math.max(0, approvedAmount - paidAmount), orderCount: book.commissions.length
    };
  }

  /** Corrects a payment that is not voided. 0 = unknown or voided. */
  correctPayment(id: string, input: { amount: number; note: string; now: Date }): Promise<number> {
    return this.store.table(PAYMENTS_TABLE).update({ ma: text(id), huy_luc: null }, {
      so_tien: Math.max(0, Math.round(input.amount)), ghi_chu: input.note.slice(0, 255), sua_luc: toMysqlDateTime(input.now)
    });
  }

  /** Voids a payment: kept, never counted. 0 = unknown or already voided. */
  voidPayment(id: string, input: { reason: string; now: Date }): Promise<number> {
    return this.store.table(PAYMENTS_TABLE).update({ ma: text(id), huy_luc: null }, { huy_luc: toMysqlDateTime(input.now), ly_do_huy: input.reason.slice(0, 255) });
  }

  async pay(input: { collaboratorId: string; amount: number; note: string; actor: string; now: Date }): Promise<string> {
    const id = `ctvpay_${input.now.getTime().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
    await this.store.table(PAYMENTS_TABLE).insert({
      ma: id, ma_ctv: input.collaboratorId, so_tien: Math.max(0, Math.round(input.amount)),
      ghi_chu: input.note.slice(0, 255), boi: input.actor.slice(0, 190), tao_luc: toMysqlDateTime(input.now)
    });
    return id;
  }
}
