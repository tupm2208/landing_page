/**
 * @file PRODUCTS OUTSIDE THE CATALOGUE (Desk `external_product_kit.js`, 04/09/2026) — Đ7.
 *
 * The case that made Desk build it: a seller sent a photo of "Boston 12 xanh sale 1.490k" that was
 * not on the site, the customer settled on it, and the bot matched "Boston 12" to catalogue codes
 * and sent an order card with the wrong code and price. A hand-made card gives the item ONE code
 * and ONE price; while it is `chot` the brain is told (through `training.knowledge`) to stay on it.
 *
 * Status: `chot` (settled) → `da_dat` (an order was made) | `quan_tam` (replaced by another, or 7
 * days without an order) | `bo` (the seller un-settled it). Pure functions over the book.
 */

export const EXTERNAL_DOCUMENT = "tro-ly-ai-sp-ngoai";
export const ACTIVE_MAX_MS = 7 * 24 * 3600 * 1000;
const KEEP_MAX = 500;

export interface ExternalProduct {
  id: string;
  maHoiThoai: string;
  ma: string;
  ten: string;
  size: string;
  gia: number;
  giaNhap: number;
  anh: string;
  loiNhan: string;
  trangThai: "chot" | "quan_tam" | "bo" | "da_dat";
  taoLuc: string;
  chotLuc: string;
  guiLuc: string;
  maDon: string;
}

export interface ExternalBook { version: 1; muc: ExternalProduct[] }
export const defaultExternalBook = (): ExternalBook => ({ version: 1, muc: [] });

const text = (v: unknown, n = 300): string => String(v ?? "").trim().slice(0, n);
const money = (v: unknown): number => {
  const n = Number(String(v ?? "").replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** "1490k", "1.490k", "1tr490", "1.490.000" → đồng; 0 when nothing reads as a price. */
export function parsePrice(value: unknown): number {
  const s = text(value, 500).toLowerCase().replace(/\s+/g, " ");
  if (!s) return 0;
  let m = /(\d)\s*tr(?:ieu|iệu)?\s*(\d{1,3})\b/.exec(s);
  if (m) return Number(m[1]) * 1000000 + Number(m[2]!.padEnd(3, "0")) * 1000;
  m = /(\d[\d.,]{0,6})\s*(k|nghin|nghìn|ngan|ngàn)\b/.exec(s);
  if (m) { const n = Number(m[1]!.replace(/[.,]/g, "")); if (n >= 50 && n <= 99999) return n * 1000; }
  m = /(\d[\d.,]{0,6})\s*(tr|trieu|triệu)\b/.exec(s);
  if (m) { const n = Number(m[1]!.replace(/,/g, ".")); if (n > 0 && n < 100) return Math.round(n * 1000000); }
  m = /\b(\d{1,2}[.,]\d{3}[.,]\d{3}|\d{6,8})\b/.exec(s);
  if (m) { const n = Number(m[1]!.replace(/[.,]/g, "")); if (n >= 100000 && n <= 99000000) return n; }
  return 0;
}

export function cardText(item: { ten: string; size: string; gia: number }): string {
  const head = [`🧾 ${item.ten}`, item.size ? `size ${item.size}` : "", item.gia ? `${item.gia.toLocaleString("vi-VN")}đ` : ""].filter(Boolean).join(" — ");
  return [head, "Mẫu này shop có sẵn, xác nhận là em đóng gửi ngay ạ.", "Bác cho em xin tên, SĐT và địa chỉ nhận hàng nhé. Chuyển khoản giữ đơn (tối thiểu 20%) hoặc nhận COD đều được ạ."].join("\n");
}

function newCode(book: ExternalBook, at: Date): string {
  const stamp = `${String(at.getMonth() + 1).padStart(2, "0")}${String(at.getDate()).padStart(2, "0")}`;
  const used = new Set(book.muc.map((i) => i.ma.toUpperCase()));
  for (let i = 1; i < 1000; i += 1) {
    const code = `NG-${stamp}-${String(i).padStart(2, "0")}`;
    if (!used.has(code)) return code;
  }
  return `NG-${stamp}-${at.getTime().toString(36).toUpperCase()}`;
}

/** Items still `chot` after 7 days fall back to `quan_tam`. Returns whether anything changed. */
export function expire(book: ExternalBook, now: Date): boolean {
  let changed = false;
  for (const item of book.muc) {
    if (item.trangThai === "chot" && now.getTime() - Date.parse(item.chotLuc || item.taoLuc) > ACTIVE_MAX_MS) { item.trangThai = "quan_tam"; changed = true; }
  }
  return changed;
}

export function activeFor(book: ExternalBook | null, conversation: string, now: Date): ExternalProduct | null {
  const list = (book?.muc ?? []).filter((i) => i.maHoiThoai === conversation && i.trangThai === "chot" && now.getTime() - Date.parse(i.chotLuc || i.taoLuc) <= ACTIVE_MAX_MS);
  return list.at(-1) ?? null;
}

/** "Gần đây" chips: one per name + price, newest first. */
export function recentItems(book: ExternalBook | null, limit = 30): ExternalProduct[] {
  const seen = new Set<string>();
  const out: ExternalProduct[] = [];
  for (const item of [...(book?.muc ?? [])].reverse()) {
    const key = `${item.ten.toLowerCase().replace(/\s+/g, " ")}|${item.gia}`;
    if (!item.ten || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/** Settles an item for a conversation; the one settled before in the same conversation becomes `quan_tam`. */
export function settle(book: ExternalBook | null, input: Record<string, unknown>, at: Date): { book: ExternalBook; item: ExternalProduct } {
  const current: ExternalBook = { version: 1, muc: (book?.muc ?? []).map((i) => ({ ...i })) };
  const maHoiThoai = text(input["maHoiThoai"], 191);
  const ten = text(input["ten"], 200);
  const gia = money(input["gia"]);
  if (!maHoiThoai) throw new Error("Chưa chọn hội thoại.");
  if (!ten) throw new Error("Nhập tên sản phẩm.");
  if (!gia) throw new Error("Nhập giá bán.");
  const ma = text(input["ma"], 32).toUpperCase().replace(/[^A-Z0-9-]/g, "") || newCode(current, at);
  for (const i of current.muc) if (i.maHoiThoai === maHoiThoai && i.trangThai === "chot") i.trangThai = "quan_tam";
  const item: ExternalProduct = {
    id: `extp_${at.getTime().toString(36)}_${current.muc.length + 1}`, maHoiThoai, ma, ten, size: text(input["size"], 32), gia, giaNhap: money(input["giaNhap"]),
    anh: text(input["anh"], 2000), loiNhan: text(input["loiNhan"], 2000), trangThai: "chot", taoLuc: at.toISOString(), chotLuc: at.toISOString(), guiLuc: "", maDon: ""
  };
  if (!item.loiNhan) item.loiNhan = cardText(item);
  current.muc.push(item);
  current.muc = current.muc.slice(-KEEP_MAX);
  return { book: current, item };
}

export function patchItem(book: ExternalBook | null, id: string, patch: Partial<ExternalProduct>): { book: ExternalBook; item: ExternalProduct | null } {
  let found: ExternalProduct | null = null;
  const muc = (book?.muc ?? []).map((i) => {
    if (i.id !== id) return i;
    found = { ...i, ...patch };
    return found;
  });
  return { book: { version: 1, muc }, item: found };
}
