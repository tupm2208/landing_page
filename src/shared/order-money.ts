/**
 * @file Typed access to the SYNCED order-money kit (`chung/order-money-kit.js`).
 *
 * That file is byte-identical across three repositories (landing, Sales Desk, Image Tool) and a
 * test guards the sync. Nobody may edit it here; this wrapper only adds TypeScript types.
 * Field names (`paidAmount`, `remainingAmount`, `paymentStatus`...) are the order wire format.
 */

import { createRequire } from "node:module";
import path from "node:path";

/** The subset of an order the kit reads. Extra fields pass through `annotate` untouched. */
export interface MoneyFields {
  total?: number | string;
  paidAmount?: number | string;
  remainingAmount?: number | string | null;
  paymentAmount?: number | string;
  paymentStatus?: string;
  [extra: string]: unknown;
}

interface OrderMoneyKit {
  paidAmountForOrder(order: MoneyFields | null | undefined): number;
  remainingAmountForOrder(order: MoneyFields | null | undefined): number;
  codAmountForOrder(order: MoneyFields | null | undefined): number;
  orderDepositConfirmed(order: MoneyFields | null | undefined): boolean;
  annotateOrderMoneyFields<T extends MoneyFields>(order: T): T & { paidAmount: number; remainingAmount: number };
}

const requireShared = createRequire(__filename);
// `kit/order-money-kit.js` inside this repo: the landing deploys on its own, so it cannot reach `../chung`.
const kit: OrderMoneyKit = requireShared(path.join(__dirname, "..", "..", "kit", "order-money-kit.js"));

/** Amount already received on the order, by the kit's rules. */
export const paidAmountForOrder = kit.paidAmountForOrder;
/** Amount still owed. */
export const remainingAmountForOrder = kit.remainingAmountForOrder;
/** Amount to collect on delivery (equals the remaining amount). */
export const codAmountForOrder = kit.codAmountForOrder;
/** Has a deposit or full payment been confirmed? */
export const orderDepositConfirmed = kit.orderDepositConfirmed;
/** Returns the order with `paidAmount` and `remainingAmount` filled in. */
export const annotateOrderMoneyFields = kit.annotateOrderMoneyFields;
