/**
 * @file Money rules of the landing — ported verbatim from `server.js`.
 *
 * RULE NUMBER ONE of all three repositories (decided 08/08/2026): "shared fields, one source".
 * Every place reading "paid / remaining / COD" goes through `chung/order-money-kit.js` — the
 * file is byte-identical in three repositories and a test compares every byte. This file does
 * NOT recompute those three numbers; it handles only the landing's own part: how much the
 * customer chooses to pay now, and how it is rounded.
 *
 * FOUR CHOICES (kept exactly as the running site):
 *   confirm_first  — the shop confirms first, the customer pays later. Deposit by configured %.
 *   deposit        — deposit first, the rest + shipping on delivery. Deposit by configured %.
 *   deposit_hold   — "hold the order for 20%" (assigned 02/09). Same `bank_deposit` method as
 *                    deposit; told apart by the log note so the shop reconciles the right amount.
 *   full           — 100% up front, FREE shipping.
 *
 * Quirk of 04/09 that must stay: changing the choice REWRITES the amount due. Before, only the
 * method + shipping fee were written, so a customer who picked 100% then changed to "hold 20%"
 * still saw the old amount on Telegram and on the QR code.
 *
 * The choice keys, method strings and notes are wire (posted by the storefront, written on the order).
 */

export const HOLD_PERCENT = 20;

export type PaymentChoice = "confirm_first" | "deposit" | "deposit_hold" | "full";

/** The method written on the order, per customer choice. */
export const PAYMENT_METHODS: Record<PaymentChoice, string> = {
  confirm_first: "manual_confirm",
  deposit: "bank_deposit",
  deposit_hold: "bank_deposit",
  full: "bank_full_prepaid"
};

/** The log note written on the order, per customer choice. Vietnamese: the shop reads it. */
export const PAYMENT_NOTES: Record<PaymentChoice, string> = {
  full: "Khách chọn thanh toán trước 100%, miễn phí ship.",
  deposit_hold: `Khách chọn GIỮ ĐƠN ${HOLD_PERCENT}%, còn lại + phí ship thanh toán khi nhận hàng.`,
  deposit: "Khách chọn đặt cọc trước, còn lại + phí ship thanh toán khi nhận hàng.",
  confirm_first: "Khách chọn shop xác nhận trước, thanh toán sau."
};

/**
 * Rounds an amount due: to the nearest ten thousand, at least 10,000đ, never above the total.
 * MUST match the rounding on the order page, or the customer sees one number and the order
 * records another — and the customer phones.
 */
export function roundToPercent(total: number, percent: number): number {
  const p = Math.max(1, Math.min(100, Number(percent) || 100));
  const t = Math.max(0, Number(total || 0));
  if (t <= 0) return 0;
  const rounded = Math.max(10000, Math.round((t * p / 100) / 10000) * 10000);
  return Math.min(Math.ceil(t), rounded);
}

/** The amount due NOW for a choice. `depositPercent` is the shop's setting. */
export function amountDueNow(choice: string, total: number, depositPercent = 100): number {
  const t = Math.max(0, Number(total || 0));
  if (t <= 0) return 0;
  if (choice === "full") return Math.ceil(t);
  if (choice === "deposit_hold") return roundToPercent(t, HOLD_PERCENT);
  return roundToPercent(t, depositPercent);
}

/** Shipping fee: paying 100% up front makes shipping free. */
export function shippingFee(choice: string, defaultFee = 30000): number {
  return choice === "full" ? 0 : Math.max(0, Math.round(Number(defaultFee) || 0));
}

/**
 * The transfer reference the shop reconciles by: `<prefix>-<last 8 characters of the order id>`.
 * Lives in `shared/` because Orders stamps the same string when the order is placed.
 */
export { transferCode } from "../../shared/transfer-code";

export function isValidChoice(choice: unknown): choice is PaymentChoice {
  return Object.prototype.hasOwnProperty.call(PAYMENT_METHODS, String(choice || ""));
}
