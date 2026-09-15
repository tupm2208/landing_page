/**
 * @file The multi-channel inbox ("hop-thu") — chatbot tier, running on the merchant server.
 *
 * Its job: receive messages (from Meta, from OMI), keep them, announce them on the bus, push them
 * to the brain, and send messages out when someone (the brain, or a human in OMI) asks.
 *
 * It does NOT know how to answer a customer — that is the brain's job on Xeon. Here there are only
 * wires and a mailbox. So switching the brain off still lands every message in the inbox; nothing is lost.
 *
 * TWO LINES (decided 14/09/2026):
 *   1. The official Facebook Graph API: Meta calls the webhook here, the landing answers through
 *      the Graph API. Runs 24/7 on hosting.
 *   2. Zalo, personal Facebook (automation on OMI, the shop's machine): OMI reads a message ->
 *      POST /api/hop-thu/tin-vao; the brain replies here like on any channel; the landing CANNOT
 *      send on these channels so it QUEUES; OMI (the on-duty machine) pulls through
 *      /api/hop-thu/cho-gui/nhan, types through automation, reports back through /xong.
 *   The brain and the inbox share ONE message shape; a new channel = one more reader on OMI.
 *
 * Old messages (the shop's machine was off, comes back and sees a whole thread): the bot STILL
 * answers unanswered messages, except those older than the threshold (default 24 hours, the shop
 * adjusts it in OMI through /api/hop-thu/cau-hinh).
 */

import { ACCESS, EVENTS, defineModule, reply, type KernelRequest, type ModuleContext } from "../../contract";
import type { PlatformServices } from "../khung-nen-tang/module";
import {
  defaultConversationBook, fileIncoming, fileOutgoing, listThreads, markOutgoingState, markRead, threadOf, unreadThreadCount,
  type ConversationBook
} from "./conversations";
import { GraphApiClient } from "./graph-api";
import {
  COMMENT_CHANNEL, INBOX_KEEP_MAX, INBOX_SEEN_MAX, OMI_CHANNELS, defaultInboxBook, isOmiEvent, normaliseOmiMessage,
  type InboundMessage, type InboxBook, type InboxEvent
} from "./inbox";
import { CLAIM_TTL_MS, Outbox, type ClaimedItem, type OutboxBook, type OutboxItem } from "./outbox";
import { WEBHOOK_BODY_LIMIT, isPagePayload, parseWebhookComments, parseWebhookMessages, verifySignature } from "./webhook";

export { COMMENT_CHANNEL, OMI_CHANNELS };

/** Document names — on-disk contract (Desk pulls `hop-thu-den` unchanged from the running site). */
export const INBOX_DOCUMENT = "hop-thu-den";
/** Threads as a person reads them (`conversations.ts`). Derived from the events, never the other way. */
export const CONVERSATION_DOCUMENT = "hop-thu-hoi-thoai";
export const OUTBOX_DOCUMENT = "hop-thu-cho-gui";
export const SETTINGS_DOCUMENT = "hop-thu-cau-hinh";
/** Conversations the bot handed to a human, waiting for one. */
export const HANDOFF_DOCUMENT = "hop-thu-can-nguoi";

const HANDOFF_KEEP_MAX = 200;
const DEFAULT_STALE_HOURS = 24;
const TEN_MINUTES = 10 * 60 * 1000;
const NO_STORE = { "Cache-Control": "no-store" };

/** `ctx.config` as `app.ts` builds it (`moduleConfigFromEnv`). */
export interface Config {
  verifyToken: string;
  appSecret: string;
  pageToken: string;
  /**
   * Manual brain target for tests and trial runs when the landing has not registered with Xeon.
   * `app.ts` never sets it: in production the target comes from `khung-nen-tang.xeon`.
   */
  brain?: { address: string; token: string; tenant: string };
}

/** Knowing which Xeon / which token to push messages to. Absent (not registered) = the inbox still works. */
interface Services {
  "khung-nen-tang"?: Pick<PlatformServices, "xeon" | "settings">;
}

type Ctx = ModuleContext<Config, Services>;

/** What `hop-thu.send` takes. Field names are wire: the brain posts exactly these to `/api/hop-thu/gui`. */
export interface SendInput {
  kenh?: string;
  nguoi: string;
  chu: string;
  nguon?: string;
  maHoiThoai?: string;
  /** Comment channel only: WHICH comment the reply goes under (Meta threads it there). */
  traLoiTin?: string;
}

/** Sent right away through the Graph API (with Meta's reply spread in), or queued for OMI. */
export type SendResult =
  | { guiNgay: true; [meta: string]: unknown }
  | { guiNgay: false; xepHang: true; id: string };

/** Services this module provides (`hop-thu.send`). */
export interface InboxServices {
  send(input: SendInput): Promise<SendResult>;
}

interface InboxSettings {
  nguongTinCuGio: number;
}

interface HandoffItem {
  maHoiThoai: string;
  kenh: string;
  nguoi: string;
  lyDo: string;
  tinCuoi: string;
  baoLuc: string;
  xongLuc: string;
}

interface HandoffBook {
  version: 1;
  muc: HandoffItem[];
  updatedAt?: string;
}

/** The message OMI/Desk see when pulling the inbox: the message plus where it came from. */
interface InboxMessageRow extends InboundMessage {
  maSuKien: string;
  nhanLuc: string;
  daXacMinh: boolean;
}

const inboxDocument = (ctx: Ctx) => ctx.ports.store.document<InboxBook>(INBOX_DOCUMENT);
const conversationDocument = (ctx: Ctx) => ctx.ports.store.document<ConversationBook>(CONVERSATION_DOCUMENT);

/**
 * Files a message into the thread book.
 *
 * Wrapped in try/catch on purpose: the thread book is a READING CONVENIENCE built on top of the
 * events, which are the record. A failure to file must never turn into a non-2xx to Meta (which
 * retries forever) nor stop a reply from going out.
 */
async function fileInThread(ctx: Ctx, write: (book: ConversationBook | null, at: string) => ConversationBook): Promise<void> {
  const at = ctx.ports.clock.now().toISOString();
  try {
    await conversationDocument(ctx).update((current) => write(current ?? null, at), defaultConversationBook());
  } catch (e) {
    ctx.ports.logger.warn(`[hop-thu] khong ghi duoc kho hoi thoai: ${e instanceof Error ? e.message : String(e)}`);
  }
}
const outboxDocument = (ctx: Ctx) => ctx.ports.store.document<OutboxBook>(OUTBOX_DOCUMENT);
const handoffDocument = (ctx: Ctx) => ctx.ports.store.document<HandoffBook>(HANDOFF_DOCUMENT);

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * The Facebook credentials, SHOP FIRST.
 *
 * They used to come only from the machine's environment, which is right for one shop on one
 * server and wrong for OMI: the owner types them in the Kết nối screen and they are kept on their
 * own landing. The environment stays as the fallback, so an existing self-hosted shop that never
 * opens that screen keeps working exactly as before, and a blank box never wipes a live token.
 */
async function facebookKeys(ctx: Ctx): Promise<{ verifyToken: string; appSecret: string; pageToken: string }> {
  const fallback = { verifyToken: ctx.config.verifyToken, appSecret: ctx.config.appSecret, pageToken: ctx.config.pageToken };
  const read = ctx.services["khung-nen-tang"]?.settings;
  if (read === undefined) return fallback;
  try {
    const shop = await read();
    const pick = (key: string, was: string): string => String(shop[key] ?? "").trim() || String(was ?? "");
    return {
      verifyToken: pick("fb_verify_token", fallback.verifyToken),
      appSecret: pick("fb_app_secret", fallback.appSecret),
      pageToken: pick("fb_page_token", fallback.pageToken)
    };
  } catch {
    return fallback;                                     // a settings read must never drop a webhook
  }
}

async function readSettings(ctx: Ctx): Promise<InboxSettings> {
  const stored = await ctx.ports.store.document<Partial<InboxSettings>>(SETTINGS_DOCUMENT).read(null);
  const hours = Number(stored?.nguongTinCuGio);
  return { ...(stored ?? {}), nguongTinCuGio: Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_STALE_HOURS };
}

/**
 * Pushes a message to the brain on Xeon.
 *
 * Does NOT wait for the result, and a failure here must NOT stop the 200 to Meta: Meta retries
 * every non-2xx reply, so a dead brain would mean Meta retrying forever and the inbox filling with
 * duplicates. The message is already in the document — a brain that comes back can pull it.
 */
function pushToBrain(ctx: Ctx, message: InboundMessage): void {
  void Promise.resolve()
    .then(async () => {
      // Which Xeon, which token: from the registration with Xeon (platform base). Not registered ->
      // try the manual `brain` config (tests / trial runs). Neither = no brain connected, the inbox
      // works as usual.
      const registration = ctx.services["khung-nen-tang"]?.xeon ? await ctx.services["khung-nen-tang"].xeon() : null;
      const target = registration?.maNhanTin
        ? { address: registration.diaChiXeon, token: registration.maNhanTin, tenant: registration.shop }
        : ctx.config.brain ?? null;
      if (!target?.address) return null;
      const origin = String(target.address).replace(/\/+$/, "");
      return ctx.ports.http.fetch(`${origin}/tin-den`, {
        method: "POST",
        timeoutMs: 8000,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${target.token}` },
        body: JSON.stringify({
          tenant: String(target.tenant || ""),
          kenh: message.kenh, nguoi: message.nguoi, chu: message.chu, soAnh: message.soAnh,
          maTin: message.maTin, maHoiThoai: `${message.kenh}:${message.nguoi}`, luc: message.luc
        })
      });
    })
    .then((response) => { if (response && !response.ok) ctx.ports.logger.warn(`[hop-thu] bo nao tu choi tin: HTTP ${response.status}`); })
    .catch((e: unknown) => ctx.ports.logger.warn(`[hop-thu] khong day duoc tin sang bo nao: ${e instanceof Error ? e.message : String(e)}`));
}

/** A message older than the threshold is NOT auto-answered — it only sits in the inbox for a human. Returns whether it was pushed. */
function pushUnlessStale(ctx: Ctx, message: InboundMessage, settings: InboxSettings): boolean {
  const sentAt = Date.parse(String(message.luc || ""));
  const ageMs = Number.isFinite(sentAt) ? ctx.ports.clock.now().getTime() - sentAt : 0;
  if (ageMs > settings.nguongTinCuGio * 3600 * 1000) {
    ctx.ports.logger.info(`[hop-thu] tin ${message.kenh}:${message.nguoi} cu ${Math.round(ageMs / 3600000)} gio — khong tu tra loi`);
    return false;
  }
  pushToBrain(ctx, message);
  return true;
}

/** Answers 200 to Meta as soon as the packet is STORED — Meta retries every other reply. */
async function receiveMetaWebhook(ctx: Ctx, request: KernelRequest) {
  const { verifyToken, appSecret } = await facebookKeys(ctx);
  if (!verifyToken) return reply.json({ ok: false, error: "hop_thu_chua_cau_hinh" }, 503);

  const raw = await request.raw();
  if (raw.length > WEBHOOK_BODY_LIMIT) return reply.json({ ok: false, error: "goi_qua_lon" }, 413);

  const signature = String(request.headers["x-hub-signature-256"] ?? "").trim();
  let payload: unknown = null;
  try { payload = JSON.parse(raw.toString("utf8")); } catch { payload = null; }
  if (!signature.startsWith("sha256=") || !isPagePayload(payload)) {
    return reply.json({ ok: false, error: "goi_webhook_khong_hop_le" }, 400);
  }

  // With an APP_SECRET the signature is really checked. Without one, keep the running site's
  // relay behaviour: shape check only, and NEVER auto-answer — no secret means we are not sure
  // the packet came from Meta, and answering blindly is messaging a stranger.
  const verified = appSecret ? verifySignature(raw, signature, appSecret) : false;
  if (appSecret && !verified) {
    ctx.ports.logger.warn("[hop-thu] chu ky khong khop — bo goi");
    return reply.json({ ok: false, error: "chu_ky_sai" }, 401);
  }

  const at = ctx.ports.clock.now().toISOString();
  await inboxDocument(ctx).update((current) => {
    const book = current ?? defaultInboxBook();
    const events: InboxEvent[] = Array.isArray(book.events) ? book.events : [];
    events.push({
      eventId: `fbw_${Date.parse(at)}_${events.length + 1}`,
      receivedAt: at,
      signature,
      daXacMinh: verified,
      rawBodyBase64: raw.toString("base64")
    });
    return { ...book, version: 1, events: events.slice(-INBOX_KEEP_MAX), updatedAt: at };
  }, defaultInboxBook());

  // Announce on the bus only when really verified. The brain listens to answer the customer.
  if (verified) {
    const settings = await readSettings(ctx);
    // Messages AND public comments. A shop that reads only the inbox loses the loudest questions
    // it gets — the ones under a post, where everybody can see whether they were answered.
    for (const message of [...parseWebhookMessages(payload), ...parseWebhookComments(payload)]) {
      await fileInThread(ctx, (book, when) => fileIncoming(book, message, when));
      ctx.bus.emit(EVENTS.messageIn, message);
      pushUnlessStale(ctx, message, settings);
    }
  }
  return reply.json({ ok: true, daXacMinh: verified });
}

/** OMI (the on-duty machine) pushes messages it read from Zalo / personal Facebook into the inbox. */
async function receiveOmiMessages(ctx: Ctx, request: KernelRequest) {
  const body = await request.json();
  const listed = (body as { tin?: unknown } | null)?.tin;
  const list: unknown[] = Array.isArray(listed) ? listed : [body];
  if (list.length > 200) return reply.json({ ok: false, error: "qua_nhieu_tin", message: "Toi da 200 tin mot lan." }, 400);
  const now = ctx.ports.clock.now();
  const fresh: InboundMessage[] = [];
  let malformed = 0;
  let duplicates = 0;

  await inboxDocument(ctx).update((current) => {
    const book = current ?? defaultInboxBook();
    const events: InboxEvent[] = Array.isArray(book.events) ? book.events : [];
    const seen = new Set<string>(Array.isArray(book.daThay) ? book.daThay : []);
    for (const raw of list) {
      const message = normaliseOmiMessage(raw, now);
      if (!message) { malformed += 1; continue; }
      const key = `${message.kenh}|${message.maTin}`;
      if (seen.has(key)) { duplicates += 1; continue; }
      seen.add(key);
      events.push({ eventId: `omi_${now.getTime()}_${events.length + 1}`, receivedAt: now.toISOString(), kenh: message.kenh, daXacMinh: true, tin: message });
      fresh.push(message);
    }
    return {
      ...book, version: 1,
      events: events.slice(-INBOX_KEEP_MAX),
      daThay: [...seen].slice(-INBOX_SEEN_MAX),
      updatedAt: now.toISOString()
    };
  }, defaultInboxBook());

  const settings = await readSettings(ctx);
  let pushed = 0;
  for (const message of fresh) {
    await fileInThread(ctx, (book, when) => fileIncoming(book, message, when));
    ctx.bus.emit(EVENTS.messageIn, message);
    if (pushUnlessStale(ctx, message, settings)) pushed += 1;
  }
  return reply.json({ ok: true, daNhan: fresh.length, trung: duplicates, saiHinhDang: malformed, dayBoNao: pushed }, 200, NO_STORE);
}

/**
 * Sends a message to a customer. For the brain and for a human in OMI.
 * Facebook: right away through the Graph API. Zalo / personal FB: queued, the on-duty OMI sends.
 */
async function sendMessage(ctx: Ctx, input: SendInput): Promise<SendResult> {
  const channel = input.kenh ?? "facebook";
  const { nguoi: recipient, chu: text } = input;
  if (typeof recipient !== "string" || recipient.trim() === "" || typeof text !== "string" || text.trim() === "") {
    throw new Error("Gui tin can `nguoi` va `chu`.");
  }
  const at = ctx.ports.clock.now();
  const sentBy = input.nguon ?? "nguoi";
  if (channel === COMMENT_CHANNEL) {
    // Answering under the comment, not in the inbox: a public question answered privately still
    // looks unanswered to everyone else reading the post.
    const target = String(input.traLoiTin ?? "").trim();
    if (!target) throw new Error("Tra loi binh luan can `traLoiTin` — ma cua binh luan.");
    const graph = new GraphApiClient(ctx.ports.http, (await facebookKeys(ctx)).pageToken);
    const metaReply = await graph.replyToComment(target, text);
    const messageId = String((metaReply as Record<string, unknown>)["id"] ?? "") || `bl_${at.getTime()}`;
    await fileInThread(ctx, (book, when) => fileOutgoing(book, { kenh: channel, nguoi: recipient, maTin: messageId, chu: text, luc: when, boi: sentBy, trangThai: "da-gui" }, when));
    ctx.bus.emit(EVENTS.messageOut, { kenh: channel, nguoi: recipient, chu: text, luc: at.toISOString() });
    return { ...metaReply, guiNgay: true };
  }
  if (channel === "facebook") {
    const graph = new GraphApiClient(ctx.ports.http, (await facebookKeys(ctx)).pageToken);
    const metaReply = await graph.sendText(recipient, text);
    // Meta's own message id when it gave one, otherwise a local one — either way the thread keeps
    // WHAT WE SAID. Without this the chat pane shows every question and no answer.
    const messageId = String((metaReply as Record<string, unknown>)["message_id"] ?? "") || `di_${at.getTime()}`;
    await fileInThread(ctx, (book, when) => fileOutgoing(book, { kenh: channel, nguoi: recipient, maTin: messageId, chu: text, luc: when, boi: sentBy, trangThai: "da-gui" }, when));
    ctx.bus.emit(EVENTS.messageOut, { kenh: channel, nguoi: recipient, chu: text, luc: at.toISOString() });
    return { ...metaReply, guiNgay: true };
  }
  if (OMI_CHANNELS.includes(channel)) {
    let queued: OutboxItem | null = null;
    await outboxDocument(ctx).update((current) => {
      const outbox = new Outbox(current);
      queued = outbox.enqueue({ channel, recipient, text, source: input.nguon ?? "bo-nao", conversationId: input.maHoiThoai ?? "" }, at);
      return outbox.trim().book;
    }, new Outbox().book);
    // `update` ran the mutator before resolving; the item is set by then.
    const item = queued as OutboxItem | null;
    if (!item) throw new Error("Outbox mutator did not run.");
    // Queued, not sent. It shows in the thread right away marked `cho-gui`, so the person who
    // typed it sees it went somewhere; `/cho-gui/xong` flips it to `da-gui` or `hong`.
    await fileInThread(ctx, (book, when) => fileOutgoing(book, { kenh: channel, nguoi: recipient, maTin: item.id, chu: text, luc: when, boi: sentBy, trangThai: "cho-gui" }, when));
    ctx.ports.logger.info(`[hop-thu] xep hang cho gui ${channel}:${recipient} (${item.id})`);
    return { xepHang: true, id: item.id, guiNgay: false };
  }
  throw new Error(`Kenh "${channel}" chua co o ban nay.`);
}

/** Only the ON-DUTY machine (or a long-lived key) may drain the queue — so two machines never both type the same reply. */
function claimPermission(ctx: Ctx, request: KernelRequest): { allowed: boolean; name: string } {
  const caller = ctx.ports.auth.identify(request);
  if (caller.via !== "ve-xeon") return { allowed: true, name: caller.name || "khoa-dai-han" };
  return { allowed: caller.onDuty === true, name: caller.name };
}

export const manifest = defineModule<Config, Services>({
  id: "hop-thu",
  name: "Hộp thư đa kênh",
  tier: "chatbot",
  runsOn: "server-khach",
  feature: "hop-thu",
  version: "0.2.0",
  ports: ["store", "logger", "clock", "http", "bus", "config", "auth"],
  requiresOptional: ["khung-nen-tang.xeon", "khung-nen-tang.settings"],

  events: {
    emits: [EVENTS.messageIn, EVENTS.messageOut],
    listens: {}
  },

  provides: {
    "hop-thu.send": (ctx, input: SendInput): Promise<SendResult> => sendMessage(ctx, input)
  },

  routes: [
    // Meta calls to confirm the webhook address. No verify token configured = refuse (fail closed).
    {
      method: "GET", path: "/api/facebook/webhook", access: ACCESS.public,
      whyPublic: "Meta goi tu may cua ho, khong mang ma cua shop. Tu bao ve bang verify token: sai la 403.",
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const { verifyToken } = await facebookKeys(ctx);
        const valid = request.query["hub.mode"] === "subscribe" && verifyToken !== "" && request.query["hub.verify_token"] === verifyToken;
        if (!valid) return reply.json({ ok: false, error: "verify_token_khong_khop" }, 403);
        return reply.file(Buffer.from(String(request.query["hub.challenge"] ?? ""), "utf8"), "text/plain; charset=utf-8");
      }
    },
    {
      method: "POST", path: "/api/facebook/webhook", access: ACCESS.public,
      whyPublic: "Meta goi tu may cua ho. Tu bao ve bang chu ky HMAC tren raw byte; khong khop la 401.",
      // 600 per 10 minutes — the running site's number. Meta batches when many messages arrive at once.
      rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: receiveMetaWebhook
    },

    // OMI (the on-duty machine) pushes messages read from Zalo / personal Facebook. Duplicate ids are skipped.
    {
      method: "POST", path: "/api/hop-thu/tin-vao", access: ACCESS.admin,
      rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      bodyLimit: 512 * 1024,
      handle: receiveOmiMessages
    },

    // Desk / OMI pull messages (the old path is kept so the running site does not break on switch-over).
    {
      method: "GET", path: "/api/facebook/webhook-inbox", access: ACCESS.admin,
      handle: async (ctx, request) => {
        const book = (await inboxDocument(ctx).read(defaultInboxBook())) ?? defaultInboxBook();
        const since = String(request.query["since"] ?? "");
        const limit = Math.min(Number(request.query["limit"] ?? 100) || 100, INBOX_KEEP_MAX);
        const events = book.events.filter((e) => !since || e.eventId > since).slice(0, limit);
        // RETURN THE PARSED MESSAGES TOO. The document keeps only Meta's RAW packet (base64) — keeping
        // it verbatim is right, but if the admin screen decoded base64 and understood Meta's shape
        // itself, that shape would leak out of this module. Meta renames one key = two places to fix.
        const messages: InboxMessageRow[] = [];
        for (const e of events) {
          if (isOmiEvent(e)) { messages.push({ ...e.tin, maSuKien: e.eventId, nhanLuc: e.receivedAt, daXacMinh: true }); continue; }
          let packet: unknown = null;
          try { packet = JSON.parse(Buffer.from(String(e.rawBodyBase64 || ""), "base64").toString("utf8")); } catch { packet = null; }
          for (const m of packet === null ? [] : parseWebhookMessages(packet)) {
            messages.push({ ...m, maSuKien: e.eventId, nhanLuc: e.receivedAt, daXacMinh: e.daXacMinh === true });
          }
        }
        const last = events[events.length - 1];
        return reply.json({ ok: true, events, tin: messages, cursor: last ? last.eventId : since, updatedAt: book.updatedAt }, 200, NO_STORE);
      }
    },

    // The brain on Xeon (or a human in OMI) calls this to answer a customer.
    {
      method: "POST", path: "/api/hop-thu/gui", access: ACCESS.service,
      rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asObject(await request.json());
        const caller = ctx.ports.auth.identify(request);
        const source = caller.role === "dich-vu" ? "bo-nao" : "omi";
        try {
          // Network data: `sendMessage` re-checks `nguoi` / `chu` before doing anything.
          const result = await sendMessage(ctx, { ...(body as Partial<SendInput>), nguon: source } as SendInput);
          return reply.json({ ok: true, ketQua: result });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          ctx.ports.logger.warn(`[hop-thu] gui tin that bai: ${message}`);
          return reply.json({ ok: false, error: "gui_that_bai", message }, 502);
        }
      }
    },

    // THE OUTBOX — the on-duty OMI pulls, types through automation, reports back.
    {
      method: "GET", path: "/api/hop-thu/cho-gui", access: ACCESS.admin,
      rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx) => {
        const outbox = new Outbox(await outboxDocument(ctx).read(null)).sweep(ctx.ports.clock.now());
        return reply.json({ ok: true, tomTat: outbox.summary(), muc: outbox.book.muc.slice(-200) }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/hop-thu/cho-gui/nhan", access: ACCESS.admin,
      rateLimit: { calls: 1200, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const who = claimPermission(ctx, request);
        if (!who.allowed) return reply.json({ ok: false, error: "khong_phai_may_truc", message: "Chỉ máy trực mới được gửi tin cho kênh này. Đổi máy trực ở trang quản lý máy trên Xeon." }, 403);
        const body = asObject(await request.json());
        const channel = String(body["kenh"] ?? "");
        if (channel && !OMI_CHANNELS.includes(channel)) return reply.json({ ok: false, error: "kenh_khong_hop_le", kenhHopLe: OMI_CHANNELS }, 400);
        const limit = Math.max(1, Math.min(50, Number(body["gioiHan"]) || 10));
        let claimed: ClaimedItem[] = [];
        await outboxDocument(ctx).update((current) => {
          const outbox = new Outbox(current);
          claimed = outbox.claim({ channel, by: who.name, limit }, ctx.ports.clock.now());
          return outbox.book;
        }, new Outbox().book);
        return reply.json({ ok: true, tin: claimed, nhanSongGiay: Math.round(CLAIM_TTL_MS / 1000) }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/hop-thu/cho-gui/xong", access: ACCESS.admin,
      rateLimit: { calls: 1200, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asObject(await request.json());
        const id = String(body["id"] ?? "");
        if (!id) return reply.json({ ok: false, error: "thieu_id" }, 400);
        let item: OutboxItem | null = null;
        await outboxDocument(ctx).update((current) => {
          const outbox = new Outbox(current);
          item = outbox.complete({ id, ok: body["ok"] === true, error: String(body["loi"] ?? "") }, ctx.ports.clock.now());
          return outbox.book;
        }, new Outbox().book);
        const done = item as OutboxItem | null;
        if (!done) return reply.json({ ok: false, error: "khong_thay_hoac_khong_dang_gui" }, 404);
        // The thread showed it as `cho-gui` the moment it was typed; now it says what really happened.
        await fileInThread(ctx, (book, when) => markOutgoingState(book, done.id, done.trangThai, when));
        if (done.trangThai === "da-gui") {
          ctx.bus.emit(EVENTS.messageOut, { kenh: done.kenh, nguoi: done.nguoi, chu: done.chu, luc: done.guiLuc, boi: done.boi });
        }
        return reply.json({ ok: true, trangThai: done.trangThai, thuLai: done.thuLai });
      }
    },

    // THE CONVERSATIONS, as a person reads them: threads newest first, then one thread's messages.
    {
      method: "GET", path: "/api/hop-thu/hoi-thoai", access: ACCESS.admin,
      rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const book = await conversationDocument(ctx).read(null);
        return reply.json({
          ok: true,
          hoiThoai: listThreads(book, {
            kenh: String(request.query["kenh"] ?? ""),
            loc: String(request.query["loc"] ?? ""),
            q: String(request.query["q"] ?? ""),
            gioiHan: Number(request.query["limit"] ?? 0)
          }),
          soChuaDoc: unreadThreadCount(book)
        }, 200, NO_STORE);
      }
    },
    {
      method: "GET", path: "/api/hop-thu/hoi-thoai/:ma", access: ACCESS.admin,
      rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const thread = threadOf(await conversationDocument(ctx).read(null), request.params["ma"] ?? "");
        if (!thread) return reply.json({ ok: false, error: "khong_thay_hoi_thoai" }, 404);
        return reply.json({ ok: true, hoiThoai: thread }, 200, NO_STORE);
      }
    },
    {
      // Opening a thread clears its unread count. A write, so it is a POST even though it reads like a view.
      method: "POST", path: "/api/hop-thu/hoi-thoai/:ma/da-doc", access: ACCESS.admin,
      rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const id = String(request.params["ma"] ?? "");
        await fileInThread(ctx, (book, when) => markRead(book, id, when));
        const book = await conversationDocument(ctx).read(null);
        return reply.json({ ok: true, soChuaDoc: unreadThreadCount(book) }, 200, NO_STORE);
      }
    },

    // NEEDS A HUMAN — the brain deliberately does NOT answer (handoff) and reports here; OMI shows the list.
    {
      method: "POST", path: "/api/hop-thu/can-nguoi", access: ACCESS.service,
      rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      bodyLimit: 8 * 1024,
      handle: async (ctx, request) => {
        const body = asObject(await request.json());
        const conversationId = String(body["maHoiThoai"] ?? "").trim().slice(0, 160);
        if (!conversationId) return reply.json({ ok: false, error: "thieu_ma_hoi_thoai" }, 400);
        const at = ctx.ports.clock.now().toISOString();
        const item: HandoffItem = {
          maHoiThoai: conversationId, kenh: String(body["kenh"] ?? "").slice(0, 40), nguoi: String(body["nguoi"] ?? "").slice(0, 120),
          lyDo: String(body["lyDo"] ?? "").slice(0, 300), tinCuoi: String(body["tinCuoi"] ?? "").slice(0, 500),
          baoLuc: at, xongLuc: ""
        };
        await handoffDocument(ctx).update((current) => {
          const list = Array.isArray(current?.muc) ? current.muc.filter((m) => m.maHoiThoai !== conversationId) : [];
          list.push(item);
          return { version: 1, muc: list.slice(-HANDOFF_KEEP_MAX), updatedAt: at };
        }, { version: 1, muc: [] });
        ctx.ports.logger.info(`[hop-thu] can nguoi that: ${conversationId} (${item.lyDo || "khong ghi ly do"})`);
        return reply.json({ ok: true });
      }
    },
    {
      method: "GET", path: "/api/hop-thu/can-nguoi", access: ACCESS.admin,
      rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx) => {
        const book = (await handoffDocument(ctx).read(null)) ?? { version: 1 as const, muc: [] };
        const waiting = (book.muc ?? []).filter((m) => !m.xongLuc);
        return reply.json({ ok: true, muc: waiting, soDangCho: waiting.length }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/hop-thu/can-nguoi/xong", access: ACCESS.admin,
      rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asObject(await request.json());
        const conversationId = String(body["maHoiThoai"] ?? "").trim();
        let found = false;
        await handoffDocument(ctx).update((current) => {
          const list = Array.isArray(current?.muc) ? current.muc : [];
          const at = ctx.ports.clock.now().toISOString();
          for (const m of list) if (m.maHoiThoai === conversationId && !m.xongLuc) { m.xongLuc = at; found = true; }
          return { version: 1, muc: list, updatedAt: at };
        }, { version: 1, muc: [] });
        return found ? reply.json({ ok: true }) : reply.json({ ok: false, error: "khong_thay" }, 404);
      }
    },

    // The shop's settings: the stale-message threshold (hours). Adjusted in OMI.
    {
      method: "GET", path: "/api/hop-thu/cau-hinh", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx) => reply.json({ ok: true, cauHinh: await readSettings(ctx), kenhOmi: OMI_CHANNELS }, 200, NO_STORE)
    },
    {
      method: "POST", path: "/api/hop-thu/cau-hinh", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      bodyLimit: 4 * 1024,
      handle: async (ctx, request) => {
        const body = asObject(await request.json());
        const hours = Number(body["nguongTinCuGio"]);
        if (!Number.isFinite(hours) || hours < 1 || hours > 24 * 30) return reply.json({ ok: false, error: "nguong_khong_hop_le", message: "Ngưỡng tin cũ phải từ 1 giờ đến 720 giờ." }, 400);
        const next: InboxSettings = { ...(await readSettings(ctx)), nguongTinCuGio: hours };
        await ctx.ports.store.document<InboxSettings>(SETTINGS_DOCUMENT).write(next);
        return reply.json({ ok: true, cauHinh: next });
      }
    }
  ],

  // The bot may READ the inbox; it may NOT send on the seller's behalf from here —
  // the send door is a service with the access check above.
  botTools: [
    { ten: "doc_hop_thu", moTa: "Doc cac tin gan nhat cua mot khach", hieuUng: "doc" }
  ]
});
