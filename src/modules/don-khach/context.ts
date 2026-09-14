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

/** Services this module consumes. Money is optional: a shop may not have bought that feature. */
export interface Services {
  "hang-kho": {
    reserve(input: ReserveInput): Promise<ReserveResult>;
    release(input: ReleaseInput): Promise<ReleaseResult>;
  };
  "tien-doi-soat"?: {
    orderMoney(orderId: string): Promise<OrderMoneySummary | null>;
  };
}

/** The context every handler and service of this module receives. */
export type OrderContext = ModuleContext<Config, Services>;

/** The repository over this module's store port. Stateless, so a fresh one per call is free. */
export function repositoryOf(ctx: OrderContext): OrderRepository {
  return new OrderRepository(ctx.ports.store);
}
