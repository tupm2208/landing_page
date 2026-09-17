/**
 * @file The Strategy contract every carrier implements, and the SHIPPING SLIP it receives.
 *
 * The shipping module never sees a shop order. Orders (and Purchasing) build a normalised slip
 * and hand it here, so changing the order shape never touches shipping and adding a carrier never
 * touches orders. A carrier is one class implementing `Carrier`; the module picks one by name.
 *
 * Slip field names are wire: OMI posts a slip to `POST /api/van-chuyen/tao`, and other modules
 * pass the same shape to `van-chuyen.createShipment`. They stay Vietnamese.
 */

import type { Clock, HttpClient } from "../../../contract";

/** A party on the slip: sender (the shop's warehouse) or receiver (the customer). */
export interface SlipParty {
  ten?: string;
  dienThoai?: string;
  tinh?: string;
  huyen?: string;
  xa?: string;
  diaChiChiTiet?: string;
  /** Free-text full address, used when the three-tier parts are missing. */
  diaChiDayDu?: string;
  /** `"2-cap"` when the address is already in the 2025 two-tier system (province + ward). */
  heDiaChi?: string;
}

/** One line on the slip. */
export interface SlipItem {
  ten?: string;
  soLuong?: number;
  donGia?: number;
  canNangKg?: number;
}

/** The normalised shipping slip. `maPhieu` is the shop's reference the carrier echoes back. */
export interface ShippingSlip {
  maPhieu?: string;
  /** Carrier name; empty = the module's default carrier. */
  hang?: string;
  nguoiGui?: SlipParty;
  nguoiNhan?: SlipParty;
  mon?: SlipItem[];
  cod?: number;
  giaTriHang?: number;
  canNangKg?: number;
  /** Who pays shipping: "nguoi-gui" | "sender" | "shop" | "seller" = the shop; anything else = the receiver. */
  aiTraShip?: string;
  danDo?: string;
  tenGoiHang?: string;
  /** Carrier service code (Viettel Post only; default "VCN"). */
  dichVu?: string;
}

/**
 * Outcome of creating a shipment. Three branches, all wire (they are spread into HTTP replies):
 *   `daGoi: false`            — the carrier was NOT called (missing config or slip data);
 *   `daGoi: true, ok: true`   — created;
 *   `daGoi: true, ok: false`  — the carrier really refused.
 */
export type CreateShipmentResult =
  | { daGoi: false; viSao: string; thieu?: string[] }
  | { daGoi: true; ok: true; maVanDon: string; duongTra: string; loiNhan: string; maDonSpx?: string; phiUocTinh?: number; cod?: number }
  | { daGoi: true; ok: false; loiNhan: string };

/** Outcome of asking a carrier where a parcel is. `don` is the carrier's own record, passed through. */
export type TrackResult =
  | { ok: true; don: unknown; duongTra: string }
  | { ok: false; loiNhan: string };

export type CarrierName = "spx" | "vtp";

/** Đ3 (17/09/2026): answers of cancel / verify (`ok` + a sentence for the seller). */
export interface CarrierAnswer { ok: boolean; loiNhan: string }
/** A printable label: a link the carrier hosts (AWB / printing link). */
export type LabelResult = { ok: true; duongDan: string; loiNhan: string } | { ok: false; loiNhan: string };

/** Where a parcel is and what money moved, read out of a carrier's own tracking record. */
export interface TrackSnapshot {
  /** The carrier's status text, as the carrier wrote it. */
  trangThai: string;
  /** The shop's delivery state (`FULFILLMENT` values), derived from that text. */
  trangThaiGiao: string;
  /** Null = the carrier did not say. Zero is a real value. */
  codDuKien: number | null;
  codDaThu: number | null;
  phi: number | null;
}

/** Delivery states the order screens understand (Desk `spxFulfillmentStatusFromTracking`). */
export const FINAL_DELIVERY_STATES = ["delivered", "returned", "cancelled"] as const;

function plain(v: unknown): string {
  return String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().trim();
}

/**
 * Carrier status text → delivery state. Order of checks is the point (Desk, paid for): a FAILED or
 * RETURNED delivery must be caught before "đã giao" / "hoàn thành", or a returned parcel reads as sold.
 */
export function deliveryStateFromStatus(status: unknown): string {
  const t = plain(status);
  if (!t) return "shipping_created";
  if (t.includes("da huy") || t.includes("cancel")) return "cancelled";
  if (t.includes("da hoan hang") || t.includes("hoan hang thanh cong") || t.includes("tra hang thanh cong") || t.includes("returned")) return "returned";
  if (t.includes("hoan hang") || t.includes("hoan tra") || t.includes("don hoan") || t.includes("cho hoan") || t.includes("returning") || t.includes("return")) return "returning";
  if (t.includes("giao khong thanh cong") || t.includes("khong thanh cong") || t.includes("giao that bai") || t.includes("khong giao duoc") || t.includes("khong nhan hang") || t.includes("tu choi nhan") || t.includes("khach khong nhan") || t.includes("failed")) return "delivery_failed";
  if (t.includes("da giao") || t.includes("hoan thanh") || t.includes("delivered")) return "delivered";
  if (t.includes("dang van chuyen") || t.includes("dang giao") || t.includes("in transit")) return "shipping";
  if (t.includes("lay hang") || t.includes("pickup")) return "shipping_created";
  return "shipping";
}

/** First key present with a finite number (≥ 0), or null — carriers name money fields five ways. */
export function firstMoney(data: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const v = data[key];
    if (v === undefined || v === null || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) return Math.max(0, n);
  }
  return null;
}

/** One carrier. Adding a carrier = one class here plus one line in the module's factory. */
export interface Carrier {
  readonly name: CarrierName;
  createShipment(slip: ShippingSlip): Promise<CreateShipmentResult>;
  track(trackingNumber: string): Promise<TrackResult>;
  /** Reads status + money out of `track(...).don`. Pure. */
  readTrack(record: unknown): TrackSnapshot;
  /** Cancels at the carrier. Only works while the parcel waits for pickup — the carrier says why when not. */
  cancel(trackingNumber: string): Promise<CarrierAnswer>;
  label(trackingNumber: string): Promise<LabelResult>;
  /** Credentials really accepted by the carrier (not just "fields are filled"). */
  verify(): Promise<CarrierAnswer>;
}

/** What every carrier needs from the outside: the HTTP port (never `fetch`) and the clock. */
export interface CarrierDeps {
  http: HttpClient;
  clock: Clock;
}

/** Numbers both carriers derive the same way from a slip. */
export interface SlipTotals {
  /** Cash to collect on delivery, never negative. */
  cod: number;
  /** Declared value: the slip's own, or the sum of line prices. */
  declaredValue: number;
  /** Weight in kilograms: the slip's own, or the sum of line weights. */
  weightKg: number;
  /** Total quantity across lines (each line counts at least one). */
  quantity: number;
}

export function slipItems(slip: ShippingSlip): SlipItem[] {
  return Array.isArray(slip.mon) ? slip.mon : [];
}

export function itemQuantity(item: SlipItem): number {
  return Math.max(1, Number(item.soLuong || 1));
}

export function itemPrice(item: SlipItem): number {
  return Math.max(0, Math.round(Number(item.donGia || 0)));
}

/** Derives COD, declared value, weight and quantity from a slip. */
export function slipTotals(slip: ShippingSlip): SlipTotals {
  const items = slipItems(slip);
  const cod = Math.round(Math.max(0, Number(slip.cod || 0)));
  const declaredValue = Math.round(Math.max(0, Number(
    slip.giaTriHang ?? items.reduce((t, m) => t + Math.max(0, Number(m.donGia || 0)) * itemQuantity(m), 0)
  )));
  const weightKg = Number(slip.canNangKg ?? items.reduce((t, m) => t + Math.max(0, Number(m.canNangKg || 0)) * itemQuantity(m), 0));
  const quantity = items.reduce((t, m) => t + itemQuantity(m), 0);
  return { cod, declaredValue, weightKg, quantity };
}

/** The text of an outbound-call failure, for the person reading the reply. */
export function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}
