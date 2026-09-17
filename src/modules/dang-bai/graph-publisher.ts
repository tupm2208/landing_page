/**
 * @file Publishing on a Fanpage through the Graph API — albums, schedules, edits, comments.
 *
 * Like `hop-thu/graph-api.ts` this class never opens the network itself: it takes the `HttpClient`
 * port, so every test drives the whole publish path against a fake Meta.
 *
 * Pictures go the way Desk settled (18/08/2026): each image is uploaded to the page UNPUBLISHED
 * (`published=false`, `temporary=true`) by its public address, then the post attaches them with
 * `attached_media`. That is the only shape Meta accepts for an album that is also SCHEDULED.
 */

import type { HttpClient } from "../../contract";

export class GraphError extends Error {
  constructor(message: string, readonly code: number) {
    super(message);
    this.name = "GraphError";
  }
}

/** Codes that mean "stop and let a person look": spam block, token dead, permission missing. */
export function isBlockingGraphError(code: number): boolean {
  return [368, 190, 10, 200, 230].includes(Number(code));
}

export interface PostReading {
  daDang: boolean;
  duongDan: string;
  taoLuc: string;
  camXuc: number;
  binhLuan: number;
  chiaSe: number;
  tiepCan: number;
}

export class GraphPublisher {
  constructor(
    private readonly http: HttpClient,
    private readonly token: string,
    private readonly version: string
  ) {}

  private url(path: string): string {
    return `https://graph.facebook.com/${this.version}/${path}`;
  }

  private async call(method: string, path: string, params: Record<string, string> = {}): Promise<Record<string, unknown>> {
    if (!this.token) throw new GraphError("Trang chưa có token — kết nối lại Fanpage ở màn Kết nối.", 190);
    const form = new URLSearchParams({ ...params, access_token: this.token });
    const isRead = method === "GET" || method === "DELETE";
    const target = isRead ? `${this.url(path)}${path.includes("?") ? "&" : "?"}${form.toString()}` : this.url(path);
    const response = await this.http.fetch(target, {
      method, timeoutMs: 30000,
      ...(isRead ? {} : { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() })
    });
    const parsed = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const error = (parsed["error"] ?? {}) as { message?: unknown; code?: unknown };
      throw new GraphError(String(error.message ?? `Meta trả HTTP ${response.status}`).split(this.token).join("•••"), Number(error.code ?? 0));
    }
    return parsed !== null && typeof parsed === "object" ? parsed : {};
  }

  /** One unpublished picture by its public address; returns the media id to attach. */
  async uploadPhoto(pageId: string, imageUrl: string): Promise<string> {
    const r = await this.call("POST", `${encodeURIComponent(pageId)}/photos`, { url: imageUrl, published: "false", temporary: "true" });
    const id = String(r["id"] ?? "");
    if (!id) throw new GraphError(`Meta không nhận ảnh ${imageUrl}.`, 0);
    return id;
  }

  /** Creates the post; with `scheduledUnix` Meta keeps it and publishes at that time on its own. */
  async createPost(pageId: string, input: { message: string; link: string; mediaIds: string[]; scheduledUnix: number; textPreset?: string }): Promise<{ maMeta: string; maBai: string }> {
    const params: Record<string, string> = {};
    if (input.textPreset) params["text_format_preset_id"] = input.textPreset;
    if (input.message) params["message"] = input.message;
    if (input.link) params["link"] = input.link;
    if (input.mediaIds.length > 0) params["attached_media"] = JSON.stringify(input.mediaIds.map((id) => ({ media_fbid: id })));
    if (input.scheduledUnix > 0) {
      params["published"] = "false";
      params["scheduled_publish_time"] = String(input.scheduledUnix);
    }
    const r = await this.call("POST", `${encodeURIComponent(pageId)}/feed`, params);
    const id = String(r["id"] ?? "");
    return { maMeta: id, maBai: String(r["post_id"] ?? id) };
  }

  /** Changes the text (and, for a scheduled post, the time). */
  async updatePost(id: string, input: { message?: string; scheduledUnix?: number }): Promise<void> {
    const params: Record<string, string> = {};
    if (input.message !== undefined) params["message"] = input.message;
    if (input.scheduledUnix !== undefined && input.scheduledUnix > 0) params["scheduled_publish_time"] = String(input.scheduledUnix);
    await this.call("POST", encodeURIComponent(id), params);
  }

  /** A scheduled post goes live now. */
  async publishNow(id: string): Promise<void> {
    await this.call("POST", encodeURIComponent(id), { is_published: "true" });
  }

  async remove(id: string): Promise<void> {
    await this.call("DELETE", encodeURIComponent(id));
  }

  async readPost(id: string): Promise<PostReading> {
    const r = await this.call("GET", `${encodeURIComponent(id)}?fields=is_published,permalink_url,created_time,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)`);
    const total = (v: unknown) => Number(((v as { summary?: { total_count?: unknown } } | undefined)?.summary?.total_count) ?? 0) || 0;
    let reach = 0;
    try {
      const insights = await this.call("GET", `${encodeURIComponent(id)}/insights?metric=post_impressions_unique`);
      const data = (Array.isArray(insights["data"]) ? insights["data"] : []) as { values?: { value?: unknown }[] }[];
      reach = Number(data[0]?.values?.[0]?.value ?? 0) || 0;
    } catch { /* insights need read_insights; a post without them still syncs */ }
    return {
      daDang: r["is_published"] !== false,
      duongDan: String(r["permalink_url"] ?? ""),
      taoLuc: String(r["created_time"] ?? ""),
      camXuc: total(r["reactions"]), binhLuan: total(r["comments"]),
      chiaSe: Number((r["shares"] as { count?: unknown } | undefined)?.count ?? 0) || 0,
      tiepCan: reach
    };
  }

  async comment(objectId: string, message: string, attachmentUrl = ""): Promise<string> {
    const r = await this.call("POST", `${encodeURIComponent(objectId)}/comments`, { ...(message ? { message } : {}), ...(attachmentUrl ? { attachment_url: attachmentUrl } : {}) });
    return String(r["id"] ?? "");
  }

  /** The page's own latest posts (not visitors' posts). */
  async publishedPosts(pageId: string, limit = 10): Promise<{ id: string; message: string; created_time: string; permalink_url: string }[]> {
    const r = await this.call("GET", `${encodeURIComponent(pageId)}/published_posts?fields=id,message,created_time,permalink_url&limit=${Math.max(1, Math.min(25, limit))}`);
    return (Array.isArray(r["data"]) ? r["data"] : []).map((p) => {
      const o = (p ?? {}) as Record<string, unknown>;
      return { id: String(o["id"] ?? ""), message: String(o["message"] ?? ""), created_time: String(o["created_time"] ?? ""), permalink_url: String(o["permalink_url"] ?? "") };
    }).filter((p) => p.id !== "");
  }
}
