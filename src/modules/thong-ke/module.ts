/**
 * @file WEB ANALYTICS module ("thong-ke") — tier "van-hanh", runs on the merchant server.
 *
 * Two doors: the storefront posts an event, the owner's console reads the report. Between them one
 * inherited table, `analytics_events`.
 *
 * WHY THIS MODULE EXISTS AT ALL (15/09/2026): the rewritten landing shipped without it, while
 * `gian-hang/goc/analytics.js` kept firing events from every page. `POST /api/analytics/event`
 * answered 405 (the storefront's `GET /*` matched the path with the wrong method) and
 * `GET /api/admin/analytics` answered 404 — so Sales Desk showed zeros under a red error and every
 * visit since the cutover was lost. The browser file never changed; only the doors were missing.
 *
 * THREE RULES:
 *
 * 1. THE PUBLIC DOOR WRITES, AND ONLY WRITES. It reads nothing about the shop and answers nothing
 *    but "recorded" / "ignored", so an anonymous caller learns nothing by hammering it.
 *
 * 2. THE SHOP NEVER COUNTS ITS OWN SALES FROM THE BROWSER. `order_success` is refused at the public
 *    door and written here, by listening for `don-khach.da-tao`.
 *
 * 3. NO AGGREGATE IS EVER STORED. Every number in the report is counted from rows when asked. A
 *    figure that looks wrong can always be traced to the rows underneath it.
 */

import {
  ACCESS, EVENTS, defineModule, reply,
  type KernelRequest, type ModuleContext, type ReplyDraft
} from "../../contract";
import { AbuseGate, eventName, likelyBot, productCode, productName } from "./incoming";
import { EventRepository } from "./event-repository";
import { analyticsReport, type ProductRange } from "./report";
import { attributionKey, verifiedAttribution } from "./attribution";
import { SCHEMA } from "./schema";
import { CHANNELS_DOCUMENT, channelFrom, channelsOf, saveChannel, seoReadiness, storefrontTracking, type ChannelBook, type SeoItem } from "./website-channels";

/** `ctx.config` as built by `moduleConfigFromEnv()` in app.ts. */
export interface Config {
  /**
   * Signs the `tr_sig` on comment links. Missing = every attribution is dropped, so the "Hiệu quả
   * comment link" table stays empty and `source_click` is never recorded. Counting still works.
   */
  attributionSecret: string;
}

/** Đ9: the catalogue, read for the SEO readiness score of Website Channels. */
interface Services {
  "hang-kho"?: { search(input: { query?: string; limit?: number }): Promise<SeoItem[]> };
}

type Ctx = ModuleContext<Config, Services>;

async function channelList(ctx: Ctx) {
  return channelsOf(await ctx.ports.store.document<ChannelBook>(CHANNELS_DOCUMENT).read(null), { name: "Website chính", siteUrl: "/" });
}

const TEN_MINUTES = 10 * 60 * 1000;
const NO_STORE = { "Cache-Control": "no-store" };
/** One event is a few hundred bytes; 64 KB is the running site's limit and generous already. */
const EVENT_BODY_LIMIT = 64 * 1024;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/**
 * One rate-limit gate per module context (i.e. per running server), created on first use.
 *
 * A WeakMap rather than a module-level variable so two kernels in one test process — which is how
 * the suites run — do not share counters and make each other's assertions flaky.
 */
const gates = new WeakMap<object, AbuseGate>();
function gateOf(ctx: Ctx): AbuseGate {
  const existing = gates.get(ctx);
  if (existing) return existing;
  const gate = new AbuseGate(() => ctx.ports.clock.now());
  gates.set(ctx, gate);
  return gate;
}

/** Writes one event. Used by the public door and by the order listener. */
async function record(ctx: Ctx, event: {
  name: string; payload: Record<string, unknown>; visitorId: string; sessionId: string;
  path: string; referrer: string; attribution: Record<string, unknown>; userAgent: string;
}): Promise<void> {
  await new EventRepository(ctx.ports.store).record({
    event: event.name,
    productCode: productCode(event.payload),
    productName: productName(event.payload),
    visitorId: event.visitorId,
    sessionId: event.sessionId,
    path: event.path,
    referrer: event.referrer,
    attributionKey: attributionKey(event.attribution),
    attribution: event.attribution,
    userAgent: event.userAgent,
    at: ctx.ports.clock.now()
  });
}

/**
 * The storefront reporting one event.
 *
 * Everything that is not written still answers 200 with a `reason`: this is a fire-and-forget
 * beacon from a customer's browser, and an error here would be noise in their console about a
 * counter they do not care about. The one exception is an unknown event name (400) — that is a
 * mistake in our own front-end code and should be loud.
 */
async function recordFromBrowser(ctx: Ctx, request: KernelRequest): Promise<ReplyDraft> {
  const body = asRecord(await request.json());
  const name = eventName(body["event"]);
  if (name === "") return reply.json({ ok: false, error: "invalid_event" }, 400, NO_STORE);

  if (!ctx.ports.store.supportsTables) {
    return reply.json({ ok: true, ignored: true, reason: "analytics_storage_unavailable" }, 200, NO_STORE);
  }

  const userAgent = String(request.headers["user-agent"] ?? "").slice(0, 255);
  const isBot = likelyBot(userAgent);
  // A machine's visit is still a visit, but it must never earn a post any credit.
  const attribution = isBot ? {} : verifiedAttribution(body["attribution"], ctx.config.attributionSecret);

  // An unsigned or robotic click is not evidence that anyone clicked anything.
  if (name === "source_click" && (attributionKey(attribution) === "" || isBot)) {
    return reply.json({ ok: true, ignored: true, reason: "unverified_or_bot_click" }, 200, NO_STORE);
  }

  const refusal = gateOf(ctx).check(name, attribution, request.ip);
  if (refusal !== "") return reply.json({ ok: true, ignored: true, reason: refusal }, 200, NO_STORE);

  const payload = asRecord(body["payload"]);
  await record(ctx, {
    name,
    payload,
    visitorId: String(body["visitorId"] ?? "").trim().slice(0, 96),
    sessionId: String(body["sessionId"] ?? "").trim().slice(0, 96),
    path: String(body["path"] ?? "").trim().slice(0, 220),
    referrer: String(body["referrer"] ?? "").trim().slice(0, 300),
    attribution,
    userAgent
  });
  return reply.json({ ok: true, storage: "mysql" }, 200, NO_STORE);
}

/** The owner's console (and Sales Desk) reading the report. */
async function readReport(ctx: Ctx, request: KernelRequest): Promise<ReplyDraft> {
  if (!ctx.ports.store.supportsTables) {
    return reply.json(
      { ok: false, error: "khong_co_mysql", message: "Thống kê cần MySQL. Máy này đang chạy bằng tệp JSON." },
      503, NO_STORE
    );
  }

  const day = (name: string): string => {
    const value = String(request.query[name] ?? "").trim();
    return DAY_PATTERN.test(value) ? value : "";
  };
  let from = day("productFrom");
  let to = day("productTo");
  // Someone dragged the range backwards: read what they meant, do not answer an empty table.
  if (from !== "" && to !== "" && from > to) [from, to] = [to, from];
  const productRange: ProductRange | null = from !== "" || to !== "" ? { from, to } : null;

  const data = await analyticsReport({
    reader: new EventRepository(ctx.ports.store),
    now: ctx.ports.clock.now(),
    days: request.query["days"],
    productRange
  });

  // The envelope Sales Desk expects: HTTP 200 with `ok: true`, numbers under `data`
  // (`toprun-sales-desk/server.js:5581` treats anything else as a fatal read error).
  return reply.json({ ok: true, data, generatedAt: ctx.ports.clock.now().toISOString() }, 200, NO_STORE);
}

export const manifest = defineModule<Config, Services>({
  id: "thong-ke",
  name: "Thống kê web",
  tier: "van-hanh",
  runsOn: "server-khach",
  // Sold with the storefront, like CTV: counting visits to a shopfront is part of having one, and
  // the feature ceiling is 15 with 13 taken.
  feature: "gian-hang",
  version: "0.1.0",
  ports: ["store", "logger", "clock", "config"],
  requiresOptional: ["hang-kho.search"],

  // The table predates this module (47,323 rows on the running site) and Image Tool reads it by
  // name, so it keeps its name instead of taking the `thong_ke_` prefix.
  inheritedTables: ["analytics_events"],
  schema: SCHEMA,

  events: {
    listens: {
      /**
       * RULE 2: the shop's own sales are counted here, where an order really exists.
       *
       * The running site refused `order_success` from browsers "because the server writes it" — but
       * nothing ever did, so that number read 0 for the whole life of the site. This is the write.
       *
       * The payload carries no product code, so this row counts towards the TOTAL, not towards a
       * product line. Sales Desk reconciles the per-product "Đặt" column against real orders anyway.
       */
      [EVENTS.orderCreated]: async (ctx: Ctx, payload: unknown) => {
        if (!ctx.ports.store.supportsTables) return;
        const order = asRecord(payload);
        try {
          await record(ctx, {
            name: "order_success",
            payload: {},
            visitorId: "",
            sessionId: "",
            path: "",
            referrer: "",
            attribution: {},
            userAgent: "may-chu"
          });
        } catch (error) {
          // An order is worth more than its tally: never let a counter fail the sale.
          const why = error instanceof Error ? error.message : String(error);
          ctx.ports.logger.warn(`[thong-ke] khong ghi duoc order_success cho ${String(order["maDon"] ?? "(khong ro don)")}: ${why}`);
        }
      }
    }
  },

  routes: [
    {
      method: "POST", path: "/api/analytics/event", access: ACCESS.public,
      whyPublic: "Trình duyệt khách bắn sự kiện xem trang, chưa có mã nào. Tự bảo vệ bằng: tên sự kiện phải nằm "
        + "trong danh sách trắng, chỉ GHI một dòng đếm và không đọc dữ liệu nào của shop, `order_success` bị từ chối "
        + "(chỉ máy chủ ghi khi đơn có thật), và lượt có gắn bài còn bị đếm riêng theo từng bài.",
      // 240 per 10 minutes per address — the running site's number. A real customer browsing fires
      // a handful a minute; this leaves room for a family behind one router.
      rateLimit: { calls: 240, windowMs: TEN_MINUTES },
      bodyLimit: EVENT_BODY_LIMIT,
      handle: recordFromBrowser
    },
    {
      method: "GET", path: "/api/admin/analytics", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: readReport
    },
    {
      // Đ9 Website Channels (Desk `websiteChannelsTemplate`): channels + pixels + SEO readiness of the catalogue.
      method: "GET", path: "/api/kenh-web", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx: Ctx) => {
        const search = ctx.services["hang-kho"]?.search;
        const items = search ? await search({ query: "", limit: 0 }) : [];
        return reply.json({ ok: true, kenh: await channelList(ctx), seo: seoReadiness(items), coDanhMuc: search !== undefined }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/kenh-web", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES }, bodyLimit: 16 * 1024,
      handle: async (ctx: Ctx, request: KernelRequest) => {
        const body = asRecord(await request.json());
        try {
          const channel = channelFrom(body, ctx.ports.clock.now().toISOString());
          const result = saveChannel(await channelList(ctx), channel, String(body["sua"] ?? "").trim());
          await ctx.ports.store.document<ChannelBook>(CHANNELS_DOCUMENT).write({ version: 1, kenh: result.kenh });
          ctx.ports.logger.info(`[thong-ke] website channel ${channel.id} ${result.created ? "tao" : "sua"}`);
          return reply.json({ ok: true, kenh: result.kenh, message: result.created ? "Đã tạo website channel." : "Đã cập nhật website channel." }, 200, NO_STORE);
        } catch (e) {
          return reply.json({ ok: false, error: "kenh_khong_hop_le", message: e instanceof Error ? e.message : String(e) }, 400, NO_STORE);
        }
      }
    },
    {
      method: "GET", path: "/api/kenh-web/theo-doi", access: ACCESS.public,
      whyPublic: "Mã GA4 / Meta Pixel / TikTok Pixel của website chính — thứ vốn nằm công khai trong mã nguồn trang. "
        + "Chỉ trả ba mã đã kiểm đúng dạng, không đọc gì khác của shop.",
      rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx: Ctx) => reply.json({ ok: true, ...storefrontTracking(await channelList(ctx)) }, 200, { "Cache-Control": "public, max-age=300" })
    }
  ]
});
