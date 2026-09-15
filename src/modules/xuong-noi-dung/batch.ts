/**
 * @file THE FIVE STEPS of writing a day of posts, and the batch they work on.
 *
 * Sales Desk's Content screen is one flow with five stops — kế hoạch → viết bài → phản biện →
 * tối ưu → lên lịch — and the value is in the ORDER, not in any one stop: a post is planned
 * against real stock, written to a shape, judged by the rules, fixed until it passes, and only
 * then scheduled. Skipping a step is how a post about a sold-out shoe reaches ten thousand people.
 *
 * So the step is state on the batch, and `canAdvance` is the gate. A batch can always go BACK
 * (fixing a caption after the verdict is normal work); it can only go forward when the work of the
 * current step is really done.
 *
 * Pure functions again: data in, next batch out. The module wraps them in `document.update()`.
 */

import { POST_FORMATS, type Post, type RuleNote } from "./studio-rules";

/** The five stops, in order. Values are wire — OMI draws tabs from them. */
export const STEPS = ["ke-hoach", "viet-bai", "phan-bien", "toi-uu", "len-lich"] as const;
export type Step = (typeof STEPS)[number];

export const STEP_LABEL: Readonly<Record<Step, string>> = {
  "ke-hoach": "Kế hoạch",
  "viet-bai": "Viết bài",
  "phan-bien": "Phản biện",
  "toi-uu": "Tối ưu",
  "len-lich": "Lên lịch"
};

/** One post inside a batch: what the rules judge, plus where it stands in the flow. */
export interface ContentPost extends Post {
  id: string;
  page: string;
  date: string;
  time: string;
  format: string;
  codes: string[];
  caption: string;
  main: string;
  comment: string;
  /** What this post is about — set in the plan step, used as the writer's brief. */
  chuDe: string;
  /** `nhap` · `dat` (passed the rules) · `hong` (has errors) · `da-len-lich`. */
  trangThai: string;
  loi: RuleNote[];
  canhBao: RuleNote[];
  /** Why a post was dropped from the day instead of published. */
  boQua: string;
}

export interface ContentBatch {
  ma: string;
  ngay: string;
  buoc: Step;
  bai: ContentPost[];
  taoLuc: string;
  suaLuc: string;
}

export interface BatchBook {
  version: 1;
  lo: ContentBatch[];
  updatedAt: string;
}

/** How many batches survive. A batch is a day of work, so this is about two months. */
export const BATCH_KEEP_MAX = 60;

export function defaultBatchBook(): BatchBook {
  return { version: 1, lo: [], updatedAt: "" };
}

const text = (v: unknown): string => String(v ?? "").trim();

export function isStep(value: unknown): value is Step {
  return (STEPS as readonly string[]).includes(text(value));
}

/** A product as the planner sees one — the same slice the rules use, plus when it last went out. */
export interface PlannableProduct {
  code: string;
  name?: string;
  brand?: string;
  sizes?: { size?: string; qty?: number }[];
  images?: number;
  /** ISO time this code was last posted, if ever. */
  dangLuc?: string;
}

/**
 * Only codes that can actually be published: in stock, with a picture and a real name.
 *
 * This is the whole point of planning against the catalogue rather than against a wish list — the
 * rules would reject these codes at the review step anyway, and finding that out AFTER writing
 * nine hundred words is a wasted afternoon.
 */
export function sellableCodes(products: PlannableProduct[]): PlannableProduct[] {
  return products.filter((p) =>
    text(p.code) !== ""
    && text(p.name) !== ""
    && Number(p.images ?? 0) > 0
    && (p.sizes ?? []).some((s) => Number(s.qty ?? 0) > 0));
}

/**
 * Picks codes for one post: those posted longest ago first, never repeating inside the batch.
 *
 * Rotating by "last posted" is what keeps a page from showing the same six shoes all week without
 * anybody deciding to; it needs no cleverness, only the date each code last went out.
 */
export function pickCodes(pool: PlannableProduct[], want: number, used: Set<string>): string[] {
  return pool
    .filter((p) => !used.has(p.code))
    .sort((a, b) => text(a.dangLuc).localeCompare(text(b.dangLuc)) || a.code.localeCompare(b.code))
    .slice(0, Math.max(0, want))
    .map((p) => p.code);
}

export interface PlanInput {
  ma: string;
  ngay: string;
  /** One entry per post to write: which page, which time slot, which shape of post. */
  khung: { page: string; time: string; format?: string }[];
  pool: PlannableProduct[];
  at: string;
}

/**
 * STEP 1 — the plan. Turns a day's time slots into empty posts with real codes already chosen.
 *
 * Formats are rotated rather than repeated: five posts a day in the same shape reads as a machine
 * wrote them, which is exactly what the shop is trying not to look like (chốt 07/09/2026).
 */
export function planBatch({ ma, ngay, khung, pool, at }: PlanInput): ContentBatch {
  const sellable = sellableCodes(pool);
  const used = new Set<string>();
  const rotation = Object.keys(POST_FORMATS);

  const bai: ContentPost[] = khung.map((slot, index) => {
    const format = text(slot.format) !== "" && POST_FORMATS[text(slot.format)] !== undefined
      ? text(slot.format)
      : rotation[index % rotation.length] ?? "gom_nhu_cau";
    const shape = POST_FORMATS[format];
    const codes = pickCodes(sellable, shape?.minCodes ?? 4, used);
    for (const code of codes) used.add(code);
    return {
      id: `${ma}-${index + 1}`,
      page: text(slot.page),
      date: ngay,
      time: text(slot.time),
      format,
      codes,
      caption: "",
      main: "",
      comment: "",
      chuDe: shape?.guide ?? "",
      trangThai: codes.length === 0 ? "hong" : "nhap",
      loi: codes.length === 0 ? [{ id: "het_ma", message: "Không còn mã nào bán được để xếp vào bài này." }] : [],
      canhBao: [],
      boQua: ""
    };
  });

  return { ma, ngay, buoc: "ke-hoach", bai, taoLuc: at, suaLuc: at };
}

/** What each step needs finished before the batch may move on. */
export interface AdvanceVerdict {
  ok: boolean;
  viSao: string;
  buoc: Step;
}

/** The posts that still count — one dropped from the day is not holding the batch back. */
const live = (batch: ContentBatch): ContentPost[] => batch.bai.filter((p) => text(p.boQua) === "");

/**
 * May this batch move to the next step?
 *
 * Going BACK is always allowed and needs no verdict: fixing a caption after reading the review is
 * the normal shape of the work, not an exception.
 */
export function canAdvance(batch: ContentBatch): AdvanceVerdict {
  const at = STEPS.indexOf(batch.buoc);
  const next = STEPS[at + 1];
  if (next === undefined) return { ok: false, viSao: "Lô đã ở bước cuối.", buoc: batch.buoc };
  const posts = live(batch);
  if (posts.length === 0) return { ok: false, viSao: "Lô chưa có bài nào.", buoc: batch.buoc };

  if (batch.buoc === "ke-hoach") {
    const empty = posts.filter((p) => p.codes.length === 0);
    if (empty.length > 0) return { ok: false, viSao: `${empty.length} bài chưa có mã nào — bỏ qua bài đó hoặc chọn mã khác.`, buoc: batch.buoc };
  }
  if (batch.buoc === "viet-bai") {
    const blank = posts.filter((p) => text(p.caption) === "" || text(p.main) === "");
    if (blank.length > 0) return { ok: false, viSao: `${blank.length} bài chưa có caption hoặc chữ trên ảnh.`, buoc: batch.buoc };
  }
  if (batch.buoc === "phan-bien") {
    const unjudged = posts.filter((p) => p.trangThai === "nhap");
    if (unjudged.length > 0) return { ok: false, viSao: `${unjudged.length} bài chưa được chấm — bấm Chấm lại trước.`, buoc: batch.buoc };
  }
  if (batch.buoc === "toi-uu") {
    const broken = posts.filter((p) => p.trangThai !== "dat");
    if (broken.length > 0) return { ok: false, viSao: `${broken.length} bài còn lỗi. Sửa cho hết rồi mới lên lịch được.`, buoc: batch.buoc };
  }
  return { ok: true, viSao: "", buoc: next };
}

/** Moves one step forward or back; forward is gated by `canAdvance`. */
export function stepBatch(batch: ContentBatch, direction: "toi" | "lui", at: string): { batch: ContentBatch; ok: boolean; viSao: string } {
  const index = STEPS.indexOf(batch.buoc);
  if (direction === "lui") {
    const previous = STEPS[Math.max(0, index - 1)] as Step;
    return { batch: { ...batch, buoc: previous, suaLuc: at }, ok: true, viSao: "" };
  }
  const verdict = canAdvance(batch);
  if (!verdict.ok) return { batch, ok: false, viSao: verdict.viSao };
  return { batch: { ...batch, buoc: verdict.buoc, suaLuc: at }, ok: true, viSao: "" };
}

/** Writes a verdict onto a post: `dat` when it has no errors, `hong` when it has. */
export function applyVerdict(post: ContentPost, verdict: { errors: RuleNote[]; warnings: RuleNote[] }): ContentPost {
  return { ...post, loi: verdict.errors, canhBao: verdict.warnings, trangThai: verdict.errors.length === 0 ? "dat" : "hong" };
}

/** Fields of a post the owner may edit. Everything else is set by the flow. */
export interface PostPatch {
  caption?: string;
  main?: string;
  comment?: string;
  chuDe?: string;
  time?: string;
  format?: string;
  codes?: string[];
  boQua?: string;
}

/**
 * Applies an edit to one post.
 *
 * Editing anything a rule judges puts the post back to `nhap`: a caption that passed and was then
 * changed has NOT passed. Desk shipped a post that way once — the verdict was from the version
 * before the edit.
 */
export function editPost(post: ContentPost, patch: PostPatch): ContentPost {
  const next: ContentPost = { ...post };
  if (patch.caption !== undefined) next.caption = String(patch.caption);
  if (patch.main !== undefined) next.main = String(patch.main);
  if (patch.comment !== undefined) next.comment = String(patch.comment);
  if (patch.chuDe !== undefined) next.chuDe = String(patch.chuDe);
  if (patch.time !== undefined) next.time = text(patch.time);
  if (patch.format !== undefined && POST_FORMATS[text(patch.format)] !== undefined) next.format = text(patch.format);
  if (Array.isArray(patch.codes)) next.codes = patch.codes.map((c) => text(c)).filter((c) => c !== "");
  if (patch.boQua !== undefined) next.boQua = String(patch.boQua);
  const judged = ["caption", "main", "comment", "time", "format", "codes"] as const;
  if (judged.some((k) => patch[k] !== undefined)) {
    next.trangThai = next.trangThai === "da-len-lich" ? next.trangThai : "nhap";
    next.loi = [];
    next.canhBao = [];
  }
  return next;
}

/** Puts a batch into the book, newest first, bounded. */
export function saveBatch(book: Partial<BatchBook> | null, batch: ContentBatch, at: string): BatchBook {
  const others = (Array.isArray(book?.lo) ? book.lo : []).filter((b) => b?.ma !== batch.ma);
  const lo = [batch, ...others]
    .sort((a, b) => text(b.ngay).localeCompare(text(a.ngay)) || text(b.taoLuc).localeCompare(text(a.taoLuc)))
    .slice(0, BATCH_KEEP_MAX);
  return { version: 1, lo, updatedAt: at };
}

export function batchOf(book: Partial<BatchBook> | null, ma: string): ContentBatch | null {
  return (Array.isArray(book?.lo) ? book.lo : []).find((b) => b?.ma === text(ma)) ?? null;
}

/** One row of the batch list: the batch without its posts. */
export interface BatchRow {
  ma: string;
  ngay: string;
  buoc: Step;
  soBai: number;
  soDat: number;
  soHong: number;
  soBoQua: number;
  suaLuc: string;
}

export function listBatches(book: Partial<BatchBook> | null): BatchRow[] {
  return (Array.isArray(book?.lo) ? book.lo : []).map((b) => ({
    ma: b.ma, ngay: b.ngay, buoc: b.buoc,
    soBai: b.bai.length,
    soDat: b.bai.filter((p) => p.trangThai === "dat" || p.trangThai === "da-len-lich").length,
    soHong: b.bai.filter((p) => p.trangThai === "hong").length,
    soBoQua: b.bai.filter((p) => text(p.boQua) !== "").length,
    suaLuc: b.suaLuc
  }));
}
