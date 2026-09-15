/**
 * @file THE CONVERSATION BOOK — messages grouped into threads, both directions.
 *
 * The inbox document keeps EVENTS: Meta's raw packets and the messages OMI pushed in. That is the
 * right shape for a relay, and the wrong shape for a screen. A person answering a customer reads a
 * THREAD: what the customer said, what we replied, in order, with the unanswered ones on top.
 *
 * THREE THINGS THIS FIXES, all of which the event log cannot do:
 *
 * 1. WHAT WE SENT IS KEPT TOO. Until now an outgoing message was emitted on the bus and forgotten,
 *    so any chat view would show half a conversation — every customer question, no answer. A
 *    seller taking over from the bot could not see what the bot had already promised.
 *
 * 2. ONE THREAD ID ACROSS THE SYSTEM. `<kênh>:<người>` is exactly the `maHoiThoai` the brain
 *    receives and the handoff list uses, so "conversation waiting for a human" and "this thread on
 *    screen" are the same string, not two ideas that drift.
 *
 * 3. UNREAD IS COUNTED WHERE IT HAPPENS. A message in increments it; opening the thread clears it.
 *    Nobody has to diff timestamps on the client and get it subtly wrong.
 *
 * Everything here is a PURE function over the book: no clock, no store, no network. The module
 * calls them inside `document.update()`, which is the only writer.
 */

/** Which way a message went. Wire values — OMI renders on them. */
export type Direction = "den" | "di";

/** One message of a thread. Field names are wire (OMI reads them). */
export interface ThreadMessage {
  maTin: string;
  chieu: Direction;
  chu: string;
  soAnh: number;
  luc: string;
  /** Who produced it: `khach`, `bo-nao`, `omi`, `nguoi`. */
  boi: string;
  /** Outgoing only: `da-gui` (Graph API accepted it) or `cho-gui` (queued for the on-duty machine). */
  trangThai: string;
  /** Comment line only: the post this comment sits under. */
  baiViet?: string;
}

export interface Conversation {
  /** `<kênh>:<người>` — the same id the brain and the handoff list use. */
  ma: string;
  kenh: string;
  nguoi: string;
  tenNguoi: string;
  /** Fanpage id (Meta line only). */
  trang: string;
  tin: ThreadMessage[];
  soChuaDoc: number;
  tinCuoi: string;
  chieuCuoi: Direction;
  hoatDongLuc: string;
  docLuc: string;
}

export interface ConversationBook {
  version: 1;
  hoiThoai: Conversation[];
  updatedAt: string;
}

/**
 * How many threads and how many messages per thread survive a trim.
 *
 * These are small on purpose: this is a working desk, not an archive. A shop that needs the full
 * history reads it from Meta, which keeps it anyway. Keeping 50,000 messages in one JSON document
 * is how the old site's store grew to 28 MB and every write got slower.
 */
export const THREAD_KEEP_MAX = 300;
export const MESSAGE_KEEP_MAX = 200;

const PREVIEW_MAX = 300;

export function defaultConversationBook(): ConversationBook {
  return { version: 1, hoiThoai: [], updatedAt: "" };
}

const text = (v: unknown): string => String(v ?? "").trim();

/** The id of the thread a message belongs to. */
export function conversationId(channel: unknown, person: unknown): string {
  return `${text(channel)}:${text(person)}`;
}

/** A one-line preview for the thread list: no newlines, capped, "(ảnh)" when there is no text. */
function previewOf(message: ThreadMessage): string {
  const line = message.chu.replace(/\s+/g, " ").trim();
  if (line !== "") return line.slice(0, PREVIEW_MAX);
  return message.soAnh > 0 ? `(${message.soAnh} ảnh)` : "";
}

function normalise(book: Partial<ConversationBook> | null): Conversation[] {
  const list = Array.isArray(book?.hoiThoai) ? book.hoiThoai : [];
  return list.filter((c): c is Conversation => c !== null && typeof c === "object" && typeof c.ma === "string");
}

/** Newest activity first — the order a person reads a desk in. */
function newestFirst(a: Conversation, b: Conversation): number {
  return String(b.hoatDongLuc).localeCompare(String(a.hoatDongLuc));
}

function withThread(book: Partial<ConversationBook> | null, thread: Conversation, at: string): ConversationBook {
  const others = normalise(book).filter((c) => c.ma !== thread.ma);
  const next = [thread, ...others].sort(newestFirst).slice(0, THREAD_KEEP_MAX);
  return { version: 1, hoiThoai: next, updatedAt: at };
}

function threadFor(book: Partial<ConversationBook> | null, id: string, seed: Partial<Conversation>): Conversation {
  const found = normalise(book).find((c) => c.ma === id);
  if (found) return { ...found, tin: Array.isArray(found.tin) ? found.tin : [] };
  return {
    ma: id, kenh: text(seed.kenh), nguoi: text(seed.nguoi), tenNguoi: text(seed.tenNguoi), trang: text(seed.trang),
    tin: [], soChuaDoc: 0, tinCuoi: "", chieuCuoi: "den", hoatDongLuc: "", docLuc: ""
  };
}

/**
 * Appends a message, keeping the thread ordered by time and free of duplicates.
 *
 * Deduplication is by message id and matters in practice: Meta retries a webhook whenever we
 * answer anything but 200, and OMI re-scans a screen it has already read. Filing the same message
 * twice would double every unread count and show the customer saying it twice.
 */
function appendMessage(thread: Conversation, message: ThreadMessage): { thread: Conversation; added: boolean } {
  if (message.maTin !== "" && thread.tin.some((m) => m.maTin === message.maTin)) return { thread, added: false };
  const tin = [...thread.tin, message]
    .sort((a, b) => String(a.luc).localeCompare(String(b.luc)))
    .slice(-MESSAGE_KEEP_MAX);
  const last = tin[tin.length - 1] ?? message;
  return {
    thread: {
      ...thread, tin,
      tinCuoi: previewOf(last),
      chieuCuoi: last.chieu,
      hoatDongLuc: last.luc
    },
    added: true
  };
}

/** A message FROM a customer. Raises the unread count; the thread jumps to the top. */
export function fileIncoming(
  book: Partial<ConversationBook> | null,
  message: { kenh: string; nguoi: string; maTin?: string; chu?: string; soAnh?: number; luc?: string; tenNguoi?: string; trang?: string; baiViet?: string },
  at: string
): ConversationBook {
  const id = conversationId(message.kenh, message.nguoi);
  const seed = threadFor(book, id, message);
  const { thread, added } = appendMessage(seed, {
    maTin: text(message.maTin),
    chieu: "den",
    chu: String(message.chu ?? ""),
    soAnh: Math.max(0, Number(message.soAnh) || 0),
    luc: text(message.luc) || at,
    boi: "khach",
    trangThai: "",
    ...(text(message.baiViet) === "" ? {} : { baiViet: text(message.baiViet) })
  });
  if (!added) return { version: 1, hoiThoai: normalise(book), updatedAt: String(book?.updatedAt ?? at) };
  return withThread(book, {
    ...thread,
    // A name read off the screen (OMI line) may arrive later than the first message — take it when it comes.
    tenNguoi: text(message.tenNguoi) || thread.tenNguoi,
    trang: text(message.trang) || thread.trang,
    soChuaDoc: thread.soChuaDoc + 1
  }, at);
}

/** A message WE sent — by the bot, or by a person in OMI. Never counts as unread. */
export function fileOutgoing(
  book: Partial<ConversationBook> | null,
  message: { kenh: string; nguoi: string; maTin?: string; chu?: string; luc?: string; boi?: string; trangThai?: string },
  at: string
): ConversationBook {
  const id = conversationId(message.kenh, message.nguoi);
  const seed = threadFor(book, id, message);
  const { thread, added } = appendMessage(seed, {
    maTin: text(message.maTin),
    chieu: "di",
    chu: String(message.chu ?? ""),
    soAnh: 0,
    luc: text(message.luc) || at,
    boi: text(message.boi) || "nguoi",
    trangThai: text(message.trangThai) || "da-gui"
  });
  if (!added) return { version: 1, hoiThoai: normalise(book), updatedAt: String(book?.updatedAt ?? at) };
  return withThread(book, thread, at);
}

/** The on-duty machine reported a queued message as really sent (or failed). */
export function markOutgoingState(book: Partial<ConversationBook> | null, messageId: string, state: string, at: string): ConversationBook {
  const id = text(messageId);
  const threads = normalise(book);
  const found = threads.find((c) => (c.tin ?? []).some((m) => m.maTin === id));
  if (!found || id === "") return { version: 1, hoiThoai: threads, updatedAt: String(book?.updatedAt ?? at) };
  const thread = { ...found, tin: (found.tin ?? []).map((m) => (m.maTin === id ? { ...m, trangThai: text(state) } : m)) };
  return withThread(book, thread, at);
}

/** A person opened the thread: nothing is unread any more. */
export function markRead(book: Partial<ConversationBook> | null, conversation: string, at: string): ConversationBook {
  const threads = normalise(book);
  const found = threads.find((c) => c.ma === text(conversation));
  if (!found) return { version: 1, hoiThoai: threads, updatedAt: String(book?.updatedAt ?? at) };
  return withThread(book, { ...found, soChuaDoc: 0, docLuc: at }, at);
}

export interface ThreadFilter {
  kenh?: string;
  /** `tat-ca` (default) or `chua-doc`. */
  loc?: string;
  /** Free text over the person, their name and the last message. */
  q?: string;
  gioiHan?: number;
}

/** One row of the thread list: the thread WITHOUT its messages — a list of 300 threads must stay small. */
export type ThreadRow = Omit<Conversation, "tin"> & { soTin: number };

export function listThreads(book: Partial<ConversationBook> | null, filter: ThreadFilter = {}): ThreadRow[] {
  const channel = text(filter.kenh);
  const unreadOnly = text(filter.loc) === "chua-doc";
  const query = text(filter.q).toLowerCase();
  const limit = Math.min(Math.max(1, Number(filter.gioiHan) || 100), THREAD_KEEP_MAX);
  return normalise(book)
    .filter((c) => (channel === "" || c.kenh === channel))
    .filter((c) => (!unreadOnly || Number(c.soChuaDoc) > 0))
    .filter((c) => query === "" || `${c.nguoi} ${c.tenNguoi} ${c.tinCuoi}`.toLowerCase().includes(query))
    .sort(newestFirst)
    .slice(0, limit)
    .map(({ tin, ...row }) => ({ ...row, soTin: (tin ?? []).length }));
}

/** One thread WITH its messages, oldest first. `null` when there is no such thread. */
export function threadOf(book: Partial<ConversationBook> | null, conversation: string): Conversation | null {
  return normalise(book).find((c) => c.ma === text(conversation)) ?? null;
}

/** How many threads still have something unread — the number on the sidebar badge. */
export function unreadThreadCount(book: Partial<ConversationBook> | null): number {
  return normalise(book).filter((c) => Number(c.soChuaDoc) > 0).length;
}
