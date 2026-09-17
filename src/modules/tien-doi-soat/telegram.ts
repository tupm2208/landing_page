/**
 * @file Telegram alerts for the SELLER (never the customer).
 *
 * Telegram is EACH MERCHANT'S OWN SETTING (Dũng decided 12/09: "these must be set up per
 * customer"). Token and chat id come from `ctx.config`, never from constants in code — and never
 * from page content either: page content is public, and a bot token in it hands the key to the
 * world. A shop that has not configured it gets NO alerts, rather than alerts to another shop's group.
 *
 * Alerts are fire-and-forget: they never block the main job and a failure only warns in the log.
 * A broken alert must not stop a customer from ordering.
 */

import type { HttpClient, Logger } from "../../contract";

export interface TelegramConfig {
  token?: string;
  chatId?: string;
}

export interface TelegramDeps {
  http: HttpClient;
  logger: Logger;
}

export class TelegramAlerts {
  private readonly token: string;
  private readonly chatId: string;

  constructor(private readonly deps: TelegramDeps, config: TelegramConfig = {}) {
    this.token = String(config.token || "").trim();
    this.chatId = String(config.chatId || "").trim();
  }

  /** Off until the shop has entered both the token and the group. */
  get enabled(): boolean {
    return this.token !== "" && this.chatId !== "";
  }

  /**
   * Sends one message and WAITS for Telegram's answer — the "Thử Telegram" button (Đ3). The reply
   * says what is wrong in words a seller can act on; the token never appears in it.
   */
  async sendNow(text: string): Promise<{ ok: boolean; loiNhan: string }> {
    if (this.token === "") return { ok: false, loiNhan: "Chưa nhập token bot Telegram." };
    if (this.chatId === "") return { ok: false, loiNhan: "Chưa nhập chat ID nhóm nhận báo động." };
    try {
      const response = await this.deps.http.fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: "POST", timeoutMs: 8000, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: this.chatId, text, parse_mode: "HTML" })
      });
      if (response.ok) return { ok: true, loiNhan: "Đã gửi tin thử vào nhóm Telegram." };
      const answer = (await response.json().catch(() => ({}))) as { description?: string };
      const why = String(answer.description ?? `HTTP ${response.status}`);
      return { ok: false, loiNhan: /chat not found/i.test(why) ? "Telegram không thấy nhóm: kiểm tra chat ID và đã thêm bot vào nhóm chưa." : /unauthorized/i.test(why) ? "Telegram không nhận token bot." : `Telegram từ chối: ${why}` };
    } catch (e) {
      return { ok: false, loiNhan: `Không gọi được Telegram: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /**
   * Sends one message to ANOTHER chat with the shop's own bot — a partner's Telegram (Đ4, Desk's
   * "Gửi đối tác"). Waits for the answer: the seller must know which partner did not get it.
   */
  async sendTo(chatId: string, text: string): Promise<{ ok: boolean; loiNhan: string }> {
    const target = String(chatId || "").trim();
    if (this.token === "") return { ok: false, loiNhan: "Chưa nhập token bot Telegram." };
    if (target === "") return { ok: false, loiNhan: "Đối tác chưa có Telegram chat ID." };
    try {
      const response = await this.deps.http.fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: "POST", timeoutMs: 8000, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: target, text, parse_mode: "HTML" })
      });
      if (response.ok) return { ok: true, loiNhan: "Đã gửi." };
      const answer = (await response.json().catch(() => ({}))) as { description?: string };
      const why = String(answer.description ?? `HTTP ${response.status}`);
      return { ok: false, loiNhan: /chat not found/i.test(why) ? "Telegram không thấy chat ID này (đối tác đã nhắn /start cho bot chưa?)." : `Telegram từ chối: ${why}` };
    } catch (e) {
      return { ok: false, loiNhan: `Không gọi được Telegram: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /** Sends an HTML message without waiting. Returns whether an alert was attempted at all. */
  notify(text: string): boolean {
    if (!this.enabled) return false;   // not configured: OFF, never alert at random
    Promise.resolve()
      .then(() => this.deps.http.fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: "POST",
        timeoutMs: 8000,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: this.chatId, text, parse_mode: "HTML" })
      }))
      .then((response) => { if (!response.ok) this.deps.logger.warn(`[tien] Telegram tu choi: HTTP ${response.status}`); })
      .catch((e: unknown) => this.deps.logger.warn(`[tien] khong bao duoc Telegram: ${e instanceof Error ? e.message : String(e)}`));
    return true;
  }
}
