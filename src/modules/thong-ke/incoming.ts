/**
 * @file The door's bouncer: what an anonymous browser is allowed to write into the event table.
 *
 * `POST /api/analytics/event` is open to the Internet and writes a row. Three rules keep that from
 * being a hole:
 *
 * 1. THE EVENT NAME IS AN ALLOW-LIST. Not a pattern, not a sanitiser — a list. An unknown name is
 *    refused, so nobody invents `admin_password_seen` and fills the table with it.
 *
 * 2. `order_success` IS NEVER ACCEPTED FROM A BROWSER. Orders are counted by the server when the
 *    order is actually created (the module listens for `don-khach.da-tao`), so a script cannot
 *    inflate the shop's own sales figures.
 *
 *    NOTE: the running site had the same refusal but nothing ever wrote the event server-side, so
 *    `totals.order_success` has been 0 the whole time. The listener in `module.ts` closes that.
 *
 * 3. ATTRIBUTED TRAFFIC IS RATE-LIMITED PER CONTENT. The kernel's rate limit counts calls per IP;
 *    this one counts them per (IP, content, event), because the number that matters commercially is
 *    "how well did THIS post do" and that is what a competitor would want to poison.
 */

import { attributionKey, type Attribution } from "./attribution";

/**
 * Every event name the table accepts. The first ten are the running site's list; `payment_choice`
 * is added because both checkout pages have been firing it since August and the old site answered
 * every one of them with 400.
 */
export const EVENT_NAMES: readonly string[] = [
  "page_view",
  "source_click",
  "product_view",
  "add_to_cart",
  "buy_now",
  "checkout_open",
  "order_submit",
  "order_success",
  "filter_change",
  "gallery_open",
  "payment_choice"
];

const ALLOWED = new Set(EVENT_NAMES);

/** The event name if it is on the list, otherwise `""`. Normalises first, so `Page View` passes. */
export function eventName(value: unknown): string {
  const name = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9_:-]+/g, "_").slice(0, 48);
  return ALLOWED.has(name) ? name : "";
}

/** The product code out of an event payload, stripped to what a code may contain. */
export function productCode(payload: Record<string, unknown>): string {
  return String(payload["productCode"] || payload["code"] || payload["sku"] || "")
    .trim().replace(/[^A-Za-z0-9._-]/g, "").slice(0, 60);
}

/** The product name out of an event payload (column is VARCHAR(190)). */
export function productName(payload: Record<string, unknown>): string {
  return String(payload["productName"] || payload["name"] || "").trim().slice(0, 190);
}

/** User agents that are machines. Their visits are real traffic but must not earn a post credit. */
const BOTS = /bot|crawler|spider|preview|facebookexternalhit|facebot|meta-externalagent|headlesschrome/;

export function likelyBot(userAgent: unknown): boolean {
  return BOTS.test(String(userAgent ?? "").toLowerCase());
}

/** Why an event was not written. `""` = it was accepted. */
export type Refusal = "" | "unverified_or_bot_click" | "server_order_only" | "analytics_rate_limited";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A click on one comment link counts ONCE a day, however many times the tab is reopened. */
const CLICK_WINDOW_MS = DAY_MS;
const SOURCE_CLICK = { windowMs: 60 * 60 * 1000, limit: 10 };
const OTHER_EVENT = { windowMs: 10 * 60 * 1000, limit: 30 };
/** Above this many live counters, drop the ones older than a day before adding more. */
const SWEEP_AT = 20000;

/**
 * Per-content rate limiting, in memory.
 *
 * In memory means: restarting the server forgets the counters, and two processes count separately.
 * That is accepted — this guards a counter, not money, and the kernel's own per-IP limit sits in
 * front of it. Keeping it out of MySQL keeps a page view from costing a write of its own.
 */
export class AbuseGate {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();
  private readonly clicks = new Map<string, number>();

  constructor(private readonly now: () => Date) {}

  /** Decides whether one event may be written. Call ONCE per event: it also counts the event. */
  check(event: string, attribution: Attribution, ip: string): Refusal {
    if (event === "order_success") return "server_order_only";

    // Traffic with no post behind it is not worth guarding per content: the kernel's per-IP limit
    // is the whole defence, and honest browsing fires many page views a minute.
    const content = attributionKey(attribution);
    if (content === "") return "";

    const now = this.now().getTime();
    if (event === "source_click") {
      const clickKey = `${content}|${String(attribution.clickId ?? "")}`;
      const seenAt = this.clicks.get(clickKey) ?? 0;
      if (seenAt !== 0 && now - seenAt < CLICK_WINDOW_MS) return "analytics_rate_limited";
      this.clicks.set(clickKey, now);
    }

    const { windowMs, limit } = event === "source_click" ? SOURCE_CLICK : OTHER_EVENT;
    const key = `${ip || "khong-ro"}|${content}|${event}`;
    const current = this.windows.get(key);
    if (!current || now - current.startedAt >= windowMs) {
      this.windows.set(key, { startedAt: now, count: 1 });
      if (this.windows.size > SWEEP_AT) this.sweep(now);
      return "";
    }
    if (current.count >= limit) return "analytics_rate_limited";
    current.count += 1;
    return "";
  }

  private sweep(now: number): void {
    for (const [key, value] of this.windows) if (now - value.startedAt > DAY_MS) this.windows.delete(key);
    for (const [key, seenAt] of this.clicks) if (now - seenAt > DAY_MS) this.clicks.delete(key);
  }
}
