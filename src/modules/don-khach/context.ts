/**
 * @file The typed context of the orders module: its config, the services it consumes, and the
 * shapes those services exchange with it.
 *
 * Kept in its own file so the business files (`order-service.ts`, `customer-self-service.ts`) and
 * the manifest (`module.ts`) share one definition without importing each other in a circle.
 *
 * The inventory shapes are declared HERE rather than imported from `../hang-kho/module` because
 * that module is being ported at the same time and does not yet export `InventoryServices`. They
 * mirror what the old `hang-kho.giuCho` / `hang-kho.traCho` exchanged; when hang-kho exports its
 * interface, replace these with `import type { InventoryServices } from "../hang-kho/module"`.
 */

import type { ModuleContext } from "../../contract";
import { OrderRepository } from "./order-repository";

/** Configuration of the module. `app.ts` passes `{}`; the offset defaults to Vietnam (+07:00). */
export interface Config {
  /** Minutes east of UTC used to split the report by the seller's local day. Default 420 (+07:00). */
  timezoneOffsetMinutes?: number;
  /** Public address of the shop's site — links in customer e-mails. */
  siteUrl?: string;
  /** Session cookie carries `Secure` (HTTPS only). */
  https?: boolean;
  /** Customer session life in days; default 30 (as the running site). */
  sessionDays?: number;
  /** Password-reset and change-verification links live this long; default 30 minutes. */
  resetMinutes?: number;
  /** Transfer prefix when page content sets none (`TIEN_TIEN_TO_CK`); same fallback as the Money module. */
  transferPrefix?: string;
}

/** What placing an order asks Inventory to hold. */
export interface ReserveInput {
  code: string;
  size: string;
  quantity: number;
  /** Who holds the reservation (`"dat-don"` = the order flow). */
  heldBy: string;
}

/**
 * Inventory's answer. On success the PRICE is the one of the stock line just reserved — the order
 * flow takes its price from here, never from the customer's request.
 */
export type ReserveResult =
  | { ok: true; ticket: string; variantId: string; size: string; price: number; warehouseId: string }
  | { ok: false; reason: string };

/** The reservation ticket to give back (when the order write failed). */
export interface ReleaseInput {
  ticket: string;
}

/** Whether a reservation was actually released. */
export interface ReleaseResult {
  ok: boolean;
}

/**
 * Money on an order as the Money module computes it with the order-money kit. Field names are
 * the Money module's wire format (it also returns them over HTTP), so they stay Vietnamese.
 */
export interface OrderMoneySummary {
  daTra: number;
  conPhaiTra: number;
  [extra: string]: unknown;
}

/** The reservation ticket to turn into a sale (the order was written). */
export interface CommitInput {
  ticket: string;
}

export type CommitResult = { ok: true; variantId: string; quantity: number } | { ok: false; reason: string };

/** Pairs to put back on the shelf (the order was cancelled). */
export interface RestockInput {
  variantId: string;
  quantity: number;
}

export type RestockResult = { ok: true } | { ok: false; reason: string };

/** Một dòng tồn như Hàng hoá trả về. Tên trường là của Hàng hoá. */
export interface StockLine {
  variantId: string;
  size: string;
  quantity: number;
  price: number;
  warehouseId: string;
  /** Thứ tự ưu tiên kho: nhỏ hơn giao trước. */
  rank: number;
}

/** Câu trả lời của `hang-kho.stock`. */
export type StockAnswer =
  | { found: false; available: false; reason: string; lines: StockLine[] }
  | { found: true; available: boolean; code: string; name: string; lines: StockLine[] };

/** The slice of page content's money settings this module reads (the transfer prefix). */
export interface PageMoneySettings {
  tienToChuyenKhoan?: string | null;
}

/** Services this module consumes. Money and the platform are optional: a shop may not have bought them. */
export interface Services {
  "hang-kho": {
    reserve(input: ReserveInput): Promise<ReserveResult>;
    release(input: ReleaseInput): Promise<ReleaseResult>;
    commit(input: CommitInput): Promise<CommitResult>;
    restock(input: RestockInput): Promise<RestockResult>;
    /**
     * Tồn của một mã hàng, cho gợi ý gom kho. Tuỳ chọn: bài kiểm tra cắm kho giả chỉ có bốn cửa
     * giữ/trả/chốt/hoàn, và thiếu nó thì màn hình đơn giản là không có gợi ý.
     */
    stock?(input: { code?: string; size?: string }): Promise<StockAnswer>;
    /** Returned pairs into a chosen warehouse, written in the stock book (warehouse page). Optional. */
    restockInto?(input: { code: string; size: string; warehouseId: string; quantity: number; note?: string; actor?: string; reference?: string }):
      Promise<{ ok: true; after: number } | { ok: false; reason: string; message: string }>;
  };
  "tien-doi-soat"?: {
    orderMoney(orderId: string): Promise<OrderMoneySummary | null>;
  };
  "khung-nen-tang"?: {
    moneySettings(): Promise<PageMoneySettings>;
    /** Đ10: the shop's settings — the twin site's slug (`site_doi_ma`) and address (`site_doi_dia_chi`). Optional. */
    settings?(): Promise<Record<string, string>>;
  };
  /**
   * How much each order line has been bought. OPTIONAL: a shop may not have bought Purchasing —
   * then every line counts as unbought, nothing is locked, and the per-line buttons still work.
   *
   * ONLY the routes call this, never `search`/`read`: Purchasing itself calls `don-khach.search`,
   * so calling back from there would close a loop the kernel cannot see.
   */
  /** Collaborators: who brought an order in (session or referral cookie). Optional: a shop may have none. */
  "ctv"?: {
    attributionFor(headers: Record<string, string | undefined>): Promise<{ maCtv: string; maGioiThieu: string; nguon: string } | null>;
  };
  "mua-ho"?: {
    purchasedByLine(partnerId?: string): Promise<Map<string, number>>;
    /** Giá vốn thật của từng dòng, bình quân theo số đôi — để bù giá vốn cho đơn cũ. */
    costByLine?(partnerId?: string): Promise<Map<string, number>>;
  };
}

/** The context every handler and service of this module receives. */
export type OrderContext = ModuleContext<Config, Services>;

/** The repository over this module's store port. Stateless, so a fresh one per call is free. */
export function repositoryOf(ctx: OrderContext): OrderRepository {
  return new OrderRepository(ctx.ports.store);
}
