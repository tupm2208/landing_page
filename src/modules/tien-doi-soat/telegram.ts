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
