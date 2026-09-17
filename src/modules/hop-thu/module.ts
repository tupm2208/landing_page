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
import type { AssistantServices } from "../tro-ly-ai/module";
import {
  conversationId, defaultConversationBook, fileIncoming, fileOutgoing, listThreads, markOutgoingState, markRead, threadOf, unreadThreadCount,
  setContact, setThreadInfo, threadCursor, type Conversation, type ConversationBook, type ThreadInfoPatch, type ThreadMessage
} from "./conversations";
import {
  ARCHIVE_SCHEMA, BACKFILL_DOCUMENT, MessageArchive, backfillStep, defaultBackfillState, prepareBackfill, type BackfillState
} from "./archive";
import { QUICK_REPLY_DOCUMENT, defaultQuickReplyBook, deleteQuickReply, saveQuickReply, type QuickReplyBook } from "./quick-replies";
import { handoffAlertText, overdueHandoffs, parseTelegramCommand, telegramCall } from "./handoff-alerts";
import crypto from "node:crypto";
import { bytesFromDataUrl } from "../../shared/data-url";
import { GRAPH_VERSION, GraphApiClient } from "./graph-api";
import {
  PAGE_TOKEN_DOCUMENT, defaultPageTokenBook, mergePages, normaliseIncomingPages, publicPages, tokenForPage, type PageTokenBook
} from "./page-tokens";
import {
  COMMENT_CHANNEL, INBOX_KEEP_MAX, INBOX_SEEN_MAX, OMI_CHANNELS, defaultInboxBook, isOmiEvent, normaliseOmiMessage,
  type InboundMessage, type InboxBook, type InboxEvent
} from "./inbox";
import { CLAIM_TTL_MS, Outbox, type ClaimedItem, type OutboxBook, type OutboxItem } from "./outbox";
import { WEBHOOK_BODY_LIMIT, isPagePayload, parseWebhookComments, parseWebhookMessages, verifySignature } from "./webhook";
import { callXeon as sharedCallXeon, type XeonAnswer } from "../../shared/xeon-call";

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
/** Where images the shop sends customers are kept (upload port zone). Served at `/api/fanpage-media/<name>`. */
const MEDIA_ZONE = "hop-thu/anh";
const TEN_MINUTES = 10 * 60 * 1000;
const NO_STORE = { "Cache-Control": "no-store" };

/** `ctx.config` as `app.ts` builds it (`moduleConfigFromEnv`). */
export interface Config {
  verifyToken: string;
  appSecret: string;
  pageToken: string;
  /**
   * The shop's public origin. An image the shop uploaded comes back as `/api/fanpage-media/<name>`;
   * Meta fetches images itself, so a relative path is made absolute against this before sending.
   */
  siteUrl?: string;
  /**
   * Manual brain target for tests and trial runs when the landing has not registered with Xeon.
   * `app.ts` never sets it: in production the target comes from `khung-nen-tang.xeon`.
   */
  brain?: { address: string; token: string; tenant: string };
}

/** Knowing which Xeon / which token to push messages to. Absent (not registered) = the inbox still works. */
interface Services {
  "khung-nen-tang"?: Pick<PlatformServices, "xeon" | "renewXeon" | "settings">;
  /** Đ7: how a conversation is answered (auto / suggest / off) and the automatic draft for suggest mode. */
  "tro-ly-ai"?: Pick<AssistantServices, "replyMode" | "autoDraft">;
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
  /** Messenger only: an image to send (public https). With `chu` too, the text goes first. */
  anhUrl?: string;
}

/** Sent right away through the Graph API (with Meta's reply spread in), or queued for OMI. */
export type SendResult =
  | { guiNgay: true; [meta: string]: unknown }
  | { guiNgay: false; xepHang: true; id: string };

/** Services this module provides (`hop-thu.send`). */
export interface InboxServices {
  send(input: SendInput): Promise<SendResult>;
  /** The last `limit` messages of one thread (oldest first); empty when the thread does not exist. */
  thread(input: { maHoiThoai: string; limit?: number }): Promise<ThreadMessage[]>;
  /** Đ7: a thread's settings and names, without its messages; `null` when it does not exist. */
  threadInfo(input: { maHoiThoai: string }): Promise<Omit<Conversation, "tin"> | null>;
  /** Đ7: the next archived conversations after `sau` for training analysis. */
  archiveBatch(input: { sau: string; soHoiThoai: number; soTin: number }): Promise<{ hoiThoai: { ma: string; tin: { chieu: string; chu: string; luc: string; nguoi: string }[] }[]; sau: string; het: boolean; trongKho: number }>;
  /**
   * Đ8: the connected pages WITH their tokens, for `dang-bai` (publishing, comments). Server-side only —
   * no route of either module ever puts a token on the wire.
   */
  pageAccess(): Promise<{ graph: string; trang: { ma: string; ten: string; token: string }[] }>;
}

interface InboxSettings {
  nguongTinCuGio: number;
  /** Đ6: minutes a handoff may wait before Telegram hears it again. */
  phutQuaHan: number;
  /** Đ6: alert the on-duty Telegram group when the bot hands a conversation over. */
  baoTelegram: boolean;
  /** Đ6: the closing sentence of the order confirmation sent from the chat (Desk `confirmationTemplate`). */
  mauXacNhan: string;
  /** Đ6: names of the shop's own people in Zalo groups — what they say is not a customer message. */
  nguoiCuaShop: string[];
  /** Đ6: secret Telegram echoes on the webhook; never leaves the module. */
  telegramBiMat?: string;
}

const DEFAULT_OVERDUE_MINUTES = 15;
const DEFAULT_CONFIRMATION = "Anh/chị kiểm tra giúp shop, nếu thông tin chính xác nhắn \"OK\" để shop lên đơn ngay ạ. Cảm ơn anh/chị nhiều! 🙏";

interface HandoffItem {
  maHoiThoai: string;
  kenh: string;
  nguoi: string;
  lyDo: string;
  tinCuoi: string;
  baoLuc: string;
  xongLuc: string;
  /** Đ6: when the overdue reminder went to Telegram. */
  nhacLuc?: string;
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
  const minutes = Number(stored?.phutQuaHan);
  return {
    ...(stored ?? {}),
    nguongTinCuGio: Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_STALE_HOURS,
    phutQuaHan: Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_OVERDUE_MINUTES,
    baoTelegram: stored?.baoTelegram !== false,
    mauXacNhan: typeof stored?.mauXacNhan === "string" && stored.mauXacNhan.trim() !== "" ? stored.mauXacNhan : DEFAULT_CONFIRMATION,
    nguoiCuaShop: Array.isArray(stored?.nguoiCuaShop) ? stored.nguoiCuaShop.map(String) : []
  };
}

/** Settings as a screen may see them: the Telegram webhook secret stays inside. */
function publicSettings(settings: InboxSettings): Omit<InboxSettings, "telegramBiMat"> & { coWebhookTelegram: boolean } {
  const { telegramBiMat, ...rest } = settings;
  return { ...rest, coWebhookTelegram: Boolean(telegramBiMat) };
}

/** Whether the bot may answer this thread by itself: not internal, not switched off, not "suggest only". */
function botMayAnswer(thread: Conversation | null): boolean {
  if (thread === null) return true;
  return thread.noiBo !== true && (thread.bot === undefined || thread.bot === "auto");
}

/** A Zalo line "Nhóm · Người gửi" whose sender is one of the shop's own people. */
/**
 * Đ10 STOCK COMMANDS BY ZALO (Desk `stock_command_kit.js`, decided 15/09/2026): the people the shop
 * listed in `lenh_ton_zalo` (Zalo name or sender id) may fix stock by chat ("tồn JP9192 42 5", "hết …",
 * "hoàn"). Their messages are filed but never reach the bot; the shop-features module listens and answers.
 */
export function stockCommander(message: InboundMessage, listed: string): boolean {
  const names = listed.split(",").map((n) => n.trim().toLowerCase()).filter(Boolean);
  if (message.kenh !== "zalo" || names.length === 0) return false;
  const sender = String(message.tenNguoi ?? "").split(" · ").pop()?.trim().toLowerCase() ?? "";
  return names.includes(String(message.nguoi).trim().toLowerCase()) || (sender !== "" && names.includes(sender));
}

function spokenByShop(message: InboundMessage, staff: string[]): string {
  if (staff.length === 0) return "";
  const sender = String(message.tenNguoi ?? "").split(" · ").pop()?.trim().toLowerCase() ?? "";
  return sender !== "" && staff.some((n) => n.trim().toLowerCase() === sender) ? sender : "";
}

/**
 * Pushes a message to the brain on Xeon.
 *
 * Does NOT wait for the result, and a failure here must NOT stop the 200 to Meta: Meta retries
 * every non-2xx reply, so a dead brain would mean Meta retrying forever and the inbox filling with
 * duplicates. The message is already in the document — a brain that comes back can pull it.
 */
function pushToBrain(ctx: Ctx, message: InboundMessage): void {
  type Target = { address: string; token: string; tenant: string };
  const send = (target: Target) => ctx.ports.http.fetch(`${String(target.address).replace(/\/+$/, "")}/tin-den`, {
    method: "POST",
    // The brain answers inside this call: burst gathering (6-13 s), an agent turn (up to 60 s with
    // model retries) and possibly one full re-run after a gateway outage. Nothing waits on it — the
    // webhook already got its 200 — so a long limit only avoids a false "brain refused" warning.
    timeoutMs: 150_000,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${target.token}` },
    body: JSON.stringify({
      tenant: String(target.tenant || ""),
      kenh: message.kenh, nguoi: message.nguoi, chu: message.chu, soAnh: message.soAnh,
      maTin: message.maTin, maHoiThoai: `${message.kenh}:${message.nguoi}`, luc: message.luc,
      // Đ7: only conversations in auto mode are pushed; saying so lets Xeon refuse anything else.
      cheDo: "auto"
    })
  });
  void Promise.resolve()
    .then(async () => {
      // Which Xeon, which token: from the registration with Xeon (platform base). Not registered ->
      // try the manual `brain` config (tests / trial runs). Neither = no brain connected, the inbox
      // works as usual.
      const platform = ctx.services["khung-nen-tang"];
      const registration = platform?.xeon ? await platform.xeon() : null;
      const target: Target | null = registration?.maNhanTin
        ? { address: registration.diaChiXeon, token: registration.maNhanTin, tenant: registration.shop }
        : ctx.config.brain ?? null;
      if (!target?.address) return null;
      const response = await send(target);
      // 401 = Xeon no longer knows our token (it keeps one per merchant; registering again anywhere
      // replaces it). Silently dropping every message from then on is how the bot "just stopped":
      // register again and resend this message once.
      if (response.status !== 401 || !registration?.maNhanTin || !platform?.renewXeon) return response;
      const renewed = await platform.renewXeon();
      return renewed ? send({ address: renewed.diaChiXeon, token: renewed.maNhanTin, tenant: renewed.shop }) : response;
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

/**
 * Đ7: decides what the brain does with a message — answer it (auto), draft for a person (suggest), or
 * nothing (off). Without the AI module the Đ6 rule stands: internal or switched-off threads are filed only.
 * Returns whether the message was pushed to the brain to be ANSWERED.
 */
async function routeToBrain(ctx: Ctx, thread: Conversation | null, message: InboundMessage, settings: InboxSettings): Promise<boolean> {
  const assistant = ctx.services["tro-ly-ai"];
  if (!assistant?.replyMode) return botMayAnswer(thread) ? pushUnlessStale(ctx, message, settings) : false;
  let mode = botMayAnswer(thread) ? "auto" : "off";
  try {
    mode = await assistant.replyMode({ thread: thread ? { bot: thread.bot, noiBo: thread.noiBo, trang: thread.trang } : null, trang: message.trang ?? "" });
  } catch (e) {
    ctx.ports.logger.warn(`[hop-thu] khong doc duoc che do tra loi: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (mode === "auto") return pushUnlessStale(ctx, message, settings);
  const sentAt = Date.parse(String(message.luc || ""));
  const fresh = !Number.isFinite(sentAt) || ctx.ports.clock.now().getTime() - sentAt <= settings.nguongTinCuGio * 3600 * 1000;
  if (mode === "suggest" && fresh && assistant.autoDraft) {
    void assistant.autoDraft({ maHoiThoai: conversationId(message.kenh, message.nguoi) })
      .catch((e: unknown) => ctx.ports.logger.warn(`[hop-thu] chua soan duoc nhap AI: ${e instanceof Error ? e.message : String(e)}`));
  }
  return false;
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

  await acceptPagePacket(ctx, payload, raw, signature, verified);
  return reply.json({ ok: true, daXacMinh: verified });
}

/**
 * Files one Fanpage packet: the raw event into the inbox (Desk pulls it), then — only when it is
 * known to come from Meta — each message and comment into its thread, onto the bus and to the brain.
 *
 * Two doors lead here: Meta calling this landing directly (signature checked by the caller), and
 * Xeon forwarding what Meta sent to the developer's app (service ticket checked by the kernel).
 */
async function acceptPagePacket(ctx: Ctx, payload: unknown, raw: Buffer, signature: string, verified: boolean): Promise<{ daNhan: number; trung: number }> {
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
  if (!verified) return { daNhan: 0, trung: 0 };
  const settings = await readSettings(ctx);
  let filed = 0;
  let duplicates = 0;
  // Messages AND public comments. A shop that reads only the inbox loses the loudest questions
  // it gets — the ones under a post, where everybody can see whether they were answered.
  for (const message of [...parseWebhookMessages(payload), ...parseWebhookComments(payload)]) {
    // The same delivery can arrive twice (Meta retrying, Xeon re-sending a packet it kept): a
    // message already in its thread is neither filed again nor answered a second time.
    const thread = threadOf(await conversationDocument(ctx).read(null), conversationId(message.kenh, message.nguoi));
    if (message.maTin !== "" && thread?.tin.some((m) => m.maTin === message.maTin)) { duplicates += 1; continue; }
    await fileInThread(ctx, (book, when) => fileIncoming(book, message, when));
    ctx.bus.emit(EVENTS.messageIn, message);
    // Đ6: a conversation the shop switched the bot off for (or marked internal) is filed, not answered.
    await routeToBrain(ctx, thread, message, settings);
    filed += 1;
  }
  return { daNhan: filed, trung: duplicates };
}

/**
 * Xeon forwards what Meta sent to the developer's app for THIS shop's pages (decided 15/09/2026:
 * one app for every merchant, its webhook on Xeon). No Meta signature survives the hop; the kernel
 * already checked Xeon's service ticket, which names this shop.
 */
async function receiveFromXeon(ctx: Ctx, request: KernelRequest) {
  const packet = asObject(await request.json())["goi"];
  if (!isPagePayload(packet)) return reply.json({ ok: false, error: "goi_webhook_khong_hop_le" }, 400);
  const result = await acceptPagePacket(ctx, packet, Buffer.from(JSON.stringify(packet), "utf8"), "xeon", true);
  return reply.json({ ok: true, ...result }, 200, NO_STORE);
}

const pageTokenDocument = (ctx: Ctx) => ctx.ports.store.document<PageTokenBook>(PAGE_TOKEN_DOCUMENT);

/**
 * Tells Xeon which pages this shop answers for, with their tokens as PROOF: Xeon asks Meta whose
 * each token is, subscribes the page to the app, and keeps no token. From then on Xeon routes those
 * pages' events here. Not registered with Xeon = nothing to tell; the tokens still serve replies.
 */
async function connectPagesWithXeon(ctx: Ctx, pages: { ma: string; ten: string; token: string }[]): Promise<Record<string, unknown>> {
  const registration = ctx.services["khung-nen-tang"]?.xeon ? await ctx.services["khung-nen-tang"].xeon() : null;
  if (!registration?.diaChiXeon || !registration.maNhanTin) return { ok: false, viSao: "chua_dang_ky_xeon" };
  try {
    const response = await ctx.ports.http.fetch(`${String(registration.diaChiXeon).replace(/\/+$/, "")}/meta/trang`, {
      method: "POST",
      timeoutMs: 60_000,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${registration.maNhanTin}` },
      body: JSON.stringify({ trang: pages.map((p) => ({ ma: p.ma, ten: p.ten, token: p.token })), dangKyNhanTin: true })
    });
    const answer = asObject(await response.json().catch(() => ({})));
    if (!response.ok) return { ok: false, viSao: String(answer["error"] ?? `HTTP ${response.status}`) };
    // Xeon's outcomes carry page ids, names and reasons — never a token.
    return { ok: true, ketQua: Array.isArray(answer["ketQua"]) ? answer["ketQua"] : [] };
  } catch (e) {
    return { ok: false, viSao: "khong_goi_duoc_xeon", chiTiet: e instanceof Error ? e.message : String(e) };
  }
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
  const commanders = String((await ctx.services["khung-nen-tang"]?.settings().catch(() => ({} as Record<string, string>)))?.["lenh_ton_zalo"] ?? "");
  let pushed = 0;
  let byShop = 0;
  let commands = 0;
  for (const message of fresh) {
    if (stockCommander(message, commanders)) {
      await fileInThread(ctx, (book, when) => fileIncoming(book, message, when));
      ctx.bus.emit(EVENTS.stockCommand, message);
      commands += 1;
      continue;
    }
    // Đ6: one of the shop's own people speaking in a Zalo group is what WE said — never a question
    // for the bot (Desk: "thiếu danh sách này thì bot đi trả lời chính lời của shop").
    const staff = message.kenh === "zalo" ? spokenByShop(message, settings.nguoiCuaShop) : "";
    if (staff) {
      await fileInThread(ctx, (book, when) => fileOutgoing(book, { kenh: message.kenh, nguoi: message.nguoi, maTin: message.maTin, chu: message.chu, soAnh: message.soAnh, luc: message.luc, boi: staff, trangThai: "da-gui" }, when));
      byShop += 1;
      continue;
    }
    await fileInThread(ctx, (book, when) => fileIncoming(book, message, when));
    ctx.bus.emit(EVENTS.messageIn, message);
    const thread = threadOf(await conversationDocument(ctx).read(null), conversationId(message.kenh, message.nguoi));
    if (await routeToBrain(ctx, thread, message, settings)) pushed += 1;
  }
  return reply.json({ ok: true, daNhan: fresh.length, trung: duplicates, saiHinhDang: malformed, dayBoNao: pushed, ...(byShop > 0 ? { cuaShop: byShop } : {}), ...(commands > 0 ? { lenhTon: commands } : {}) }, 200, NO_STORE);
}

/**
 * Sends a message to a customer. For the brain and for a human in OMI.
 * Facebook: right away through the Graph API. Zalo / personal FB: queued, the on-duty OMI sends.
 */
/** `/api/fanpage-media/x.jpg` → `https://shop.vn/api/fanpage-media/x.jpg`. Meta cannot fetch a relative path. */
export function absoluteImageUrl(url: string, siteUrl: string | undefined): string {
  if (url === "" || /^https?:\/\//i.test(url)) return url;
  const origin = String(siteUrl ?? "").trim().replace(/\/+$/, "");
  if (!url.startsWith("/") || origin === "") {
    throw new Error("Ảnh gửi khách cần địa chỉ công khai của shop (LANDING_SITE_BASE_URL) để Meta tải được.");
  }
  return `${origin}${url}`;
}

async function sendMessage(ctx: Ctx, input: SendInput): Promise<SendResult> {
  const channel = input.kenh ?? "facebook";
  const recipient = input.nguoi;
  const text = typeof input.chu === "string" ? input.chu : "";
  const imageUrl = absoluteImageUrl(String(input.anhUrl ?? "").trim(), ctx.config.siteUrl);
  if (typeof recipient !== "string" || recipient.trim() === "" || (text.trim() === "" && imageUrl === "")) {
    throw new Error("Gui tin can `nguoi` va `chu` (hoac `anhUrl`).");
  }
  if (imageUrl !== "" && channel !== "facebook") throw new Error(`Kenh "${channel}" chua gui duoc anh o ban nay.`);
  const at = ctx.ports.clock.now();
  const sentBy = input.nguon ?? "nguoi";
  if (channel === COMMENT_CHANNEL || channel === "facebook") {
    // WHICH PAGE answers: the thread remembers the page the customer wrote to, and Meta accepts a
    // reply only with THAT page's token. A shop with several pages and one token answered one page
    // and failed the rest (15/09/2026). No token stored for the page = the old single token, as `/me`.
    const thread = threadOf(await conversationDocument(ctx).read(null), String(input.maHoiThoai ?? "").trim() || conversationId(channel, recipient));
    const pageId = String(thread?.trang ?? "");
    const tokens = await pageTokenDocument(ctx).read(null);
    const pageToken = tokenForPage(tokens, pageId);
    const sender = {
      graph: new GraphApiClient(ctx.ports.http, pageToken || (await facebookKeys(ctx)).pageToken, String(tokens?.graph ?? "") || GRAPH_VERSION),
      pageId: pageToken ? pageId : ""
    };
    if (channel === "facebook") return sendFacebookText(ctx, sender, { recipient, text, imageUrl, sentBy, at });
    // Answering under the comment, not in the inbox: a public question answered privately still
    // looks unanswered to everyone else reading the post. No comment id given (the brain did not
    // send one before 15/09/2026) = the customer's latest comment in this thread.
    const latestComment = [...(thread?.tin ?? [])].reverse().find((m) => m.chieu === "den" && m.maTin !== "")?.maTin ?? "";
    const target = String(input.traLoiTin ?? "").trim() || latestComment;
    if (!target) throw new Error("Tra loi binh luan can `traLoiTin` — ma cua binh luan.");
    const graph = sender.graph;
    const metaReply = await graph.replyToComment(target, text);
    const messageId = String((metaReply as Record<string, unknown>)["id"] ?? "") || `bl_${at.getTime()}`;
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

/** A Messenger reply sent as the thread's page (see `sendMessage`), kept in the thread as what we said. */
async function sendFacebookText(
  ctx: Ctx,
  sender: { graph: GraphApiClient; pageId: string },
  { recipient, text, imageUrl, sentBy, at }: { recipient: string; text: string; imageUrl: string; sentBy: string; at: Date }
): Promise<SendResult> {
  let metaReply: Record<string, unknown> = {};
  // Meta's own message id when it gave one, otherwise a local one — either way the thread keeps
  // WHAT WE SAID. Without this the chat pane shows every question and no answer.
  if (text.trim() !== "") {
    metaReply = await sender.graph.sendText(recipient, text, sender.pageId);
    const messageId = String(metaReply["message_id"] ?? "") || `di_${at.getTime()}`;
    await fileInThread(ctx, (book, when) => fileOutgoing(book, { kenh: "facebook", nguoi: recipient, maTin: messageId, chu: text, luc: when, boi: sentBy, trangThai: "da-gui" }, when));
  }
  if (imageUrl !== "") {
    metaReply = { ...metaReply, ...(await sender.graph.sendImage(recipient, imageUrl, sender.pageId)) };
    const imageId = String(metaReply["message_id"] ?? "") || `anh_${at.getTime()}`;
    await fileInThread(ctx, (book, when) => fileOutgoing(book, { kenh: "facebook", nguoi: recipient, maTin: `${imageId}#anh`, chu: "", soAnh: 1, anh: [imageUrl], luc: when, boi: sentBy, trangThai: "da-gui" }, when));
  }
  ctx.bus.emit(EVENTS.messageOut, { kenh: "facebook", nguoi: recipient, chu: text, anhUrl: imageUrl, luc: at.toISOString() });
  return { ...metaReply, guiNgay: true };
}

/** Only the ON-DUTY machine (or a long-lived key) may drain the queue — so two machines never both type the same reply. */
function claimPermission(ctx: Ctx, request: KernelRequest): { allowed: boolean; name: string } {
  const caller = ctx.ports.auth.identify(request);
  if (caller.via !== "ve-xeon") return { allowed: true, name: caller.name || "khoa-dai-han" };
  return { allowed: caller.onDuty === true, name: caller.name };
}

// ---------------------------------------------------------------------------------------------
// Đ6 (17/09/2026): Fanpage + Zalo đủ việc — pages through Xeon, private replies, posts, the thread
// panel, quick replies, the webhook log, the long-term archive, "cần người" on Telegram.
// ---------------------------------------------------------------------------------------------

/** One call to the shop's Xeon with the private inbox token. Never throws. */
async function callXeon(ctx: Ctx, method: string, pathAndQuery: string, body?: unknown): Promise<XeonAnswer> {
  return sharedCallXeon(ctx, method, pathAndQuery, body, { timeoutMs: 30_000, unregistered: "Landing chưa đăng ký với Xeon — không đi qua app Meta trung tâm được." });
}

/** The Graph client for one page: its own token, else the shop's single token (`/me`). */
async function graphForPage(ctx: Ctx, pageId: string): Promise<{ graph: GraphApiClient; pageId: string } | null> {
  const tokens = await pageTokenDocument(ctx).read(null);
  const own = tokenForPage(tokens, pageId);
  const token = own || (await facebookKeys(ctx)).pageToken;
  if (!token) return null;
  return { graph: new GraphApiClient(ctx.ports.http, token, String(tokens?.graph ?? "") || GRAPH_VERSION), pageId: own ? pageId : "" };
}

/** The shop's Telegram bot and on-duty group, from the shop settings. */
async function telegramTarget(ctx: Ctx): Promise<{ token: string; chatId: string }> {
  try {
    const shop = (await ctx.services["khung-nen-tang"]?.settings?.()) ?? {};
    return { token: String(shop["telegram_bot_token"] ?? "").trim(), chatId: String(shop["telegram_chat_bao_dong"] ?? "").trim() };
  } catch {
    return { token: "", chatId: "" };
  }
}

async function alertTelegram(ctx: Ctx, text: string): Promise<{ ok: boolean; loiNhan: string }> {
  const target = await telegramTarget(ctx);
  if (!target.chatId) return { ok: false, loiNhan: "Chưa nhập chat ID nhóm trực Telegram (Cấu hình → Telegram)." };
  return telegramCall(ctx.ports.http, target.token, "sendMessage", { chat_id: target.chatId, text, parse_mode: "HTML" });
}

const archiveOf = (ctx: Ctx) => new MessageArchive(ctx.ports.store, () => ctx.ports.clock.now());
const backfillDocument = (ctx: Ctx) => ctx.ports.store.document<BackfillState>(BACKFILL_DOCUMENT);
/** One backfill loop per store at a time (per landing, not per process — tests run many kernels). */
const backfillRunning = new WeakMap<object, boolean>();
const BACKFILL_MAX_STEPS = 20000;

async function backfillOnce(ctx: Ctx): Promise<BackfillState> {
  const state = (await backfillDocument(ctx).read(null)) ?? defaultBackfillState();
  const book = await pageTokenDocument(ctx).read(null);
  const graphs = new Map((book?.trang ?? []).map((p) => [p.ma, new GraphApiClient(ctx.ports.http, p.token, String(book?.graph ?? "") || GRAPH_VERSION)]));
  const { state: next } = await backfillStep(state, { graphFor: (id) => graphs.get(id) ?? null, archive: archiveOf(ctx), at: ctx.ports.clock.now().toISOString() });
  // Someone pressed "Dừng" while Meta was answering: keep the step's cursor, honour the stop.
  const latest = await backfillDocument(ctx).read(null);
  if (latest?.trangThai === "dang-dung" && next.trangThai === "dang-chay") next.trangThai = "da-dung";
  await backfillDocument(ctx).write(next);
  return next;
}

/** Runs steps until done, paused or failed. Not awaited by the route; the checkpoint is the record. */
async function runBackfill(ctx: Ctx): Promise<void> {
  if (backfillRunning.get(ctx.ports.store)) return;
  backfillRunning.set(ctx.ports.store, true);
  let failures = 0;
  try {
    for (let n = 0; n < BACKFILL_MAX_STEPS; n += 1) {
      try {
        const state = await backfillDocument(ctx).read(null);
        if (!state || state.trangThai !== "dang-chay") {
          if (state?.trangThai === "dang-dung") await backfillDocument(ctx).write({ ...state, trangThai: "da-dung", capNhatLuc: ctx.ports.clock.now().toISOString() });
          return;
        }
        const next = await backfillOnce(ctx);
        failures = 0;
        if (next.trangThai !== "dang-chay") return;
      } catch (e) {
        // The STORE hiccuped (a busy file, a dropped MySQL connection) — not Meta, which the step
        // records itself. Try again shortly; after three in a row, say so on the checkpoint.
        failures += 1;
        const why = e instanceof Error ? e.message : String(e);
        ctx.ports.logger.warn(`[hop-thu] luu tru: ghi diem dung hong (${failures}/3): ${why}`);
        if (failures >= 3) {
          await backfillDocument(ctx).update((current) => ({ ...(current ?? defaultBackfillState()), trangThai: "loi", loiCuoi: `Không ghi được điểm dừng: ${why}`, capNhatLuc: ctx.ports.clock.now().toISOString() }), defaultBackfillState()).catch(() => undefined);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 200 * failures));
      }
    }
  } finally {
    backfillRunning.delete(ctx.ports.store);
  }
}

/** Status for the screen, with how many messages the archive holds. */
async function backfillView(ctx: Ctx): Promise<Record<string, unknown>> {
  const state = (await backfillDocument(ctx).read(null)) ?? defaultBackfillState();
  const pages = Object.values(state.trang);
  return {
    ...state, dangChayVong: backfillRunning.get(ctx.ports.store) === true,
    tong: { soHoiThoai: pages.reduce((t, p) => t + p.soHoiThoai, 0), soTin: pages.reduce((t, p) => t + p.soTin, 0), trongKho: await archiveOf(ctx).count() }
  };
}

/** Private reply from a comment (Desk `send-facebook-comment-message`), optionally also a public one. */
async function privateReply(ctx: Ctx, body: Record<string, unknown>, sentBy: string): Promise<Record<string, unknown>> {
  const id = String(body["maHoiThoai"] ?? "").trim();
  const thread = threadOf(await conversationDocument(ctx).read(null), id);
  if (!thread || thread.kenh !== COMMENT_CHANNEL) throw Object.assign(new Error("Chỉ nhắn riêng được từ một hội thoại bình luận."), { status: 404 });
  const text = String(body["chu"] ?? "").trim().slice(0, 2000);
  if (!text) throw Object.assign(new Error("Nhập nội dung tin nhắn."), { status: 400 });
  const latest = [...thread.tin].reverse().find((m) => m.chieu === "den" && m.maTin !== "")?.maTin ?? "";
  const commentId = String(body["maBinhLuan"] ?? "").trim() || latest;
  if (!commentId) throw Object.assign(new Error("Không rõ bình luận nào để nhắn riêng."), { status: 400 });
  const sender = await graphForPage(ctx, thread.trang);
  if (!sender) throw Object.assign(new Error("Trang này chưa có token."), { status: 409 });
  const at = ctx.ports.clock.now();
  const meta = await sender.graph.privateReply(commentId, text, sender.pageId);
  const messageId = String(meta["message_id"] ?? "") || `rieng_${at.getTime()}`;
  const recipient = String(meta["recipient_id"] ?? "").trim();
  // The private message opens a Messenger conversation: file it there when Meta names the person.
  if (recipient) {
    await fileInThread(ctx, (book, when) => fileOutgoing(book, { kenh: "facebook", nguoi: recipient, maTin: messageId, chu: text, luc: when, boi: sentBy, trangThai: "da-gui", trang: thread.trang, tenNguoi: thread.tenNguoi }, when));
  }
  await fileInThread(ctx, (book, when) => fileOutgoing(book, { kenh: COMMENT_CHANNEL, nguoi: thread.nguoi, maTin: `rieng:${messageId}`, chu: `(Đã nhắn riêng) ${text}`, luc: when, boi: sentBy, trangThai: "da-gui" }, when));
  const publicText = String(body["traLoiCongKhai"] ?? "").trim().slice(0, 2000);
  let congKhai: Record<string, unknown> | null = null;
  if (publicText) {
    try {
      congKhai = await sender.graph.replyToComment(commentId, publicText);
      const replyId = String(congKhai["id"] ?? "") || `bl_${at.getTime()}`;
      await fileInThread(ctx, (book, when) => fileOutgoing(book, { kenh: COMMENT_CHANNEL, nguoi: thread.nguoi, maTin: replyId, chu: publicText, luc: when, boi: sentBy, trangThai: "da-gui" }, when));
    } catch (e) {
      congKhai = { loi: e instanceof Error ? e.message : String(e) };
    }
  }
  ctx.bus.emit(EVENTS.messageOut, { kenh: "facebook", nguoi: recipient || thread.nguoi, chu: text, luc: at.toISOString() });
  return { ok: true, maTin: messageId, maHoiThoaiMessenger: recipient ? conversationId("facebook", recipient) : "", congKhai, message: congKhai && "loi" in congKhai ? "Đã nhắn riêng, nhưng trả lời công khai bị Meta từ chối." : "Đã gửi tin nhắn riêng cho khách." };
}

/** The webhook log (Desk `facebookWebhookEventsTemplate`): newest deliveries, packets decoded. */
function webhookLog(book: InboxBook, limit: number): Record<string, unknown>[] {
  return [...(book.events ?? [])].reverse().slice(0, limit).map((e) => {
    if (isOmiEvent(e)) return { maSuKien: e.eventId, nhanLuc: e.receivedAt, daXacMinh: true, nguon: "omi", goi: e.tin };
    let packet: unknown = null;
    try { packet = JSON.parse(Buffer.from(String(e.rawBodyBase64 || ""), "base64").toString("utf8")); } catch { packet = null; }
    return { maSuKien: e.eventId, nhanLuc: e.receivedAt, daXacMinh: e.daXacMinh === true, nguon: e.signature === "xeon" ? "xeon" : "meta", goi: packet };
  });
}

export const manifest = defineModule<Config, Services>({
  id: "hop-thu",
  name: "Hộp thư đa kênh",
  tier: "chatbot",
  runsOn: "server-khach",
  feature: "hop-thu",
  version: "0.2.0",
  ports: ["store", "logger", "clock", "http", "bus", "config", "auth", "uploads"],
  requiresOptional: ["khung-nen-tang.xeon", "khung-nen-tang.renewXeon", "khung-nen-tang.settings", "tro-ly-ai.replyMode", "tro-ly-ai.autoDraft"],

  events: {
    emits: [EVENTS.messageIn, EVENTS.messageOut, EVENTS.stockCommand],
    listens: {}
  },

  provides: {
    "hop-thu.send": (ctx, input: SendInput): Promise<SendResult> => sendMessage(ctx, input),
    // The AI agent on Xeon reads the recent thread to answer in context (16/09/2026).
    "hop-thu.thread": async (ctx, input: { maHoiThoai: string; limit?: number }): Promise<ThreadMessage[]> => {
      const thread = threadOf(await conversationDocument(ctx).read(null), String(input?.maHoiThoai ?? "").trim());
      const limit = Math.min(Math.max(1, Number(input?.limit) || 20), 60);
      return thread ? thread.tin.slice(-limit) : [];
    },
    "hop-thu.threadInfo": async (ctx, input: { maHoiThoai: string }): Promise<Omit<Conversation, "tin"> | null> => {
      const thread = threadOf(await conversationDocument(ctx).read(null), String(input?.maHoiThoai ?? "").trim());
      if (!thread) return null;
      const { tin: _messages, ...rest } = thread;
      return rest;
    },
    "hop-thu.pageAccess": async (ctx) => {
      const book = await pageTokenDocument(ctx).read(null);
      return { graph: String(book?.graph ?? "") || GRAPH_VERSION, trang: (book?.trang ?? []).filter((p) => p.token !== "").map((p) => ({ ma: p.ma, ten: p.ten, token: p.token })) };
    },
    "hop-thu.archiveBatch": async (ctx, input: { sau: string; soHoiThoai: number; soTin: number }) => {
      const archive = archiveOf(ctx);
      const batch = await archive.conversationBatch({ sau: String(input?.sau ?? ""), conversations: Math.min(60, Math.max(1, Number(input?.soHoiThoai) || 20)), messagesPerConversation: Math.min(60, Math.max(1, Number(input?.soTin) || 30)) });
      return {
        hoiThoai: batch.hoiThoai.map((c) => ({ ma: c.ma, tin: c.tin.map((m) => ({ chieu: m.chieu, chu: m.chu, luc: m.luc, nguoi: m.nguoi })) })),
        sau: batch.sau, het: batch.het, trongKho: await archive.count()
      };
    }
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

    // Xeon forwards Meta's deliveries for this shop's pages (one developer app for every merchant, 15/09/2026).
    {
      method: "POST", path: "/api/hop-thu/meta-tu-xeon", access: ACCESS.service,
      rateLimit: { calls: 1200, windowMs: TEN_MINUTES },
      bodyLimit: 512 * 1024,
      handle: receiveFromXeon
    },

    // PAGE TOKENS — one per Fanpage. The old site's door for Sales Desk, same body; OMI and the import tool use it too.
    {
      method: "POST", path: "/api/admin/fanpage/credentials", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      bodyLimit: 64 * 1024,
      handle: async (ctx, request) => {
        const body = asObject(await request.json());
        const pages = normaliseIncomingPages(body["pages"] ?? body["trang"]);
        if (pages.length === 0) return reply.json({ ok: false, error: "can_danh_sach_trang", message: "Cần ít nhất một trang có mã và token." }, 400);
        const at = ctx.ports.clock.now().toISOString();
        let book: PageTokenBook = defaultPageTokenBook();
        await pageTokenDocument(ctx).update((current) => {
          book = mergePages(current, pages, body["metaGraphVersion"] ?? body["graph"], at);
          return book;
        }, defaultPageTokenBook());
        // Xeon learns which pages this shop answers for, so it routes their messages here.
        const xeon = await connectPagesWithXeon(ctx, pages);
        ctx.ports.logger.info(`[hop-thu] nhan token ${pages.length} trang: ${pages.map((p) => p.ma).join(", ")}`);
        // Never echo a token: the reply lists pages through `publicPages`.
        return reply.json({ ok: true, soTrang: pages.length, trang: publicPages(book), xeon }, 200, NO_STORE);
      }
    },
    {
      // "Thử Facebook" (Đ3): every connected page's token, plus the single token of shop settings.
      method: "POST", path: "/api/hop-thu/thu-facebook", access: ACCESS.admin,
      rateLimit: { calls: 20, windowMs: TEN_MINUTES },
      handle: async (ctx) => {
        const book = await pageTokenDocument(ctx).read(null);
        const graphVersion = String(book?.graph ?? "") || GRAPH_VERSION;
        const pages = Array.isArray(book?.trang) ? book.trang : [];
        const trang = [];
        for (const p of pages) {
          const answer = await new GraphApiClient(ctx.ports.http, p.token, graphVersion).whoAmI(p.ma);
          trang.push({ ma: p.ma, ten: p.ten || answer.ten, ok: answer.ok, loiNhan: answer.loiNhan });
        }
        const single = (await facebookKeys(ctx)).pageToken;
        const chung = single ? await new GraphApiClient(ctx.ports.http, single, graphVersion).whoAmI() : null;
        const ok = trang.some((x) => x.ok) || chung?.ok === true;
        const loiNhan = trang.length === 0 && chung === null ? "Chưa nối fanpage nào và chưa nhập token trang." : ok ? "Có ít nhất một trang Meta nhận token." : "Meta không nhận token nào.";
        return reply.json({ ok, loiNhan, trang, chung }, 200, NO_STORE);
      }
    },
    {
      method: "GET", path: "/api/hop-thu/trang", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx) => {
        const book = await pageTokenDocument(ctx).read(null);
        return reply.json({ ok: true, trang: publicPages(book), graph: String(book?.graph ?? "") }, 200, NO_STORE);
      }
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
        const caller = request.caller ?? ctx.ports.auth.identify(request);
        // Who answered, as the thread shows it: the brain, a person on the web admin, or OMI.
        const source = caller.role === "dich-vu" ? "bo-nao" : caller.via === "phien-nguoi" ? caller.name : "omi";
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
        const limit = Math.min(Math.max(1, Number(request.query["limit"] ?? 0) || 100), 300);
        const rows = listThreads(book, {
          kenh: String(request.query["kenh"] ?? ""),
          loc: String(request.query["loc"] ?? ""),
          q: String(request.query["q"] ?? ""),
          trang: String(request.query["trang"] ?? ""),
          gioiHan: limit,
          truoc: String(request.query["truoc"] ?? "")
        });
        const last = rows[rows.length - 1];
        return reply.json({
          ok: true,
          hoiThoai: rows,
          soChuaDoc: unreadThreadCount(book),
          // Đ6 "tải thêm": a full page may have more behind it; the cursor fetches the next one.
          conTruoc: rows.length === limit && last ? threadCursor(last) : ""
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
      // The shop notes the customer's phone and address read in the chat (web admin's long-press).
      method: "POST", path: "/api/hop-thu/hoi-thoai/:ma/lien-he", access: ACCESS.admin,
      rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const id = String(request.params["ma"] ?? "");
        const body = asObject(await request.json());
        const contact = { dienThoai: String(body["dienThoai"] ?? body["phone"] ?? ""), diaChi: String(body["diaChi"] ?? body["address"] ?? "") };
        if (!contact.dienThoai.trim() && !contact.diaChi.trim()) return reply.json({ ok: false, error: "thieu_lien_he", message: "Nhập số điện thoại hoặc địa chỉ." }, 422);
        if (!threadOf(await conversationDocument(ctx).read(null), id)) return reply.json({ ok: false, error: "khong_thay", message: "Không thấy hội thoại." }, 404);
        await fileInThread(ctx, (book, when) => setContact(book, id, contact, when));
        return reply.json({ ok: true, hoiThoai: threadOf(await conversationDocument(ctx).read(null), id) }, 200, NO_STORE);
      }
    },
    {
      // An image to send a customer (invoice, QR): kept by the upload port, served back publicly
      // below so Meta can fetch it. Images only, named by the server.
      method: "POST", path: "/api/admin/fanpage/media", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      bodyLimit: 12 * 1024 * 1024,
      handle: async (ctx, request) => {
        const body = asObject(await request.json());
        const bytes = bytesFromDataUrl(body["imageData"] ?? body["anh"]);
        if (!bytes) return reply.json({ ok: false, error: "thieu_anh", message: "Thiếu ảnh (data URL base64)." }, 400);
        try {
          const saved = await ctx.ports.uploads.saveImage(MEDIA_ZONE, bytes, "fbm");
          return reply.json({ ok: true, url: `/api/fanpage-media/${saved.name}`, fileName: saved.name, message: "Đã lưu ảnh." }, 200, NO_STORE);
        } catch (e) {
          const code = (e as { code?: string })?.code;
          if (code) return reply.json({ ok: false, error: code, message: e instanceof Error ? e.message : String(e) }, 400);
          throw e;
        }
      }
    },
    {
      method: "GET", path: "/api/fanpage-media/:tep", access: ACCESS.public,
      whyPublic: "Ảnh shop gửi khách qua Messenger: Meta phải tải được ảnh về nên không có mã. Chỉ đọc ảnh do máy chủ tự đặt tên trong vùng tải lên của hộp thư; không liệt kê, không ghi.",
      rateLimit: { calls: 1200, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const file = await ctx.ports.uploads.open(MEDIA_ZONE).read(String(request.params["tep"] ?? ""));
        if (!file) return reply.json({ ok: false, error: "khong_thay" }, 404);
        return reply.file(file.data, file.type, 200, { "Cache-Control": "public, max-age=604800" });
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
        // Đ6: the on-duty group hears it now. Not awaited — the brain must not wait on Telegram.
        if ((await readSettings(ctx)).baoTelegram) {
          void alertTelegram(ctx, handoffAlertText(item, "moi"))
            .then((r) => { if (!r.ok) ctx.ports.logger.warn(`[hop-thu] chua bao Telegram can nguoi: ${r.loiNhan}`); })
            .catch(() => undefined);
        }
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
      handle: async (ctx) => reply.json({ ok: true, cauHinh: publicSettings(await readSettings(ctx)), kenhOmi: OMI_CHANNELS }, 200, NO_STORE)
    },
    {
      // Partial: only the fields sent change (Đ6 added the handoff, confirmation and staff settings).
      method: "POST", path: "/api/hop-thu/cau-hinh", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      bodyLimit: 16 * 1024,
      handle: async (ctx, request) => {
        const body = asObject(await request.json());
        const next: InboxSettings = { ...(await readSettings(ctx)) };
        if (body["nguongTinCuGio"] !== undefined) {
          const hours = Number(body["nguongTinCuGio"]);
          if (!Number.isFinite(hours) || hours < 1 || hours > 24 * 30) return reply.json({ ok: false, error: "nguong_khong_hop_le", message: "Ngưỡng tin cũ phải từ 1 giờ đến 720 giờ." }, 400);
          next.nguongTinCuGio = hours;
        }
        if (body["phutQuaHan"] !== undefined) {
          const minutes = Number(body["phutQuaHan"]);
          if (!Number.isFinite(minutes) || minutes < 1 || minutes > 24 * 60) return reply.json({ ok: false, error: "phut_khong_hop_le", message: "Thời gian chờ người thật phải từ 1 đến 1440 phút." }, 400);
          next.phutQuaHan = Math.round(minutes);
        }
        if (body["baoTelegram"] !== undefined) next.baoTelegram = body["baoTelegram"] === true;
        if (body["mauXacNhan"] !== undefined) next.mauXacNhan = String(body["mauXacNhan"] ?? "").trim().slice(0, 2000) || DEFAULT_CONFIRMATION;
        if (body["nguoiCuaShop"] !== undefined) {
          const raw = body["nguoiCuaShop"];
          const names = (Array.isArray(raw) ? raw.map(String) : String(raw ?? "").split(",")).map((n) => n.trim().slice(0, 120)).filter(Boolean);
          next.nguoiCuaShop = [...new Set(names)].slice(0, 50);
        }
        await ctx.ports.store.document<InboxSettings>(SETTINGS_DOCUMENT).write(next);
        return reply.json({ ok: true, cauHinh: publicSettings(next) });
      }
    },

    // ----- Đ6: the thread panel (profile, orders, note, bot mode, Zalo group form, order card) -----
    {
      method: "POST", path: "/api/hop-thu/hoi-thoai/:ma/thong-tin", access: ACCESS.admin,
      rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      bodyLimit: 16 * 1024,
      handle: async (ctx, request) => {
        const id = String(request.params["ma"] ?? "");
        const body = asObject(await request.json());
        const patch: ThreadInfoPatch = {};
        for (const key of ["maKhach", "ghiChu", "ganDon", "boGanDon", "boGoiYDon", "bot", "tenKhach", "maDon"] as const) {
          if (body[key] !== undefined) patch[key] = String(body[key] ?? "");
        }
        if (body["daXacNhan"] !== undefined) patch.daXacNhan = body["daXacNhan"] === true;
        if (body["noiBo"] !== undefined) patch.noiBo = body["noiBo"] === true;
        if (body["theDatHang"] !== undefined) patch.theDatHang = body["theDatHang"] === null ? null : asObject(body["theDatHang"]);
        if (Object.keys(patch).length === 0) return reply.json({ ok: false, error: "khong_co_gi", message: "Không có gì để lưu." }, 400);
        let found: Conversation | null = null;
        try {
          await conversationDocument(ctx).update((current) => {
            const r = setThreadInfo(current, id, patch, ctx.ports.clock.now().toISOString());
            found = r.thread;
            return r.thread ? r.book : undefined;
          }, defaultConversationBook());
        } catch (e) {
          return reply.json({ ok: false, error: "sai_thong_tin", message: e instanceof Error ? e.message : String(e) }, 400);
        }
        if (found === null) return reply.json({ ok: false, error: "khong_thay", message: "Không thấy hội thoại." }, 404);
        return reply.json({ ok: true, hoiThoai: found }, 200, NO_STORE);
      }
    },

    // ----- Đ6: comments — private reply, the original post -----
    {
      method: "POST", path: "/api/hop-thu/tra-loi-rieng", access: ACCESS.admin,
      rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      bodyLimit: 16 * 1024,
      handle: async (ctx, request) => {
        const caller = request.caller ?? ctx.ports.auth.identify(request);
        try {
          return reply.json(await privateReply(ctx, asObject(await request.json()), caller.via === "phien-nguoi" ? caller.name : "omi"), 200, NO_STORE);
        } catch (e) {
          const status = Number((e as { status?: number }).status) || 502;
          return reply.json({ ok: false, error: "nhan_rieng_that_bai", message: e instanceof Error ? e.message : String(e) }, status);
        }
      }
    },
    {
      method: "GET", path: "/api/hop-thu/bai-viet", access: ACCESS.admin,
      rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const thread = threadOf(await conversationDocument(ctx).read(null), String(request.query["maHoiThoai"] ?? ""));
        const postId = String(request.query["baiViet"] ?? "").trim() || [...(thread?.tin ?? [])].reverse().find((m) => m.baiViet)?.baiViet || "";
        if (!postId) return reply.json({ ok: false, error: "khong_co_bai", message: "Hội thoại này không gắn bài viết nào." }, 404);
        const sender = await graphForPage(ctx, String(request.query["trang"] ?? "") || thread?.trang || postId.split("_")[0] || "");
        if (!sender) return reply.json({ ok: false, error: "chua_co_token", message: "Trang này chưa có token." }, 409);
        try {
          return reply.json({ ok: true, bai: await sender.graph.postInfo(postId) }, 200, { "Cache-Control": "private, max-age=300" });
        } catch (e) {
          return reply.json({ ok: false, error: "meta_tu_choi", message: e instanceof Error ? e.message : String(e) }, 502);
        }
      }
    },

    // ----- Đ6: quick reply templates -----
    {
      method: "GET", path: "/api/hop-thu/mau-tra-loi", access: ACCESS.admin,
      rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx) => reply.json({ ok: true, mau: ((await ctx.ports.store.document<QuickReplyBook>(QUICK_REPLY_DOCUMENT).read(null)) ?? defaultQuickReplyBook()).mau }, 200, NO_STORE)
    },
    {
      method: "POST", path: "/api/hop-thu/mau-tra-loi", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      bodyLimit: 16 * 1024,
      handle: async (ctx, request) => {
        const body = asObject(await request.json());
        let saved: unknown = null;
        try {
          await ctx.ports.store.document<QuickReplyBook>(QUICK_REPLY_DOCUMENT).update((current) => {
            const r = saveQuickReply(current, body, ctx.ports.clock.now());
            saved = r.mau;
            return r.book;
          }, defaultQuickReplyBook());
        } catch (e) {
          return reply.json({ ok: false, error: "mau_khong_hop_le", message: e instanceof Error ? e.message : String(e) }, 400);
        }
        return reply.json({ ok: true, mau: saved });
      }
    },
    {
      method: "POST", path: "/api/hop-thu/mau-tra-loi/xoa", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const id = String(asObject(await request.json())["ma"] ?? "");
        let found = false;
        await ctx.ports.store.document<QuickReplyBook>(QUICK_REPLY_DOCUMENT).update((current) => {
          const r = deleteQuickReply(current, id);
          found = r.found;
          return r.found ? r.book : undefined;
        }, defaultQuickReplyBook());
        return found ? reply.json({ ok: true }) : reply.json({ ok: false, error: "khong_thay", message: "Không thấy mẫu." }, 404);
      }
    },

    // ----- Đ6: the webhook log -----
    {
      method: "GET", path: "/api/hop-thu/nhat-ky-webhook", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const book = (await inboxDocument(ctx).read(defaultInboxBook())) ?? defaultInboxBook();
        const limit = Math.min(Math.max(1, Number(request.query["limit"] ?? 20) || 20), 100);
        return reply.json({ ok: true, suKien: webhookLog(book, limit), tong: (book.events ?? []).length }, 200, NO_STORE);
      }
    },

    // ----- Đ6: pages through the central Meta app on Xeon — log in, subscribe, disconnect -----
    {
      method: "POST", path: "/api/hop-thu/ket-noi-facebook", access: ACCESS.admin,
      rateLimit: { calls: 30, windowMs: TEN_MINUTES },
      handle: async (ctx) => {
        const r = await callXeon(ctx, "POST", "/meta/dang-nhap", {});
        if (!r.ok) return reply.json({ ok: false, error: "xeon_tu_choi", message: r.viSao }, r.status === 503 ? 503 : 502);
        return reply.json({ ok: true, url: String(r.body["url"] ?? ""), maPhien: String(r.body["maPhien"] ?? ""), hetSauGiay: Number(r.body["hetSauGiay"] ?? 900) }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/hop-thu/ket-noi-facebook/xong", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const session = String(asObject(await request.json())["maPhien"] ?? "").trim();
        if (!session) return reply.json({ ok: false, error: "thieu_ma_phien", message: "Bấm Kết nối page trước." }, 400);
        const r = await callXeon(ctx, "GET", `/meta/dang-nhap/ket-qua?maPhien=${encodeURIComponent(session)}`);
        if (!r.ok) return reply.json({ ok: false, error: "xeon_tu_choi", message: r.viSao }, r.status === 404 ? 404 : 502);
        if (r.body["xong"] !== true) return reply.json({ ok: false, error: "chua_cap_quyen", message: String(r.body["loi"] ?? "") || "Chưa đăng nhập Facebook xong — cấp quyền trong trình duyệt rồi bấm lại." }, 409);
        const pages = normaliseIncomingPages(r.body["trang"]);
        if (pages.length === 0) return reply.json({ ok: false, error: "khong_co_trang", message: "Tài khoản này không quản lý trang nào." }, 409);
        let book: PageTokenBook = defaultPageTokenBook();
        await pageTokenDocument(ctx).update((current) => { book = mergePages(current, pages, "", ctx.ports.clock.now().toISOString()); return book; }, defaultPageTokenBook());
        const xeon = await connectPagesWithXeon(ctx, pages);
        return reply.json({ ok: true, soTrang: pages.length, trang: publicPages(book), xeon }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/hop-thu/trang/dang-ky", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const id = String(asObject(await request.json())["ma"] ?? "").trim();
        const book = await pageTokenDocument(ctx).read(null);
        const page = (book?.trang ?? []).find((p) => p.ma === id);
        if (!page) return reply.json({ ok: false, error: "khong_thay_trang", message: "Trang này chưa có token — nối trang trước." }, 404);
        const xeon = await connectPagesWithXeon(ctx, [{ ma: page.ma, ten: page.ten, token: page.token }]);
        const outcome = (Array.isArray(xeon["ketQua"]) ? xeon["ketQua"] : [])[0] as Record<string, unknown> | undefined;
        const ok = xeon["ok"] === true && outcome?.["ok"] === true && outcome["daDangKyNhanTin"] === true;
        return reply.json({
          ok, xeon,
          message: ok ? `Đã bật webhook cho ${page.ten || page.ma}.` : `Chưa bật được webhook: ${String(outcome?.["loiDangKy"] ?? outcome?.["viSao"] ?? xeon["viSao"] ?? "không rõ")}`
        }, ok ? 200 : 502);
      }
    },
    {
      method: "POST", path: "/api/hop-thu/trang/ngat", access: ACCESS.admin,
      rateLimit: { calls: 30, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const raw = asObject(await request.json())["ma"];
        const ids = (Array.isArray(raw) ? raw : [raw]).map((x) => String(x ?? "").trim()).filter(Boolean);
        if (ids.length === 0) return reply.json({ ok: false, error: "can_trang", message: "Chọn trang cần ngắt." }, 400);
        const before = await pageTokenDocument(ctx).read(null);
        const leaving = (before?.trang ?? []).filter((p) => ids.includes(p.ma));
        // Xeon first, WITH the tokens, so Meta stops delivering; then the tokens are forgotten here.
        const xeon = await callXeon(ctx, "POST", "/meta/trang/ngat", { trang: ids.map((ma) => ({ ma, token: leaving.find((p) => p.ma === ma)?.token ?? "" })) });
        let book: PageTokenBook = defaultPageTokenBook();
        await pageTokenDocument(ctx).update((current) => {
          book = { ...defaultPageTokenBook(), ...(current ?? {}), trang: (current?.trang ?? []).filter((p) => !ids.includes(p.ma)), updatedAt: ctx.ports.clock.now().toISOString() };
          return book;
        }, defaultPageTokenBook());
        return reply.json({ ok: true, daNgat: leaving.map((p) => p.ma), trang: publicPages(book), xeon: xeon.ok ? xeon.body : { ok: false, viSao: xeon.viSao } }, 200, NO_STORE);
      }
    },

    // ----- Đ6: the long-term archive (resumable backfill through the Graph API) -----
    {
      method: "GET", path: "/api/hop-thu/luu-tru", access: ACCESS.admin,
      rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx) => reply.json({ ok: true, luuTru: await backfillView(ctx) }, 200, NO_STORE)
    },
    {
      method: "POST", path: "/api/hop-thu/luu-tru/bat-dau", access: ACCESS.admin,
      rateLimit: { calls: 30, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asObject(await request.json());
        const pages = ((await pageTokenDocument(ctx).read(null))?.trang ?? []).map((p) => ({ ma: p.ma, ten: p.ten }));
        if (pages.length === 0) return reply.json({ ok: false, error: "chua_co_trang", message: "Chưa nối fanpage nào có token." }, 409);
        const current = await backfillDocument(ctx).read(null);
        if (current?.trangThai === "dang-chay" && backfillRunning.get(ctx.ports.store)) return reply.json({ ok: true, luuTru: await backfillView(ctx), message: "Đang tải rồi." });
        const next = prepareBackfill(current, pages, { restart: body["lamLai"] === true, since: String(body["tu"] ?? ""), at: ctx.ports.clock.now().toISOString() });
        await backfillDocument(ctx).write(next);
        void runBackfill(ctx);
        return reply.json({ ok: true, luuTru: await backfillView(ctx), message: body["lamLai"] === true ? "Đã bắt đầu tải lại từ đầu (kho cũ giữ nguyên)." : "Đã bắt đầu/tiếp tục tải lịch sử." }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/hop-thu/luu-tru/dung", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: async (ctx) => {
        const at = ctx.ports.clock.now().toISOString();
        await backfillDocument(ctx).update((current) => {
          const state = current ?? defaultBackfillState();
          if (state.trangThai !== "dang-chay") return undefined;
          return { ...state, trangThai: backfillRunning.get(ctx.ports.store) ? "dang-dung" : "da-dung", capNhatLuc: at };
        }, defaultBackfillState());
        return reply.json({ ok: true, luuTru: await backfillView(ctx), message: "Đã yêu cầu dừng — chốt checkpoint sau lượt Meta đang chạy." }, 200, NO_STORE);
      }
    },
    {
      // One step by hand — OMI's "chạy một bước" and the tests; refused while the loop runs.
      method: "POST", path: "/api/hop-thu/luu-tru/buoc", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx) => {
        if (backfillRunning.get(ctx.ports.store)) return reply.json({ ok: false, error: "dang_chay", message: "Vòng tải đang chạy." }, 409);
        const state = await backfillDocument(ctx).read(null);
        if (!state || Object.keys(state.trang).length === 0) return reply.json({ ok: false, error: "chua_bat_dau", message: "Bấm Tải lịch sử trước." }, 409);
        if (state.trangThai !== "dang-chay") await backfillDocument(ctx).write({ ...state, trangThai: "dang-chay" });
        await backfillOnce(ctx);
        return reply.json({ ok: true, luuTru: await backfillView(ctx) }, 200, NO_STORE);
      }
    },
    {
      method: "GET", path: "/api/hop-thu/luu-tru/tin", access: ACCESS.admin,
      rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const id = String(request.query["maHoiThoai"] ?? "").trim();
        if (!id) return reply.json({ ok: false, error: "thieu_ma_hoi_thoai" }, 400);
        const r = await archiveOf(ctx).older({ maHoiThoai: id, truoc: String(request.query["truoc"] ?? ""), limit: Number(request.query["limit"] ?? 50) });
        return reply.json({ ok: true, ...r }, 200, NO_STORE);
      }
    },

    // ----- Đ6: "cần người" on Telegram — the overdue scan, the bot webhook -----
    {
      method: "POST", path: "/api/hop-thu/can-nguoi/quet-qua-han", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx) => {
        const settings = await readSettings(ctx);
        const now = ctx.ports.clock.now();
        const book = (await handoffDocument(ctx).read(null)) ?? { version: 1 as const, muc: [] };
        const overdue = overdueHandoffs(book.muc ?? [], now, settings.phutQuaHan);
        let sent = 0;
        let lastError = "";
        for (const item of overdue) {
          const r = await alertTelegram(ctx, handoffAlertText(item, "qua-han", settings.phutQuaHan));
          if (r.ok) sent += 1; else lastError = r.loiNhan;
        }
        if (overdue.length > 0) {
          const ids = new Set(overdue.map((m) => m.maHoiThoai));
          await handoffDocument(ctx).update((current) => ({
            version: 1, updatedAt: now.toISOString(),
            muc: (current?.muc ?? []).map((m) => (ids.has(m.maHoiThoai) && !m.xongLuc ? { ...m, nhacLuc: now.toISOString() } : m))
          }), { version: 1, muc: [] });
        }
        const waiting = (book.muc ?? []).filter((m) => !m.xongLuc).length;
        return reply.json({
          ok: overdue.length === 0 || sent > 0, quaHan: overdue.length, daBao: sent, dangCho: waiting,
          message: overdue.length === 0 ? `Không có hội thoại nào chờ quá ${settings.phutQuaHan} phút (${waiting} đang chờ).` : sent > 0 ? `Đã nhắc ${sent}/${overdue.length} hội thoại quá hạn trên Telegram.` : `Có ${overdue.length} hội thoại quá hạn nhưng chưa báo được: ${lastError}`
        }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/hop-thu/telegram/dat-webhook", access: ACCESS.admin,
      rateLimit: { calls: 20, windowMs: TEN_MINUTES },
      handle: async (ctx) => {
        const site = String(ctx.config.siteUrl ?? "").trim().replace(/\/+$/, "");
        if (!/^https:\/\//i.test(site)) return reply.json({ ok: false, error: "can_https", message: "Telegram chỉ nhận webhook HTTPS công khai — landing cần LANDING_SITE_BASE_URL dạng https." }, 409);
        const target = await telegramTarget(ctx);
        const settings = await readSettings(ctx);
        const secret = settings.telegramBiMat || crypto.randomBytes(24).toString("hex");
        const url = `${site}/api/hop-thu/telegram/webhook`;
        const r = await telegramCall(ctx.ports.http, target.token, "setWebhook", { url, secret_token: secret, allowed_updates: ["message"] });
        if (!r.ok) return reply.json({ ok: false, error: "telegram_tu_choi", message: r.loiNhan }, 502);
        await ctx.ports.store.document<InboxSettings>(SETTINGS_DOCUMENT).write({ ...settings, telegramBiMat: secret });
        return reply.json({ ok: true, duongDan: url, message: `Đã đặt webhook Telegram: ${url}. Trong nhóm trực gõ /tra <mã> <câu> hoặc /xong <mã>.` });
      }
    },
    {
      method: "POST", path: "/api/hop-thu/telegram/webhook", access: ACCESS.public,
      whyPublic: "Telegram goi tu may cua ho. Tu bao ve bang secret_token dat luc setWebhook (header X-Telegram-Bot-Api-Secret-Token); khong khop la 401. Chi nhan lenh tu dung chat nhom truc.",
      rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      bodyLimit: 64 * 1024,
      handle: async (ctx, request) => {
        const settings = await readSettings(ctx);
        const given = String(request.headers["x-telegram-bot-api-secret-token"] ?? "");
        const secret = String(settings.telegramBiMat ?? "");
        if (!secret || given.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
          return reply.json({ ok: false, error: "sai_bi_mat" }, 401);
        }
        const message = asObject(asObject(await request.json())["message"]);
        const target = await telegramTarget(ctx);
        const chatId = String(asObject(message["chat"])["id"] ?? "");
        // Only the on-duty group may command: a stranger who found the bot cannot message customers.
        if (!target.chatId || chatId !== target.chatId) return reply.json({ ok: true, boQua: "khong_phai_nhom_truc" });
        const command = parseTelegramCommand(message["text"]);
        if (!command) return reply.json({ ok: true, boQua: "khong_phai_lenh" });
        const answer = (text: string) => { void telegramCall(ctx.ports.http, target.token, "sendMessage", { chat_id: chatId, text }).catch(() => undefined); };
        const at = ctx.ports.clock.now().toISOString();
        if (command.viec === "xong") {
          let found = false;
          await handoffDocument(ctx).update((current) => {
            const list = Array.isArray(current?.muc) ? current.muc : [];
            for (const m of list) if (m.maHoiThoai === command.ma && !m.xongLuc) { m.xongLuc = at; found = true; }
            return { version: 1, muc: list, updatedAt: at };
          }, { version: 1, muc: [] });
          answer(found ? `Đã đánh dấu xong ${command.ma}.` : `Không có ${command.ma} đang chờ người.`);
          return reply.json({ ok: true, viec: "xong", found });
        }
        const [kenh, ...rest] = command.ma.split(":");
        const person = rest.join(":");
        const from = String(asObject(message["from"])["first_name"] ?? "telegram").slice(0, 60);
        try {
          await sendMessage(ctx, { kenh: kenh ?? "", nguoi: person, chu: command.chu, nguon: `telegram:${from}`, maHoiThoai: command.ma });
          answer(`Đã gửi cho ${command.ma}.`);
          return reply.json({ ok: true, viec: "tra" });
        } catch (e) {
          answer(`Chưa gửi được cho ${command.ma}: ${e instanceof Error ? e.message : String(e)}`);
          return reply.json({ ok: true, viec: "tra", loi: e instanceof Error ? e.message : String(e) });
        }
      }
    }
  ],
  schema: ARCHIVE_SCHEMA,

  // The bot may READ the inbox; it may NOT send on the seller's behalf from here —
  // the send door is a service with the access check above.
  botTools: [
    { ten: "doc_hop_thu", moTa: "Doc cac tin gan nhat cua mot khach", hieuUng: "doc" }
  ]
});
