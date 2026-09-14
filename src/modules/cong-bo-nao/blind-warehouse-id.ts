/**
 * @file The warehouse id sent to the brain is a BLIND id, not the real one.
 *
 * Real warehouse ids carry people's names ("wh_yen", "wh_phuong_thu") and partner names
 * ("supersports_supersports_com_vn"). The brain only uses the id to COUNT sources ("3 in stock
 * across 2 warehouses"), never reads its content — so hashing it is exactly enough for the job,
 * and no person's or partner's name leaves the merchant's machine.
 *
 * The hash must be STABLE: the same warehouse always gives the same id, different warehouses give
 * different ids. Otherwise the brain miscounts sources and tells the customer "at 3 warehouses"
 * when there is one.
 */

import crypto from "node:crypto";

/** `kho_` + 8 hex characters of SHA-1; empty in = empty out. */
export function blindWarehouseId(realId: unknown): string {
  const text = String(realId ?? "").trim();
  if (!text) return "";
  return `kho_${crypto.createHash("sha1").update(text).digest("hex").slice(0, 8)}`;
}
