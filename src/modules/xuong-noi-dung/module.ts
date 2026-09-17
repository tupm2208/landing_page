/**
 * @file MODULE CONTENT WORKSHOP ("xuong-noi-dung") — tier "content", runs on the merchant server.
 *
 * One day of Facebook posts, from a plan against real stock to a schedule Meta accepts, in the
 * five steps Sales Desk settled on: kế hoạch → viết bài → phản biện → tối ưu → lên lịch.
 *
 * WHY THE STEP IS SERVER STATE and not a tab in the screen: the gate between steps is the whole
 * value. A post that never met the rules must not become a schedule, and a screen that keeps the
 * step in a local variable loses that the moment somebody reloads or opens the shop on a second
 * machine. `canAdvance` lives beside the rules it enforces.
 *
 * Đ8 ("Content đăng thật", 17/09/2026) added, as Desk's Content screen has them:
 *   - the owner's TOPICS for the planner, "KHO MÃ" ranked by priority (`priority.ts`), the buying angle;
 *   - write / critique / optimise a WHOLE batch on Xeon, as a background run the screen polls
 *     (`chay`), or one post at a time; the shop's WRITING STYLE travels with every request;
 *   - REAL scheduling through `dang-bai`: cover + product cards rendered, album ≥ 5 pictures;
 *   - choose / drop / undo posts, suggest other codes, the post LIBRARY, weekly TREND research.
 *
 * It reads the catalogue through `hang-kho.search` and never opens those tables itself.
 */

import crypto from "node:crypto";
import { ACCESS, defineModule, reply } from "../../contract";
import {
  BATCH_KEEP_MAX, applyVerdict, batchOf, defaultBatchBook, editPost, listBatches, pickCodes, planBatch, sellableCodes,
  saveBatch, stepBatch, STEP_LABEL, STEPS, type BatchBook, type BatchRun, type ContentBatch, type ContentPost
} from "./batch";
import { DEFAULT_SLOTS, POST_FORMATS, validateBatch, validatePost, type PostContext } from "./studio-rules";
import { asRecord, callXeon, text, toPlannable, type Config, type Ctx, type Services } from "./context";
import { albumFor, catalogue, draftWithBrain, judgeContext, needsRewrite, optimizePost, poolRows, priorityIndex, reviewPost, slotInstant } from "./flow";
import { BUY_ANGLES, detectAngle, freeAngles, rankPool } from "./priority";
import { TOPIC_DOCUMENT, addTopic, defaultTopicBook, setTopicStatus, topicCounts, waitingTopics, type TopicBook } from "./topics";
import { TREND_DOCUMENT, applyResearch, buildUniverse, defaultTrendBook, researchDue, type TrendBook, type TrendCard } from "./trends";
import {
  LIBRARY_DOCUMENT, STYLE_DOCUMENT, chosenStyle, defaultLibraryBook, defaultStyleBook, filterLibrary, saveLibraryItem, saveStyle,
  type LibraryBook, type StyleBook
} from "./library";

export type { Config } from "./context";

/** Document name — on-disk contract. */
export const BATCH_DOCUMENT = "xuong-noi-dung-lo";

const TEN_MINUTES = 10 * 60 * 1000;
const NO_STORE = { "Cache-Control": "no-store" };
/** The most posts one batch may hold: five slots on a handful of pages is already a long day. */
const POSTS_PER_BATCH_MAX = 40;

const document = (ctx: Ctx) => ctx.ports.store.document<BatchBook>(BATCH_DOCUMENT);
const topicDocument = (ctx: Ctx) => ctx.ports.store.document<TopicBook>(TOPIC_DOCUMENT);
const trendDocument = (ctx: Ctx) => ctx.ports.store.document<TrendBook>(TREND_DOCUMENT);
const libraryDocument = (ctx: Ctx) => ctx.ports.store.document<LibraryBook>(LIBRARY_DOCUMENT);
const styleDocument = (ctx: Ctx) => ctx.ports.store.document<StyleBook>(STYLE_DOCUMENT);
const nowIso = (ctx: Ctx) => ctx.ports.clock.now().toISOString();

/** Batches with a background run in THIS process — a second press answers 409 instead of doubling the spend. */
const running = new Set<string>();

async function readTrends(ctx: Ctx): Promise<TrendBook> {
  return { ...defaultTrendBook(), ...((await trendDocument(ctx).read(null)) ?? {}) };
}

/** Runs the rules over a batch and writes the verdict onto every post. */
async function judge(ctx: Ctx, batch: ContentBatch): Promise<{ batch: ContentBatch; chung: ReturnType<typeof validateBatch> }> {
  const { context } = judgeContext(ctx, await catalogue(ctx));
  const live = batch.bai.filter((p) => text(p.boQua) === "" && text(p.maLenh) === "");
  const verdict = validateBatch(live, context);
  const byId = new Map(live.map((p, i) => [p.id, verdict.theoBai[i]]));
  const bai = batch.bai.map((post) => {
    const one = byId.get(post.id);
    if (one === undefined) return post;
    const judged = applyVerdict(post, one);
    // A critique that did not pass keeps the post "hỏng" even when the machine rules are clean.
    return post.phanBien?.dat === false ? { ...judged, trangThai: "hong" } : judged;
  });
  return { batch: { ...batch, bai, suaLuc: nowIso(ctx) }, chung: verdict };
}

/** What `withBatch`'s worker may answer: a changed batch, or a refusal with a reason to show. */
type BatchWork =
  | { batch: ContentBatch; body: Record<string, unknown> }
  | { error: string; status: number; message?: string };

/** Reads a batch, hands it to `work`, saves what comes back. */
async function withBatch(ctx: Ctx, ma: string, work: (batch: ContentBatch) => Promise<BatchWork>) {
  const found = batchOf(await document(ctx).read(null), ma);
  if (found === null) return reply.json({ ok: false, error: "khong_thay_lo" }, 404);
  const done = await work(found);
  if ("error" in done) return reply.json({ ok: false, error: done.error, ...(done.message === undefined ? {} : { message: done.message }) }, done.status);
  const at = nowIso(ctx);
  await document(ctx).update((current) => saveBatch(current, done.batch, at), defaultBatchBook());
  return reply.json({ ok: true, ...done.body }, 200, NO_STORE);
}

/** Replaces one post in the stored batch (re-read, so edits made meanwhile to OTHER posts survive). */
async function storePost(ctx: Ctx, ma: string, post: ContentPost, run?: ContentBatch["chay"]): Promise<void> {
  const at = nowIso(ctx);
  await document(ctx).update((current) => {
    const batch = batchOf(current, ma);
    if (batch === null) return undefined;
    return saveBatch(current, { ...batch, bai: batch.bai.map((p) => (p.id === post.id ? post : p)), ...(run === undefined ? {} : { chay: run }), suaLuc: at }, at);
  }, defaultBatchBook());
}

async function storeRun(ctx: Ctx, ma: string, run: BatchRun | null): Promise<void> {
  const at = nowIso(ctx);
  await document(ctx).update((current) => {
    const batch = batchOf(current, ma);
    return batch === null ? undefined : saveBatch(current, { ...batch, chay: run, suaLuc: at }, at);
  }, defaultBatchBook());
}

const RUN_LABEL: Record<string, string> = { viet: "Bước 2 · Viết bài", "viet-loi": "Viết lại bài lỗi", "phan-bien": "Bước 3 · Phản biện", "toi-uu": "Bước 4 · Tối ưu", "chu-trinh": "Chạy cả chu trình", "len-lich": "Bước 5 · Dựng ảnh và lên lịch" };

/**
 * One background run over the batch. Posts are done one after another and saved after each, so the
 * screen polling the batch sees progress, and a crash half-way keeps what was finished.
 */
async function runBatch(ctx: Ctx, ma: string, job: string, chosen: string[]): Promise<{ xong: number; tong: number; loi: string[] }> {
  const items = await catalogue(ctx);
  const { known, context } = judgeContext(ctx, items);
  const style = chosenStyle(await styleDocument(ctx).read(null));
  const errors: string[] = [];
  const steps = job === "chu-trinh" ? ["viet", "phan-bien", "toi-uu", "len-lich"] : [job];
  let done = 0;
  let total = 0;
  for (const step of steps) {
    const batch = batchOf(await document(ctx).read(null), ma);
    if (batch === null) break;
    const live = batch.bai.filter((p) => text(p.boQua) === "" && text(p.maLenh) === "");
    const targets = step === "viet" ? live.filter((p) => job === "chu-trinh" ? text(p.caption) === "" : true)
      : step === "viet-loi" ? live.filter(needsRewrite)
      : step === "phan-bien" ? live.filter((p) => text(p.caption) !== "")
      : step === "toi-uu" ? live.filter((p) => text(p.caption) !== "" && (p.trangThai !== "dat" || p.phanBien?.dat !== true))
      : [];
    if (step === "len-lich") {
      const pick = chosen.length > 0 ? chosen : batch.bai.filter((p) => p.trangThai === "dat").map((p) => p.id);
      const r = await schedulePosts(ctx, ma, pick);
      errors.push(...r.loi);
      done += r.xong;
      total += r.tong;
      continue;
    }
    total += targets.length;
    for (const post of targets) {
      await storeRun(ctx, ma, { buoc: step, dangChay: true, xong: done, tong: total, thongBao: `${RUN_LABEL[step] ?? step}: ${post.time} ${post.page}`, loi: "", capNhat: nowIso(ctx) });
      let next: ContentPost = post;
      if (step === "viet" || step === "viet-loi") {
        const written = await draftWithBrain(ctx, post, known, context, style);
        if (written.ok) next = { ...applyVerdict(editPost(post, { caption: written.draft.caption, main: written.draft.chuAnh, comment: written.draft.comment }), written.verdict), loiAi: "" };
        else { next = { ...post, loiAi: written.message }; errors.push(`${post.time} ${post.page}: ${written.message}`); }
      } else if (step === "phan-bien") {
        const r = await reviewPost(ctx, post, known, context, style);
        next = r.post;
        if (r.error) errors.push(`${post.time} ${post.page}: ${r.error}`);
      } else {
        let r = await optimizePost(ctx, post, known, context, style);
        if (!r.error && r.post.trangThai !== "dat") r = await optimizePost(ctx, r.post, known, context, style);
        next = r.post;
        if (r.error) errors.push(`${post.time} ${post.page}: ${r.error}`);
      }
      done += 1;
      await storePost(ctx, ma, next);
      // Xeon unreachable is the same for every post: stop instead of failing ten times.
      if (errors.some((e) => /chưa đăng ký với Xeon|Không nối được bộ não/.test(e))) break;
    }
  }
  const message = `${RUN_LABEL[job] ?? job} xong: ${done}/${total} bài${errors.length ? `, ${errors.length} lỗi` : ""}.`;
  await storeRun(ctx, ma, { buoc: job, dangChay: false, xong: done, tong: total, thongBao: message, loi: errors.slice(0, 5).join(" · "), capNhat: nowIso(ctx) });
  ctx.ports.logger.info(`[xuong-noi-dung] lô ${ma}: ${message}`);
  return { xong: done, tong: total, loi: errors };
}

/** Step 5 for real: album → `dang-bai` → Meta's schedule. Posts with a rule error are skipped with a note. */
async function schedulePosts(ctx: Ctx, ma: string, chosen: string[]): Promise<{ xong: number; tong: number; loi: string[]; ketQua: { id: string; ok: boolean; message: string }[] }> {
  const publishing = ctx.services["dang-bai"];
  const batch = batchOf(await document(ctx).read(null), ma);
  if (batch === null || publishing === undefined) return { xong: 0, tong: 0, loi: [publishing === undefined ? "Chưa bật module đăng bài." : "Không thấy lô."], ketQua: [] };
  const items = await catalogue(ctx);
  const { context } = judgeContext(ctx, items);
  const targets = batch.bai.filter((p) => chosen.includes(p.id) && text(p.boQua) === "" && text(p.maLenh) === "" && text(p.caption) !== "");
  const results: { id: string; ok: boolean; message: string }[] = [];
  const errors: string[] = [];
  let scheduled = 0;
  for (const post of targets) {
    const verdict = validatePost(post, { ...context, seenCodes: new Map() });
    if (!verdict.ok) {
      const why = verdict.errors.map((e) => e.message).join("; ");
      results.push({ id: post.id, ok: false, message: why });
      errors.push(`${post.time} ${post.page}: ${why}`);
      await storePost(ctx, ma, applyVerdict(post, verdict));
      continue;
    }
    const album = await albumFor(ctx, post, items);
    const answer = await publishing.publish({
      mode: "schedule", trang: post.page, noiDung: post.caption, anh: album.anh, lichDang: slotInstant(post.date, post.time),
      binhLuan: { cheDo: text(post.comment) === "" ? "none" : "custom", chu: post.comment }, nguon: { maLo: ma, maBai: post.id, maSP: post.codes }
    });
    if (!answer.ok || answer.job === undefined) {
      const why = [answer.message, ...album.notes].filter(Boolean).join(" · ");
      results.push({ id: post.id, ok: false, message: why });
      errors.push(`${post.time} ${post.page}: ${why}`);
      await storePost(ctx, ma, { ...post, loiAi: why });
      continue;
    }
    scheduled += 1;
    results.push({ id: post.id, ok: true, message: `Đã lên lịch ${post.time} với ${album.anh.length} ảnh.` });
    await storePost(ctx, ma, { ...post, maLenh: answer.job.id, trangThai: "da-len-lich", loiAi: "" });
    if (text(post.maChuDe) !== "") {
      await topicDocument(ctx).update((current) => {
        const r = setTopicStatus(current, text(post.maChuDe), "used", nowIso(ctx), ma);
        return "error" in r ? undefined : r;
      }, defaultTopicBook());
    }
  }
  return { xong: scheduled, tong: targets.length, loi: errors, ketQua: results };
}

/** Trend research on Xeon for the shop's biggest model lines; the landing clamps the change. */
async function researchTrends(ctx: Ctx): Promise<{ ok: boolean; message: string; book: TrendBook }> {
  const items = await catalogue(ctx);
  const universe = buildUniverse(items.map((i) => ({
    code: i.code, name: text(i.name), brand: text(i.brand), discountPercent: Number(i.discountPercent || 0),
    qty: (i.sizes ?? []).reduce((sum, s) => sum + Math.max(0, Number(s.qty ?? 0)), 0)
  })));
  const current = await readTrends(ctx);
  const at = nowIso(ctx);
  if (universe.length === 0) {
    const book: TrendBook = { ...current, lastRunAt: at, lastStatus: "skipped", lastSummary: "Danh mục chưa có dòng sản phẩm nào.", lastError: "" };
    await trendDocument(ctx).write(book);
    return { ok: true, message: book.lastSummary, book };
  }
  const answer = await callXeonTrends(ctx, universe, at);
  if (!answer.ok) {
    const book: TrendBook = { ...current, lastRunAt: at, lastStatus: "error", lastError: answer.viSao };
    await trendDocument(ctx).write(book);
    return { ok: false, message: answer.viSao, book };
  }
  const applied = applyResearch(current, answer.cards, at);
  const book: TrendBook = { ...applied.book, lastRunAt: at, lastStatus: answer.cards.length < universe.length ? "partial" : "ok", lastSummary: `${applied.updated} thẻ cập nhật, ${applied.created} thẻ mới, ${applied.clamped} điểm bị kẹp ±5.`, lastError: "" };
  await trendDocument(ctx).write(book);
  return { ok: true, message: book.lastSummary, book };
}

async function callXeonTrends(ctx: Ctx, universe: ReturnType<typeof buildUniverse>, at: string): Promise<{ ok: true; cards: Omit<TrendCard, "lastResearchedAt">[] } | { ok: false; viSao: string }> {
  const r = await callXeon(ctx, "/noi-dung/xu-huong", { dong: universe.map(({ codes: _codes, ...line }) => line), boiCanh: `tháng ${at.slice(5, 7)}/${at.slice(0, 4)}` });
  if (!r.ok) return { ok: false, viSao: r.viSao };
  const cards = (Array.isArray(r.body["dong"]) ? r.body["dong"] : []).map((c) => {
    const o = asRecord(c);
    const status = text(o["trendStatus"]);
    return {
      key: text(o["key"], 160), hang: text(o["hang"], 80), dong: text(o["dong"], 160), hotScore: Number(o["hotScore"]) || 0,
      trendStatus: (status === "rising" || status === "cooling" ? status : "stable") as TrendCard["trendStatus"],
      trendReason: text(o["trendReason"], 300), story: text(o["story"], 900),
      styling: (Array.isArray(o["styling"]) ? o["styling"] : []).map((s) => text(s, 160)), sampleCaptions: (Array.isArray(o["sampleCaptions"]) ? o["sampleCaptions"] : []).map((s) => text(s, 200)),
      confidence: Number(o["confidence"]) || 0.55
    };
  }).filter((c) => c.key !== "");
  return { ok: true, cards };
}

function batchView(batch: ContentBatch): ContentBatch & { chon: string[] } {
  // Desk default (12/09/2026): posts that passed are ticked when nobody has ticked anything yet.
  const chon = Array.isArray(batch.chon) ? batch.chon : batch.bai.filter((p) => p.trangThai === "dat" || text(p.maLenh) !== "").map((p) => p.id);
  return { ...batch, chon };
}

export const manifest = defineModule<Config, Services>({
  id: "xuong-noi-dung",
  name: "Xưởng nội dung",
  tier: "content",
  runsOn: "server-khach",
  feature: "xuong-noi-dung",
  version: "0.2.0",
  ports: ["store", "logger", "clock", "config", "http"],
  requires: ["hang-kho.search"],
  requiresOptional: ["khung-nen-tang.xeon", "dang-bai.publish", "dang-bai.renderCover", "dang-bai.renderCard", "dang-bai.jobs", "don-khach.search"],

  routes: [
    {
      // What the screen needs to draw itself: the steps, the shapes of post, the default slots, the angles.
      method: "GET", path: "/api/noi-dung/khuon", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: () => reply.json({
        ok: true,
        buoc: STEPS.map((id) => ({ ma: id, ten: STEP_LABEL[id] })),
        dangBai: Object.entries(POST_FORMATS).map(([ma, f]) => ({ ma, ten: f.label, tuMa: f.minCodes, denMa: f.maxCodes, huongDan: f.guide, canGallery: f.requiresGallery === true })),
        khungGio: DEFAULT_SLOTS,
        goc: BUY_ANGLES.map((a) => ({ id: a.id, label: a.label, guide: a.guide }))
      }, 200, NO_STORE)
    },
    {
      method: "GET", path: "/api/noi-dung/lo", access: ACCESS.admin,
      rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx) => reply.json({ ok: true, lo: listBatches(await document(ctx).read(null)) }, 200, NO_STORE)
    },
    {
      // STEP 1 — plan a day: slots in, posts with real codes out. The owner's topics come first.
      method: "POST", path: "/api/noi-dung/lo", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      bodyLimit: 64 * 1024,
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const ngay = text(body["ngay"]);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ngay)) return reply.json({ ok: false, error: "thieu_ngay" }, 400);

        const pages = Array.isArray(body["trang"]) ? (body["trang"] as unknown[]).map((p) => text(p)).filter((p) => p !== "") : [];
        if (pages.length === 0) return reply.json({ ok: false, error: "thieu_trang" }, 400);
        const slots = Array.isArray(body["khungGio"]) && (body["khungGio"] as unknown[]).length > 0
          ? (body["khungGio"] as unknown[]).map((t) => text(t)).filter((t) => /^\d{2}:\d{2}$/.test(t))
          : [...DEFAULT_SLOTS];

        const khung = pages.flatMap((page) => slots.map((time) => ({ page, time })));
        if (khung.length === 0) return reply.json({ ok: false, error: "thieu_khung_gio" }, 400);
        if (khung.length > POSTS_PER_BATCH_MAX) {
          return reply.json({ ok: false, error: "qua_nhieu_bai", tran: POSTS_PER_BATCH_MAX }, 400);
        }

        const at = ctx.ports.clock.now();
        const items = await catalogue(ctx);
        const book = await document(ctx).read(null);
        const index = await priorityIndex(ctx, items, book?.lo ?? [], await readTrends(ctx));
        const ranked = new Map(rankPool(poolRows(items), index).map((r) => [r.code, r.priorityScore]));
        const pool = toPlannable(items).map((p) => ({ ...p, priority: ranked.get(p.code) ?? 0, ...(index.lastPostedAt.has(p.code) ? { dangLuc: new Date(index.lastPostedAt.get(p.code)!).toISOString() } : {}) }));
        const topics = waitingTopics(await topicDocument(ctx).read(null), pages).map((t) => ({ id: t.id, text: t.text, page: t.page, angle: detectAngle(t.text) }));
        const batch = planBatch({ ma: `lo_${at.getTime()}`, ngay, khung, pool, at: at.toISOString(), topics });
        await document(ctx).update((current) => saveBatch(current, batch, at.toISOString()), defaultBatchBook());
        ctx.ports.logger.info(`[xuong-noi-dung] lô ${batch.ma} ngày ${ngay}: ${batch.bai.length} bài trên ${pages.length} trang`);
        return reply.json({ ok: true, lo: batchView(batch) }, 200, NO_STORE);
      }
    },
    {
      method: "GET", path: "/api/noi-dung/lo/:ma", access: ACCESS.admin,
      rateLimit: { calls: 1200, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const found = batchOf(await document(ctx).read(null), request.params["ma"] ?? "");
        if (found === null) return reply.json({ ok: false, error: "khong_thay_lo" }, 404);
        return reply.json({ ok: true, lo: batchView(found) }, 200, NO_STORE);
      }
    },
    {
      // STEP 2 / 4 — a person writes or fixes one post. Editing anything a rule judges puts the
      // post back to `nhap`: a caption that passed and was then changed has NOT passed.
      method: "PUT", path: "/api/noi-dung/lo/:ma/bai/:bai", access: ACCESS.admin,
      rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      bodyLimit: 256 * 1024,
      handle: async (ctx, request) => withBatch(ctx, request.params["ma"] ?? "", async (batch) => {
        const postId = text(request.params["bai"]);
        const post = batch.bai.find((p) => p.id === postId);
        if (post === undefined) return { error: "khong_thay_bai", status: 404 };
        if (text(post.maLenh) !== "") return { error: "bai_da_len_lich", status: 409, message: "Bài đã lên lịch Meta — sửa ở tab Bài đã đăng." };
        const body = asRecord(await request.json());
        const next: ContentPost = editPost(post, {
          ...(body["caption"] === undefined ? {} : { caption: String(body["caption"]).slice(0, 8000) }),
          ...(body["chuAnh"] === undefined ? {} : { main: String(body["chuAnh"]).slice(0, 300) }),
          ...(body["dongNho"] === undefined ? {} : { sub: String(body["dongNho"]).slice(0, 120) }),
          ...(body["comment"] === undefined ? {} : { comment: String(body["comment"]).slice(0, 2000) }),
          ...(body["chuDe"] === undefined ? {} : { chuDe: String(body["chuDe"]).slice(0, 500) }),
          ...(body["goc"] === undefined ? {} : { goc: text(body["goc"]).slice(0, 40) }),
          ...(body["gio"] === undefined ? {} : { time: text(body["gio"]) }),
          ...(body["dangBai"] === undefined ? {} : { format: text(body["dangBai"]) }),
          ...(Array.isArray(body["ma"]) ? { codes: body["ma"] as string[] } : {}),
          ...(body["boQua"] === undefined ? {} : { boQua: String(body["boQua"]).slice(0, 300) })
        });
        return { batch: { ...batch, bai: batch.bai.map((p) => (p.id === postId ? next : p)) }, body: { bai: next } };
      })
    },
    {
      // STEP 3 — the machine review: every rule over every post, the verdict written down.
      method: "POST", path: "/api/noi-dung/lo/:ma/cham", access: ACCESS.admin,
      rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => withBatch(ctx, request.params["ma"] ?? "", async (batch) => {
        const { batch: judged, chung } = await judge(ctx, batch);
        ctx.ports.logger.info(`[xuong-noi-dung] chấm lô ${batch.ma}: ${judged.bai.filter((p) => p.trangThai === "dat").length}/${judged.bai.length} bài đạt`);
        return { batch: judged, body: { lo: batchView(judged), loChung: { loi: chung.errors, canhBao: chung.warnings } } };
      })
    },
    {
      // Moving between steps. Forward is gated; back is always allowed.
      method: "POST", path: "/api/noi-dung/lo/:ma/buoc", access: ACCESS.admin,
      rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => withBatch(ctx, request.params["ma"] ?? "", async (batch) => {
        const body = asRecord(await request.json());
        const direction = text(body["huong"]) === "lui" ? "lui" : "toi";
        const moved = stepBatch(batch, direction, nowIso(ctx));
        if (!moved.ok) return { error: "chua_qua_duoc_buoc", status: 409, message: moved.viSao };
        return { batch: moved.batch, body: { buoc: moved.batch.buoc, ten: STEP_LABEL[moved.batch.buoc] } };
      })
    },
    {
      // STEP 5 — REAL since Đ8: the chosen posts go on Meta's schedule through `dang-bai`. Desk
      // 13/09/2026: the button works as soon as one chosen post is written — the owner accepts a post
      // the judges did not love; a post breaking a MACHINE rule is still refused, with the reason.
      method: "POST", path: "/api/noi-dung/lo/:ma/len-lich", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const ma = text(request.params["ma"]);
        const batch = batchOf(await document(ctx).read(null), ma);
        if (batch === null) return reply.json({ ok: false, error: "khong_thay_lo" }, 404);
        const body = asRecord(await request.json());
        const chosen = Array.isArray(body["chon"]) ? (body["chon"] as unknown[]).map((c) => text(c)) : batchView(batch).chon;
        const ready = batch.bai.filter((p) => chosen.includes(p.id) && text(p.boQua) === "" && text(p.maLenh) === "" && text(p.caption) !== "");
        if (ready.length === 0) return reply.json({ ok: false, error: "chua_co_bai_chon", message: "Tick chọn bài đã viết để lên lịch (hoặc bấm chọn hết)." }, 409);
        if (ctx.services["dang-bai"] === undefined) return reply.json({ ok: false, error: "chua_bat_dang_bai", message: "Chưa bật module đăng bài nên chưa đẩy lên Meta được." }, 503);
        if (running.has(ma)) return reply.json({ ok: false, error: "dang_chay", message: "Lô đang chạy một bước khác — đợi xong rồi bấm lại." }, 409);
        running.add(ma);
        try {
          const r = await schedulePosts(ctx, ma, chosen);
          ctx.ports.logger.info(`[xuong-noi-dung] lô ${ma}: ${r.xong}/${r.tong} bài đã lên lịch Meta`);
          const after = batchOf(await document(ctx).read(null), ma);
          return reply.json({ ok: true, soBai: r.xong, tong: r.tong, ketQua: r.ketQua, loi: r.loi, lo: after ? batchView(after) : null, message: `Đã lên lịch ${r.xong}/${r.tong} bài trên Meta.` }, 200, NO_STORE);
        } finally {
          running.delete(ma);
        }
      }
    },
    {
      // THE AI DRAFT of one post. Xeon writes; THIS SERVER judges, and hands a failed draft back once.
      method: "POST", path: "/api/noi-dung/lo/:ma/bai/:bai/viet", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => withBatch(ctx, request.params["ma"] ?? "", async (batch) => {
        const postId = text(request.params["bai"]);
        const post = batch.bai.find((p) => p.id === postId);
        if (post === undefined) return { error: "khong_thay_bai", status: 404 };
        const { known, context } = judgeContext(ctx, await catalogue(ctx));
        const written = await draftWithBrain(ctx, post, known, context, chosenStyle(await styleDocument(ctx).read(null)));
        if (!written.ok) return { error: written.error, status: written.status, message: written.message };
        const next = editPost(post, { caption: written.draft.caption, main: written.draft.chuAnh, comment: written.draft.comment });
        const judged = { ...applyVerdict(next, written.verdict), loiAi: "" };
        ctx.ports.logger.info(`[xuong-noi-dung] bộ não viết ${postId}: ${written.draft.caption.length} ký tự, ${written.rounds} lượt, ${judged.trangThai}`);
        return { batch: { ...batch, bai: batch.bai.map((p) => (p.id === postId ? judged : p)) }, body: { bai: judged, soLuot: written.rounds, caption: written.draft.caption } };
      })
    },
    {
      // Đ8 — one post through Xeon's three judges.
      method: "POST", path: "/api/noi-dung/lo/:ma/bai/:bai/phan-bien", access: ACCESS.admin,
      rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => withBatch(ctx, request.params["ma"] ?? "", async (batch) => {
        const post = batch.bai.find((p) => p.id === text(request.params["bai"]));
        if (post === undefined) return { error: "khong_thay_bai", status: 404 };
        const { known, context } = judgeContext(ctx, await catalogue(ctx));
        const r = await reviewPost(ctx, post, known, context, chosenStyle(await styleDocument(ctx).read(null)));
        if (r.error) return { error: "phan_bien_hong", status: 502, message: r.error };
        return { batch: { ...batch, bai: batch.bai.map((p) => (p.id === post.id ? r.post : p)) }, body: { bai: r.post } };
      })
    },
    {
      // Đ8 — the whole batch in the background: viet | viet-loi | phan-bien | toi-uu | chu-trinh.
      // `doiXong: true` waits for the end (tests, a cron); the screen does not wait and polls the batch.
      method: "POST", path: "/api/noi-dung/lo/:ma/chay", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const ma = text(request.params["ma"]);
        const body = asRecord(await request.json());
        const job = text(body["viec"]);
        if (!RUN_LABEL[job] || job === "len-lich") return reply.json({ ok: false, error: "viec_la", message: "Việc chạy lô không hợp lệ." }, 400);
        const batch = batchOf(await document(ctx).read(null), ma);
        if (batch === null) return reply.json({ ok: false, error: "khong_thay_lo" }, 404);
        if (running.has(ma)) return reply.json({ ok: false, error: "dang_chay", message: `Lô đang chạy: ${batch.chay?.thongBao ?? ""}` }, 409);
        const chosen = batchView(batch).chon;
        running.add(ma);
        await storeRun(ctx, ma, { buoc: job, dangChay: true, xong: 0, tong: 0, thongBao: `${RUN_LABEL[job]}: đang bắt đầu.`, loi: "", capNhat: nowIso(ctx) });
        const work = runBatch(ctx, ma, job, chosen)
          .catch(async (e: unknown) => {
            const why = e instanceof Error ? e.message : String(e);
            await storeRun(ctx, ma, { buoc: job, dangChay: false, xong: 0, tong: 0, thongBao: "Dừng vì lỗi.", loi: why, capNhat: nowIso(ctx) });
            return { xong: 0, tong: 0, loi: [why] };
          })
          .finally(() => running.delete(ma));
        if (body["doiXong"] === true) {
          const r = await work;
          const after = batchOf(await document(ctx).read(null), ma);
          return reply.json({ ok: true, dangChay: false, ...r, lo: after ? batchView(after) : null }, 200, NO_STORE);
        }
        return reply.json({ ok: true, dangChay: true, message: `${RUN_LABEL[job]} đang chạy — có thể rời màn hình.` }, 200, NO_STORE);
      }
    },
    {
      // Đ8 — the ticks: which posts get scheduled, and kept on a rebuild.
      method: "POST", path: "/api/noi-dung/lo/:ma/chon", access: ACCESS.admin,
      rateLimit: { calls: 1200, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => withBatch(ctx, request.params["ma"] ?? "", async (batch) => {
        const body = asRecord(await request.json());
        const ids = new Set(batch.bai.map((p) => p.id));
        const chon = (Array.isArray(body["chon"]) ? body["chon"] : []).map((c) => text(c)).filter((c) => ids.has(c));
        const locked = batch.bai.filter((p) => text(p.maLenh) !== "").map((p) => p.id);
        const next = { ...batch, chon: [...new Set([...chon, ...locked])] };
        return { batch: next, body: { chon: next.chon } };
      })
    },
    {
      // Đ8 — drop a post: the slot empties, one step of undo is kept.
      method: "POST", path: "/api/noi-dung/lo/:ma/bai/:bai/bo", access: ACCESS.admin,
      rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => withBatch(ctx, request.params["ma"] ?? "", async (batch) => {
        const post = batch.bai.find((p) => p.id === text(request.params["bai"]));
        if (post === undefined) return { error: "khong_thay_bai", status: 404 };
        if (text(post.maLenh) !== "") return { error: "bai_da_len_lich", status: 409, message: "Huỷ lịch ở tab Bài đã đăng trước rồi mới bỏ được." };
        const bai = batch.bai.map((p) => (p.id === post.id ? { ...editPost(p, { boQua: "anh_bo" }), caption: "", main: "", comment: "", codes: [] } : p));
        return { batch: { ...batch, bai, chon: (batch.chon ?? []).filter((c) => c !== post.id), hoanTac: { nhan: `bỏ bài ${post.time} ${post.page}`, bai: batch.bai } }, body: { bai: bai.find((p) => p.id === post.id) } };
      })
    },
    {
      method: "POST", path: "/api/noi-dung/lo/:ma/hoan-tac", access: ACCESS.admin,
      rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => withBatch(ctx, request.params["ma"] ?? "", async (batch) => {
        if (!batch.hoanTac) return { error: "khong_co_hoan_tac", status: 409, message: "Không có gì để hoàn tác." };
        // Posts scheduled since the snapshot stay scheduled: undo never un-publishes.
        const now = new Map(batch.bai.filter((p) => text(p.maLenh) !== "").map((p) => [p.id, p]));
        const bai = batch.hoanTac.bai.map((p) => now.get(p.id) ?? p);
        return { batch: { ...batch, bai, hoanTac: null }, body: { nhan: batch.hoanTac.nhan } };
      })
    },
    {
      // Đ8 — "Dựng lại kế hoạch": replan every post that is NOT ticked and not scheduled.
      method: "POST", path: "/api/noi-dung/lo/:ma/dung-lai", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => withBatch(ctx, request.params["ma"] ?? "", async (batch) => {
        const chon = new Set(batchView(batch).chon);
        const keep = batch.bai.filter((p) => chon.has(p.id) || text(p.maLenh) !== "");
        const redo = batch.bai.filter((p) => !keep.includes(p));
        const items = await catalogue(ctx);
        const used = new Set(keep.flatMap((p) => p.codes));
        const pages = [...new Set(batch.bai.map((p) => p.page))];
        const topics = waitingTopics(await topicDocument(ctx).read(null), pages).map((t) => ({ id: t.id, text: t.text, page: t.page, angle: detectAngle(t.text) }));
        const fresh = planBatch({ ma: batch.ma, ngay: batch.ngay, khung: redo.map((p) => ({ page: p.page, time: p.time })), pool: toPlannable(items).filter((p) => !used.has(p.code)), at: nowIso(ctx), topics });
        const byTime = new Map(fresh.bai.map((p, i) => [redo[i]!.id, { ...p, id: redo[i]!.id }]));
        const bai = batch.bai.map((p) => byTime.get(p.id) ?? p);
        return { batch: { ...batch, bai, hoanTac: { nhan: "dựng lại kế hoạch", bai: batch.bai } }, body: { lo: batchView({ ...batch, bai }), giu: keep.length, moi: redo.length } };
      })
    },
    {
      // Đ8 — "Gợi ý mã khác": sellable codes not in this batch, best priority first, angle still free.
      method: "POST", path: "/api/noi-dung/lo/:ma/bai/:bai/goi-y-ma", access: ACCESS.admin,
      rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const book = await document(ctx).read(null);
        const batch = batchOf(book, text(request.params["ma"]));
        const post = batch?.bai.find((p) => p.id === text(request.params["bai"]));
        if (!batch || !post) return reply.json({ ok: false, error: "khong_thay_bai" }, 404);
        const items = await catalogue(ctx);
        const index = await priorityIndex(ctx, items, book?.lo ?? [], await readTrends(ctx));
        const ranked = rankPool(poolRows(items), index);
        const inBatch = new Set(batch.bai.flatMap((p) => (p.id === post.id ? [] : p.codes)));
        const want = Math.max(post.codes.length, POST_FORMATS[post.format]?.minCodes ?? 4);
        const plannable = toPlannable(items).map((p) => ({ ...p, priority: ranked.find((r) => r.code === p.code)?.priorityScore ?? 0 }));
        const codes = pickCodes(sellableCodes(plannable).sort((a, b) => Number(b.priority) - Number(a.priority)), want, inBatch);
        return reply.json({ ok: true, ma: codes, lyDo: codes.map((c) => ({ ma: c, lyDo: ranked.find((r) => r.code === c)?.priorityReasons ?? [], gocTrong: freeAngles(c, index) })) }, 200, NO_STORE);
      }
    },
    {
      // Đ8 — "Lưu vào kho": a written post becomes a library item.
      method: "POST", path: "/api/noi-dung/lo/:ma/bai/:bai/vao-kho", access: ACCESS.admin,
      rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const batch = batchOf(await document(ctx).read(null), text(request.params["ma"]));
        const post = batch?.bai.find((p) => p.id === text(request.params["bai"]));
        if (!batch || !post) return reply.json({ ok: false, error: "khong_thay_bai" }, 404);
        if (text(post.caption) === "") return reply.json({ ok: false, error: "bai_rong", message: "Bài chưa có nội dung." }, 409);
        let saved: ReturnType<typeof saveLibraryItem> | null = null;
        await libraryDocument(ctx).update((current) => {
          saved = saveLibraryItem(current, { tieuDe: post.chuDe || post.main, kenh: "facebook", trangThai: text(post.maLenh) ? "published" : "ready", maSanPham: post.codes, quote: post.main, noiDung: post.caption, ghiChu: `Nguồn từ lô ${batch.ngay} ${post.time} ${post.page}`, nguonBai: `${batch.ma}/${post.id}` }, `kb_${crypto.randomUUID().slice(0, 10)}`, nowIso(ctx));
          return "error" in saved ? undefined : saved.book;
        }, defaultLibraryBook());
        const result = saved as ReturnType<typeof saveLibraryItem> | null;
        if (result === null || "error" in result) return reply.json({ ok: false, message: result && "error" in result ? result.error : "Không lưu được." }, 400);
        return reply.json({ ok: true, muc: result.item }, 200, NO_STORE);
      }
    },

    // ----- topics -----
    {
      method: "GET", path: "/api/noi-dung/chu-de", access: ACCESS.admin, rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx) => {
        const book = await topicDocument(ctx).read(null);
        return reply.json({ ok: true, list: book?.list ?? [], counts: topicCounts(book) }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/noi-dung/chu-de", access: ACCESS.admin, rateLimit: { calls: 300, windowMs: TEN_MINUTES }, bodyLimit: 8 * 1024,
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const holder: { r: ReturnType<typeof addTopic> | null } = { r: null };
        await topicDocument(ctx).update((current) => {
          holder.r = addTopic(current, { text: body["text"], page: body["page"], priority: body["priority"] }, `cd_${crypto.randomUUID().slice(0, 10)}`, nowIso(ctx));
          return "error" in holder.r ? undefined : holder.r.book;
        }, defaultTopicBook());
        const r = holder.r;
        if (r === null || "error" in r) return reply.json({ ok: false, message: r && "error" in r ? r.error : "Không thêm được." }, 400);
        return reply.json({ ok: true, topic: r.topic, counts: topicCounts(r.book) }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/noi-dung/chu-de/:id/trang-thai", access: ACCESS.admin, rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const holder: { r: TopicBook | { error: string } | null } = { r: null };
        await topicDocument(ctx).update((current) => {
          holder.r = setTopicStatus(current, text(request.params["id"]), body["status"], nowIso(ctx));
          return "error" in holder.r ? undefined : holder.r;
        }, defaultTopicBook());
        const r = holder.r;
        if (r === null || "error" in r) return reply.json({ ok: false, message: r && "error" in r ? r.error : "Không đổi được." }, 400);
        return reply.json({ ok: true, counts: topicCounts(r) }, 200, NO_STORE);
      }
    },

    // ----- the code pool -----
    {
      method: "GET", path: "/api/noi-dung/kho-ma", access: ACCESS.admin, rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const items = await catalogue(ctx);
        const rows = poolRows(items);
        const index = await priorityIndex(ctx, items, (await document(ctx).read(null))?.lo ?? [], await readTrends(ctx));
        const ranked = rankPool(rows, index, { query: request.query["q"] ?? "", brand: request.query["hang"] ?? "", category: request.query["nhom"] ?? "", gallery: request.query["gocChup"] === "1", fresh: request.query["moi"] === "1" });
        return reply.json({
          ok: true, rows: ranked.slice(0, 300), matched: ranked.length, total: rows.length,
          brands: [...new Set(rows.map((r) => r.brand).filter(Boolean))].sort(), categories: [...new Set(rows.map((r) => r.category).filter(Boolean))].sort()
        }, 200, NO_STORE);
      }
    },

    // ----- trends -----
    {
      method: "GET", path: "/api/noi-dung/xu-huong", access: ACCESS.admin, rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx) => {
        const book = await readTrends(ctx);
        return reply.json({ ok: true, ...book, cards: [...book.cards].sort((a, b) => b.hotScore - a.hotScore), denHan: researchDue(book, ctx.ports.clock.now().getTime()) }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/noi-dung/xu-huong/chay", access: ACCESS.admin, rateLimit: { calls: 20, windowMs: TEN_MINUTES },
      handle: async (ctx) => {
        const r = await researchTrends(ctx);
        return reply.json({ ok: r.ok, message: r.message, ...r.book }, r.ok ? 200 : 502, NO_STORE);
      }
    },
    {
      // The heartbeat: weekly trend research when due. OMI calls it while the Content screen is open; a cron may too.
      method: "POST", path: "/api/noi-dung/nhip", access: ACCESS.service, rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx) => {
        const book = await readTrends(ctx);
        if (!researchDue(book, ctx.ports.clock.now().getTime())) return reply.json({ ok: true, xuHuong: "chưa đến hạn" }, 200, NO_STORE);
        const r = await researchTrends(ctx);
        return reply.json({ ok: true, xuHuong: r.message }, 200, NO_STORE);
      }
    },

    // ----- writing styles -----
    {
      method: "GET", path: "/api/noi-dung/phong-cach", access: ACCESS.admin, rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx) => {
        const book = await styleDocument(ctx).read(null);
        return reply.json({ ok: true, ...(book && Array.isArray(book.danhSach) && book.danhSach.length ? book : defaultStyleBook()) }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/noi-dung/phong-cach", access: ACCESS.admin, rateLimit: { calls: 120, windowMs: TEN_MINUTES }, bodyLimit: 32 * 1024,
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const current = await styleDocument(ctx).read(null);
        if (body["chon"] !== undefined && body["id"] === undefined) {
          const base = current && current.danhSach?.length ? current : defaultStyleBook();
          const id = text(body["chon"]);
          if (!base.danhSach.some((s) => s.id === id)) return reply.json({ ok: false, message: "Không có style này." }, 400);
          const next = { ...base, chon: id, updatedAt: nowIso(ctx) };
          await styleDocument(ctx).write(next);
          return reply.json({ ok: true, ...next }, 200, NO_STORE);
        }
        const saved = saveStyle(current, body, nowIso(ctx));
        if ("error" in saved) return reply.json({ ok: false, message: saved.error }, 400);
        await styleDocument(ctx).write(saved);
        return reply.json({ ok: true, ...saved, message: "Đã lưu style — bài viết sau sẽ theo style này." }, 200, NO_STORE);
      }
    },

    // ----- the library -----
    {
      method: "GET", path: "/api/noi-dung/kho-bai", access: ACCESS.admin, rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const book = await libraryDocument(ctx).read(null);
        const all = book?.muc ?? [];
        return reply.json({
          ok: true, muc: filterLibrary(book, { q: request.query["q"], kenh: request.query["kenh"] }),
          dem: { tong: all.length, facebook: all.filter((m) => m.kenh === "facebook").length, seo: all.filter((m) => m.kenh === "seo").length }
        }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/noi-dung/kho-bai", access: ACCESS.admin, rateLimit: { calls: 300, windowMs: TEN_MINUTES }, bodyLimit: 128 * 1024,
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const holder: { r: ReturnType<typeof saveLibraryItem> | null } = { r: null };
        await libraryDocument(ctx).update((current) => {
          holder.r = saveLibraryItem(current, body, `kb_${crypto.randomUUID().slice(0, 10)}`, nowIso(ctx));
          return "error" in holder.r ? undefined : holder.r.book;
        }, defaultLibraryBook());
        const r = holder.r;
        if (r === null || "error" in r) return reply.json({ ok: false, message: r && "error" in r ? r.error : "Không lưu được." }, 400);
        return reply.json({ ok: true, muc: r.item }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/noi-dung/kho-bai/:id/xoa", access: ACCESS.admin, rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const id = text(request.params["id"]);
        await libraryDocument(ctx).update((current) => ({ version: 1, muc: (current?.muc ?? []).filter((m) => m.id !== id), updatedAt: nowIso(ctx) }), defaultLibraryBook());
        return reply.json({ ok: true, message: "Đã xoá bài khỏi kho." }, 200, NO_STORE);
      }
    }
  ],

  botTools: []
});

export { BATCH_KEEP_MAX };
export type { PostContext };
