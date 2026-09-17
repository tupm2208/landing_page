/**
 * @file "Cần người" on Telegram (Đ6) — Desk's `handoff_notifier.js`, on the shop's landing.
 *
 * When the brain hands a conversation to a human, the on-duty group hears it on Telegram at once;
 * when nobody has taken it after N minutes, it hears it AGAIN (the overdue scan). The group can
 * answer from Telegram itself: `/xong <mã>` closes the handoff, `/tra <mã> <câu>` replies to the
 * customer through the same send path as OMI.
 *
 * Pure helpers here (texts, command parsing, the overdue rule); the module does the calls.
 */

import type { HttpClient } from "../../contract";

export interface HandoffLike {
  maHoiThoai: string;
  kenh: string;
  nguoi: string;
  lyDo: string;
  tinCuoi: string;
  baoLuc: string;
  xongLuc: string;
  /** When the overdue reminder went out; empty = not yet. */
  nhacLuc?: string;
}

const escapeHtml = (text: unknown) => String(text ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);

export function handoffAlertText(item: HandoffLike, kind: "moi" | "qua-han", minutes = 0): string {
  const head = kind === "moi" ? "🙋 <b>Cần người trả lời</b>" : `⏰ <b>Quá ${minutes} phút chưa ai nhận</b>`;
  return [
    head,
    `Hội thoại: <code>${escapeHtml(item.maHoiThoai)}</code>`,
    item.lyDo ? `Vì sao: ${escapeHtml(item.lyDo)}` : "",
    item.tinCuoi ? `Khách: “${escapeHtml(item.tinCuoi.slice(0, 300))}”` : "",
    `Trả lời: <code>/tra ${escapeHtml(item.maHoiThoai)} nội dung</code> · Xong: <code>/xong ${escapeHtml(item.maHoiThoai)}</code>`
  ].filter(Boolean).join("\n");
}

/** Waiting handoffs older than `minutes` that have not been reminded yet. */
export function overdueHandoffs<T extends HandoffLike>(items: T[], now: Date, minutes: number): T[] {
  const limit = Math.max(1, minutes) * 60 * 1000;
  return items.filter((m) => !m.xongLuc && !m.nhacLuc && now.getTime() - Date.parse(m.baoLuc) > limit);
}

export type TelegramCommand = { viec: "xong"; ma: string } | { viec: "tra"; ma: string; chu: string };

/** `/xong zalo:k1`, `/tra facebook:123 dạ còn ạ` (also `/tra@TenBot ...`). Anything else = null. */
export function parseTelegramCommand(text: unknown): TelegramCommand | null {
  const value = String(text ?? "").trim();
  const match = /^\/(xong|tra)(?:@\S+)?\s+(\S+)(?:\s+([\s\S]+))?$/i.exec(value);
  if (!match) return null;
  const viec = match[1]!.toLowerCase();
  const ma = match[2]!.slice(0, 160);
  if (!ma.includes(":")) return null;
  if (viec === "xong") return { viec: "xong", ma };
  const chu = String(match[3] ?? "").trim();
  return chu ? { viec: "tra", ma, chu: chu.slice(0, 2000) } : null;
}

/** One Bot API call. Never throws; the token never appears in the answer. */
export async function telegramCall(http: HttpClient, token: string, method: string, body: Record<string, unknown>): Promise<{ ok: boolean; loiNhan: string }> {
  if (!token) return { ok: false, loiNhan: "Chưa nhập token bot Telegram (Cấu hình → Telegram)." };
  try {
    const response = await http.fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST", timeoutMs: 8000, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    if (response.ok) return { ok: true, loiNhan: "" };
    const answer = (await response.json().catch(() => ({}))) as { description?: string };
    return { ok: false, loiNhan: `Telegram từ chối: ${String(answer.description ?? `HTTP ${response.status}`).replace(token, "•••")}` };
  } catch (e) {
    return { ok: false, loiNhan: `Không gọi được Telegram: ${(e instanceof Error ? e.message : String(e)).replace(token, "•••")}` };
  }
}
