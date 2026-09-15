/**
 * @file The transfer reference a shop reconciles bank transfers by.
 *
 * Two modules need the SAME string. Orders stamps it on the order the moment it is placed (the
 * checkout popup shows it in the QR code and as "Nội dung CK"); Money rewrites it when the customer
 * picks how to pay. One function, so the two can never drift — the old site computed it once, in
 * `paymentReferenceForOrder`, at the moment the order was created.
 */

/**
 * `<prefix>-<last 8 characters of the order id>`. The prefix belongs to each shop (config), so two
 * shops never mistake each other's money.
 */
export function transferCode(orderId: string, prefix = "TR"): string {
  const p = String(prefix || "TR").trim().replace(/[^a-z0-9_-]/gi, "").slice(0, 12) || "TR";
  const tail = String(orderId || Date.now()).replace(/[^0-9a-z]/gi, "").slice(-8).toUpperCase();
  return `${p}-${tail}`;
}
