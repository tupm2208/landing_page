/**
 * @file THE MONEY OF ONE ORDER — Sales Desk's `calculateOrderItem` + `calculateOrderCheckout`
 * (`app.js`), moved to the server (Đ2, 17/09/2026).
 *
 * Desk computed the total in the browser and sent it. Here the owner sends the INPUTS (per-line
 * price and discount, order discount, shipping fee) and the server writes the total: a total typed
 * by a screen is a total two screens can disagree on.
 *
 * Rules kept from Desk, each a real mistake once:
 *  - a line discount never goes below zero (`Math.min(discount, gross)`);
 *  - an ORDER discount applies after line discounts, and a money discount is capped at what is left;
 *  - percent is clamped 0..100;
 *  - what the customer already paid is capped at what they owe — paying more does not make the
 *    order owe the customer money on this screen (refunds are a separate door).
 */

export type DiscountType = "money" | "percent";

export const DISCOUNT_TYPES: readonly DiscountType[] = ["money", "percent"];

export interface CheckoutLine {
  quantity: number;
  unitPrice: number;
  discountType?: DiscountType | string | undefined;
  discountValue?: number | undefined;
}

export interface CheckoutInput {
  discountType?: DiscountType | string | undefined;
  discountValue?: number | undefined;
  shippingFee?: number | undefined;
  paidAmount?: number | undefined;
}

export interface CheckoutTotals {
  subtotal: number;
  itemDiscount: number;
  orderDiscount: number;
  discount: number;
  shippingFee: number;
  customerPayable: number;
  paidAmount: number;
  remainingAmount: number;
}

const money = (v: unknown): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const percent = (v: unknown): number => Math.min(100, Math.max(0, Number(v) || 0));

export function discountTypeOf(v: unknown): DiscountType {
  return v === "percent" ? "percent" : "money";
}

/** One line: gross, its own discount, and what is left. */
export function lineMoney(line: CheckoutLine): { gross: number; discount: number; total: number } {
  const quantity = Math.max(1, Math.trunc(Number(line.quantity) || 1));
  const gross = money(line.unitPrice) * quantity;
  const value = line.discountValue ?? 0;
  const discount = discountTypeOf(line.discountType) === "percent"
    ? Math.round((gross * percent(value)) / 100)
    : Math.min(money(value), gross);
  return { gross, discount, total: Math.max(0, gross - discount) };
}

export function computeCheckout(lines: readonly CheckoutLine[], input: CheckoutInput = {}): CheckoutTotals {
  const each = lines.map(lineMoney);
  const subtotal = each.reduce((s, l) => s + l.gross, 0);
  const itemDiscount = each.reduce((s, l) => s + l.discount, 0);
  const afterItems = Math.max(0, subtotal - itemDiscount);
  const orderDiscount = discountTypeOf(input.discountType) === "percent"
    ? Math.round((afterItems * percent(input.discountValue)) / 100)
    : Math.min(money(input.discountValue), afterItems);
  const shippingFee = money(input.shippingFee);
  const customerPayable = Math.max(0, subtotal - itemDiscount - orderDiscount + shippingFee);
  const paidAmount = Math.min(money(input.paidAmount), customerPayable);
  return {
    subtotal, itemDiscount, orderDiscount, discount: itemDiscount + orderDiscount, shippingFee,
    customerPayable, paidAmount, remainingAmount: Math.max(0, customerPayable - paidAmount)
  };
}

/** Delivery choices of the order editor (Desk `orderDeliveryMethodCard`). Wire values. */
export const DELIVERY_METHODS = ["carrier", "external", "pickup", "later"] as const;
/** Who pays the carrier (Desk `orderShippingPayerOptions`). Empty = receiver, as Desk defaults. */
export const SHIPPING_PAYERS = ["", "sender", "receiver"] as const;
