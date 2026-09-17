/**
 * @file The ONE message shape the inbox and the brain share, the OMI intake normaliser, and the inbox document.
 *
 * Two lines feed the inbox (decided 14/09/2026): Meta's webhook (Facebook Fanpage) and OMI on the
 * shop's machine (Zalo, personal Facebook, read by automation). Whatever the line, a message is
 * ONE shape — adding a channel means adding a reader on OMI, not a new shape here.
 *
 * The inbox document keeps Meta's RAW packets (base64) so Desk can pull them unchanged, plus the
 * ids of OMI messages already seen, so a re-scan of the screen never files a message twice.
 */

/** Channels OMI feeds and drains — the landing cannot send on these itself. Values are wire. */
export const OMI_CHANNELS: readonly string[] = ["zalo", "fb-ca-nhan"];

/**
 * Channel of a PUBLIC COMMENT on a Fanpage post.
 *
 * A comment is not a message and must not be treated as one: it is public, anyone reading the
 * post sees the answer, and the reply goes to the comment rather than to the person's inbox. Its
 * own channel keeps that difference visible everywhere — in the thread list, in what the brain is
 * told, and in which Graph endpoint the reply takes.
 */
export const COMMENT_CHANNEL = "facebook-binh-luan";

/** A customer message as every channel delivers it. Field names are wire (the brain and OMI read them). */
export interface InboundMessage {
  kenh: string;
  nguoi: string;
  maTin: string;
  chu: string;
  soAnh: number;
  /** ISO time the customer sent it. */
  luc: string;
  /** The Fanpage id (Meta line only). */
  trang?: string;
  /** Display name OMI read from the screen (OMI line only), or the commenter's name Meta sent. */
  tenNguoi?: string;
  /** Comment line only: the post the comment sits under, so the seller sees WHAT is being asked about. */
  baiViet?: string;
  /** Đ6: image addresses (Meta's CDN for the Fanpage line). Absent when there are none. */
  anh?: string[];
}

/** One Meta webhook delivery, stored raw. */
export interface MetaInboxEvent {
  eventId: string;
  receivedAt: string;
  signature: string;
  daXacMinh: boolean;
  rawBodyBase64: string;
}

/** One message OMI pushed in, already normalised. */
export interface OmiInboxEvent {
  eventId: string;
  receivedAt: string;
  kenh: string;
  daXacMinh: true;
  tin: InboundMessage;
}

export type InboxEvent = MetaInboxEvent | OmiInboxEvent;

/** The inbox document (`hop-thu-den`). Field names are on-disk and Desk reads `events`. */
export interface InboxBook {
  version: 1;
  events: InboxEvent[];
  /** `${kenh}|${maTin}` of OMI messages already filed. */
  daThay: string[];
  updatedAt: string;
}

/** Trim so the document never balloons. */
export const INBOX_KEEP_MAX = 500;
/** How many OMI message ids to remember for de-duplication when OMI re-scans the screen. */
export const INBOX_SEEN_MAX = 2000;

export function defaultInboxBook(): InboxBook {
  return { version: 1, events: [], daThay: [], updatedAt: "" };
}

/** Whether a stored event is an OMI one (carries the normalised message). */
export function isOmiEvent(event: InboxEvent): event is OmiInboxEvent {
  return (event as OmiInboxEvent).tin !== undefined;
}

/**
 * One message OMI read, normalised. Returns `null` when the shape is wrong: unknown channel,
 * no sender, no message id, or neither text nor an image.
 */
export function normaliseOmiMessage(raw: unknown, fallbackAt: Date): InboundMessage | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const kenh = String(r["kenh"] ?? "").trim();
  const nguoi = String(r["nguoi"] ?? "").trim().slice(0, 120);
  const chu = typeof r["chu"] === "string" ? r["chu"].slice(0, 4000) : "";
  const maTin = String(r["maTin"] ?? "").trim().slice(0, 160);
  if (!OMI_CHANNELS.includes(kenh) || !nguoi || !maTin || (chu === "" && !(Number(r["soAnh"]) > 0))) return null;
  const sentAt = Date.parse(String(r["luc"] ?? ""));
  return {
    kenh, nguoi, chu, maTin,
    tenNguoi: String(r["tenNguoi"] ?? "").slice(0, 120),
    soAnh: Math.max(0, Math.min(20, Number(r["soAnh"]) || 0)),
    luc: Number.isFinite(sentAt) ? new Date(sentAt).toISOString() : fallbackAt.toISOString()
  };
}
