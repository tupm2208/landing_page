/**
 * @file MODULE CONTENT WORKSHOP ("xuong-noi-dung") — tier "content", runs on the merchant server.
 *
 * One day of Facebook posts, from a plan against real stock to a schedule Meta will accept, in the
 * five steps Sales Desk settled on: kế hoạch → viết bài → phản biện → tối ưu → lên lịch.
 *
 * WHY THE STEP IS SERVER STATE and not a tab in the screen: the gate between steps is the whole
 * value. A post that never met the rules must not become a schedule, and a screen that keeps the
 * step in a local variable loses that the moment somebody reloads or opens the shop on a second
 * machine. `canAdvance` lives beside the rules it enforces.
 *
 * WHAT THIS MODULE DOES NOT DO:
 *
 *   - It does not WRITE for you. Drafting text and pictures is the brain's job on Xeon, and the
 *     brain has no door for it yet, so `POST .../viet` says exactly that instead of pretending.
 *     Every other step works today with a person typing — which is how the shop worked anyway.
 *   - It does not PUBLISH. "Lên lịch" marks the batch ready and is where the Meta hand-off will
 *     attach; nothing here calls Meta, so a half-built feature cannot post to a real page.
 *
 * It reads the catalogue through `hang-kho.search` and never opens those tables itself.
 */

import { ACCESS, defineModule, reply, type ModuleContext } from "../../contract";
import type { PlatformServices } from "../khung-nen-tang/module";
import {
  BATCH_KEEP_MAX, applyVerdict, batchOf, defaultBatchBook, editPost, listBatches, planBatch,
  saveBatch, stepBatch, STEP_LABEL, STEPS, type BatchBook, type ContentBatch, type ContentPost, type PlannableProduct
} from "./batch";
import {
  DEFAULT_SLOTS, POST_FORMATS, validateBatch, validatePost, writerRules,
  type PostContext, type PostVerdict, type ProductForPost
} from "./studio-rules";

/** Document name — on-disk contract. */
export const BATCH_DOCUMENT = "xuong-noi-dung-lo";

const TEN_MINUTES = 10 * 60 * 1000;
const NO_STORE = { "Cache-Control": "no-store" };
/** The most posts one batch may hold: five slots on a handful of pages is already a long day. */
const POSTS_PER_BATCH_MAX = 40;

/** `ctx.config` as `app.ts` builds it. */
export interface Config {
  /** The shop's own site — links in the first comment must point there. */
  siteUrl?: string;
}

/** What the catalogue answers (`hang-kho.search`), narrowed to what the planner needs. */
interface CatalogItem {
  code: string;
  name?: string;
  brand?: string;
  sizes?: { size?: string; qty?: number }[];
  galleryImages?: string[];
  thumbnailImage?: string;
}

interface Services {
  "hang-kho": { search(input: { query?: string; limit?: number }): Promise<CatalogItem[]> };
  /** Which Xeon holds the brain, and with which private token. Absent = no brain, and it says so. */
  "khung-nen-tang"?: Pick<PlatformServices, "xeon">;
}

type Ctx = ModuleContext<Config, Services>;

const document = (ctx: Ctx) => ctx.ports.store.document<BatchBook>(BATCH_DOCUMENT);
const text = (v: unknown): string => String(v ?? "").trim();

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The catalogue as the planner and the rules see it: one shape, built once per request. */
function toPlannable(items: CatalogItem[]): PlannableProduct[] {
  return items.map((item) => ({
    code: text(item.code),
    name: text(item.name),
    brand: text(item.brand),
    sizes: (item.sizes ?? []).map((s) => ({ size: text(s.size), qty: Number(s.qty ?? 0) })),
    images: (item.galleryImages ?? []).length + (text(item.thumbnailImage) === "" ? 0 : 1)
  }));
}

function byCode(products: PlannableProduct[]): Map<string, ProductForPost> {
  return new Map(products.map((p) => [p.code, p]));
}

/** What the brain answered, plus this server's verdict on it. */
type DraftOutcome =
  | { ok: true; draft: { caption: string; chuAnh: string; comment: string }; verdict: PostVerdict; rounds: number }
  | { ok: false; error: string; status: number; message: string };

/** The most times one press of the button may call the model. */
const WRITE_ROUNDS = 2;

/**
 * Asks Xeon for a draft, judges it here, and on a failure asks ONCE more with the errors attached.
 *
 * Why the retry lives on this side: the rules are here. Xeon cannot know whether a caption broke
 * one, and teaching it would put a second, drifting copy of the rules on a server that serves many
 * shops. So the loop is: brief -> draft -> verdict -> (brief + what was wrong) -> draft.
 *
 * Two rounds, not a loop until clean. A model that misses the same rule twice will usually miss it
 * five times too, and a seller pressing one button should not silently spend five calls; the second
 * draft comes back with its verdict shown, and a person fixes the last mile.
 */
async function draftWithBrain(
  ctx: Ctx,
  input: { xeon: { diaChiXeon: string; maNhanTin: string }; post: ContentPost; known: Map<string, ProductForPost>; judgeContext: PostContext }
): Promise<DraftOutcome> {
  const { xeon, post, known, judgeContext } = input;
  const origin = text(xeon.diaChiXeon).replace(/\/+$/, "");
  const shape = POST_FORMATS[post.format];
  const brief: Record<string, unknown> = {
    dangBai: post.format,
    huongDan: shape?.guide ?? "",
    chuDe: post.chuDe,
    // Only what the catalogue really has: a code the brief cannot describe is a code the model
    // would otherwise invent a description for.
    mon: post.codes.map((code) => {
      const item = known.get(code);
      return {
        ma: code,
        ten: item?.name ?? "",
        size: (item?.sizes ?? []).filter((s) => Number(s.qty ?? 0) > 0).map((s) => text(s.size))
      };
    }),
    luat: { ...writerRules(), gocLink: text(ctx.config.siteUrl) }
  };

  let last: DraftOutcome | null = null;
  for (let round = 1; round <= WRITE_ROUNDS; round += 1) {
    let answer: { ok: boolean; status: number; body: Record<string, unknown> };
    try {
      const response = await ctx.ports.http.fetch(`${origin}/viet-bai`, {
        method: "POST",
        timeoutMs: 120000,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${xeon.maNhanTin}` },
        body: JSON.stringify(brief)
      });
      const parsed: unknown = await response.json().catch(() => null);
      answer = { ok: response.ok, status: response.status, body: (parsed ?? {}) as Record<string, unknown> };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      ctx.ports.logger.warn(`[xuong-noi-dung] khong hoi duoc bo nao: ${message}`);
      return { ok: false, error: "khong_noi_duoc_bo_nao", status: 502, message: `Không nối được bộ não trên Xeon: ${message}` };
    }
    if (!answer.ok) {
      const why = text(answer.body["message"]) || text(answer.body["error"]) || `Xeon trả mã ${answer.status}`;
      return { ok: false, error: "bo_nao_tu_choi", status: 502, message: why };
    }

    const draft = (answer.body["ban"] ?? {}) as Record<string, unknown>;
    const caption = text(draft["caption"]);
    if (caption === "") return { ok: false, error: "ban_nhap_rong", status: 502, message: "Bộ não trả về bài rỗng." };
    const written = { caption, chuAnh: text(draft["chuAnh"]), comment: text(draft["comment"]) };

    const verdict = validatePost(
      { ...post, caption: written.caption, main: written.chuAnh, comment: written.comment },
      { ...judgeContext, seenCodes: new Map() }
    );
    last = { ok: true, draft: written, verdict, rounds: round };
    if (verdict.ok || round === WRITE_ROUNDS) return last;

    // Round two: the same brief plus exactly what the judge objected to.
    brief["loiLanTruoc"] = verdict.errors.map((e) => e.message);
  }
  return last ?? { ok: false, error: "khong_viet_duoc", status: 502, message: "Bộ não không trả về bài nào." };
}

/** Runs the rules over a batch and writes the verdict onto every post. */
async function judge(ctx: Ctx, batch: ContentBatch): Promise<{ batch: ContentBatch; chung: ReturnType<typeof validateBatch> }> {
  const catalogue = toPlannable(await ctx.services["hang-kho"].search({ limit: 1000 }));
  const context: PostContext = {
    productsByCode: byCode(catalogue),
    // Desk had `toprun.site` in a regular expression; here the link rule judges against THIS
    // shop's own address, so one shop's rule never fails another shop's links.
    siteOrigin: text(ctx.config.siteUrl),
    nowMs: ctx.ports.clock.now().getTime()
  };
  const live = batch.bai.filter((p) => text(p.boQua) === "");
  const verdict = validateBatch(live, context);
  const byId = new Map(live.map((p, i) => [p.id, verdict.theoBai[i]]));
  const bai = batch.bai.map((post) => {
    const one = byId.get(post.id);
    return one === undefined ? post : applyVerdict(post, one);
  });
  return { batch: { ...batch, bai, suaLuc: ctx.ports.clock.now().toISOString() }, chung: verdict };
}

/** What `withBatch`'s worker may answer: a changed batch, or a refusal with a reason to show. */
type BatchWork =
  | { batch: ContentBatch; body: Record<string, unknown> }
  | { error: string; status: number; message?: string };

/** Reads a batch, hands it to `work`, saves what comes back. */
async function withBatch(ctx: Ctx, ma: string, work: (batch: ContentBatch) => Promise<BatchWork>) {
  const book = await document(ctx).read(null);
  const found = batchOf(book, ma);
  if (found === null) return reply.json({ ok: false, error: "khong_thay_lo" }, 404);
  const done = await work(found);
  if ("error" in done) return reply.json({ ok: false, error: done.error, ...(done.message === undefined ? {} : { message: done.message }) }, done.status);
  const at = ctx.ports.clock.now().toISOString();
  await document(ctx).update((current) => saveBatch(current, done.batch, at), defaultBatchBook());
  return reply.json({ ok: true, ...done.body }, 200, NO_STORE);
}

export const manifest = defineModule<Config, Services>({
  id: "xuong-noi-dung",
  name: "Xưởng nội dung",
  tier: "content",
  runsOn: "server-khach",
  feature: "xuong-noi-dung",
  version: "0.1.0",
  ports: ["store", "logger", "clock", "config", "http"],
  requires: ["hang-kho.search"],
  requiresOptional: ["khung-nen-tang.xeon"],

  routes: [
    {
      // What the screen needs to draw itself: the steps, the shapes of post, the default slots.
      method: "GET", path: "/api/noi-dung/khuon", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: () => reply.json({
        ok: true,
        buoc: STEPS.map((id) => ({ ma: id, ten: STEP_LABEL[id] })),
        dangBai: Object.entries(POST_FORMATS).map(([ma, f]) => ({ ma, ten: f.label, tuMa: f.minCodes, denMa: f.maxCodes, huongDan: f.guide, canGallery: f.requiresGallery === true })),
        khungGio: DEFAULT_SLOTS
      }, 200, NO_STORE)
    },
    {
      method: "GET", path: "/api/noi-dung/lo", access: ACCESS.admin,
      rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx) => reply.json({ ok: true, lo: listBatches(await document(ctx).read(null)) }, 200, NO_STORE)
    },
    {
      // STEP 1 — plan a day: slots in, posts with real codes out.
      method: "POST", path: "/api/noi-dung/lo", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      bodyLimit: 64 * 1024,
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const ngay = text(body["ngay"]);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ngay)) return reply.json({ ok: false, error: "thieu_ngay" }, 400);

        const pages = Array.isArray(body["trang"]) ? (body["trang"] as unknown[]).map(text).filter((p) => p !== "") : [];
        if (pages.length === 0) return reply.json({ ok: false, error: "thieu_trang" }, 400);
        const slots = Array.isArray(body["khungGio"]) && (body["khungGio"] as unknown[]).length > 0
          ? (body["khungGio"] as unknown[]).map(text).filter((t) => /^\d{2}:\d{2}$/.test(t))
          : [...DEFAULT_SLOTS];

        const khung = pages.flatMap((page) => slots.map((time) => ({ page, time })));
        if (khung.length === 0) return reply.json({ ok: false, error: "thieu_khung_gio" }, 400);
        if (khung.length > POSTS_PER_BATCH_MAX) {
          return reply.json({ ok: false, error: "qua_nhieu_bai", tran: POSTS_PER_BATCH_MAX }, 400);
        }

        const at = ctx.ports.clock.now();
        const pool = toPlannable(await ctx.services["hang-kho"].search({ limit: 1000 }));
        const batch = planBatch({ ma: `lo_${at.getTime()}`, ngay, khung, pool, at: at.toISOString() });
        await document(ctx).update((current) => saveBatch(current, batch, at.toISOString()), defaultBatchBook());
        ctx.ports.logger.info(`[xuong-noi-dung] lô ${batch.ma} ngày ${ngay}: ${batch.bai.length} bài trên ${pages.length} trang`);
        return reply.json({ ok: true, lo: batch }, 200, NO_STORE);
      }
    },
    {
      method: "GET", path: "/api/noi-dung/lo/:ma", access: ACCESS.admin,
      rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const found = batchOf(await document(ctx).read(null), request.params["ma"] ?? "");
        if (found === null) return reply.json({ ok: false, error: "khong_thay_lo" }, 404);
        return reply.json({ ok: true, lo: found }, 200, NO_STORE);
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
        const body = asRecord(await request.json());
        const next: ContentPost = editPost(post, {
          ...(body["caption"] === undefined ? {} : { caption: String(body["caption"]).slice(0, 8000) }),
          ...(body["chuAnh"] === undefined ? {} : { main: String(body["chuAnh"]).slice(0, 300) }),
          ...(body["comment"] === undefined ? {} : { comment: String(body["comment"]).slice(0, 2000) }),
          ...(body["chuDe"] === undefined ? {} : { chuDe: String(body["chuDe"]).slice(0, 500) }),
          ...(body["gio"] === undefined ? {} : { time: text(body["gio"]) }),
          ...(body["dangBai"] === undefined ? {} : { format: text(body["dangBai"]) }),
          ...(Array.isArray(body["ma"]) ? { codes: body["ma"] as string[] } : {}),
          ...(body["boQua"] === undefined ? {} : { boQua: String(body["boQua"]).slice(0, 300) })
        });
        return { batch: { ...batch, bai: batch.bai.map((p) => (p.id === postId ? next : p)) }, body: { bai: next } };
      })
    },
    {
      // STEP 3 — the review: run every rule over every post and write the verdict down.
      method: "POST", path: "/api/noi-dung/lo/:ma/cham", access: ACCESS.admin,
      rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => withBatch(ctx, request.params["ma"] ?? "", async (batch) => {
        const { batch: judged, chung } = await judge(ctx, batch);
        ctx.ports.logger.info(`[xuong-noi-dung] chấm lô ${batch.ma}: ${judged.bai.filter((p) => p.trangThai === "dat").length}/${judged.bai.length} bài đạt`);
        return { batch: judged, body: { lo: judged, loChung: { loi: chung.errors, canhBao: chung.warnings } } };
      })
    },
    {
      // Moving between steps. Forward is gated; back is always allowed — fixing a caption after
      // reading the review is the normal shape of the work.
      method: "POST", path: "/api/noi-dung/lo/:ma/buoc", access: ACCESS.admin,
      rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => withBatch(ctx, request.params["ma"] ?? "", async (batch) => {
        const body = asRecord(await request.json());
        const direction = text(body["huong"]) === "lui" ? "lui" : "toi";
        const moved = stepBatch(batch, direction, ctx.ports.clock.now().toISOString());
        if (!moved.ok) return { error: "chua_qua_duoc_buoc", status: 409, message: moved.viSao };
        return { batch: moved.batch, body: { buoc: moved.batch.buoc, ten: STEP_LABEL[moved.batch.buoc] } };
      })
    },
    {
      // STEP 5 — mark the batch scheduled. Nothing here calls Meta: publishing is the next piece
      // of work, and a half-built one must not be able to post to a real page.
      method: "POST", path: "/api/noi-dung/lo/:ma/len-lich", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => withBatch(ctx, request.params["ma"] ?? "", async (batch) => {
        if (batch.buoc !== "len-lich") return { error: "chua_toi_buoc_len_lich", status: 409 };
        const { batch: judged } = await judge(ctx, batch);
        const live = judged.bai.filter((p) => text(p.boQua) === "");
        const broken = live.filter((p) => p.trangThai === "hong");
        if (broken.length > 0) return { error: "con_bai_loi", status: 409, message: `${broken.length} bài còn lỗi.` };
        const bai = judged.bai.map((p) => (text(p.boQua) === "" ? { ...p, trangThai: "da-len-lich" } : p));
        ctx.ports.logger.info(`[xuong-noi-dung] lô ${batch.ma}: ${live.length} bài đã lên lịch`);
        return { batch: { ...judged, bai }, body: { soBai: live.length, chuaDang: true } };
      })
    },
    {
      // THE AI DRAFT. Xeon writes; THIS SERVER judges, with the same rules that will judge the
      // final post — and hands a failed draft's errors straight back for one rewrite. That loop is
      // the "tối ưu" step done by machine, and it only works because the judge and the brief come
      // from one place.
      method: "POST", path: "/api/noi-dung/lo/:ma/bai/:bai/viet", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => withBatch(ctx, request.params["ma"] ?? "", async (batch) => {
        const postId = text(request.params["bai"]);
        const post = batch.bai.find((p) => p.id === postId);
        if (post === undefined) return { error: "khong_thay_bai", status: 404 };

        const xeon = ctx.services["khung-nen-tang"]?.xeon ? await ctx.services["khung-nen-tang"].xeon() : null;
        if (xeon === null || text(xeon.diaChiXeon) === "" || text(xeon.maNhanTin) === "") {
          return { error: "chua_dang_ky_xeon", status: 503, message: "Landing chưa đăng ký với Xeon nên chưa hỏi được bộ não. Soạn tay vẫn chạy bình thường." };
        }

        const catalogue = toPlannable(await ctx.services["hang-kho"].search({ limit: 1000 }));
        const known = byCode(catalogue);
        const judgeContext: PostContext = { productsByCode: known, siteOrigin: text(ctx.config.siteUrl), nowMs: ctx.ports.clock.now().getTime() };
        const written = await draftWithBrain(ctx, { xeon, post, known, judgeContext });
        if (!written.ok) return { error: written.error, status: written.status, message: written.message };

        const next = editPost(post, { caption: written.draft.caption, main: written.draft.chuAnh, comment: written.draft.comment });
        const judged = applyVerdict(next, written.verdict);
        ctx.ports.logger.info(`[xuong-noi-dung] bộ não viết ${postId}: ${written.draft.caption.length} ký tự, ${written.rounds} lượt, ${judged.trangThai}`);
        return {
          batch: { ...batch, bai: batch.bai.map((p) => (p.id === postId ? judged : p)) },
          body: { bai: judged, soLuot: written.rounds, caption: written.draft.caption }
        };
      })
    }
  ],

  botTools: []
});

export { BATCH_KEEP_MAX };
