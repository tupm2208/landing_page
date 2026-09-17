/**
 * @file The "van-don" document: tracking numbers remembered per slip reference.
 *
 * Why a document and not a table: it is small (one line per shipment) and must work on machines
 * without MySQL. Why remember at all: the bot asks "where is my parcel" many times for the same
 * order — every question must not become a call to the carrier. The document is read first and
 * the carrier is asked only for the tracking status itself.
 *
 * The document name and its keys (`vanDon`, `updatedAt`, `luc`) are on-disk format: unchanged.
 */

import type { Clock, DataStore } from "../../contract";
import type { CarrierName } from "./carriers/carrier";

export const SHIPMENTS_DOCUMENT = "van-don";

/** One remembered shipment. */
export interface ShipmentRecord {
  hang: CarrierName;
  maVanDon: string;
  duongTra: string;
  cod: number;
  /** ISO time it was remembered. */
  luc: string;
  // ----- Đ3 (17/09/2026): what the last tracking sync learned. All optional: old rows have none. -----
  /** The order this slip belongs to (a parcel `ORD-1-02` → `ORD-1`). */
  maDon?: string;
  trangThai?: string;
  /** `FULFILLMENT` value derived from the carrier's text. */
  trangThaiGiao?: string;
  codDaThu?: number | null;
  phi?: number | null;
  capNhatLuc?: string;
  /** Cancelled at the carrier from OMI. */
  daHuy?: boolean;
  /** Đ10: the twin / reseller site whose carrier account created it. Empty = the shop's own. */
  site?: string;
}

export interface ShipmentsBook {
  version: 1;
  vanDon: Record<string, ShipmentRecord>;
  updatedAt: string;
}

export function emptyBook(): ShipmentsBook {
  return { version: 1, vanDon: {}, updatedAt: "" };
}

/** Repository over the document: hides the read-modify-write from the shipping rules. */
export class ShipmentsDocument {
  constructor(private readonly store: DataStore, private readonly clock: Clock) {}

  private document() {
    return this.store.document<ShipmentsBook>(SHIPMENTS_DOCUMENT);
  }

  /** Records the tracking number under the slip reference (overwrites an earlier one). */
  async remember(slipRef: string, record: Omit<ShipmentRecord, "luc">): Promise<void> {
    const luc = this.clock.now().toISOString();
    await this.document().update((current) => {
      const book = current ?? emptyBook();
      return { version: 1, vanDon: { ...(book.vanDon ?? {}), [slipRef]: { ...record, luc } }, updatedAt: luc };
    }, emptyBook());
  }

  /** Merges a patch into one remembered shipment. Unknown slip = nothing written, `false`. */
  async patch(slipRef: string, patch: Partial<Omit<ShipmentRecord, "luc">>): Promise<boolean> {
    let found = false;
    const at = this.clock.now().toISOString();
    await this.document().update((current) => {
      const book = current ?? emptyBook();
      const old = (book.vanDon ?? {})[slipRef];
      if (!old) return book;
      found = true;
      return { version: 1, vanDon: { ...(book.vanDon ?? {}), [slipRef]: { ...old, ...patch } }, updatedAt: at };
    }, emptyBook());
    return found;
  }

  /** Every remembered shipment, keyed by slip reference. */
  async all(): Promise<Record<string, ShipmentRecord>> {
    const book = (await this.document().read(emptyBook())) ?? emptyBook();
    return book.vanDon ?? {};
  }

  /** The remembered shipment for a slip reference, or `null`. */
  async lookup(slipRef: string): Promise<ShipmentRecord | null> {
    if (!slipRef) return null;
    const book = (await this.document().read(emptyBook())) ?? emptyBook();
    return (book.vanDon ?? {})[slipRef] ?? null;
  }
}
