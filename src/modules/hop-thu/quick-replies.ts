/**
 * @file Quick reply templates (Đ6) — Desk's `facebookQuickReplies`: a shortcut (`#stk`), the text,
 * an optional image (a transfer QR, "how to measure your foot").
 *
 * Desk kept them in the browser and copied them to its store; one machine's templates were missing
 * on the next. Here they live on the shop's landing, so every OMI and the web admin see the same
 * list. Pure functions over the book; the module is the only writer.
 */

import { cleanImages } from "./conversations";

export const QUICK_REPLY_DOCUMENT = "hop-thu-mau-tra-loi";
export const QUICK_REPLY_MAX = 200;

export interface QuickReply {
  ma: string;
  tat: string;
  chu: string;
  anhUrl: string;
  suaLuc: string;
}

export interface QuickReplyBook {
  version: 1;
  mau: QuickReply[];
  dem: number;
}

export function defaultQuickReplyBook(): QuickReplyBook {
  return { version: 1, mau: [], dem: 0 };
}

/** Adds or replaces one template. Throws a sentence for the screen when the input is unusable. */
export function saveQuickReply(book: QuickReplyBook | null, input: Record<string, unknown>, at: Date): { book: QuickReplyBook; mau: QuickReply } {
  const current: QuickReplyBook = { ...defaultQuickReplyBook(), ...(book ?? {}), mau: [...(book?.mau ?? [])] };
  const shortcut = String(input["tat"] ?? "").trim().replace(/^#+/, "").slice(0, 40);
  const text = String(input["chu"] ?? "").trim().slice(0, 2000);
  const image = cleanImages([input["anhUrl"]])[0] ?? "";
  if (!shortcut) throw new Error("Nhập từ viết tắt cho mẫu.");
  if (!text && !image) throw new Error("Mẫu cần nội dung hoặc ảnh.");
  const id = String(input["ma"] ?? "").trim();
  const clash = current.mau.find((m) => m.tat.toLowerCase() === shortcut.toLowerCase() && m.ma !== id);
  if (clash) throw new Error(`Từ viết tắt #${shortcut} đã có mẫu khác.`);
  const index = id ? current.mau.findIndex((m) => m.ma === id) : -1;
  if (id && index < 0) throw new Error("Không thấy mẫu cần sửa.");
  if (index < 0 && current.mau.length >= QUICK_REPLY_MAX) throw new Error(`Tối đa ${QUICK_REPLY_MAX} mẫu.`);
  if (index < 0) current.dem += 1;
  const entry: QuickReply = { ma: index >= 0 ? id : `mau_${at.getTime()}_${current.dem}`, tat: shortcut, chu: text, anhUrl: image, suaLuc: at.toISOString() };
  if (index >= 0) current.mau[index] = entry;
  else current.mau.push(entry);
  return { book: current, mau: entry };
}

export function deleteQuickReply(book: QuickReplyBook | null, id: string): { book: QuickReplyBook; found: boolean } {
  const current: QuickReplyBook = { ...defaultQuickReplyBook(), ...(book ?? {}), mau: [...(book?.mau ?? [])] };
  const before = current.mau.length;
  current.mau = current.mau.filter((m) => m.ma !== String(id ?? "").trim());
  return { book: current, found: current.mau.length !== before };
}
