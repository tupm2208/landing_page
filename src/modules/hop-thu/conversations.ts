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
  /**
   * Addresses of the images in this message (Đ6). Meta's CDN links for what the customer sent, the
   * shop's own `/api/fanpage-media/…` for what we sent. Absent on text-only and older messages.
   */
  anh?: string[];
}

/** How the bot treats one conversation (Đ6, Desk's Zalo group setting). Wire values. */
export const BOT_MODES = ["auto", "suggest", "off"] as const;
export type BotMode = (typeof BOT_MODES)[number];

/** Channels whose new conversations start with the bot OFF: a personal account is not a shop page. */
export const BOT_OFF_BY_DEFAULT: readonly string[] = ["fb-ca-nhan"];

/** The order card a seller fills in the chat (Desk `save-order-draft`). Field names are wire. */
export interface OrderDraft {
  ma: string;
  ten: string;
  size: string;
  soLuong: number;
  gia: number;
  anh: string;
  tenNguoiNhan: string;
  dienThoai: string;
  diaChi: string;
  ghiChu: string;
  /** The order it became (`submit-order-draft`); empty while still a draft. */
  maDon: string;
  luuLuc: string;
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
  /** What the shop noted about this customer from the chat (web admin, 16/09/2026). Older threads have neither. */
  dienThoai?: string;
  diaChi?: string;
  /** Đ6: the customer profile (don-khach) this conversation belongs to. */
  maKhach?: string;
  /** Đ6: orders a person linked to this conversation, and suggestions they said "không phải" to. */
  donGan?: string[];
  donBoGoiY?: string[];
  /** Đ6: internal note about the customer. */
  ghiChu?: string;
  /** Đ6: bot mode of THIS conversation (absent = auto). A Zalo group can be internal (no bot, not a customer). */
  bot?: BotMode;
  daXacNhan?: boolean;
  noiBo?: boolean;
  /** Đ6: Zalo group form — customer name and order id typed by the shop. */
  tenKhach?: string;
  maDon?: string;
  theDatHang?: OrderDraft;
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
  const images = Math.max(message.soAnh, message.anh?.length ?? 0);
  return images > 0 ? `(${images} ảnh)` : "";
}

/** Image addresses worth keeping: http(s) or the shop's own media path, at most 10, no duplicates. */
export function cleanImages(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (const item of list) {
    const url = String(item ?? "").trim();
    if (url.length > 2000 || !(/^https?:\/\//i.test(url) || url.startsWith("/api/fanpage-media/"))) continue;
    if (!out.includes(url)) out.push(url);
    if (out.length >= 10) break;
  }
  return out;
}

function normalise(book: Partial<ConversationBook> | null): Conversation[] {
  const list = Array.isArray(book?.hoiThoai) ? book.hoiThoai : [];
  return list.filter((c): c is Conversation => c !== null && typeof c === "object" && typeof c.ma === "string");
}

/** Newest activity first — the order a person reads a desk in. */
function newestFirst(a: Conversation, b: Conversation): number {
  // Ties by id, so the "tải thêm" cursor is stable.
  return String(b.hoatDongLuc).localeCompare(String(a.hoatDongLuc)) || String(a.ma).localeCompare(String(b.ma));
}

function withThread(book: Partial<ConversationBook> | null, thread: Conversation, at: string): ConversationBook {
  const others = normalise(book).filter((c) => c.ma !== thread.ma);
  const next = [thread, ...others].sort(newestFirst).slice(0, THREAD_KEEP_MAX);
  return { version: 1, hoiThoai: next, updatedAt: at };
}

function threadFor(book: Partial<ConversationBook> | null, id: string, seed: Partial<Conversation>): Conversation {
  const found = normalise(book).find((c) => c.ma === id);
  if (found) return { ...found, tin: Array.isArray(found.tin) ? found.tin : [] };
  const kenh = text(seed.kenh);
  return {
    ma: id, kenh, nguoi: text(seed.nguoi), tenNguoi: text(seed.tenNguoi), trang: text(seed.trang),
    tin: [], soChuaDoc: 0, tinCuoi: "", chieuCuoi: "den", hoatDongLuc: "", docLuc: "",
    // 17/09/2026: a PERSONAL account's chats start with the bot off — the shop turns it on per
    // conversation with the bot switch in OMI. Stored, not implied, so the switch shows the truth.
    ...(BOT_OFF_BY_DEFAULT.includes(kenh) ? { bot: "off" as BotMode } : {})
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
  message: { kenh: string; nguoi: string; maTin?: string; chu?: string; soAnh?: number; luc?: string; tenNguoi?: string; trang?: string; baiViet?: string; anh?: string[] },
  at: string
): ConversationBook {
  const id = conversationId(message.kenh, message.nguoi);
  const seed = threadFor(book, id, message);
  const images = cleanImages(message.anh);
  const { thread, added } = appendMessage(seed, {
    maTin: text(message.maTin),
    chieu: "den",
    chu: String(message.chu ?? ""),
    soAnh: Math.max(0, Number(message.soAnh) || 0, images.length),
    luc: text(message.luc) || at,
    boi: "khach",
    trangThai: "",
    ...(text(message.baiViet) === "" ? {} : { baiViet: text(message.baiViet) }),
    ...(images.length === 0 ? {} : { anh: images })
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
  message: { kenh: string; nguoi: string; maTin?: string; chu?: string; soAnh?: number; luc?: string; boi?: string; trangThai?: string; anh?: string[]; trang?: string; tenNguoi?: string },
  at: string
): ConversationBook {
  const id = conversationId(message.kenh, message.nguoi);
  const seed = threadFor(book, id, message);
  const images = cleanImages(message.anh);
  const { thread, added } = appendMessage(seed, {
    maTin: text(message.maTin),
    chieu: "di",
    chu: String(message.chu ?? ""),
    soAnh: Math.max(0, Math.trunc(Number(message.soAnh) || 0), images.length),
    luc: text(message.luc) || at,
    boi: text(message.boi) || "nguoi",
    trangThai: text(message.trangThai) || "da-gui",
    ...(images.length === 0 ? {} : { anh: images })
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
  /** Page ids (comma-separated or array). Empty = every thread; set = only threads of those pages. */
  trang?: string | readonly string[];
  gioiHan?: number;
  /** Đ6 "tải thêm": the `conTruoc` cursor of the previous page — rows strictly older than it. */
  truoc?: string;
}

/** One row of the thread list: the thread WITHOUT its messages — a list of 300 threads must stay small. */
export type ThreadRow = Omit<Conversation, "tin"> & { soTin: number };

export function listThreads(book: Partial<ConversationBook> | null, filter: ThreadFilter = {}): ThreadRow[] {
  const channel = text(filter.kenh);
  const unreadOnly = text(filter.loc) === "chua-doc";
  const query = text(filter.q).toLowerCase();
  const pages = (typeof filter.trang === "string" || filter.trang === undefined ? text(filter.trang).split(",") : [...filter.trang]).map(text).filter((p) => p !== "");
  const limit = Math.min(Math.max(1, Number(filter.gioiHan) || 100), THREAD_KEEP_MAX);
  const [cursorAt, cursorId] = splitCursor(filter.truoc);
  return normalise(book)
    .filter((c) => cursorAt === "" || String(c.hoatDongLuc) < cursorAt || (String(c.hoatDongLuc) === cursorAt && String(c.ma) > cursorId))
    .filter((c) => (channel === "" || c.kenh === channel))
    .filter((c) => (!unreadOnly || Number(c.soChuaDoc) > 0))
    .filter((c) => pages.length === 0 || pages.includes(text(c.trang)))
    .filter((c) => query === "" || `${c.nguoi} ${c.tenNguoi} ${c.tinCuoi}`.toLowerCase().includes(query))
    .sort(newestFirst)
    .slice(0, limit)
    .map(({ tin, ...row }) => ({ ...row, soTin: (tin ?? []).length }));
}

/** The cursor after one row: its activity time and id. */
export function threadCursor(row: { hoatDongLuc: string; ma: string }): string {
  return `${row.hoatDongLuc}|${row.ma}`;
}

function splitCursor(raw: unknown): [string, string] {
  const value = text(raw);
  if (value === "") return ["", ""];
  const bar = value.indexOf("|");
  return bar < 0 ? [value, ""] : [value.slice(0, bar), value.slice(bar + 1)];
}

/** What a person may change about a conversation (Đ6). Absent field = unchanged. */
export interface ThreadInfoPatch {
  maKhach?: string;
  ghiChu?: string;
  ganDon?: string;
  boGanDon?: string;
  boGoiYDon?: string;
  bot?: string;
  daXacNhan?: boolean;
  noiBo?: boolean;
  tenKhach?: string;
  maDon?: string;
  theDatHang?: Partial<OrderDraft> | null;
}

/** Throws on a value a person could not have meant; the route turns it into a 400. */
export function applyThreadInfo(thread: Conversation, patch: ThreadInfoPatch, at: string): Conversation {
  const next: Conversation = { ...thread };
  const orderId = (v: unknown) => text(v).slice(0, 64);
  if (patch.maKhach !== undefined) { const v = text(patch.maKhach).slice(0, 64); if (v) next.maKhach = v; else delete next.maKhach; }
  if (patch.ghiChu !== undefined) { const v = String(patch.ghiChu ?? "").trim().slice(0, 1000); if (v) next.ghiChu = v; else delete next.ghiChu; }
  if (patch.ganDon !== undefined && orderId(patch.ganDon)) {
    const id = orderId(patch.ganDon);
    next.donGan = [...new Set([...(next.donGan ?? []), id])].slice(-20);
    next.donBoGoiY = (next.donBoGoiY ?? []).filter((x) => x !== id);
  }
  if (patch.boGanDon !== undefined) next.donGan = (next.donGan ?? []).filter((x) => x !== orderId(patch.boGanDon));
  if (patch.boGoiYDon !== undefined && orderId(patch.boGoiYDon)) next.donBoGoiY = [...new Set([...(next.donBoGoiY ?? []), orderId(patch.boGoiYDon)])].slice(-50);
  if (patch.bot !== undefined) {
    if (!(BOT_MODES as readonly string[]).includes(String(patch.bot))) throw new Error(`"bot" chỉ nhận ${BOT_MODES.join(", ")}.`);
    next.bot = patch.bot as BotMode;
  }
  if (patch.daXacNhan !== undefined) next.daXacNhan = patch.daXacNhan === true;
  if (patch.noiBo !== undefined) next.noiBo = patch.noiBo === true;
  if (patch.tenKhach !== undefined) { const v = text(patch.tenKhach).slice(0, 190); if (v) next.tenKhach = v; else delete next.tenKhach; }
  if (patch.maDon !== undefined) { const v = orderId(patch.maDon); if (v) next.maDon = v; else delete next.maDon; }
  if (patch.theDatHang !== undefined) {
    if (patch.theDatHang === null) delete next.theDatHang;
    else {
      const d = patch.theDatHang;
      const code = text(d.ma).slice(0, 64);
      if (!code) throw new Error("Thẻ đặt hàng cần mã sản phẩm.");
      const quantity = Math.trunc(Number(d.soLuong ?? 1));
      if (!Number.isFinite(quantity) || quantity < 1 || quantity > 50) throw new Error("Số lượng phải từ 1 đến 50.");
      next.theDatHang = {
        ma: code, ten: text(d.ten).slice(0, 255), size: text(d.size).slice(0, 32), soLuong: quantity,
        gia: Math.max(0, Math.round(Number(d.gia) || 0)), anh: text(d.anh).slice(0, 2000),
        tenNguoiNhan: text(d.tenNguoiNhan).slice(0, 190), dienThoai: String(d.dienThoai ?? "").replace(/[^0-9+]/g, "").slice(0, 20),
        diaChi: text(d.diaChi).slice(0, 500), ghiChu: String(d.ghiChu ?? "").trim().slice(0, 1000),
        maDon: text(d.maDon).slice(0, 64), luuLuc: at
      };
    }
  }
  return next;
}

/** Applies a patch to one thread in the book. `thread: null` = no such thread, book unchanged. */
export function setThreadInfo(book: Partial<ConversationBook> | null, id: string, patch: ThreadInfoPatch, at: string): { book: ConversationBook; thread: Conversation | null } {
  const threads = normalise(book);
  const found = threads.find((c) => c.ma === text(id));
  if (!found) return { book: { version: 1, hoiThoai: threads, updatedAt: String(book?.updatedAt ?? at) }, thread: null };
  const next = applyThreadInfo(found, patch, at);
  return { book: { version: 1, hoiThoai: threads.map((c) => (c.ma === found.ma ? next : c)), updatedAt: at }, thread: next };
}

/**
 * Notes the customer's phone and address on a thread (the shop read them in the chat). Digits
 * only for the phone; an empty value leaves what was there. Unknown thread = the book unchanged.
 */
export function setContact(book: Partial<ConversationBook> | null, id: string, contact: { dienThoai?: string; diaChi?: string }, at: string): ConversationBook {
  const threads = normalise(book);
  const found = threads.find((c) => c.ma === text(id));
  if (!found) return { version: 1, hoiThoai: threads, updatedAt: String(book?.updatedAt ?? at) };
  const phone = String(contact.dienThoai ?? "").replace(/[^0-9+]/g, "").slice(0, 20);
  const address = text(contact.diaChi).slice(0, 500);
  const next: Conversation = { ...found, ...(phone ? { dienThoai: phone } : {}), ...(address ? { diaChi: address } : {}) };
  return { version: 1, hoiThoai: threads.map((c) => (c.ma === found.ma ? next : c)), updatedAt: at };
}

/** One thread WITH its messages, oldest first. `null` when there is no such thread. */
export function threadOf(book: Partial<ConversationBook> | null, conversation: string): Conversation | null {
  return normalise(book).find((c) => c.ma === text(conversation)) ?? null;
}

/** How many threads still have something unread — the number on the sidebar badge. */
export function unreadThreadCount(book: Partial<ConversationBook> | null): number {
  return normalise(book).filter((c) => Number(c.soChuaDoc) > 0).length;
}
