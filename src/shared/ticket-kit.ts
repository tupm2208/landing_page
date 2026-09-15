/**
 * @file Typed access to the SHARED machine-ticket kit (`chung/ve-may.js`).
 *
 * Xeon signs tickets with that very file and the landing verifies with it, so the ticket shape
 * exists in exactly one place. This module adds TypeScript types and English names; the wire
 * fields (`vai`, `shop`, `maMay`, `manh`, `truc`, `phatLuc`, `hetLuc`, `keyId`) stay as they are.
 */

import { createRequire } from "node:module";
import path from "node:path";

/** Roles a ticket can carry: the merchant's console, or the brain. */
export type TicketRole = "quan-tri" | "dich-vu";

/** Signed body of a machine ticket (wire format). */
export interface TicketBody {
  v: 1;
  vai: TicketRole;
  shop: string;
  tenShop: string;
  maMay: string;
  tenMay: string;
  manh: string[];
  truc: boolean;
  phatLuc: number;
  hetLuc: number;
  keyId: string;
}

/** What `signTicket` takes: the body without the version and key id, which the kit adds. */
export type TicketClaims = Omit<TicketBody, "v" | "keyId">;

export interface SigningKeyPair {
  khoaRiengPem: string;
  khoaCongPem: string;
  keyId: string;
}

export type TicketVerification =
  | { hopLe: true; than: TicketBody }
  | { hopLe: false; viSao: string };

interface SharedTicketKit {
  TIEN_TO: string;
  VAI: readonly string[];
  LECH_GIO_CHO_PHEP_MS: number;
  sinhKhoaKy(): SigningKeyPair;
  keyIdCuaKhoaCong(publicKeyPem: string): string;
  kyChuoi(privateKeyPem: string, text: string): string;
  kiemChuKy(publicKeyPem: string, text: string, signatureB64url: string): boolean;
  chuoiChuan(body: object): string;
  kyVe(claims: TicketClaims, key: { khoaRiengPem: string; keyId: string }): string;
  docVe(ticket: string, options: { khoaCongTheoKeyId: (keyId: string) => string | null; bayGio: Date }): TicketVerification;
  laVe(value: string): boolean;
}

const requireShared = createRequire(__filename);
// From `dist/shared/` (or `src/shared/`) up to the package root, then `kit/ve-may.js` — a byte-identical
// copy of `chung/ve-may.js` kept inside this repo, because the landing deploys on its own (cPanel).
const kit: SharedTicketKit = requireShared(path.join(__dirname, "..", "..", "kit", "ve-may.js"));

export const TICKET_PREFIX: string = kit.TIEN_TO;

/** A fresh Ed25519 key pair — for tests that play Xeon. */
export function generateSigningKey(): SigningKeyPair { return kit.sinhKhoaKy(); }

/** Signs a ticket the way Xeon does — for tests that play Xeon. */
export function signTicket(claims: TicketClaims, key: { khoaRiengPem: string; keyId: string }): string {
  return kit.kyVe(claims, key);
}

/** Verifies a ticket against the public key(s) received from Xeon. */
export function verifyTicket(ticket: string, options: { publicKeyForKeyId: (keyId: string) => string | null; now: Date }): TicketVerification {
  return kit.docVe(ticket, { khoaCongTheoKeyId: options.publicKeyForKeyId, bayGio: options.now });
}

/** Does this credential look like a machine ticket (as opposed to a long-lived key)? */
export function isTicket(value: string): boolean { return kit.laVe(value); }
