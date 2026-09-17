/**
 * @file THE AI HALF OF THE FIVE STEPS — write, critique, optimise, schedule — over one post or a whole
 * batch (Desk `content_flow_kit.js` + the `/api/content/studio/{write,review,optimize,schedule}` doors).
 *
 * The split that must not move: XEON WRITES AND JUDGES VOICE, THIS SERVER JUDGES RULES. Every draft
 * and every rewrite passes through `validatePost` here; Xeon's three judges add scores and notes but
 * a post with a machine rule error is never "đạt", whatever the judges said.
 *
 * Scheduling is REAL since Đ8: the cover and the product cards are rendered, the album is padded to
 * at least 5 pictures with the products' gallery, and `dang-bai` puts the post on Meta's schedule.
 */

import { applyVerdict, editPost, type ContentBatch, type ContentPost, type PostReview } from "./batch";
import { callXeon, text, toPlannable, byCode, type CatalogItem, type Ctx } from "./context";
import { angleOf, emptyIndex, type PoolRow, type PriorityIndex } from "./priority";
import { POST_FORMATS, validatePost, writerRules, type PostContext, type PostVerdict, type ProductForPost } from "./studio-rules";
import type { WritingStyle } from "./library";
import { hotByCode, type TrendBook } from "./trends";

/** The most times one press may call the writer for one post. */
export const WRITE_ROUNDS = 2;
export const MAX_ALBUM = 10;
export const MIN_ALBUM = 5;

export type DraftOutcome =
  | { ok: true; draft: { caption: string; chuAnh: string; comment: string }; verdict: PostVerdict; rounds: number }
  | { ok: false; error: string; status: number; message: string };

export async function catalogue(ctx: Ctx): Promise<CatalogItem[]> {
  return ctx.services["hang-kho"].search({ limit: 2000 });
}

export function judgeContext(ctx: Ctx, items: CatalogItem[]): { known: Map<string, ProductForPost>; context: PostContext } {
  const known = byCode(toPlannable(items));
  return { known, context: { productsByCode: known, siteOrigin: text(ctx.config.siteUrl), nowMs: ctx.ports.clock.now().getTime() } };
}

function briefItems(post: ContentPost, known: Map<string, ProductForPost>): { ma: string; ten: string; size: string[] }[] {
  return post.codes.map((code) => {
    const item = known.get(code);
    return { ma: code, ten: item?.name ?? "", size: (item?.sizes ?? []).filter((s) => Number(s.qty ?? 0) > 0).map((s) => text(s.size)) };
  });
}

function styleWire(style: WritingStyle | null): Record<string, string> | undefined {
  return style === null ? undefined : { ten: style.ten, moTa: style.moTa, luatViet: style.luatViet, cauTruc: style.cauTruc, baiMau: style.baiMau };
}

/**
 * Asks Xeon for a draft, judges it here, and on a failure asks ONCE more with the errors attached.
 * Two rounds, not a loop until clean: a model that misses the same rule twice will miss it five times.
 */
export async function draftWithBrain(ctx: Ctx, post: ContentPost, known: Map<string, ProductForPost>, context: PostContext, style: WritingStyle | null): Promise<DraftOutcome> {
  const shape = POST_FORMATS[post.format];
  const angle = angleOf(text(post.goc));
  const brief: Record<string, unknown> = {
    maBai: post.id,
    dangBai: post.format,
    huongDan: shape?.guide ?? "",
    chuDe: post.chuDe,
    mon: briefItems(post, known),
    luat: { ...writerRules(), gocLink: text(ctx.config.siteUrl) },
    ...(style === null ? {} : { phongCach: styleWire(style) }),
    ...(angle === null ? {} : { goc: { ten: angle.label, huongDan: angle.guide } })
  };
  let last: DraftOutcome | null = null;
  for (let round = 1; round <= WRITE_ROUNDS; round += 1) {
    const answer = await callXeon(ctx, "/viet-bai", brief, 120_000);
    if (!answer.ok) {
      if (answer.status === 503) return { ok: false, error: "chua_dang_ky_xeon", status: 503, message: answer.viSao };
      ctx.ports.logger.warn(`[xuong-noi-dung] bo nao tu choi viet: ${answer.viSao}`);
      return { ok: false, error: "bo_nao_tu_choi", status: 502, message: answer.viSao };
    }
    const draft = (answer.body["ban"] ?? {}) as Record<string, unknown>;
    const caption = text(draft["caption"]);
    if (caption === "") return { ok: false, error: "ban_nhap_rong", status: 502, message: "Bộ não trả về bài rỗng." };
    const written = { caption, chuAnh: text(draft["chuAnh"]), comment: text(draft["comment"]) };
    const verdict = validatePost({ ...post, caption: written.caption, main: written.chuAnh, comment: written.comment }, { ...context, seenCodes: new Map() });
    last = { ok: true, draft: written, verdict, rounds: round };
    if (verdict.ok || round === WRITE_ROUNDS) return last;
    brief["loiLanTruoc"] = verdict.errors.map((e) => e.message);
  }
  return last ?? { ok: false, error: "khong_viet_duoc", status: 502, message: "Bộ não không trả về bài nào." };
}

/** Machine rules + the three judges. `dat` only when both agree. */
export async function reviewPost(ctx: Ctx, post: ContentPost, known: Map<string, ProductForPost>, context: PostContext, style: WritingStyle | null): Promise<{ post: ContentPost; error: string }> {
  // The lead-time rule is about scheduling, not about the words; a critique of yesterday's batch still runs.
  const verdict = validatePost(post, { ...context, nowMs: 0, seenCodes: new Map() });
  const judged = applyVerdict(post, verdict);
  if (text(post.caption) === "") return { post: { ...judged, loiAi: "Bài chưa có nội dung." }, error: "Bài chưa có nội dung." };
  const angle = angleOf(text(post.goc));
  const answer = await callXeon(ctx, "/noi-dung/phan-bien", {
    bai: { ma: post.id, gio: post.time, trang: post.page, dangBai: post.format, huongDan: POST_FORMATS[post.format]?.guide ?? "", goc: angle?.label ?? "", caption: post.caption, chuAnh: post.main, comment: post.comment, mon: briefItems(post, known) },
    loiLuat: verdict.errors.map((e) => e.message),
    ...(style === null ? {} : { phongCach: styleWire(style) })
  });
  if (!answer.ok) return { post: { ...judged, loiAi: answer.viSao }, error: answer.viSao };
  const b = answer.body;
  const score = (key: string) => Number((b[key] as { diem?: unknown } | undefined)?.diem ?? 0) || 0;
  const review: PostReview = {
    dat: b["dat"] === true, chuyenMon: score("chuyenMon"), giong: score("giong"), dangBai: score("dangBai"),
    ghiChu: (Array.isArray(b["ghiChu"]) ? b["ghiChu"] : []).map((n) => text(n, 300)).slice(0, 9),
    chiTiet: { chuyenMon: b["chuyenMon"], giong: b["giong"], dangBai: b["dangBai"], dat: b["dat"], ghiChu: b["ghiChu"] },
    luc: ctx.ports.clock.now().toISOString()
  };
  const passed = verdict.errors.length === 0 && review.dat;
  const loi = review.dat ? judged.loi : [...judged.loi, { id: "phan_bien_chua_dat", message: `Ba người chấm chưa đạt (chuyên môn ${review.chuyenMon}, giọng ${review.giong}, dạng bài ${review.dangBai}).` }];
  return { post: { ...judged, phanBien: review, loi, trangThai: passed ? "dat" : "hong", loiAi: "" }, error: "" };
}

/** Rewrites against the critique + rule errors, then critiques again. */
export async function optimizePost(ctx: Ctx, post: ContentPost, known: Map<string, ProductForPost>, context: PostContext, style: WritingStyle | null): Promise<{ post: ContentPost; error: string }> {
  const verdict = validatePost(post, { ...context, nowMs: 0, seenCodes: new Map() });
  const answer = await callXeon(ctx, "/noi-dung/toi-uu", {
    bai: { ma: post.id, gio: post.time, trang: post.page, dangBai: post.format, huongDan: POST_FORMATS[post.format]?.guide ?? "", goc: angleOf(text(post.goc))?.label ?? "", caption: post.caption, chuAnh: post.main, comment: post.comment, mon: briefItems(post, known) },
    phanBien: post.phanBien?.chiTiet ?? null,
    loiLuat: verdict.errors.map((e) => e.message),
    ...(style === null ? {} : { phongCach: styleWire(style) })
  });
  if (!answer.ok) return { post: { ...post, loiAi: answer.viSao }, error: answer.viSao };
  const caption = text(answer.body["caption"]);
  if (caption === "") return { post: { ...post, loiAi: "Bộ não trả về bài rỗng." }, error: "Bộ não trả về bài rỗng." };
  const rewritten = editPost(post, { caption, ...(text(answer.body["chuAnh"]) === "" ? {} : { main: text(answer.body["chuAnh"]) }) });
  return reviewPost(ctx, rewritten, known, context, style);
}

/** Desk `contentFlowPostNeedsRewrite`: no caption, a model error, or a critique that did not pass. */
export function needsRewrite(post: ContentPost): boolean {
  if (text(post.boQua) !== "" || text(post.maLenh) !== "") return false;
  if (text(post.caption) === "" || text(post.loiAi) !== "") return true;
  return post.phanBien?.dat === false || post.trangThai === "hong";
}

/** The album of a post: cover, one card per code, then gallery pictures until there are 5. */
export async function albumFor(ctx: Ctx, post: ContentPost, items: CatalogItem[]): Promise<{ anh: string[]; notes: string[] }> {
  const publishing = ctx.services["dang-bai"];
  const notes: string[] = [];
  const pictures: string[] = [];
  if (publishing === undefined) return { anh: [], notes: ["Chưa bật module đăng bài."] };
  const cover = await publishing.renderCover({ main: post.main || post.chuDe, sub: text(post.sub), key: `${post.date}${post.time}` });
  if (cover.ok) pictures.push(cover.url); else notes.push(`Ảnh bìa: ${cover.message}`);
  for (const code of post.codes.slice(0, MAX_ALBUM - 1)) {
    const card = await publishing.renderCard({ ma: code });
    if (card.ok) pictures.push(card.url); else notes.push(`Card ${code}: ${card.message}`);
  }
  const byItem = new Map(items.map((i) => [i.code, i]));
  for (const code of post.codes) {
    for (const extra of byItem.get(code)?.galleryImages ?? []) {
      if (pictures.length >= MIN_ALBUM) break;
      if (!pictures.includes(extra)) pictures.push(extra);
    }
  }
  return { anh: pictures.slice(0, MAX_ALBUM), notes };
}

/** `2026-09-20` + `10:00` → the instant in Vietnam time. */
export const slotInstant = (date: string, time: string): string => new Date(`${date}T${time}:00+07:00`).toISOString();

/** Posts sold in the last 30 days, engagement and last-posted per code, hot per code. */
export async function priorityIndex(ctx: Ctx, items: CatalogItem[], batches: ContentBatch[], trends: TrendBook): Promise<PriorityIndex> {
  const nowMs = ctx.ports.clock.now().getTime();
  const index = emptyIndex(nowMs);
  const orders = ctx.services["don-khach"]?.search
    ? await ctx.services["don-khach"].search({ since: new Date(nowMs - 30 * 24 * 3600 * 1000).toISOString(), limit: 500 }).catch(() => [])
    : [];
  for (const order of orders) {
    if (/huy|cancel/i.test(String(order.status))) continue;
    for (const line of order.items ?? []) index.salesQty.set(line.productCode, (index.salesQty.get(line.productCode) ?? 0) + (Number(line.quantity ?? line.qty) || 1));
  }
  const jobs = ctx.services["dang-bai"]?.jobs ? await ctx.services["dang-bai"].jobs().catch(() => []) : [];
  for (const job of jobs) {
    if (["cancelled", "draft", "failed", "deleted"].includes(job.trangThai)) continue;
    const when = Date.parse(job.dangLuc || job.lichDang || job.taoLuc) || 0;
    for (const code of job.nguon.maSP) {
      index.lastPostedAt.set(code, Math.max(index.lastPostedAt.get(code) ?? 0, when));
      if (job.soLieu) {
        const e = index.engagement.get(code) ?? { total: 0, posts: 0 };
        index.engagement.set(code, { total: e.total + job.soLieu.camXuc + 2 * job.soLieu.binhLuan + 3 * job.soLieu.chiaSe, posts: e.posts + 1 });
      }
    }
  }
  for (const batch of batches) {
    for (const post of batch.bai) {
      if (text(post.boQua) !== "" || text(post.maLenh) === "") continue;
      const when = Date.parse(slotInstant(post.date, post.time)) || 0;
      for (const code of post.codes) {
        if (text(post.goc) !== "") index.angles.set(code, [...(index.angles.get(code) ?? []), { angle: text(post.goc), at: when }]);
      }
    }
  }
  index.hot = hotByCode(trends, items.map((i) => ({ code: i.code, name: text(i.name), brand: text(i.brand) })));
  return index;
}

export function poolRows(items: CatalogItem[]): PoolRow[] {
  return items.map((i) => {
    const sizes = (i.sizes ?? []).filter((s) => Number(s.qty ?? 0) > 0).length;
    const gallery = (i.galleryImages ?? []).length;
    const sale = Number(i.salePrice || i.price || 0);
    return {
      code: text(i.code), name: text(i.name), brand: text(i.brand), category: text(i.category), salePrice: sale, listPrice: Number(i.listPrice || 0),
      discountPercent: Number(i.discountPercent || 0), sizeCount: sizes, imageCount: gallery + (text(i.thumbnailImage) === "" ? 0 : 1), galleryReady: gallery >= 4
    };
  }).filter((r) => r.code !== "" && r.name !== "" && r.sizeCount > 0 && r.imageCount > 0);
}
