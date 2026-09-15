/**
 * @file THE PAGE TOKENS — one token per Fanpage the shop connected.
 *
 * A shop sells from several pages (TopRun: four), and Meta accepts a reply only when it is sent
 * with the token of the page the customer wrote to. One token for the whole shop answered one page
 * and failed the others (15/09/2026). The thread remembers its page (`trang`), and the reply takes
 * that page's token from here.
 *
 * Tokens are secrets: only the send path reads them, and every HTTP view goes through
 * `publicPages`, which drops them. Pure functions over the book, like `conversations.ts`.
 */

/** Document name — on-disk contract. */
export const PAGE_TOKEN_DOCUMENT = "hop-thu-trang";

export interface PageToken {
  /** Page id — `entry.id` in Meta's webhook, `trang` on a thread. */
  ma: string;
  ten: string;
  token: string;
  /** ISO time the token was handed in. */
  capLuc: string;
}

export interface PageTokenBook {
  version: 1;
  /** Graph API version the tokens were issued for (`v23.0`); empty = the module default. */
  graph: string;
  trang: PageToken[];
  updatedAt: string;
}

/** What an HTTP reply may show about a page: never the token itself. */
export interface PublicPage {
  ma: string;
  ten: string;
  capLuc: string;
  coToken: boolean;
}

export function defaultPageTokenBook(): PageTokenBook {
  return { version: 1, graph: "", trang: [], updatedAt: "" };
}

const text = (v: unknown): string => String(v ?? "").trim();

/**
 * Pages as Sales Desk sends them (`{ pageId, name, accessToken }`, the old site's contract) or in
 * this build's names (`{ ma, ten, token }`). Entries without an id or a token are dropped; a page
 * listed twice keeps the last one.
 */
export function normaliseIncomingPages(raw: unknown): { ma: string; ten: string; token: string }[] {
  const byId = new Map<string, { ma: string; ten: string; token: string }>();
  for (const item of Array.isArray(raw) ? raw : []) {
    if (item === null || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const ma = text(r["ma"] ?? r["pageId"] ?? r["id"]).slice(0, 64);
    const token = text(r["token"] ?? r["accessToken"]);
    if (!ma || !token) continue;
    byId.set(ma, { ma, ten: text(r["ten"] ?? r["name"]).slice(0, 190), token });
  }
  return [...byId.values()];
}

/** Adds or replaces pages; pages not mentioned stay as they were. */
export function mergePages(book: Partial<PageTokenBook> | null, pages: { ma: string; ten: string; token: string }[], graphVersion: unknown, at: string): PageTokenBook {
  const current = Array.isArray(book?.trang) ? [...book.trang] : [];
  for (const page of pages) {
    const index = current.findIndex((p) => p.ma === page.ma);
    const entry: PageToken = { ma: page.ma, ten: page.ten || (index >= 0 ? current[index]!.ten : ""), token: page.token, capLuc: at };
    if (index >= 0) current[index] = entry;
    else current.push(entry);
  }
  return { version: 1, graph: text(graphVersion) || text(book?.graph), trang: current, updatedAt: at };
}

/** The token of one page, or "" when the shop never handed one in. */
export function tokenForPage(book: Partial<PageTokenBook> | null, pageId: unknown): string {
  const id = text(pageId);
  if (!id || !Array.isArray(book?.trang)) return "";
  return book.trang.find((p) => p.ma === id)?.token ?? "";
}

/** Pages without their tokens — the only shape that may leave the module over HTTP. */
export function publicPages(book: Partial<PageTokenBook> | null): PublicPage[] {
  return (Array.isArray(book?.trang) ? book.trang : []).map((p) => ({ ma: p.ma, ten: p.ten, capLuc: p.capLuc, coToken: p.token !== "" }));
}
