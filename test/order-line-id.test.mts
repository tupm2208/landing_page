/**
 * THE STABLE LINE ID — the key every purchase slip is written against.
 *
 * Incident ORD-1788854262493 (10/09/2026): a line was identified by its POSITION, so deleting one
 * line slid the next one into its place and a purchase slip started pointing at a different pair
 * of shoes. Measured on the running shop (16/09/2026) the trap was still open: 284 of 421 lines
 * carry no `variant_id`, and 47 orders have two or more of them.
 *
 * These tests hold the two halves of the fix: ONE spelling shared by both modules, and an id that
 * survives an edit of the order.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { orderLineId } from "../dist/shared/order-line-id.js";
import { lineIdOf } from "../dist/modules/mua-ho/portal-state.js";

test("the stored column wins over everything else — that is the whole point of having it", () => {
  assert.equal(orderLineId("ORD-1", "ORD-1#var_abc", "var_xyz", 3), "ORD-1#var_abc");
  assert.equal(orderLineId("ORD-1", "ORD-1#7", "", 0), "ORD-1#7");
});

test("without the column: the variant, then the position — the values the backfill wrote", () => {
  assert.equal(orderLineId("ORD-1", "", "var_abc", 0), "ORD-1#var_abc");
  assert.equal(orderLineId("ORD-1", "", "", 0), "ORD-1#1", "position is one-based, as the old expression was");
  assert.equal(orderLineId("ORD-1", "", "", 2), "ORD-1#3");
});

test("ONE spelling: Orders and Purchasing cannot drift apart", () => {
  // `mua-ho` reads a line handed over by Orders. Whatever shape that line is in, the two must agree.
  const order = { id: "ORD-9" };
  assert.equal(lineIdOf(order, { maDong: "ORD-9#var_k", variantId: "var_k" }, 0), orderLineId("ORD-9", "ORD-9#var_k", "var_k", 0));
  assert.equal(lineIdOf(order, { variantId: "var_k" }, 0), orderLineId("ORD-9", "", "var_k", 0));
  assert.equal(lineIdOf(order, {}, 1), orderLineId("ORD-9", "", "", 1));
});

test("a line written before the column existed keeps the id its purchase slips were written with", () => {
  // The backfill wrote CONCAT(order_id,'#',IF(variant_id='',line_no,variant_id)) — the same string
  // the old expression produced, so no slip is orphaned by the migration.
  const rowWithoutVariant = { line_no: 2, variant_id: "" };
  const rowWithVariant = { line_no: 2, variant_id: "var_q" };
  assert.equal(orderLineId("ORD-5", "", rowWithoutVariant.variant_id, rowWithoutVariant.line_no - 1), "ORD-5#2");
  assert.equal(orderLineId("ORD-5", "", rowWithVariant.variant_id, rowWithVariant.line_no - 1), "ORD-5#var_q");
});

test("blank and odd input degrade to a readable id instead of throwing", () => {
  assert.equal(orderLineId("", "", "", 0), "#1");
  assert.equal(orderLineId("  ORD-2  ", "", "  ", 0), "ORD-2#1", "whitespace is not an id");
  assert.equal(orderLineId("ORD-2", null, undefined, 0), "ORD-2#1");
});
