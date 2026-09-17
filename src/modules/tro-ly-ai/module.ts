/**
 * @file MODULE AI ASSISTANT ("tro-ly-ai") — Đ7, chatbot tier, on the merchant server.
 *
 * Every AI screen of OMI (the "AI nghĩ gì" pane, Zalo suggestions, Demo AI, Training, Token AI, the
 * photo and external-product tools of Fanpage) goes OMI → HERE → Xeon. Decided 17/09/2026: all AI
 * runs on Xeon, OMI never holds a key. This module holds what is the SHOP'S:
 *
 *   - the operations settings (reply mode, person on duty, force human, partner goods paused, pages
 *     whose bot is off) — `hop-thu` asks `replyMode` before pushing a message to the brain;
 *   - the training books (Q&A, review queue, sample profiles, fit notes, libraries, style examples)
 *     and the analysis job over the archive — conversations are stripped of personal data HERE,
 *     before anything leaves for Xeon;
 *   - the last draft per conversation, the photo memory, the external products;
 *   - `training.knowledge` for the brain: APPROVED items only.
 *
 * THE RULE THAT MUST NOT BEND: nothing is approved automatically. Analysis results enter the queue
 * as candidates when a person presses "Đưa vào hàng đợi", and each one needs its own "Duyệt".
 */

import crypto from "node:crypto";
import { ACCESS, defineModule, reply, type KernelRequest, type ModuleContext } from "../../contract";
import type { PlatformServices } from "../khung-nen-tang/module";
import type { InboxServices } from "../hop-thu/module";
import {
  ANALYSIS_DOCUMENT, KNOWLEDGE_DOCUMENT, OPS_DOCUMENT, QA_DOCUMENT, REVIEW_DOCUMENT,
  addFitNote, addQa, addSampleProfile, approveReview, blockReview, defaultAnalysis, defaultKnowledgeBook, defaultQaBook, defaultReviewBook,
  effectiveMode, enqueueCandidates, foldAnalysis, knowledgeMarkdown, patchOps, readOps, reviewCandidate, saveLibrary, saveStyleExample, setQaStatus, upsertCandidate,
  type AnalysisState, type KnowledgeBook, type OpsSettings, type QaBook, type ReplyMode, type ReviewBook, type ReviewItem
} from "./training";
import { stripPII } from "./pii";
import { extractFitSignals } from "./fit-signals";
import { EXTERNAL_DOCUMENT, activeFor, defaultExternalBook, expire, parsePrice, patchItem, recentItems, settle, type ExternalBook } from "./external-products";
import { callXeon as sharedCallXeon, type XeonAnswer } from "../../shared/xeon-call";

export const DRAFT_DOCUMENT = "tro-ly-ai-goi-y";
export const IMAGE_MEMORY_DOCUMENT = "tro-ly-ai-anh-nho";
export const FIT_DISMISSED_DOCUMENT = "tro-ly-ai-tin-hieu-bo";

const TEN_MINUTES = 10 * 60 * 1000;
const NO_STORE = { "Cache-Control": "no-store" };
const DRAFTS_KEEP = 300;
const ANALYSIS_BATCH_CONVERSATIONS = 20;
const ANALYSIS_MESSAGES = 30;
const ANALYSIS_MAX_BATCHES = 200;

export type Config = Record<string, never>;

interface Services {
  "hop-thu"?: Pick<InboxServices, "thread" | "threadInfo" | "send" | "archiveBatch">;
  "khung-nen-tang"?: Pick<PlatformServices, "xeon">;
}

type Ctx = ModuleContext<Config, Services>;

/** What other modules may ask of this one. */
export interface AssistantServices {
  replyMode(input: { thread: { bot?: string | undefined; noiBo?: boolean | undefined; trang?: string | undefined } | null; trang: string }): Promise<ReplyMode>;
  autoDraft(input: { maHoiThoai: string }): Promise<unknown>;
  knowledge(input: { q: string; maHoiThoai: string }): Promise<Record<string, unknown>>;
}

interface StoredDraft extends Record<string, unknown> {
  maHoiThoai: string;
  luc: string;
  nguon: string;
  cheDo: string;
}

interface DraftBook { version: 1; hoiThoai: Record<string, StoredDraft> }
interface ImageMemory { version: 1; anh: Record<string, { ma: string; ten: string; luc: string }> }
interface DismissedBook { version: 1; hoiThoai: Record<string, string[]> }

const text = (v: unknown, n = 2000): string => String(v ?? "").trim().slice(0, n);
const norm = (v: unknown): string => text(v, 4000).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d");
function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const opsDocument = (ctx: Ctx) => ctx.ports.store.document<Partial<OpsSettings>>(OPS_DOCUMENT);
const qaDocument = (ctx: Ctx) => ctx.ports.store.document<QaBook>(QA_DOCUMENT);
const reviewDocument = (ctx: Ctx) => ctx.ports.store.document<ReviewBook>(REVIEW_DOCUMENT);
const knowledgeDocument = (ctx: Ctx) => ctx.ports.store.document<KnowledgeBook>(KNOWLEDGE_DOCUMENT);
const analysisDocument = (ctx: Ctx) => ctx.ports.store.document<AnalysisState>(ANALYSIS_DOCUMENT);
const draftDocument = (ctx: Ctx) => ctx.ports.store.document<DraftBook>(DRAFT_DOCUMENT);
const imageDocument = (ctx: Ctx) => ctx.ports.store.document<ImageMemory>(IMAGE_MEMORY_DOCUMENT);
const externalDocument = (ctx: Ctx) => ctx.ports.store.document<ExternalBook>(EXTERNAL_DOCUMENT);
const dismissedDocument = (ctx: Ctx) => ctx.ports.store.document<DismissedBook>(FIT_DISMISSED_DOCUMENT);

const ops = async (ctx: Ctx): Promise<OpsSettings> => readOps(await opsDocument(ctx).read(null));

/** Who pressed the button, as the thread shows it. */
function actor(ctx: Ctx, request: KernelRequest): string {
  const caller = request.caller ?? ctx.ports.auth.identify(request);
  return caller.via === "phien-nguoi" ? caller.name : "omi";
}

/** One call to the shop's Xeon with the private inbox token. Never throws. */
async function callXeon(ctx: Ctx, method: string, route: string, body?: unknown, timeoutMs = 60_000): Promise<XeonAnswer> {
  return sharedCallXeon(ctx, method, route, body, { timeoutMs, unregistered: "Landing chưa đăng ký với Xeon — các việc AI chạy trên Xeon nên chưa dùng được." });
}

/** Xeon's refusal as this landing's reply. */
function xeonRefused(r: { status: number; viSao: string; body: Record<string, unknown> }) {
  const status = r.status === 503 || r.status === 409 || r.status === 400 || r.status === 403 ? r.status : 502;
  return reply.json({ ok: false, error: String(r.body["error"] ?? "xeon_tu_choi"), message: r.viSao }, status, NO_STORE);
}

// ------------------------------------------------------------------ drafts

async function draftFor(ctx: Ctx, maHoiThoai: string, source: "nguoi" | "tu-dong"): Promise<{ ok: true; draft: StoredDraft } | { ok: false; status: number; body: Record<string, unknown>; viSao: string }> {
  const info = ctx.services["hop-thu"]?.threadInfo ? await ctx.services["hop-thu"].threadInfo({ maHoiThoai }) : null;
  if (!info) return { ok: false, status: 404, body: { error: "khong_thay_hoi_thoai" }, viSao: "Không thấy hội thoại." };
  const mode = effectiveMode(await ops(ctx), { bot: info.bot, noiBo: info.noiBo, trang: info.trang });
  const r = await callXeon(ctx, "POST", "/ai/goi-y", { maHoiThoai, kenh: info.kenh, cheDo: mode, nguon: source }, 150_000);
  if (!r.ok) return { ok: false, status: r.status, body: r.body, viSao: r.viSao };
  const { ok: _ok, ...rest } = r.body;
  const draft: StoredDraft = { ...rest, maHoiThoai, luc: ctx.ports.clock.now().toISOString(), nguon: source, cheDo: mode };
  if (draft["boQua"]) return { ok: true, draft };
  await draftDocument(ctx).update((current) => {
    const all = { ...(current?.hoiThoai ?? {}), [maHoiThoai]: draft };
    const kept = Object.entries(all).sort((a, b) => String(b[1].luc).localeCompare(String(a[1].luc))).slice(0, DRAFTS_KEEP);
    return { version: 1, hoiThoai: Object.fromEntries(kept) };
  }, { version: 1, hoiThoai: {} });
  return { ok: true, draft };
}

// ------------------------------------------------------------------ knowledge for the brain

const words = (value: string): Set<string> => new Set(norm(value).split(/[^a-z0-9]+/).filter((w) => w.length >= 3));

function relevance(query: Set<string>, value: string): number {
  if (query.size === 0) return 0;
  let hits = 0;
  for (const w of words(value)) if (query.has(w)) hits += 1;
  return hits;
}

function topBy<T>(items: T[], score: (item: T) => number, limit: number): T[] {
  return items.map((item, i) => ({ item, s: score(item), i })).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, limit).map((x) => x.item);
}

async function knowledgeFor(ctx: Ctx, input: { q: string; maHoiThoai: string }): Promise<Record<string, unknown>> {
  const query = words(input.q);
  const [qa, review, books, external, settings] = await Promise.all([
    qaDocument(ctx).read(null), reviewDocument(ctx).read(null), knowledgeDocument(ctx).read(null), externalDocument(ctx).read(null), ops(ctx)
  ]);
  const k = { ...defaultKnowledgeBook(), ...(books ?? {}) };
  const approvedQa = (qa?.muc ?? []).filter((q) => q.trangThai === "approved");
  const rules = (review?.muc ?? []).filter((r) => r.trangThai === "approved_rule" || r.trangThai === "approved_knowledge");
  const libraries = k.thuVien.filter((l) => l.dungKhi.some((w) => query.size > 0 && [...words(w)].some((x) => query.has(x))));
  const product = input.maHoiThoai ? activeFor(external, input.maHoiThoai, ctx.ports.clock.now()) : null;
  return {
    hoiDap: topBy(approvedQa, (q) => relevance(query, `${q.intent} ${q.cauHoi}`), 15).map((q) => ({ intent: q.intent, cauHoi: q.cauHoi, traLoi: q.traLoi })),
    quyTac: topBy(rules, (r) => relevance(query, `${r.intent} ${r.cauKhach} ${r.tieuDe}`), 20).map((r) => ({ tieuDe: r.tieuDe, noiDung: `Khách: ${r.cauKhach} → Shop: ${r.traLoiDeXuat}`, loai: r.cachApDung })),
    cauMau: k.cauMau.slice(0, 6).map((s) => ({ cauKhach: s.cauKhach, traLoi: s.traLoiDuyet, lyDo: s.lyDo })),
    kienThuc: topBy(k.kienThuc, (f) => relevance(query, `${f.maSp} ${f.tenSp}`) * 3, 12).map((f) => ({ ma: f.maSp, ten: f.tenSp, form: f.form, phuHop: f.phuHop, tuVanSize: f.tuVanSize, luuY: f.luuY })),
    thuVien: topBy(libraries, (l) => l.uuTien, 3).map((l) => ({ ten: l.ten, dungKhi: l.dungKhi, noiDung: l.noiDung })),
    hoSoMau: k.hoSoMau.slice(0, 5).map((p) => ({ ten: p.ten, tomTat: p.tomTat || [p.sizeQuen && `size ${p.sizeQuen}`, p.formChan, p.monChoi].filter(Boolean).join(", ") })),
    spNgoai: product ? { ma: product.ma, ten: product.ten, size: product.size, gia: product.gia } : null,
    cauHinh: { tatHangDoiTac: settings.tatHangDoiTac }
  };
}

// ------------------------------------------------------------------ analysis job

/** One loop per store (per landing, not per process — tests run many kernels). */
const analysisRunning = new WeakMap<object, boolean>();

async function analysisView(ctx: Ctx): Promise<Record<string, unknown>> {
  const state = { ...defaultAnalysis(), ...((await analysisDocument(ctx).read(null)) ?? {}) };
  return { ...state, dangChayVong: analysisRunning.get(ctx.ports.store) === true };
}

/** One batch: archive → strip PII → Xeon → fold. Never throws; an error lands in the state. */
async function analysisStep(ctx: Ctx): Promise<AnalysisState> {
  const state = { ...defaultAnalysis(), ...((await analysisDocument(ctx).read(null)) ?? {}) };
  const at = ctx.ports.clock.now().toISOString();
  const inbox = ctx.services["hop-thu"];
  if (!inbox?.archiveBatch || !inbox.threadInfo) {
    const failed = { ...state, trangThai: "loi" as const, loiCuoi: "Hộp thư chưa bật — không đọc được kho lưu trữ.", capNhatLuc: at };
    await analysisDocument(ctx).write(failed);
    return failed;
  }
  try {
    const batch = await inbox.archiveBatch({ sau: state.sau, soHoiThoai: ANALYSIS_BATCH_CONVERSATIONS, soTin: ANALYSIS_MESSAGES });
    if (batch.hoiThoai.length === 0) {
      const done = { ...state, trangThai: "xong" as const, trongKhoLucChay: batch.trongKho, capNhatLuc: at };
      await analysisDocument(ctx).write(done);
      return done;
    }
    // PERSONAL DATA STAYS HERE: the display name of each thread and every phone / e-mail / address.
    const conversations = [];
    for (const c of batch.hoiThoai) {
      const info = await inbox.threadInfo({ maHoiThoai: c.ma });
      const names = [info?.tenNguoi ?? "", info?.tenKhach ?? ""].filter(Boolean);
      conversations.push({ ma: `hoi-thoai-${conversations.length + 1}`, tin: c.tin.map((m) => ({ chieu: m.chieu, chu: stripPII(m.chu, names) })).filter((m) => m.chu.trim() !== "") });
    }
    const usable = conversations.filter((c) => c.tin.length > 0);
    let result: Record<string, unknown> = {};
    if (usable.length > 0) {
      const r = await callXeon(ctx, "POST", "/ai/phan-tich-lo", { hoiThoai: usable }, 150_000);
      if (!r.ok) {
        const failed = { ...state, trangThai: "loi" as const, loiCuoi: r.viSao, capNhatLuc: at };
        await analysisDocument(ctx).write(failed);
        return failed;
      }
      result = asObject(r.body["ketQua"]);
    }
    const next = foldAnalysis(state, result, batch.sau, batch.het, batch.hoiThoai.length, at);
    next.trongKhoLucChay = batch.trongKho;
    const latest = await analysisDocument(ctx).read(null);
    if (latest?.trangThai !== "dang-chay" && next.trangThai === "dang-chay") next.trangThai = latest?.trangThai ?? next.trangThai;
    await analysisDocument(ctx).write(next);
    return next;
  } catch (e) {
    const failed = { ...state, trangThai: "loi" as const, loiCuoi: e instanceof Error ? e.message : String(e), capNhatLuc: at };
    await analysisDocument(ctx).write(failed);
    return failed;
  }
}

async function runAnalysis(ctx: Ctx): Promise<void> {
  if (analysisRunning.get(ctx.ports.store)) return;
  analysisRunning.set(ctx.ports.store, true);
  try {
    for (let n = 0; n < ANALYSIS_MAX_BATCHES; n += 1) {
      const state = await analysisDocument(ctx).read(null);
      if (!state || state.trangThai !== "dang-chay") return;
      const next = await analysisStep(ctx);
      if (next.trangThai !== "dang-chay") return;
    }
  } finally {
    analysisRunning.delete(ctx.ports.store);
  }
}

// ------------------------------------------------------------------ photos

/** A short fingerprint of the image bytes: the same photo sent again is recognised. */
async function imageHash(ctx: Ctx, url: string): Promise<string> {
  try {
    const response = await ctx.ports.http.fetch(url, { method: "GET", timeoutMs: 20_000 });
    if (!response.ok) return "";
    const bytes = response.arrayBuffer ? Buffer.from(await response.arrayBuffer()) : Buffer.from(await response.text(), "utf8");
    if (bytes.length === 0 || bytes.length > 8 * 1024 * 1024) return "";
    return crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 24);
  } catch {
    return "";
  }
}

const httpsImages = (raw: unknown): string[] => (Array.isArray(raw) ? raw : [raw]).map((u) => text(u, 2000)).filter((u) => /^https:\/\//i.test(u)).slice(0, 4);

// ------------------------------------------------------------------ the manifest

async function saveStyle(ctx: Ctx, body: Record<string, unknown>) {
  const at = ctx.ports.clock.now();
  let saved: ReturnType<typeof saveStyleExample>["item"] | null = null;
  await knowledgeDocument(ctx).update((current) => {
    const r = saveStyleExample(current, body, at);
    saved = r.item;
    return r.book;
  }, defaultKnowledgeBook());
  const style = saved as unknown as ReturnType<typeof saveStyleExample>["item"];
  const candidate = reviewCandidate({
    loai: "operator_style_correction", tieuDe: "Phong cách trả lời do người trực sửa", intent: text(body["intent"], 80) || "khac",
    cauKhach: style.cauKhach, traLoiDeXuat: style.traLoiDuyet, traLoiAiGoc: style.traLoiAi, nguCanh: style.nguCanh,
    lyDo: ["Người trực sửa nháp AI trong Demo AI; dùng để học giọng tư vấn của shop.", style.lyDo ? `Lý do: ${style.lyDo}` : ""].filter(Boolean).join(" ")
  }, at, 1);
  const reviewId = style.maDuyet || candidate.id;
  await reviewDocument(ctx).update((current) => upsertCandidate(current, reviewId, { ...candidate, id: reviewId }), defaultReviewBook());
  if (!style.maDuyet) {
    await knowledgeDocument(ctx).update((current) => ({ ...defaultKnowledgeBook(), ...(current ?? {}), cauMau: (current?.cauMau ?? []).map((s) => (s.id === style.id ? { ...s, maDuyet: reviewId } : s)) }), defaultKnowledgeBook());
  }
  return { ...style, maDuyet: reviewId };
}

export const manifest = defineModule<Config, Services>({
  id: "tro-ly-ai",
  name: "Trợ lý AI (gọi bộ não Xeon)",
  tier: "chatbot",
  runsOn: "server-khach",
  feature: "hop-thu",
  version: "0.1.0",
  ports: ["store", "logger", "clock", "http", "auth"],
  requiresOptional: ["hop-thu.thread", "hop-thu.threadInfo", "hop-thu.send", "hop-thu.archiveBatch", "khung-nen-tang.xeon"],

  provides: {
    "tro-ly-ai.replyMode": async (ctx, input: Parameters<AssistantServices["replyMode"]>[0]): Promise<ReplyMode> =>
      effectiveMode(await ops(ctx), input?.thread ?? null, String(input?.trang ?? "")),
    "tro-ly-ai.autoDraft": async (ctx, input: { maHoiThoai: string }): Promise<unknown> => {
      if (!(await ops(ctx)).tuPhanTich) return { boQua: "tat_tu_phan_tich" };
      const r = await draftFor(ctx, text(input?.maHoiThoai, 191), "tu-dong");
      if (!r.ok) ctx.ports.logger.warn(`[tro-ly-ai] nhap tu dong hong: ${r.viSao}`);
      return r;
    },
    "tro-ly-ai.knowledge": (ctx, input: { q: string; maHoiThoai: string }) => knowledgeFor(ctx, { q: text(input?.q, 300), maHoiThoai: text(input?.maHoiThoai, 191) })
  },

  routes: [
    // ----- operations settings -----
    {
      method: "GET", path: "/api/ai/van-hanh", access: ACCESS.admin, rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx) => reply.json({ ok: true, vanHanh: await ops(ctx) }, 200, NO_STORE)
    },
    {
      method: "POST", path: "/api/ai/van-hanh", access: ACCESS.admin, rateLimit: { calls: 120, windowMs: TEN_MINUTES }, bodyLimit: 8 * 1024,
      handle: async (ctx, request) => {
        const body = asObject(await request.json());
        let next: OpsSettings | null = null;
        try {
          await opsDocument(ctx).update((current) => { next = patchOps(readOps(current), body, ctx.ports.clock.now()); return next; }, null);
        } catch (e) {
          return reply.json({ ok: false, error: "sai_cau_hinh", message: e instanceof Error ? e.message : String(e) }, 400);
        }
        return reply.json({ ok: true, vanHanh: next }, 200, NO_STORE);
      }
    },

    // ----- the draft ("Soạn bot", "AI nghĩ gì", Zalo "AI soạn lại") -----
    {
      method: "POST", path: "/api/ai/goi-y", access: ACCESS.admin, rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const maHoiThoai = text(asObject(await request.json())["maHoiThoai"], 191);
        if (!maHoiThoai) return reply.json({ ok: false, error: "thieu_ma_hoi_thoai", message: "Chưa chọn hội thoại." }, 400);
        const r = await draftFor(ctx, maHoiThoai, "nguoi");
        if (!r.ok) return r.status === 404 ? reply.json({ ok: false, error: "khong_thay", message: r.viSao }, 404) : xeonRefused(r);
        return reply.json({ ok: true, goiY: r.draft }, 200, NO_STORE);
      }
    },
    {
      method: "GET", path: "/api/ai/goi-y", access: ACCESS.admin, rateLimit: { calls: 1200, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const book = await draftDocument(ctx).read(null);
        return reply.json({ ok: true, goiY: book?.hoiThoai[text(request.query["maHoiThoai"], 191)] ?? null }, 200, NO_STORE);
      }
    },
    {
      // "Lưu sửa đổi & đưa vào Training" (Fanpage) and a Zalo reply edited before sending.
      method: "POST", path: "/api/ai/phan-hoi-goi-y", access: ACCESS.admin, rateLimit: { calls: 300, windowMs: TEN_MINUTES }, bodyLimit: 32 * 1024,
      handle: async (ctx, request) => {
        const body = asObject(await request.json());
        const maHoiThoai = text(body["maHoiThoai"], 191);
        const messages = maHoiThoai && ctx.services["hop-thu"]?.thread ? await ctx.services["hop-thu"].thread({ maHoiThoai, limit: 8 }) : [];
        const lastCustomer = [...messages].reverse().find((m) => m.chieu === "den")?.chu ?? "";
        const at = ctx.ports.clock.now();
        let item: ReviewItem;
        try {
          item = reviewCandidate({
            loai: maHoiThoai.startsWith("zalo:") ? "zalo_operator_edit" : "facebook_ai_operator_edit",
            tieuDe: "Người trực sửa câu AI soạn", intent: body["intent"], cauKhach: text(body["cauKhach"], 1000) || lastCustomer,
            traLoiDeXuat: body["traLoiSua"], traLoiAiGoc: body["traLoiAiGoc"], lyDoSua: body["lyDoSua"],
            duKienAi: body["duKienAi"], duKienSua: body["duKienSua"], nguonHoiThoai: maHoiThoai,
            nguCanh: messages.map((m) => ({ vai: m.chieu === "den" ? "khach" : "shop", chu: m.chu })),
            lyDo: "Người trực sửa nháp AI trước khi gửi; chờ duyệt mới được dùng."
          }, at, 1);
        } catch (e) {
          return reply.json({ ok: false, error: "thieu_noi_dung", message: e instanceof Error ? e.message : String(e) }, 400);
        }
        let added = false;
        await reviewDocument(ctx).update((current) => { const r = enqueueCandidates(current, [item]); added = r.added.length > 0; return r.book; }, defaultReviewBook());
        return reply.json({ ok: true, hangDuyet: added ? item : null, message: added ? "Đã đưa vào hàng đợi huấn luyện — chờ duyệt." : "Đề xuất này đã có trong hàng đợi." }, 200, NO_STORE);
      }
    },

    // ----- Demo AI -----
    {
      method: "POST", path: "/api/ai/hop-cat", access: ACCESS.admin, rateLimit: { calls: 120, windowMs: TEN_MINUTES }, bodyLimit: 64 * 1024,
      handle: async (ctx, request) => {
        const body = asObject(await request.json());
        const r = await callXeon(ctx, "POST", "/ai/hop-cat", { lichSu: Array.isArray(body["lichSu"]) ? body["lichSu"].slice(-30) : [], chu: text(body["chu"]) }, 150_000);
        if (!r.ok) return xeonRefused(r);
        const { ok: _ok, ...goiY } = r.body;
        return reply.json({ ok: true, goiY }, 200, NO_STORE);
      }
    },
    {
      method: "GET", path: "/api/ai/cau-mau", access: ACCESS.admin, rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx) => reply.json({ ok: true, cauMau: ((await knowledgeDocument(ctx).read(null))?.cauMau ?? []) }, 200, NO_STORE)
    },
    {
      method: "POST", path: "/api/ai/cau-mau", access: ACCESS.admin, rateLimit: { calls: 120, windowMs: TEN_MINUTES }, bodyLimit: 32 * 1024,
      handle: async (ctx, request) => {
        try {
          const saved = await saveStyle(ctx, asObject(await request.json()));
          return reply.json({ ok: true, cauMau: saved, message: "Đã ghi nhận phong cách và đưa vào hàng đợi huấn luyện." }, 200, NO_STORE);
        } catch (e) {
          return reply.json({ ok: false, error: "thieu_noi_dung", message: e instanceof Error ? e.message : String(e) }, 400);
        }
      }
    },

    // ----- Training -----
    {
      method: "GET", path: "/api/ai/huan-luyen", access: ACCESS.admin, rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const limit = Math.min(2000, Math.max(1, Number(request.query["gioiHan"]) || 30));
        const [qa, review, books] = await Promise.all([qaDocument(ctx).read(null), reviewDocument(ctx).read(null), knowledgeDocument(ctx).read(null)]);
        const k = { ...defaultKnowledgeBook(), ...(books ?? {}) };
        const queue = review?.muc ?? [];
        return reply.json({
          ok: true,
          hoiDap: qa?.muc ?? [], hangDuyet: queue.slice(0, limit), tongHangDuyet: queue.length,
          dem: { kichBan: (qa?.muc ?? []).filter((q) => q.trangThai === "approved").length, canDuyet: queue.filter((r) => r.trangThai === "candidate").length, daDuyet: queue.filter((r) => r.trangThai.startsWith("approved")).length },
          hoSoMau: k.hoSoMau, kienThuc: k.kienThuc, thuVien: k.thuVien, soCauMau: k.cauMau.length,
          vanHanh: await ops(ctx), phanTich: await analysisView(ctx)
        }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/ai/hoi-dap", access: ACCESS.admin, rateLimit: { calls: 120, windowMs: TEN_MINUTES }, bodyLimit: 16 * 1024,
      handle: async (ctx, request) => {
        const body = asObject(await request.json());
        let item: unknown = null;
        try {
          await qaDocument(ctx).update((current) => { const r = addQa(current, body, ctx.ports.clock.now()); item = r.item; return r.book; }, defaultQaBook());
        } catch (e) {
          return reply.json({ ok: false, error: "thieu_noi_dung", message: e instanceof Error ? e.message : String(e) }, 400);
        }
        return reply.json({ ok: true, hoiDap: item }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/ai/hoi-dap/:ma/trang-thai", access: ACCESS.admin, rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const id = String(request.params["ma"] ?? "");
        const status = text(asObject(await request.json())["trangThai"], 16);
        let found: unknown = null;
        try {
          await qaDocument(ctx).update((current) => { const r = setQaStatus(current, id, status, ctx.ports.clock.now()); found = r.item; return r.item ? r.book : undefined; }, defaultQaBook());
        } catch (e) {
          return reply.json({ ok: false, error: "sai_trang_thai", message: e instanceof Error ? e.message : String(e) }, 400);
        }
        return found ? reply.json({ ok: true, hoiDap: found }, 200, NO_STORE) : reply.json({ ok: false, error: "khong_thay", message: "Không thấy kịch bản." }, 404);
      }
    },
    {
      // A PERSON approves one candidate. There is no other way into the bot's knowledge.
      method: "POST", path: "/api/ai/hang-duyet/:ma/duyet", access: ACCESS.admin, rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const id = String(request.params["ma"] ?? "");
        const at = ctx.ports.clock.now();
        try {
          const review = await reviewDocument(ctx).read(null);
          const qa = await qaDocument(ctx).read(null);
          const r = approveReview(review, qa, id, at);
          if (r.item.trangThai === "approved") await qaDocument(ctx).write(r.qa);
          await reviewDocument(ctx).update((current) => ({ version: 1, muc: (current?.muc ?? []).map((x) => (x.id === id ? r.item : x)) }), defaultReviewBook());
          ctx.ports.logger.info(`[tro-ly-ai] ${actor(ctx, request)} duyet ${id} (${r.item.cachApDung})`);
          return reply.json({ ok: true, hangDuyet: r.item }, 200, NO_STORE);
        } catch (e) {
          const status = Number((e as { status?: number }).status) || 400;
          return reply.json({ ok: false, error: status === 404 ? "khong_thay" : "da_xu_ly", message: e instanceof Error ? e.message : String(e) }, status);
        }
      }
    },
    {
      method: "POST", path: "/api/ai/hang-duyet/:ma/chan", access: ACCESS.admin, rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const id = String(request.params["ma"] ?? "");
        let found: ReviewItem | null = null;
        await reviewDocument(ctx).update((current) => { const r = blockReview(current, id, ctx.ports.clock.now()); found = r.item; return r.item ? r.review : undefined; }, defaultReviewBook());
        return found ? reply.json({ ok: true, hangDuyet: found }, 200, NO_STORE) : reply.json({ ok: false, error: "khong_thay", message: "Không thấy mục." }, 404);
      }
    },
    {
      method: "POST", path: "/api/ai/ho-so-mau", access: ACCESS.admin, rateLimit: { calls: 120, windowMs: TEN_MINUTES }, bodyLimit: 16 * 1024,
      handle: async (ctx, request) => bookWrite(ctx, request, addSampleProfile, "hoSoMau")
    },
    {
      method: "POST", path: "/api/ai/kien-thuc", access: ACCESS.admin, rateLimit: { calls: 120, windowMs: TEN_MINUTES }, bodyLimit: 16 * 1024,
      handle: async (ctx, request) => bookWrite(ctx, request, addFitNote, "kienThuc")
    },
    {
      method: "POST", path: "/api/ai/thu-vien", access: ACCESS.admin, rateLimit: { calls: 60, windowMs: TEN_MINUTES }, bodyLimit: 64 * 1024,
      handle: async (ctx, request) => bookWrite(ctx, request, saveLibrary, "thuVien")
    },
    {
      method: "POST", path: "/api/ai/thu-vien/de-xuat", access: ACCESS.admin, rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const chuDe = text(asObject(await request.json())["chuDe"], 1000);
        if (!chuDe) return reply.json({ ok: false, error: "thieu_chu_de", message: "Nhập chủ đề kho kiến thức trước." }, 400);
        const r = await callXeon(ctx, "POST", "/ai/de-xuat-kien-thuc", { chuDe }, 120_000);
        return r.ok ? reply.json({ ok: true, deXuat: r.body["deXuat"] }, 200, NO_STORE) : xeonRefused(r);
      }
    },
    {
      method: "POST", path: "/api/ai/thu-vien/noi-dung", access: ACCESS.admin, rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (_ctx, request) => {
        const body = asObject(await request.json());
        const dungKhi = (Array.isArray(body["dungKhi"]) ? body["dungKhi"].map(String) : String(body["dungKhi"] ?? "").split(",")).map((w) => w.trim()).filter(Boolean).slice(0, 12);
        return reply.json({ ok: true, noiDung: knowledgeMarkdown({ ten: text(body["ten"], 160), moTa: text(body["moTa"], 1000), dungKhi }) }, 200, NO_STORE);
      }
    },

    // ----- analysis of the archive -----
    {
      method: "GET", path: "/api/ai/phan-tich", access: ACCESS.admin, rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx) => reply.json({ ok: true, phanTich: await analysisView(ctx) }, 200, NO_STORE)
    },
    {
      method: "POST", path: "/api/ai/phan-tich/bat-dau", access: ACCESS.admin, rateLimit: { calls: 30, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const restart = asObject(await request.json())["lamLai"] === true;
        if (analysisRunning.get(ctx.ports.store)) return reply.json({ ok: true, phanTich: await analysisView(ctx), message: "Đang phân tích rồi." }, 200, NO_STORE);
        const at = ctx.ports.clock.now().toISOString();
        await analysisDocument(ctx).update((current) => {
          const state = { ...defaultAnalysis(), ...(current ?? {}) };
          const fresh = restart || state.trangThai === "xong" || state.trangThai === "chua-chay";
          return fresh ? { ...defaultAnalysis(), trangThai: "dang-chay", batDauLuc: at, capNhatLuc: at } : { ...state, trangThai: "dang-chay", loiCuoi: "", capNhatLuc: at };
        }, defaultAnalysis());
        void runAnalysis(ctx);
        return reply.json({ ok: true, phanTich: await analysisView(ctx), message: restart ? "Đã bắt đầu phân tích lại từ đầu." : "Đã bắt đầu/tiếp tục phân tích kho chat theo lô." }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/ai/phan-tich/buoc", access: ACCESS.admin, rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx) => {
        if (analysisRunning.get(ctx.ports.store)) return reply.json({ ok: false, error: "dang_chay", message: "Vòng phân tích đang chạy." }, 409);
        const state = await analysisDocument(ctx).read(null);
        if (!state || state.trangThai === "chua-chay") return reply.json({ ok: false, error: "chua_bat_dau", message: "Bấm Phân tích trước." }, 409);
        if (state.trangThai !== "dang-chay") await analysisDocument(ctx).write({ ...state, trangThai: "dang-chay" });
        await analysisStep(ctx);
        return reply.json({ ok: true, phanTich: await analysisView(ctx) }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/ai/phan-tich/dung", access: ACCESS.admin, rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: async (ctx) => {
        await analysisDocument(ctx).update((current) => (current?.trangThai === "dang-chay" ? { ...current, trangThai: "loi", loiCuoi: "Đã dừng — bấm Tiếp tục để chạy tiếp từ lô đang dở.", capNhatLuc: ctx.ports.clock.now().toISOString() } : undefined), defaultAnalysis());
        return reply.json({ ok: true, phanTich: await analysisView(ctx) }, 200, NO_STORE);
      }
    },
    {
      // "Đưa vào Hàng đợi huấn luyện": candidates only, deduplicated. NOTHING is approved here.
      method: "POST", path: "/api/ai/phan-tich/dua-vao-hang-duyet", access: ACCESS.admin, rateLimit: { calls: 30, windowMs: TEN_MINUTES },
      handle: async (ctx) => {
        const state = { ...defaultAnalysis(), ...((await analysisDocument(ctx).read(null)) ?? {}) };
        if (state.trangThai !== "xong") return reply.json({ ok: false, error: "chua_xong", message: "Phân tích chưa hoàn tất hoặc chưa có kết quả." }, 409);
        const at = ctx.ports.clock.now();
        const candidates: ReviewItem[] = [];
        state.cauHoi.forEach((q, i) => {
          try { candidates.push(reviewCandidate({ loai: "ai_analysis", tieuDe: `Câu hỏi hay gặp: ${q.intent || "khác"}`, intent: q.intent, cauKhach: q.cauHoi, traLoiDeXuat: q.traLoi, cachApDung: q.loai, lyDo: q.lyDo || "AI rút từ hội thoại lưu trữ (đã ẩn thông tin cá nhân)." }, at, i + 1)); } catch { /* an empty one is skipped */ }
        });
        state.nguyenTac.forEach((p, i) => {
          try { candidates.push(reviewCandidate({ loai: "ai_analysis", tieuDe: `Nguyên tắc: ${p.tieuDe}`, intent: p.loai || "nguyen_tac", cauKhach: p.tieuDe, traLoiDeXuat: p.chiTiet || p.tieuDe, cachApDung: "knowledge_rule", lyDo: "Nguyên tắc AI rút từ kho chat." }, at, 1000 + i)); } catch { /* skipped */ }
        });
        let added: ReviewItem[] = [];
        await reviewDocument(ctx).update((current) => { const r = enqueueCandidates(current, candidates); added = r.added; return r.book; }, defaultReviewBook());
        await analysisDocument(ctx).write({ ...state, daNhapLuc: at.toISOString() });
        return reply.json({
          ok: true, soMoi: added.length,
          message: added.length ? `Đã đưa ${added.length} đề xuất mới vào hàng đợi; chưa có mục nào tự duyệt.` : "Kết quả đã có trong hàng đợi, không tạo bản trùng."
        }, 200, NO_STORE);
      }
    },

    // ----- photos -----
    {
      method: "POST", path: "/api/ai/doc-anh", access: ACCESS.admin, rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asObject(await request.json());
        const images = httpsImages(body["anh"]);
        if (images.length === 0) return reply.json({ ok: false, error: "thieu_anh", message: "Cần ảnh https của khách." }, 400);
        const memory = await imageDocument(ctx).read(null);
        const anh = [];
        for (const url of images) {
          const bam = await imageHash(ctx, url);
          anh.push({ url, bam, nho: bam ? memory?.anh[bam] ?? null : null });
        }
        const maHoiThoai = text(body["maHoiThoai"], 191);
        const r = await callXeon(ctx, "POST", "/ai/doc-anh", { anh: images, goiY: text(body["goiY"], 300), maHoiThoai, kenh: maHoiThoai.split(":")[0] ?? "", mucDich: "khop-anh" }, 90_000);
        return reply.json({ ok: true, anh, doc: r.ok ? r.body["doc"] : null, ungVien: r.ok ? r.body["ungVien"] : [], loiXeon: r.ok ? "" : r.viSao }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/ai/anh-nho", access: ACCESS.admin, rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asObject(await request.json());
        const bam = text(body["bam"], 64);
        const ma = text(body["ma"], 64).toUpperCase();
        if (!/^[a-f0-9]{8,64}$/.test(bam) || !ma) return reply.json({ ok: false, error: "thieu_ma", message: "Gõ mã sản phẩm đúng vào ô trước khi bấm Lưu mã." }, 400);
        const at = ctx.ports.clock.now().toISOString();
        await imageDocument(ctx).update((current) => ({ version: 1, anh: { ...(current?.anh ?? {}), [bam]: { ma, ten: text(body["ten"], 200), luc: at } } }), { version: 1, anh: {} });
        return reply.json({ ok: true, message: `Đã ghi nhớ ảnh này là ${ma}.` }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/ai/anh-nho/quen", access: ACCESS.admin, rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const bam = text(asObject(await request.json())["bam"], 64);
        let found = false;
        await imageDocument(ctx).update((current) => {
          if (!current?.anh[bam]) return undefined;
          found = true;
          const { [bam]: _gone, ...rest } = current.anh;
          return { version: 1, anh: rest };
        }, { version: 1, anh: {} });
        return reply.json({ ok: true, daGo: found, message: found ? "Đã gỡ ghi nhớ ảnh." : "Ảnh này chưa được ghi nhớ." }, 200, NO_STORE);
      }
    },

    // ----- external products -----
    {
      method: "GET", path: "/api/ai/sp-ngoai", access: ACCESS.admin, rateLimit: { calls: 1200, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const now = ctx.ports.clock.now();
        const book = await externalDocument(ctx).update((current) => {
          const b = { version: 1 as const, muc: (current?.muc ?? []).map((i) => ({ ...i })) };
          return expire(b, now) ? b : undefined;
        }, defaultExternalBook());
        const maHoiThoai = text(request.query["maHoiThoai"], 191);
        return reply.json({ ok: true, dangChot: activeFor(book, maHoiThoai, now), ganDay: recentItems(book, 8), cuaHoiThoai: (book?.muc ?? []).filter((i) => i.maHoiThoai === maHoiThoai).slice(-10) }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/ai/sp-ngoai", access: ACCESS.admin, rateLimit: { calls: 300, windowMs: TEN_MINUTES }, bodyLimit: 16 * 1024,
      handle: async (ctx, request) => {
        const body = asObject(await request.json());
        const at = ctx.ports.clock.now();
        let item: ReturnType<typeof settle>["item"] | null = null;
        try {
          await externalDocument(ctx).update((current) => { const r = settle(current, body, at); item = r.item; return r.book; }, defaultExternalBook());
        } catch (e) {
          return reply.json({ ok: false, error: "thieu_thong_tin", message: e instanceof Error ? e.message : String(e) }, 400);
        }
        const settled = item as unknown as ReturnType<typeof settle>["item"];
        if (body["gui"] !== true) return reply.json({ ok: true, spNgoai: settled, message: "Đã chốt (chưa gửi thẻ)." }, 200, NO_STORE);
        return sendCard(ctx, request, settled.id);
      }
    },
    {
      method: "POST", path: "/api/ai/sp-ngoai/:ma/gui-lai", access: ACCESS.admin, rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => sendCard(ctx, request, String(request.params["ma"] ?? ""))
    },
    {
      method: "POST", path: "/api/ai/sp-ngoai/:ma/trang-thai", access: ACCESS.admin, rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asObject(await request.json());
        const status = text(body["trangThai"], 16);
        if (status !== "bo" && status !== "da_dat") return reply.json({ ok: false, error: "sai_trang_thai", message: 'Trạng thái phải là "bo" hoặc "da_dat".' }, 400);
        let found: unknown = null;
        await externalDocument(ctx).update((current) => { const r = patchItem(current, String(request.params["ma"] ?? ""), { trangThai: status, maDon: text(body["maDon"], 64) }); found = r.item; return r.item ? r.book : undefined; }, defaultExternalBook());
        return found ? reply.json({ ok: true, spNgoai: found }, 200, NO_STORE) : reply.json({ ok: false, error: "khong_thay", message: "Không thấy SP ngoài." }, 404);
      }
    },
    {
      method: "POST", path: "/api/ai/sp-ngoai/goi-y", access: ACCESS.admin, rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asObject(await request.json());
        const images = httpsImages(body["anh"]);
        const hint = text(body["goiY"], 300);
        const gia = parsePrice(hint);
        if (images.length === 0) return reply.json({ ok: true, goiY: { ten: "", ma: "", gia }, message: "Không có ảnh https để AI đọc — chỉ đọc giá từ chữ." }, 200, NO_STORE);
        const maHoiThoai = text(body["maHoiThoai"], 191);
        const r = await callXeon(ctx, "POST", "/ai/doc-anh", { anh: images, goiY: hint, maHoiThoai, kenh: maHoiThoai.split(":")[0] ?? "", mucDich: "sp-ngoai" }, 90_000);
        if (!r.ok) return xeonRefused(r);
        const doc = asObject(r.body["doc"]);
        const model = text(doc["model"], 160);
        const brand = text(doc["brand"], 40);
        const name = [model, text(doc["color"], 60)].filter(Boolean).join(" ");
        const ten = name && brand && !norm(name).includes(norm(brand)) ? `${brand} ${name}` : name;
        return reply.json({ ok: true, goiY: { ten, ma: text(doc["code"], 16), gia, doTinCay: Number(doc["confidence"]) || 0 } }, 200, NO_STORE);
      }
    },

    // ----- Token AI (the ledger and the price table live on Xeon) -----
    {
      method: "POST", path: "/api/ai/token", access: ACCESS.admin, rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asObject(await request.json());
        const r = await callXeon(ctx, "POST", "/ai/token", { soNgay: Number(body["soNgay"]) || 7, kenh: text(body["kenh"], 20), model: text(body["model"], 120) });
        return r.ok ? reply.json({ ok: true, soToken: r.body["soToken"] }, 200, NO_STORE) : xeonRefused(r);
      }
    },
    {
      method: "GET", path: "/api/ai/bang-gia", access: ACCESS.admin, rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx) => {
        const r = await callXeon(ctx, "GET", "/ai/bang-gia");
        return r.ok ? reply.json({ ok: true, pricing: r.body["pricing"], source: r.body["source"], duocSua: r.body["duocSua"] === true }, 200, NO_STORE) : xeonRefused(r);
      }
    },
    {
      method: "POST", path: "/api/ai/bang-gia", access: ACCESS.admin, rateLimit: { calls: 60, windowMs: TEN_MINUTES }, bodyLimit: 64 * 1024,
      handle: async (ctx, request) => {
        const body = asObject(await request.json());
        const r = await callXeon(ctx, "POST", "/ai/bang-gia", { rateVndPerUsd: body["rateVndPerUsd"], models: Array.isArray(body["models"]) ? body["models"] : [] });
        return r.ok ? reply.json({ ok: true, pricing: r.body["pricing"], source: r.body["source"], duocSua: true }, 200, NO_STORE) : xeonRefused(r);
      }
    },

    // ----- size signals in the chat -----
    {
      method: "GET", path: "/api/ai/tin-hieu-size", access: ACCESS.admin, rateLimit: { calls: 1200, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const maHoiThoai = text(request.query["maHoiThoai"], 191);
        if (!maHoiThoai) return reply.json({ ok: false, error: "thieu_ma_hoi_thoai" }, 400);
        const messages = ctx.services["hop-thu"]?.thread ? await ctx.services["hop-thu"].thread({ maHoiThoai, limit: 60 }) : [];
        const dismissed = (await dismissedDocument(ctx).read(null))?.hoiThoai[maHoiThoai] ?? [];
        return reply.json({ ok: true, tinHieu: extractFitSignals(messages, dismissed) }, 200, NO_STORE);
      }
    },
    {
      // ✗ — and ✓ too, once OMI wrote the value into the profile: either way it stops showing here.
      method: "POST", path: "/api/ai/tin-hieu-size/bo", access: ACCESS.admin, rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asObject(await request.json());
        const maHoiThoai = text(body["maHoiThoai"], 191);
        const key = text(body["khoa"], 200).toLowerCase();
        if (!maHoiThoai || !key) return reply.json({ ok: false, error: "thieu_khoa" }, 400);
        await dismissedDocument(ctx).update((current) => {
          const all = { ...(current?.hoiThoai ?? {}) };
          all[maHoiThoai] = [...new Set([...(all[maHoiThoai] ?? []), key])].slice(-30);
          const kept = Object.entries(all).slice(-2000);
          return { version: 1, hoiThoai: Object.fromEntries(kept) };
        }, { version: 1, hoiThoai: {} });
        return reply.json({ ok: true }, 200, NO_STORE);
      }
    }
  ],

  botTools: [
    { ten: "kien_thuc_da_duyet", moTa: "Doc hoi dap, quy tac, cau mau, ghi chu fit shop da duyet va SP ngoai dang chot", hieuUng: "doc" }
  ]
});

async function bookWrite<T>(ctx: Ctx, request: KernelRequest, write: (book: KnowledgeBook | null, input: Record<string, unknown>, at: Date) => { book: KnowledgeBook; item: T }, field: string) {
  const body = asObject(await request.json());
  let item: T | null = null;
  try {
    await knowledgeDocument(ctx).update((current) => { const r = write(current, body, ctx.ports.clock.now()); item = r.item; return r.book; }, defaultKnowledgeBook());
  } catch (e) {
    return reply.json({ ok: false, error: "thieu_thong_tin", message: e instanceof Error ? e.message : String(e) }, 400);
  }
  return reply.json({ ok: true, [field]: item }, 200, NO_STORE);
}

/** Sends the external product's photo + message to the customer through the inbox, and notes when. */
async function sendCard(ctx: Ctx, request: KernelRequest, id: string) {
  const book = await externalDocument(ctx).read(null);
  const item = (book?.muc ?? []).find((i) => i.id === id);
  if (!item) return reply.json({ ok: false, error: "khong_thay", message: "Không thấy SP ngoài." }, 404);
  const inbox = ctx.services["hop-thu"];
  const info = inbox?.threadInfo ? await inbox.threadInfo({ maHoiThoai: item.maHoiThoai }) : null;
  if (!inbox?.send || !info) return reply.json({ ok: false, error: "khong_gui_duoc", spNgoai: item, message: "Đã chốt, nhưng không tìm thấy hội thoại để gửi thẻ." }, 409);
  try {
    await inbox.send({ kenh: info.kenh, nguoi: info.nguoi, chu: item.loiNhan, ...(item.anh ? { anhUrl: item.anh } : {}), maHoiThoai: item.maHoiThoai, nguon: actor(ctx, request) });
  } catch (e) {
    return reply.json({ ok: false, error: "gui_that_bai", spNgoai: item, message: `Đã chốt, nhưng chưa gửi được thẻ: ${e instanceof Error ? e.message : String(e)}` }, 502);
  }
  let sent: unknown = item;
  await externalDocument(ctx).update((current) => { const r = patchItem(current, id, { guiLuc: ctx.ports.clock.now().toISOString() }); sent = r.item; return r.book; }, defaultExternalBook());
  return reply.json({ ok: true, spNgoai: sent, message: "Đã gửi thẻ + chốt." }, 200, NO_STORE);
}
