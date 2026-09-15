/**
 * @file Meta's webhook: the HMAC signature check and the reader that turns a packet into messages.
 *
 * Difference from the running site: today the landing is only a RELAY inbox (no APP_SECRET, no
 * replies; Desk verifies and answers). Decided 12/09: the merchant server answers ITSELF through
 * the Graph API. So the signature check lives here — while the old relay mode survives: without an
 * APP_SECRET the behaviour is exactly the running site's (shape check only, never auto-reply).
 */

import crypto from "node:crypto";
import { COMMENT_CHANNEL, type InboundMessage } from "./inbox";

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
 * Reads the COMMENTS out of a Meta webhook packet (`changes` with field `feed`, item `comment`).
 *
 * Sales Desk answers comments as well as messages, and a shop that only reads the inbox loses the
 * loudest questions it gets — the public ones under a post, where everybody can see whether they
 * were answered.
 *
 * A comment the PAGE ITSELF wrote is skipped for the same reason an echo message is: otherwise
 * the bot answers its own reply forever. So is a `remove` — a deleted comment is not a question.
 */
export function parseWebhookComments(payload: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  if (!isPagePayload(payload) || !Array.isArray(payload.entry)) return out;
  for (const entry of payload.entry as unknown[]) {
    const e = (entry ?? {}) as { id?: unknown; changes?: unknown };
    const page = String(e.id ?? "");
    const changes = Array.isArray(e.changes) ? (e.changes as unknown[]) : [];
    for (const raw of changes) {
      const change = (raw ?? {}) as { field?: unknown; value?: Record<string, unknown> };
      if (change.field !== "feed") continue;
      const value = (change.value ?? {}) as Record<string, unknown>;
      if (String(value["item"] ?? "") !== "comment") continue;
      if (String(value["verb"] ?? "") === "remove") continue;
      const from = (value["from"] ?? {}) as { id?: unknown; name?: unknown };
      const sender = String(from.id ?? "");
      if (!sender || sender === page) continue;
      const text = String(value["message"] ?? "").trim();
      const photo = String(value["photo"] ?? "");
      if (!text && photo === "") continue;
      const at = Number(value["created_time"] ?? 0);
      out.push({
        kenh: COMMENT_CHANNEL,
        trang: page,
        nguoi: sender,
        tenNguoi: String(from.name ?? ""),
        maTin: String(value["comment_id"] ?? ""),
        baiViet: String(value["post_id"] ?? ""),
        chu: text,
        soAnh: photo === "" ? 0 : 1,
        // Meta sends comment times in SECONDS, messages in milliseconds. Multiplying the wrong one
        // by 1000 puts the comment in the year 57,000 and it sorts to the top of every thread.
        luc: new Date(at > 0 ? at * 1000 : Date.now()).toISOString()
      });
    }
  }
  return out;
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
