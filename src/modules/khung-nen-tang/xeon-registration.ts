/**
 * @file Registering the landing with Xeon by its licence key (decided 14/09/2026).
 *
 * Why the landing calls UP rather than Xeon pushing DOWN: a freshly installed landing has no Xeon
 * public key yet, so nothing could authenticate a "push". The landing calls up over HTTPS (TLS to
 * Xeon's domain is the trust anchor) and receives:
 *   - Xeon's PUBLIC signing key -> verifies OMI's machine tickets and the brain's service tickets, no further calls;
 *   - a PRIVATE inbox token     -> the inbox module sends it when pushing messages; Xeon derives the shop from it;
 *   - the shop id               -> a ticket naming another shop is refused.
 *
 * The result is stored in document `khung-nen-tang-xeon`. Registering again (reinstalled hosting)
 * kills the old inbox token on Xeon — one live landing per shop.
 */

import type { DataStore, HttpClient } from "../../contract";

/** Document name — on-disk contract. */
export const XEON_DOCUMENT = "khung-nen-tang-xeon";

/** `TR-XXXX-XXXX-XXXX-XXXX` over the alphabet without look-alikes (no I, O, 0, 1). */
export const LICENSE_KEY_PATTERN = /^TR-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

/** What Xeon returned plus what we sent — the full record (field names are the stored format). */
export interface XeonRegistration {
  key: string;
  shop: string;
  tenShop: string;
  keyId: string;
  khoaCongPem: string;
  maNhanTin: string;
  diaChiXeon: string;
  diaChiLanding: string;
}

export interface StoredXeonRegistration extends XeonRegistration {
  dangKyLuc: string;
}

/** The screen-safe view: no inbox token, no licence key. Field names are wire (admin screen, OMI). */
export interface XeonRegistrationSummary {
  shop: string;
  tenShop: string;
  keyId: string;
  diaChiXeon: string;
  diaChiLanding: string;
  dangKyLuc: string;
}

export function normaliseLicenseKey(key: unknown): string {
  return String(key ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

/** An http(s) origin without a trailing slash, or "" when not a usable address. */
export function normaliseAddress(address: unknown): string {
  const s = String(address ?? "").trim().replace(/\/+$/, "");
  try {
    const u = new URL(`${s}/`);
    return u.protocol === "http:" || u.protocol === "https:" ? s : "";
  } catch {
    return "";
  }
}

export interface RegisterOptions {
  http: HttpClient;
  xeonAddress: string;
  key: string;
  landingAddress: string;
  timeoutMs?: number;
}

/**
 * Calls Xeon to register. THROWS when it cannot (network, bad key, refusal) — the caller decides
 * whether to warn or to stop.
 */
export async function registerWithXeon(options: RegisterOptions): Promise<XeonRegistration> {
  const xeon = normaliseAddress(options.xeonAddress);
  if (!xeon) throw new Error("Địa chỉ Xeon không hợp lệ.");
  const key = normaliseLicenseKey(options.key);
  if (!LICENSE_KEY_PATTERN.test(key)) throw new Error("License key phải có dạng TR-XXXX-XXXX-XXXX-XXXX.");
  const landing = normaliseAddress(options.landingAddress);
  if (!landing) throw new Error("Địa chỉ công khai của landing không hợp lệ (LANDING_SITE_BASE_URL).");

  const response = await options.http.fetch(`${xeon}/license/landing-dang-ky`, {
    method: "POST",
    timeoutMs: options.timeoutMs ?? 15000,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, diaChi: landing })
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || body["ok"] !== true) {
    throw new Error(`Xeon từ chối đăng ký: ${String(body["viSao"] || body["error"] || `HTTP ${response.status}`)}`);
  }
  for (const field of ["shop", "keyId", "khoaCongPem", "maNhanTin"]) {
    if (typeof body[field] !== "string" || body[field] === "") throw new Error(`Xeon trả thiếu "${field}".`);
  }
  const publicKeyPem = body["khoaCongPem"] as string;
  if (!/BEGIN PUBLIC KEY/.test(publicKeyPem)) throw new Error("Khoá Xeon trả về không phải khoá công.");
  return {
    key,
    shop: body["shop"] as string,
    tenShop: String(body["tenShop"] ?? ""),
    keyId: body["keyId"] as string,
    khoaCongPem: publicKeyPem,
    maNhanTin: body["maNhanTin"] as string,
    diaChiXeon: normaliseAddress(body["diaChiXeon"]) || xeon,
    diaChiLanding: landing
  };
}

/** The stored registration, or `null` when the landing never registered. */
export async function readXeonRegistration(store: DataStore): Promise<StoredXeonRegistration | null> {
  const doc = await store.document<StoredXeonRegistration>(XEON_DOCUMENT).read(null);
  return doc && typeof doc === "object" && doc.keyId ? doc : null;
}

export async function saveXeonRegistration(store: DataStore, registration: XeonRegistration, at: Date): Promise<void> {
  await store.document<StoredXeonRegistration>(XEON_DOCUMENT).write({ ...registration, dangKyLuc: at.toISOString() });
}

/** The view for screens — NEVER carries the inbox token or the key. */
export function summariseXeonRegistration(doc: StoredXeonRegistration | null): XeonRegistrationSummary | null {
  if (!doc) return null;
  return {
    shop: doc.shop, tenShop: doc.tenShop || "", keyId: doc.keyId,
    diaChiXeon: doc.diaChiXeon, diaChiLanding: doc.diaChiLanding, dangKyLuc: doc.dangKyLuc || ""
  };
}
