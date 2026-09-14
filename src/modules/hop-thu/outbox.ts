/**
 * @file The outbox — the queue for channels the landing CANNOT send on itself (Zalo, personal Facebook).
 *
 * Decided 14/09/2026: line 2 (Zalo, personal FB, automation) runs on OMI at the shop's machine.
 * The brain replies into the landing like on any channel; the landing cannot send on these, so it
 * queues; OMI (the on-duty machine) pulls, types through automation, then reports back.
 *
 * Rules, each with a test (inbox-omi-channels.test.mts):
 *   - A CLAIM is exclusive for 3 minutes: a machine that claimed and went silent loses the item
 *     back to the queue and another machine can claim it — nobody sends twice because within those
 *     3 minutes only one machine holds it.
 *   - An item waiting more than 12 hours is EXPIRED: not sent any more (answering yesterday's
 *     question annoys the customer), but kept so a human sees it.
 *   - A failed send is retried up to 3 times, then stops and says why.
 *   - The document keeps only the 500 most recent finished items; waiting/sending items are never cut.
 *
 * This class holds ONE document object and mutates it in place — no ports, no real clock — so it
 * is tested completely by hand. Item field names are on-disk and OMI reads them.
 */

export const CLAIM_TTL_MS = 3 * 60 * 1000;
export const EXPIRY_MS = 12 * 60 * 60 * 1000;
export const MAX_RETRIES = 3;
export const KEEP_DONE_MAX = 500;
export const OUTBOX_STATUSES = ["cho", "dang-gui", "da-gui", "hong", "qua-han"] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export interface OutboxItem {
  id: string;
  kenh: string;
  nguoi: string;
  chu: string;
  /** Who asked to send: "bo-nao" (the brain) or "omi" (a human in OMI). */
  nguon: string;
  maHoiThoai: string;
  taoLuc: string;
  trangThai: OutboxStatus;
  nhanLuc: string;
  /** The machine that claimed it. */
  boi: string;
  guiLuc: string;
  loi: string;
  thuLai: number;
}

/** The outbox document (`hop-thu-cho-gui`). */
export interface OutboxBook {
  version: 1;
  muc: OutboxItem[];
  /** Running counter for ids. */
  dem: number;
  updatedAt: string;
}

/** What a machine receives when it claims: the item without bookkeeping fields (no `boi`). */
export interface ClaimedItem {
  id: string;
  kenh: string;
  nguoi: string;
  chu: string;
  maHoiThoai: string;
  taoLuc: string;
  nguon: string;
}

export interface EnqueueInput {
  channel: string;
  recipient: string;
  text: string;
  source?: string;
  conversationId?: string;
}

export interface ClaimInput {
  /** Restrict to one channel; empty = every channel. */
  channel?: string;
  /** The claiming machine's name. */
  by?: string;
  limit?: number;
}

export interface CompleteInput {
  id: string;
  ok: boolean;
  error?: string;
}

export function defaultOutboxBook(): OutboxBook {
  return { version: 1, muc: [], dem: 0, updatedAt: "" };
}

/** Repairs a document read from disk in place (missing list, missing counter). */
function normalise(book: unknown): OutboxBook {
  const b = book !== null && typeof book === "object" ? (book as Partial<OutboxBook>) : defaultOutboxBook();
  if (!Array.isArray(b.muc)) b.muc = [];
  if (!Number.isInteger(b.dem)) b.dem = 0;
  return b as OutboxBook;
}

/** The queue over one document object. Every method mutates `book` so the caller can write it back. */
export class Outbox {
  readonly book: OutboxBook;

  constructor(book?: unknown) {
    this.book = normalise(book ?? defaultOutboxBook());
  }

  /** Queues one message. Returns the item just queued. */
  enqueue(input: EnqueueInput, at: Date): OutboxItem {
    const b = this.book;
    b.dem += 1;
    const item: OutboxItem = {
      id: `cg_${at.getTime()}_${b.dem}`,
      kenh: String(input.channel), nguoi: String(input.recipient), chu: String(input.text), nguon: String(input.source ?? "bo-nao"),
      maHoiThoai: String(input.conversationId || `${input.channel}:${input.recipient}`),
      taoLuc: at.toISOString(), trangThai: "cho",
      nhanLuc: "", boi: "", guiLuc: "", loi: "", thuLai: 0
    };
    b.muc.push(item);
    b.updatedAt = at.toISOString();
    return item;
  }

  /** Housekeeping: waiting past expiry -> `qua-han`; claimed then silent -> back to `cho`. */
  sweep(at: Date): this {
    const t = at.getTime();
    for (const m of this.book.muc) {
      if (m.trangThai === "dang-gui" && t - Date.parse(m.nhanLuc) > CLAIM_TTL_MS) {
        m.trangThai = "cho"; m.nhanLuc = ""; m.boi = "";
      }
      if (m.trangThai === "cho" && t - Date.parse(m.taoLuc) > EXPIRY_MS) {
        m.trangThai = "qua-han"; m.loi = "cho qua 12 gio, khong gui nua";
      }
    }
    return this;
  }

  /** Machine `by` claims up to `limit` waiting items (of `channel`, or of every channel when empty). */
  claim(input: ClaimInput, at: Date): ClaimedItem[] {
    const channel = input.channel ?? "";
    const limit = input.limit ?? 10;
    this.sweep(at);
    const out: OutboxItem[] = [];
    for (const m of this.book.muc) {
      if (out.length >= limit) break;
      if (m.trangThai !== "cho") continue;
      if (channel && m.kenh !== channel) continue;
      m.trangThai = "dang-gui"; m.nhanLuc = at.toISOString(); m.boi = String(input.by ?? "");
      out.push(m);
    }
    this.book.updatedAt = at.toISOString();
    return out.map((m) => ({ id: m.id, kenh: m.kenh, nguoi: m.nguoi, chu: m.chu, maHoiThoai: m.maHoiThoai, taoLuc: m.taoLuc, nguon: m.nguon }));
  }

  /**
   * The machine reports the outcome. `ok` -> `da-gui`; otherwise retry (up to 3) then `hong`.
   * Returns the item, or `null` when it does not exist or is not being sent.
   */
  complete(input: CompleteInput, at: Date): OutboxItem | null {
    const m = this.book.muc.find((x) => x.id === input.id);
    if (!m || m.trangThai !== "dang-gui") return null;
    if (input.ok) {
      m.trangThai = "da-gui"; m.guiLuc = at.toISOString(); m.loi = "";
    } else {
      m.thuLai += 1;
      m.loi = String(input.error || "gui hong").slice(0, 300);
      if (m.thuLai >= MAX_RETRIES) { m.trangThai = "hong"; } else { m.trangThai = "cho"; m.nhanLuc = ""; m.boi = ""; }
    }
    this.book.updatedAt = at.toISOString();
    this.trim();
    return m;
  }

  /** Keeps every waiting/sending item; finished items only the 500 most recent. */
  trim(): this {
    const live = this.book.muc.filter((m) => m.trangThai === "cho" || m.trangThai === "dang-gui");
    const done = this.book.muc.filter((m) => m.trangThai !== "cho" && m.trangThai !== "dang-gui").slice(-KEEP_DONE_MAX);
    this.book.muc = [...live, ...done].sort((a, b) => a.taoLuc.localeCompare(b.taoLuc));
    return this;
  }

  /** Count per status — every status present, even at zero. */
  summary(): Record<OutboxStatus, number> {
    const counts = Object.fromEntries(OUTBOX_STATUSES.map((s) => [s, 0])) as Record<OutboxStatus, number>;
    for (const m of this.book.muc) counts[m.trangThai] = (counts[m.trangThai] ?? 0) + 1;
    return counts;
  }
}
