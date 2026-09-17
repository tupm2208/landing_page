/**
 * @file THE LONG-TERM MESSAGE ARCHIVE (Đ6) — Sales Desk's `facebook_message_archive.js`, rebuilt.
 *
 * The conversation book keeps a working desk: 300 threads, 200 messages each. Training (Đ7) and a
 * seller scrolling back to "what did we promise this customer last year" need the WHOLE history,
 * and Meta keeps it. So the archive pulls it back through the Graph API, page by page, with a
 * CHECKPOINT after every step: a hosting that restarts, a token that expires or a person who presses
 * "Dừng" loses nothing — the next start continues from the cursor it stopped at.
 *
 * Three rules, the ones Desk learned:
 *   1. TEXT ONLY, from a date (default 01/01/2023). Image addresses are kept, images are not fetched.
 *   2. UPSERT by message id: running twice, or restarting from the beginning, never duplicates.
 *   3. The raw archive is never edited or deleted from the screen; "Quét lại từ đầu" resets only
 *      the cursors.
 *
 * Storage: a real table on MySQL; a capped JSON document on the file store (tests, trial runs).
 */

import type { DataStore, SchemaStep } from "../../contract";
import { cleanImages } from "./conversations";
import type { GraphApiClient } from "./graph-api";

export const ARCHIVE_TABLE = "hop_thu_luu_tru_tin";
/** The checkpoint document. */
export const BACKFILL_DOCUMENT = "hop-thu-luu-tru";
/** File-store fallback of the table. */
export const ARCHIVE_FALLBACK_DOCUMENT = "hop-thu-luu-tru-tin";
/** Fallback cap: a JSON document must stay small. MySQL has no cap. */
export const ARCHIVE_FALLBACK_MAX = 20000;
/** Default oldest date Desk archived from. */
export const DEFAULT_SINCE = "2023-01-01T00:00:00.000Z";

const CONVERSATIONS_PER_STEP = 25;
const MESSAGES_PER_PAGE = 100;
const MESSAGE_PAGES_PER_CONVERSATION = 10;

export const ARCHIVE_SCHEMA: SchemaStep[] = [
  {
    name: "001-luu-tru-tin",
    tables: [ARCHIVE_TABLE],
    sql: `
      CREATE TABLE IF NOT EXISTS hop_thu_luu_tru_tin (
        ma_tin VARCHAR(191) NOT NULL,
        ma_hoi_thoai VARCHAR(191) NOT NULL,
        trang VARCHAR(64) NOT NULL DEFAULT '',
        nguoi VARCHAR(128) NOT NULL DEFAULT '',
        -- 'den' = the customer wrote, 'di' = the page wrote.
        chieu VARCHAR(4) NOT NULL DEFAULT 'den',
        chu TEXT NULL,
        anh_json TEXT NULL,
        -- ISO 8601 UTC; sorts as text.
        luc VARCHAR(32) NOT NULL,
        luu_luc VARCHAR(32) NOT NULL,
        PRIMARY KEY (ma_tin),
        KEY idx_hop_thu_luu_tru_hoi_thoai (ma_hoi_thoai, luc),
        KEY idx_hop_thu_luu_tru_trang (trang, luc)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `
  }
];

/** One archived message. Field names are wire (OMI reads them like thread messages). */
export interface ArchivedMessage {
  maTin: string;
  maHoiThoai: string;
  trang: string;
  nguoi: string;
  chieu: "den" | "di";
  chu: string;
  anh: string[];
  luc: string;
}

interface FallbackBook {
  version: 1;
  tin: ArchivedMessage[];
}

/** The archive itself: upsert and read back, on whatever store the shop runs. */
export class MessageArchive {
  constructor(private readonly store: DataStore, private readonly now: () => Date) {}

  async upsert(messages: ArchivedMessage[]): Promise<number> {
    if (messages.length === 0) return 0;
    const at = this.now().toISOString();
    if (this.store.supportsTables) {
      const table = this.store.table(ARCHIVE_TABLE);
      for (const m of messages) {
        await table.upsert({
          ma_tin: m.maTin.slice(0, 191), ma_hoi_thoai: m.maHoiThoai.slice(0, 191), trang: m.trang.slice(0, 64), nguoi: m.nguoi.slice(0, 128),
          chieu: m.chieu, chu: m.chu.slice(0, 20000), anh_json: JSON.stringify(m.anh), luc: m.luc, luu_luc: at
        });
      }
      return messages.length;
    }
    await this.store.document<FallbackBook>(ARCHIVE_FALLBACK_DOCUMENT).update((current) => {
      const byId = new Map<string, ArchivedMessage>((current?.tin ?? []).map((m) => [m.maTin, m]));
      for (const m of messages) byId.set(m.maTin, m);
      const tin = [...byId.values()].sort((a, b) => a.luc.localeCompare(b.luc)).slice(-ARCHIVE_FALLBACK_MAX);
      return { version: 1, tin };
    }, { version: 1, tin: [] });
    return messages.length;
  }

  /** Messages of one conversation strictly older than `truoc` (ISO), newest `limit`, returned oldest first. */
  async older(input: { maHoiThoai: string; truoc?: string; limit?: number }): Promise<{ tin: ArchivedMessage[]; conNua: boolean }> {
    const limit = Math.min(Math.max(1, Number(input.limit) || 50), 200);
    const before = String(input.truoc ?? "").trim();
    if (this.store.supportsTables) {
      const where: Record<string, unknown> = { ma_hoi_thoai: input.maHoiThoai };
      if (before) where["luc"] = { "<": before };
      const rows = await this.store.table(ARCHIVE_TABLE).find({ where: where as never, orderBy: "luc desc", limit: limit + 1 });
      const list = rows.slice(0, limit).map(fromRow).reverse();
      return { tin: list, conNua: rows.length > limit };
    }
    const book = await this.store.document<FallbackBook>(ARCHIVE_FALLBACK_DOCUMENT).read(null);
    const all = (book?.tin ?? []).filter((m) => m.maHoiThoai === input.maHoiThoai && (!before || m.luc < before));
    return { tin: all.slice(-limit), conNua: all.length > limit };
  }

  /**
   * Đ7 training analysis: the next conversations AFTER `sau` (by conversation id), each with its
   * last `messagesPerConversation` messages. Reads at most 500 rows per call; a conversation cut by
   * that limit is left for the next batch (unless it is the only one, then it is truncated).
   */
  async conversationBatch(input: { sau: string; conversations: number; messagesPerConversation: number }): Promise<{ hoiThoai: { ma: string; tin: ArchivedMessage[] }[]; sau: string; het: boolean }> {
    const ROWS = 500;
    const after = String(input.sau ?? "");
    let rows: ArchivedMessage[];
    if (this.store.supportsTables) {
      const found = await this.store.table(ARCHIVE_TABLE).find({ where: { ma_hoi_thoai: { ">": after } }, orderBy: ["ma_hoi_thoai asc", "luc asc"], limit: ROWS });
      rows = found.map(fromRow);
    } else {
      const book = await this.store.document<FallbackBook>(ARCHIVE_FALLBACK_DOCUMENT).read(null);
      rows = (book?.tin ?? []).filter((m) => m.maHoiThoai > after)
        .sort((a, b) => a.maHoiThoai.localeCompare(b.maHoiThoai) || a.luc.localeCompare(b.luc)).slice(0, ROWS);
    }
    const groups: { ma: string; tin: ArchivedMessage[] }[] = [];
    for (const row of rows) {
      const last = groups.at(-1);
      if (last && last.ma === row.maHoiThoai) last.tin.push(row);
      else groups.push({ ma: row.maHoiThoai, tin: [row] });
    }
    const full = rows.length >= ROWS;
    if (full && groups.length > 1) groups.pop();
    const taken = groups.slice(0, Math.max(1, input.conversations)).map((g) => ({ ma: g.ma, tin: g.tin.slice(-Math.max(1, input.messagesPerConversation)) }));
    const cursor = taken.at(-1)?.ma ?? after;
    return { hoiThoai: taken, sau: cursor, het: taken.length === 0 || (!full && taken.length === groups.length) };
  }

  async count(): Promise<number> {
    if (this.store.supportsTables) return this.store.table(ARCHIVE_TABLE).count();
    return ((await this.store.document<FallbackBook>(ARCHIVE_FALLBACK_DOCUMENT).read(null))?.tin ?? []).length;
  }
}

function fromRow(row: Record<string, unknown>): ArchivedMessage {
  let images: unknown = [];
  try { images = JSON.parse(String(row["anh_json"] ?? "[]")); } catch { images = []; }
  return {
    maTin: String(row["ma_tin"] ?? ""), maHoiThoai: String(row["ma_hoi_thoai"] ?? ""), trang: String(row["trang"] ?? ""),
    nguoi: String(row["nguoi"] ?? ""), chieu: row["chieu"] === "di" ? "di" : "den", chu: String(row["chu"] ?? ""),
    anh: cleanImages(images), luc: String(row["luc"] ?? "")
  };
}

// ---------------------------------------------------------------------------------------------
// The backfill checkpoint
// ---------------------------------------------------------------------------------------------

/** Wire values the screen shows. */
export type BackfillStatus = "chua-chay" | "dang-chay" | "dang-dung" | "da-dung" | "xong" | "loi";

export interface PageProgress {
  ma: string;
  ten: string;
  /** Graph cursor of the NEXT conversations page; empty = from the newest. */
  sau: string;
  xong: boolean;
  soHoiThoai: number;
  soTin: number;
  soTrangHoiThoai: number;
  loi: string;
}

export interface BackfillState {
  version: 1;
  trangThai: BackfillStatus;
  tu: string;
  batDauLuc: string;
  capNhatLuc: string;
  loiCuoi: string;
  trang: Record<string, PageProgress>;
}

export function defaultBackfillState(): BackfillState {
  return { version: 1, trangThai: "chua-chay", tu: DEFAULT_SINCE, batDauLuc: "", capNhatLuc: "", loiCuoi: "", trang: {} };
}

/** Adds pages that were connected since the last run; `restart` sends every cursor back to the newest. */
export function prepareBackfill(state: BackfillState | null, pages: { ma: string; ten: string }[], options: { restart: boolean; since?: string; at: string }): BackfillState {
  const next: BackfillState = { ...defaultBackfillState(), ...(state ?? {}), trang: { ...(state?.trang ?? {}) } };
  if (options.since && Number.isFinite(Date.parse(options.since))) next.tu = new Date(options.since).toISOString();
  for (const page of pages) {
    const was = next.trang[page.ma];
    next.trang[page.ma] = options.restart || !was
      ? { ma: page.ma, ten: page.ten, sau: "", xong: false, soHoiThoai: 0, soTin: 0, soTrangHoiThoai: 0, loi: "" }
      : { ...was, ten: page.ten || was.ten, loi: "" };
  }
  next.trangThai = "dang-chay";
  next.loiCuoi = "";
  next.batDauLuc = options.at;
  next.capNhatLuc = options.at;
  return next;
}

interface GraphRow { id?: unknown; updated_time?: unknown; participants?: { data?: { id?: unknown; name?: unknown }[] }; message?: unknown; from?: { id?: unknown }; created_time?: unknown; attachments?: { data?: Record<string, unknown>[] } }

/**
 * ONE step: one page of conversations of the first unfinished Fanpage, each with its messages.
 * Mutates and returns `state`; the caller writes it back. Never throws: an error lands in the state.
 */
export async function backfillStep(
  state: BackfillState,
  deps: { graphFor(pageId: string): GraphApiClient | null; archive: MessageArchive; at: string }
): Promise<{ state: BackfillState; soHoiThoai: number; soTin: number }> {
  const page = Object.values(state.trang).find((p) => !p.xong);
  if (!page) {
    state.trangThai = "xong";
    state.capNhatLuc = deps.at;
    return { state, soHoiThoai: 0, soTin: 0 };
  }
  const graph = deps.graphFor(page.ma);
  if (!graph) {
    page.loi = "Trang chưa có token.";
    page.xong = true;
    state.capNhatLuc = deps.at;
    return { state, soHoiThoai: 0, soTin: 0 };
  }
  const since = state.tu || DEFAULT_SINCE;
  let conversations = 0;
  let messages = 0;
  try {
    const raw = await graph.read(`${encodeURIComponent(page.ma)}/conversations?fields=id,updated_time,participants&limit=${CONVERSATIONS_PER_STEP}${page.sau ? `&after=${encodeURIComponent(page.sau)}` : ""}`);
    const list = (Array.isArray(raw["data"]) ? raw["data"] : []) as GraphRow[];
    let reachedSince = false;
    for (const conversation of list) {
      const updated = toIso(conversation.updated_time);
      if (updated !== "" && updated < since) { reachedSince = true; break; }
      const customer = (conversation.participants?.data ?? []).find((p) => String(p.id ?? "") !== page.ma);
      const customerId = String(customer?.id ?? "");
      if (!customerId) continue;
      const rows: ArchivedMessage[] = [];
      let after = "";
      for (let n = 0; n < MESSAGE_PAGES_PER_CONVERSATION; n += 1) {
        const chunk = await graph.read(`${encodeURIComponent(String(conversation.id ?? ""))}/messages?fields=id,message,from,created_time,attachments&limit=${MESSAGES_PER_PAGE}${after ? `&after=${encodeURIComponent(after)}` : ""}`);
        const items = (Array.isArray(chunk["data"]) ? chunk["data"] : []) as GraphRow[];
        let old = false;
        for (const m of items) {
          const at = toIso(m.created_time);
          if (at !== "" && at < since) { old = true; break; }
          const images = cleanImages((m.attachments?.data ?? []).map((a) => {
            const imageData = a["image_data"] as { url?: unknown } | undefined;
            return String(imageData?.url ?? "");
          }));
          const text = String(m.message ?? "");
          if (!String(m.id ?? "") || (text.trim() === "" && images.length === 0)) continue;
          rows.push({
            maTin: String(m.id), maHoiThoai: `facebook:${customerId}`, trang: page.ma, nguoi: customerId,
            chieu: String(m.from?.id ?? "") === page.ma ? "di" : "den", chu: text, anh: images, luc: at || deps.at
          });
        }
        const paging = chunk["paging"] as { next?: unknown; cursors?: { after?: unknown } } | undefined;
        after = paging?.next ? String(paging.cursors?.after ?? "") : "";
        if (old || !after) break;
      }
      await deps.archive.upsert(rows);
      conversations += 1;
      messages += rows.length;
    }
    page.soHoiThoai += conversations;
    page.soTin += messages;
    page.soTrangHoiThoai += 1;
    page.loi = "";
    const paging = raw["paging"] as { next?: unknown; cursors?: { after?: unknown } } | undefined;
    const next = paging?.next ? String(paging.cursors?.after ?? "") : "";
    if (reachedSince || next === "") page.xong = true;
    else page.sau = next;
    if (!Object.values(state.trang).some((p) => !p.xong)) state.trangThai = "xong";
  } catch (e) {
    // The cursor stays where it was: the next start repeats this step, the upsert keeps it clean.
    page.loi = e instanceof Error ? e.message : String(e);
    state.loiCuoi = `${page.ten || page.ma}: ${page.loi}`;
    state.trangThai = "loi";
  }
  state.capNhatLuc = deps.at;
  return { state, soHoiThoai: conversations, soTin: messages };
}

function toIso(value: unknown): string {
  const t = Date.parse(String(value ?? ""));
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
}
