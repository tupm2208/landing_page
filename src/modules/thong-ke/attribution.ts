/**
 * @file Where a visitor came from — and the signature that makes the claim trustworthy.
 *
 * A link posted under a Facebook comment carries `?tr_content=...&tr_sig=...`. The browser hands
 * those back on every event, which is exactly why they cannot be believed on sight: anyone can type
 * a URL. So attribution is only kept when it carries an HMAC the shop itself signed.
 *
 * WITHOUT A SECRET, EVERY ATTRIBUTION IS DROPPED. That is deliberate (fail closed), but it also
 * means an unconfigured `TOPRUN_ATTRIBUTION_SECRET` makes the attribution table silently empty and
 * every `source_click` ignored — `app.ts` therefore lists it among the switched-off features.
 */

import crypto from "node:crypto";

/** Fields kept from an incoming attribution object; everything else is dropped. */
const FIELDS = [
  "source", "medium", "campaign", "pageId", "postId", "commentId", "contentId", "topicId",
  "signature", "clickId", "firstContentId", "firstPostId", "firstTopicId", "firstCapturedAt",
  "visitorId", "sessionId", "capturedAt"
] as const;

const LIMITS: Partial<Record<(typeof FIELDS)[number], number>> = { capturedAt: 40 };
const DEFAULT_LIMIT = 160;

export type Attribution = Partial<Record<(typeof FIELDS)[number], string>>;

/** Keeps the known fields, trims them, and caps their length. Anything else is discarded. */
export function normaliseAttribution(input: unknown): Attribution {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const source = input as Record<string, unknown>;
  const out: Attribution = {};
  for (const field of FIELDS) {
    const value = String(source[field] ?? "").trim().slice(0, LIMITS[field] ?? DEFAULT_LIMIT);
    if (value !== "") out[field] = value;
  }
  return out;
}

/**
 * The attribution as it may be STORED: `{}` unless the signature matches.
 *
 * The signature covers `pageId|postId|topicId|contentId` — the four fields that decide which post
 * gets credited. `clickId` and the timestamps are outside it: they vary per visitor and signing
 * them would mean a signature per click.
 */
export function verifiedAttribution(input: unknown, secret: string): Attribution {
  const attribution = normaliseAttribution(input);
  const key = String(secret ?? "").trim();
  if (!attribution.contentId || key === "" || !attribution.signature) return {};

  const signed = [attribution.pageId, attribution.postId, attribution.topicId, attribution.contentId].join("|");
  const expected = crypto.createHmac("sha256", key).update(signed).digest("base64url");
  const given = Buffer.from(attribution.signature);
  const wanted = Buffer.from(expected);
  // Lengths first: timingSafeEqual throws on a mismatch instead of returning false.
  if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) return {};

  // "First touch" only means something when it is the SAME content. A visitor who arrived through
  // post A and now clicks post B must not have B's numbers credited to A.
  if (attribution.firstContentId !== attribution.contentId) {
    delete attribution.firstContentId;
    delete attribution.firstPostId;
    delete attribution.firstTopicId;
    delete attribution.firstCapturedAt;
  }
  return attribution;
}

/** The key rows are grouped by. Empty string = this event is not attributed to anything. */
export function attributionKey(attribution: Attribution): string {
  return String(attribution.contentId || attribution.postId || attribution.campaign || "").trim().slice(0, 160);
}
