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

  /**
   * Sends one IMAGE by its public https address (an invoice, a transfer QR, a product photo).
   * Meta fetches the file itself, so the address must be reachable from the Internet.
   */
  async sendImage(recipientId: string, imageUrl: string, pageId = ""): Promise<Record<string, unknown>> {
    if (!this.pageToken) throw new Error("Chua co token trang — khong gui anh duoc.");
    if (!recipientId) throw new Error("Thieu nguoi nhan.");
    const url = String(imageUrl ?? "").trim();
    if (!/^https:\/\/[^\s]{1,2040}$/.test(url)) throw new Error("Anh gui khach phai la duong dan https cong khai.");

    const sender = String(pageId ?? "").trim() ? encodeURIComponent(String(pageId).trim()) : "me";
    const endpoint = `https://graph.facebook.com/${this.version}/${sender}/messages?access_token=${encodeURIComponent(this.pageToken)}`;
    const response = await this.http.fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId }, messaging_type: "RESPONSE",
        message: { attachment: { type: "image", payload: { url, is_reusable: true } } }
      })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Meta tu choi gui anh (${response.status}): ${detail.slice(0, 300)}`);
    }
    const parsed: unknown = await response.json();
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  }

  /**
   * Sends one text message. THROWS when Meta refuses (the caller reports, never swallows). Returns Meta's reply (`message_id`...).
   * `pageId`: send as THAT page (`/{pageId}/messages`, the token must be that page's); empty = `/me`, the token's own page.
   */
  /**
   * "Thử Facebook" (Desk `test-facebook-connection`, Đ3): does Meta accept this page token? Reads the
   * page's own name — nothing is posted. Never throws; the token never appears in the answer.
   */
  async whoAmI(pageId = ""): Promise<{ ok: boolean; ten: string; loiNhan: string }> {
    if (!this.pageToken) return { ok: false, ten: "", loiNhan: "Chưa có token trang." };
    const target = String(pageId ?? "").trim() ? encodeURIComponent(String(pageId).trim()) : "me";
    try {
      const response = await this.http.fetch(`https://graph.facebook.com/${this.version}/${target}?fields=id,name&access_token=${encodeURIComponent(this.pageToken)}`, { method: "GET", timeoutMs: 8000 });
      const parsed = (await response.json().catch(() => ({}))) as { name?: string; error?: { message?: string } };
      if (response.ok && parsed.name) return { ok: true, ten: String(parsed.name), loiNhan: `Meta nhận token trang "${parsed.name}".` };
      return { ok: false, ten: "", loiNhan: `Meta không nhận token: ${String(parsed.error?.message ?? `HTTP ${response.status}`).replace(this.pageToken, "•••")}` };
    } catch (e) {
      return { ok: false, ten: "", loiNhan: `Không gọi được Meta: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /**
   * "Nhắn tin" from a comment (Desk `private-reply-facebook-comment`, Đ6): ONE private message into
   * the commenter's inbox, addressed by the comment id. Meta allows one per comment, within 7 days.
   * Returns Meta's reply — `recipient_id` is the customer's Messenger id when Meta gives it.
   */
  async privateReply(commentId: string, text: string, pageId = ""): Promise<Record<string, unknown>> {
    if (!this.pageToken) throw new Error("Chua co token trang — khong nhan rieng duoc.");
    const target = String(commentId ?? "").trim();
    if (!target) throw new Error("Thieu ma binh luan.");
    const content = String(text ?? "").trim();
    if (!content) throw new Error("Tin rong — khong gui.");
    const sender = String(pageId ?? "").trim() ? encodeURIComponent(String(pageId).trim()) : "me";
    const response = await this.http.fetch(`https://graph.facebook.com/${this.version}/${sender}/messages?access_token=${encodeURIComponent(this.pageToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { comment_id: target }, message: { text: content } })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Meta tu choi nhan rieng (${response.status}): ${detail.slice(0, 300).replace(this.pageToken, "•••")}`);
    }
    const parsed: unknown = await response.json();
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  }

  /** One GET on the Graph API; throws with Meta's sentence (token masked) on refusal. */
  async read(pathAndQuery: string, timeoutMs = 15000): Promise<Record<string, unknown>> {
    if (!this.pageToken) throw new Error("Chưa có token trang.");
    const separator = pathAndQuery.includes("?") ? "&" : "?";
    const response = await this.http.fetch(`https://graph.facebook.com/${this.version}/${pathAndQuery}${separator}access_token=${encodeURIComponent(this.pageToken)}`, { method: "GET", timeoutMs });
    const parsed = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const error = (parsed["error"] ?? {}) as { message?: unknown };
      throw new Error(`Meta từ chối: ${String(error.message ?? `HTTP ${response.status}`).replace(this.pageToken, "•••")}`);
    }
    return parsed !== null && typeof parsed === "object" ? parsed : {};
  }

  /** The post a comment sits under (Desk "xem bài gốc", Đ6): text, picture, link, album pictures. */
  async postInfo(postId: string): Promise<{ ma: string; noiDung: string; anh: string; lienKet: string; dangLuc: string; anhCon: { anh: string; tieuDe: string }[] }> {
    const id = String(postId ?? "").trim();
    if (!/^[0-9A-Za-z_.-]{1,120}$/.test(id)) throw new Error("Mã bài viết không hợp lệ.");
    const raw = await this.read(`${encodeURIComponent(id)}?fields=message,created_time,permalink_url,full_picture,attachments{media,type,title,subattachments}`);
    const attachments = ((raw["attachments"] as { data?: unknown } | undefined)?.data ?? []) as Record<string, unknown>[];
    const pictures: { anh: string; tieuDe: string }[] = [];
    const pictureOf = (a: Record<string, unknown>) => String(((a["media"] as { image?: { src?: unknown } } | undefined)?.image?.src) ?? "");
    for (const a of Array.isArray(attachments) ? attachments : []) {
      const subs = ((a["subattachments"] as { data?: unknown } | undefined)?.data ?? []) as Record<string, unknown>[];
      for (const sub of Array.isArray(subs) && subs.length ? subs : [a]) {
        const src = pictureOf(sub);
        if (src) pictures.push({ anh: src, tieuDe: String(sub["title"] ?? "") });
      }
    }
    return {
      ma: String(raw["id"] ?? id), noiDung: String(raw["message"] ?? ""), anh: String(raw["full_picture"] ?? ""),
      lienKet: String(raw["permalink_url"] ?? ""), dangLuc: String(raw["created_time"] ?? ""), anhCon: pictures.slice(0, 40)
    };
  }

  async sendText(recipientId: string, text: string, pageId = ""): Promise<Record<string, unknown>> {
    if (!this.pageToken) throw new Error("Chua co token trang — khong gui tin duoc.");
    if (!recipientId) throw new Error("Thieu nguoi nhan.");
    const content = String(text ?? "").trim();
    if (!content) throw new Error("Tin rong — khong gui.");

    const sender = String(pageId ?? "").trim() ? encodeURIComponent(String(pageId).trim()) : "me";
    const url = `https://graph.facebook.com/${this.version}/${sender}/messages?access_token=${encodeURIComponent(this.pageToken)}`;
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
