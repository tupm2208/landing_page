/**
 * @file The bot's CONVERSATION MEMORY lives on the landing (decided 14/09/2026).
 *
 * The landing holds all of the customer's data; Xeon keeps nothing. The engine on Xeon reads the
 * state before every turn and writes it after, through two service routes in `module.ts`. The
 * state is opaque here: the engine masks phone numbers itself before writing (`assertNoStoredPII`);
 * this side only stores and trims.
 */

/** Document name — on-disk contract. */
export const MEMORY_DOCUMENT = "cong-bo-nao-tri-nho";
/** Keep the 2000 most recent conversations. The engine sets its own 6-hour session boundary; this only stops unbounded growth. */
export const MAX_CONVERSATIONS = 2000;
export const MAX_STATE_BYTES = 96 * 1024;
export const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9_.:@-]{1,160}$/;

export interface RememberedConversation {
  trangThai: Record<string, unknown>;
  capNhatLuc: string;
}

/** The memory document: conversation id -> state. */
export interface MemoryBook {
  version: 1;
  hoiThoai: Record<string, RememberedConversation>;
}

export function defaultMemoryBook(): MemoryBook {
  return { version: 1, hoiThoai: {} };
}

/** A document read from disk is used only when it has the expected shape. */
export function asMemoryBook(value: unknown): MemoryBook {
  const v = value as Partial<MemoryBook> | null;
  return v !== null && typeof v === "object" && v.hoiThoai !== undefined && typeof v.hoiThoai === "object" ? (v as MemoryBook) : defaultMemoryBook();
}

/** Whether a state is storable: a plain object, at most `MAX_STATE_BYTES` as JSON. */
export function stateProblem(state: unknown): "thieu_trang_thai" | "trang_thai_qua_lon" | null {
  if (!state || typeof state !== "object" || Array.isArray(state)) return "thieu_trang_thai";
  if (Buffer.byteLength(JSON.stringify(state), "utf8") > MAX_STATE_BYTES) return "trang_thai_qua_lon";
  return null;
}

/** Writes one conversation's state into the book (in place) and drops the oldest beyond the cap. */
export function rememberConversation(book: MemoryBook, conversationId: string, state: Record<string, unknown>, at: string): MemoryBook {
  book.hoiThoai[conversationId] = { trangThai: state, capNhatLuc: at };
  const ids = Object.keys(book.hoiThoai);
  if (ids.length > MAX_CONVERSATIONS) {
    ids.sort((a, b) => String(book.hoiThoai[a]?.capNhatLuc).localeCompare(String(book.hoiThoai[b]?.capNhatLuc)));
    for (const id of ids.slice(0, ids.length - MAX_CONVERSATIONS)) delete book.hoiThoai[id];
  }
  return book;
}
