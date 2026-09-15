/**
 * @file Talking to the Meta Graph API: sending a text message to a customer.
 *
 * This class does NOT open the network itself: it receives the `HttpClient` port. That is why the
 * tests run the whole send path without calling Meta once — and why trial mode (which wraps the
 * client) can refuse the call before it leaves the machine.
 */

import type { HttpClient } from "../../contract";

export const GRAPH_VERSION = "v21.0";

/** A Graph API client for one page token. */
export class GraphApiClient {
  constructor(
    private readonly http: HttpClient,
    private readonly pageToken: string,
    private readonly version: string = GRAPH_VERSION
  ) {}

  /**
   * Replies UNDER a public comment. A different endpoint from `sendText` on purpose: answering a
   * public question in a private inbox leaves the question looking unanswered to everyone else
   * reading the post — which is the whole reason a shop answers comments at all.
   */
  async replyToComment(commentId: string, text: string): Promise<Record<string, unknown>> {
    if (!this.pageToken) throw new Error("Chua co token trang — khong tra loi binh luan duoc.");
    const target = String(commentId ?? "").trim();
    if (!target) throw new Error("Thieu ma binh luan can tra loi.");
    const content = String(text ?? "").trim();
    if (!content) throw new Error("Tin rong — khong gui.");

    const url = `https://graph.facebook.com/${this.version}/${encodeURIComponent(target)}/comments?access_token=${encodeURIComponent(this.pageToken)}`;
    const response = await this.http.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Meta tu choi tra loi binh luan (${response.status}): ${detail.slice(0, 300)}`);
    }
    const parsed: unknown = await response.json();
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  }

  /** Sends one text message. THROWS when Meta refuses (the caller reports, never swallows). Returns Meta's reply (`message_id`...). */
  async sendText(recipientId: string, text: string): Promise<Record<string, unknown>> {
    if (!this.pageToken) throw new Error("Chua co token trang — khong gui tin duoc.");
    if (!recipientId) throw new Error("Thieu nguoi nhan.");
    const content = String(text ?? "").trim();
    if (!content) throw new Error("Tin rong — khong gui.");

    const url = `https://graph.facebook.com/${this.version}/me/messages?access_token=${encodeURIComponent(this.pageToken)}`;
    const response = await this.http.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { text: content } })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Meta tu choi gui tin (${response.status}): ${detail.slice(0, 300)}`);
    }
    const parsed: unknown = await response.json();
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  }
}
