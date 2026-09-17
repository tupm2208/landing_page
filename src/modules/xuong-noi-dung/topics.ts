/**
 * @file "CHỦ ĐỀ ANH GỢI Ý" — topics the owner types for the planner to use (Desk `/api/content/studio/topics`).
 *
 * A topic waits (`waiting`) with a priority: `today` (use in the next plan) or `queue` (keep for
 * later). The planner takes waiting topics, today first, one per post; a topic becomes `used` when
 * its post is scheduled, or `skipped` when the owner drops it. Pure functions over one book.
 */

export const TOPIC_DOCUMENT = "xuong-noi-dung-chu-de";
const TOPICS_KEEP = 300;

export interface Topic {
  id: string;
  text: string;
  /** A page id, or "" for any page. */
  page: string;
  priority: "today" | "queue";
  status: "waiting" | "used" | "skipped";
  createdAt: string;
  usedAt: string;
  usedBy: string;
}

export interface TopicBook { version: 1; list: Topic[]; updatedAt: string }

export const defaultTopicBook = (): TopicBook => ({ version: 1, list: [], updatedAt: "" });

const text = (v: unknown, n = 300): string => String(v ?? "").trim().slice(0, n);

export function addTopic(book: Partial<TopicBook> | null, input: { text?: unknown; page?: unknown; priority?: unknown }, id: string, at: string): { book: TopicBook; topic: Topic } | { error: string } {
  const value = text(input.text, 300);
  if (value.length < 4) return { error: "Gõ chủ đề ít nhất vài chữ." };
  const list = Array.isArray(book?.list) ? book.list : [];
  if (list.some((t) => t.status === "waiting" && t.text.toLowerCase() === value.toLowerCase())) return { error: "Chủ đề này đang chờ rồi." };
  const topic: Topic = { id, text: value, page: text(input.page, 64), priority: input.priority === "today" ? "today" : "queue", status: "waiting", createdAt: at, usedAt: "", usedBy: "" };
  return { book: { version: 1, list: [topic, ...list].slice(0, TOPICS_KEEP), updatedAt: at }, topic };
}

export function setTopicStatus(book: Partial<TopicBook> | null, id: string, status: unknown, at: string, usedBy = ""): TopicBook | { error: string } {
  const wanted = String(status ?? "");
  if (!["waiting", "used", "skipped"].includes(wanted)) return { error: "Trạng thái chủ đề không hợp lệ." };
  const list = Array.isArray(book?.list) ? book.list : [];
  if (!list.some((t) => t.id === id)) return { error: "Không thấy chủ đề." };
  return {
    version: 1, updatedAt: at,
    list: list.map((t) => (t.id === id ? { ...t, status: wanted as Topic["status"], usedAt: wanted === "used" ? at : t.usedAt, usedBy: wanted === "used" ? usedBy : t.usedBy } : t))
  };
}

/** Waiting topics the planner may use for these pages, today first, oldest first. */
export function waitingTopics(book: Partial<TopicBook> | null, pages: readonly string[]): Topic[] {
  return (Array.isArray(book?.list) ? book.list : [])
    .filter((t) => t.status === "waiting" && (t.page === "" || pages.includes(t.page)))
    .sort((a, b) => (a.priority === b.priority ? a.createdAt.localeCompare(b.createdAt) : a.priority === "today" ? -1 : 1));
}

export function topicCounts(book: Partial<TopicBook> | null): { today: number; queue: number; used: number } {
  const list = Array.isArray(book?.list) ? book.list : [];
  return {
    today: list.filter((t) => t.status === "waiting" && t.priority === "today").length,
    queue: list.filter((t) => t.status === "waiting" && t.priority === "queue").length,
    used: list.filter((t) => t.status === "used").length
  };
}
