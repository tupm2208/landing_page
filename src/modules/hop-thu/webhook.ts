/**
 * @file Meta's webhook: the HMAC signature check and the reader that turns a packet into messages.
 *
 * Difference from the running site: today the landing is only a RELAY inbox (no APP_SECRET, no
 * replies; Desk verifies and answers). Decided 12/09: the merchant server answers ITSELF through
 * the Graph API. So the signature check lives here — while the old relay mode survives: without an
 * APP_SECRET the behaviour is exactly the running site's (shape check only, never auto-reply).
 */

import crypto from "node:crypto";
import type { InboundMessage } from "./inbox";

/** Meta never sends a bigger packet. */
export const WEBHOOK_BODY_LIMIT = 256 * 1024;

/**
 * Checks `X-Hub-Signature-256` over the RAW BYTES — not over re-serialised JSON: parsing and
 * `JSON.stringify` again changes bytes, and the signature would never match.
 */
export function verifySignature(rawBody: Buffer, signature: string, appSecret: string): boolean {
  const s = String(signature ?? "").trim();
  if (!s.startsWith("sha256=") || !appSecret) return false;
  const received = Buffer.from(s.slice("sha256=".length), "hex");
  const computed = crypto.createHmac("sha256", appSecret).update(rawBody).digest();
  if (received.length !== computed.length) return false;
  return crypto.timingSafeEqual(received, computed);
}

/** Whether a parsed packet is a Fanpage packet at all (`object: "page"`). */
export function isPagePayload(payload: unknown): payload is { object: "page"; entry?: unknown } {
  return payload !== null && typeof payload === "object" && (payload as { object?: unknown }).object === "page";
}

/**
 * Reads the messages out of a Meta webhook packet. Keeps only what is usable; packets of another
 * page or non-message events are skipped.
 */
export function parseWebhookMessages(payload: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  if (!isPagePayload(payload) || !Array.isArray(payload.entry)) return out;
  for (const entry of payload.entry as unknown[]) {
    const e = (entry ?? {}) as { id?: unknown; messaging?: unknown };
    const page = String(e.id ?? "");
    const messaging = Array.isArray(e.messaging) ? (e.messaging as unknown[]) : [];
    for (const item of messaging) {
      const m = (item ?? {}) as { sender?: { id?: unknown }; timestamp?: unknown; message?: { mid?: unknown; text?: unknown; is_echo?: unknown; attachments?: unknown } };
      const sender = String(m.sender?.id ?? "");
      // A message the PAGE ITSELF sent (echo) is not a customer writing in — otherwise the bot
      // answers itself and loops.
      if (!sender || sender === page || m.message?.is_echo) continue;
      const text = String(m.message?.text ?? "").trim();
      const attachments = Array.isArray(m.message?.attachments) ? (m.message.attachments as { type?: unknown }[]) : [];
      const images = attachments.filter((a) => a?.type === "image").length;
      if (!text && images === 0) continue;
      out.push({
        kenh: "facebook",
        trang: page,
        nguoi: sender,
        maTin: String(m.message?.mid ?? ""),
        chu: text,
        soAnh: images,
        luc: new Date(Number(m.timestamp ?? Date.now())).toISOString()
      });
    }
  }
  return out;
}
