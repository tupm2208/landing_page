/**
 * @file THE stable id of one order line — the key every purchase slip is written against.
 *
 * Why this tiny file exists at all: the id used to be spelled out in two modules
 * (`don-khach/order-repository.ts` and `mua-ho/portal-state.ts`). Two spellings of one key is one
 * bug away from a purchase slip that belongs to nobody, and modules may not import each other —
 * so the single spelling lives here, in `shared/`, where both may reach it.
 *
 * THE TRAP THIS CLOSES (incident ORD-1788854262493, 10/09/2026). A line used to be identified by
 * its POSITION in the order. Remove one line and every line below it slides up a place, so a
 * purchase slip — or an out-of-stock report — silently starts pointing at a different pair of
 * shoes. The customer is then told the wrong thing about the wrong item.
 *
 * Measured on the running shop's data (16/09/2026): of 421 order lines, 284 carry NO `variant_id`,
 * and 47 orders have two or more such lines. For those the id was still `<order>#<position>` — the
 * trap was never actually closed, only moved. Hence `line_id`: a column written ONCE when the line
 * is first inserted and carried across every rewrite of the order, so the id stops depending on
 * anything that can move.
 *
 * Order of preference, and why:
 *   1. `storedLineId` — the column. Written once, never recomputed. This is the real answer.
 *   2. `variantId`    — stable per (item, size, warehouse); correct for lines from the catalogue.
 *   3. position       — last resort, for rows written before the column existed. Backfilled to
 *                       exactly this value, so old slips keep matching.
 */

const text = (value: unknown): string => String(value ?? "").trim();

/**
 * The id of one line of one order.
 *
 * @param orderId      the order's id (`ORD-…`, `MAN-…`)
 * @param storedLineId `order_items.line_id` when the row has one — always wins
 * @param variantId    the stock variant, when the line came from the catalogue
 * @param index        zero-based position, used only when the two above are empty
 */
export function orderLineId(orderId: unknown, storedLineId: unknown, variantId: unknown, index: number): string {
  const stored = text(storedLineId);
  if (stored !== "") return stored;
  return `${text(orderId)}#${text(variantId) || index + 1}`;
}
