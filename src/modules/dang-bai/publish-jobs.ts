/**
 * @file PUBLISH JOBS — one Facebook post the shop publishes or schedules, as pure functions.
 *
 * Ported from Sales Desk `server.js` (`createFacebookPublishJob`, `updateFacebookPublishJob`,
 * `facebook_tool_schedule_kit.js`, the comment templates). Rules kept, each one learned on the
 * running shop:
 *
 *   - A post WITH pictures needs at least 5 of them (18/08/2026): a two-picture album reads as an
 *     accident. A post without pictures is still fine.
 *   - Meta refuses a schedule less than 10 minutes out; saying so before calling Meta saves a
 *     half-uploaded album.
 *   - A DRAFT never touches Meta and needs no page.
 *   - A published post can only have its TEXT changed — Meta locks the pictures.
 *
 * Desk's "lịch tool" (the desk machine regenerating cards at posting time) is not ported: OMI is
 * not always on, and a landing on shared hosting sleeps. Every schedule here is Meta's own.
 */

export const JOB_DOCUMENT = "dang-bai-lenh";
export const TEMPLATE_DOCUMENT = "dang-bai-mau-binh-luan";
export const MIN_POST_IMAGES = 5;
export const MAX_POST_IMAGES = 10;
export const SCHEDULE_LEAD_MINUTES = 10;
export const JOBS_KEEP = 500;

export const JOB_STATUSES = ["draft", "scheduled", "published", "failed", "cancelled", "deleted"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const COMMENT_MODES = ["none", "template", "custom"] as const;
export type CommentMode = (typeof COMMENT_MODES)[number];
export const TEMPLATE_CATEGORIES = ["shop_link", "product_link", "upsell", "size_advice", "promotion", "inbox"] as const;

export const STATUS_LABEL: Readonly<Record<string, string>> = {
  submitting: "Đang gửi", scheduled: "Đã lên lịch", published: "Đã đăng", draft: "Nháp", deleted: "Đã xóa", failed: "Lỗi", cancelled: "Đã hủy"
};

export interface JobComment {
  cheDo: CommentMode;
  mauId: string;
  chu: string;
  /** `disabled` · `pending` (waits for the post to go live) · `published` · `failed`. */
  trangThai: string;
  maBinhLuan: string;
  chuDaDang: string;
  loi: string;
}

export interface JobMetrics { tiepCan: number; camXuc: number; binhLuan: number; chiaSe: number; luc: string }

export interface PublishJob {
  id: string;
  trang: string;
  tenTrang: string;
  noiDung: string;
  lienKet: string;
  /** Public https addresses Meta downloads — the album, in order. */
  anh: string[];
  /** Desk "Ảnh sẽ comment lần lượt": pictures posted as comments, in order, once the post is live. */
  anhBinhLuan: { url: string; trangThai: string; loi: string }[];
  /** Facebook text background preset id (Desk "Nền màu chữ"); empty = none. */
  nenChu: string;
  /** ISO time; empty = publish now. */
  lichDang: string;
  trangThai: JobStatus;
  /** What Meta returned on create (the scheduled object) and the post id. */
  maMeta: string;
  maBaiMeta: string;
  duongDan: string;
  dangLuc: string;
  loi: string;
  binhLuan: JobComment;
  /** Where the post came from: a content batch post, a library item, product codes. */
  nguon: { maLo: string; maBai: string; maKhoBai: string; maSP: string[] };
  soLieu: JobMetrics | null;
  taoLuc: string;
  suaLuc: string;
  dongBoLuc: string;
}

export interface JobBook { version: 1; lenh: PublishJob[]; updatedAt: string }
export interface CommentTemplate { id: string; ten: string; nhom: string; noiDung: string; bat: boolean; suaLuc: string }
export interface TemplateBook { version: 1; mau: CommentTemplate[]; updatedAt: string }

export const defaultJobBook = (): JobBook => ({ version: 1, lenh: [], updatedAt: "" });

const text = (v: unknown, n = 5000): string => String(v ?? "").trim().slice(0, n);
const asObject = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Desk's first comment templates: a shop link, a product link, an inbox invitation. */
export function defaultTemplateBook(): TemplateBook {
  return {
    version: 1,
    mau: [
      { id: "mau_shop", ten: "Link shop", nhom: "shop_link", noiDung: "Xem thêm mẫu và size còn hàng tại {SHOP_LINK} — cần tư vấn size cứ inbox {PAGE_NAME} nhé 📩", bat: true, suaLuc: "" },
      { id: "mau_san_pham", ten: "Link sản phẩm", nhom: "product_link", noiDung: "{PRODUCT_NAME} ({PRODUCT_CODE}) xem chi tiết ở đây: {PRODUCT_LINK}", bat: true, suaLuc: "" },
      { id: "mau_inbox", ten: "Mời inbox", nhom: "inbox", noiDung: "Các bác inbox {PAGE_NAME} để em check size nhanh nhé!", bat: true, suaLuc: "" }
    ],
    updatedAt: ""
  };
}

/** What a person typed in the composer, cleaned. Field names are wire (OMI sends them). */
export interface JobInput {
  trang: string;
  noiDung: string;
  lienKet: string;
  anh: string[];
  anhBinhLuan: string[];
  nenChu: string;
  lichDang: string;
  binhLuan: { cheDo: CommentMode; mauId: string; chu: string };
  nguon: { maLo: string; maBai: string; maKhoBai: string; maSP: string[] };
}

export function cleanInput(body: unknown): JobInput {
  const o = asObject(body);
  const comment = asObject(o["binhLuan"]);
  const source = asObject(o["nguon"]);
  const mode = text(comment["cheDo"]) as CommentMode;
  const when = text(o["lichDang"], 40);
  const whenMs = when === "" ? NaN : Date.parse(when);
  return {
    trang: text(o["trang"], 64),
    noiDung: text(o["noiDung"], 63000),
    lienKet: /^https?:\/\//i.test(text(o["lienKet"], 2000)) ? text(o["lienKet"], 2000) : "",
    anh: (Array.isArray(o["anh"]) ? o["anh"] : []).map((a) => text(a, 2000)).filter((a) => /^https?:\/\//i.test(a) || a.startsWith("/")),
    anhBinhLuan: (Array.isArray(o["anhBinhLuan"]) ? o["anhBinhLuan"] : []).map((a) => text(a, 2000)).filter((a) => /^https?:\/\//i.test(a) || a.startsWith("/")).slice(0, 30),
    nenChu: /^\d{6,20}$/.test(text(o["nenChu"], 20)) ? text(o["nenChu"], 20) : "",
    lichDang: Number.isFinite(whenMs) ? new Date(whenMs).toISOString() : "",
    binhLuan: { cheDo: COMMENT_MODES.includes(mode) ? mode : "none", mauId: text(comment["mauId"], 80), chu: text(comment["chu"], 8000) },
    nguon: {
      maLo: text(source["maLo"], 80), maBai: text(source["maBai"], 120), maKhoBai: text(source["maKhoBai"], 120),
      maSP: (Array.isArray(source["maSP"]) ? source["maSP"] : []).map((c) => text(c, 80)).filter(Boolean).slice(0, 20)
    }
  };
}

/** Desk `postImageCountError`: a post without pictures is fine, a thin album is not. */
export function imageCountError(images: readonly string[]): string {
  if (images.length === 0 || images.length >= MIN_POST_IMAGES) {
    return images.length > MAX_POST_IMAGES ? `Album tối đa ${MAX_POST_IMAGES} ảnh (đang có ${images.length}).` : "";
  }
  return `Bài có ảnh cần tối thiểu ${MIN_POST_IMAGES} ảnh (đang có ${images.length}) — bù thêm ảnh gallery của sản phẩm trong bài.`;
}

/** Why this input may NOT go to Meta; "" when it may. `mode` is `now` or `schedule`. */
export function publishRefusal(input: JobInput, mode: "now" | "schedule", nowMs: number, templateOk: boolean): string {
  if (input.trang === "") return "Cần chọn Fanpage trước khi đăng bài.";
  if (input.noiDung === "" && input.lienKet === "" && input.anh.length === 0) return "Bài đăng cần có nội dung, link hoặc ảnh.";
  if (input.nenChu !== "" && input.noiDung === "") return "Bài nền màu cần có nội dung chữ.";
  const images = imageCountError(input.anh);
  if (images !== "") return images;
  if (input.binhLuan.cheDo === "template" && !templateOk) return "Comment mẫu không tồn tại hoặc đã tắt.";
  if (input.binhLuan.cheDo === "custom" && input.binhLuan.chu === "") return "Hãy nhập nội dung comment riêng.";
  if (mode === "schedule") {
    if (input.lichDang === "") return "Lên lịch cần chọn ngày giờ đăng.";
    if (Date.parse(input.lichDang) < nowMs + SCHEDULE_LEAD_MINUTES * 60 * 1000) return `Lịch Meta cần cách thời điểm hiện tại ít nhất ${SCHEDULE_LEAD_MINUTES} phút.`;
  }
  return "";
}

export function commentState(input: JobInput, template: CommentTemplate | null): JobComment {
  const mode = input.binhLuan.cheDo;
  const body = mode === "custom" ? input.binhLuan.chu : mode === "template" ? template?.noiDung ?? "" : "";
  return { cheDo: mode, mauId: input.binhLuan.mauId, chu: body, trangThai: mode === "none" || body === "" ? "disabled" : "pending", maBinhLuan: "", chuDaDang: "", loi: "" };
}

export interface TagValues { shopLink: string; productLink: string; productName: string; productCode: string; pageName: string }

/** Desk tags: {SHOP_LINK}, {PRODUCT_LINK}, {PRODUCT_NAME}, {PRODUCT_CODE}, {PAGE_NAME}. */
export function renderTags(template: string, values: TagValues): string {
  return String(template ?? "")
    .replace(/\{SHOP_LINK\}/g, values.shopLink)
    .replace(/\{PRODUCT_LINK\}/g, values.productLink || values.shopLink)
    .replace(/\{PRODUCT_NAME\}/g, values.productName)
    .replace(/\{PRODUCT_CODE\}/g, values.productCode)
    .replace(/\{PAGE_NAME\}/g, values.pageName)
    .trim();
}

export function newJob(id: string, input: JobInput, pageName: string, template: CommentTemplate | null, at: string): PublishJob {
  return {
    id, trang: input.trang, tenTrang: pageName, noiDung: input.noiDung, lienKet: input.lienKet, anh: [...input.anh], anhBinhLuan: input.anhBinhLuan.map((url) => ({ url, trangThai: "pending", loi: "" })), nenChu: input.nenChu, lichDang: input.lichDang,
    trangThai: "draft", maMeta: "", maBaiMeta: "", duongDan: "", dangLuc: "", loi: "",
    binhLuan: commentState(input, template), nguon: { ...input.nguon, maSP: [...input.nguon.maSP] }, soLieu: null,
    taoLuc: at, suaLuc: at, dongBoLuc: ""
  };
}

/** Puts a job in the book (newest first, bounded). */
export function putJob(book: Partial<JobBook> | null, job: PublishJob, at: string): JobBook {
  const others = (Array.isArray(book?.lenh) ? book.lenh : []).filter((j) => j.id !== job.id);
  return { version: 1, lenh: [job, ...others].sort((a, b) => b.taoLuc.localeCompare(a.taoLuc)).slice(0, JOBS_KEEP), updatedAt: at };
}

export function dropJob(book: Partial<JobBook> | null, id: string, at: string): JobBook {
  return { version: 1, lenh: (Array.isArray(book?.lenh) ? book.lenh : []).filter((j) => j.id !== id), updatedAt: at };
}

/** Desk's tabs: scheduled counts the tool queue too; cancelled counts deleted. */
export function statusCounts(jobs: readonly PublishJob[]): Record<string, number> {
  const out: Record<string, number> = { all: jobs.length, scheduled: 0, published: 0, draft: 0, failed: 0, cancelled: 0 };
  for (const j of jobs) {
    const key = j.trangThai === "deleted" ? "cancelled" : j.trangThai;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

export function filterJobs(jobs: readonly PublishJob[], filter: { trangThai?: string | undefined; trang?: string | undefined; q?: string | undefined }): PublishJob[] {
  const status = text(filter.trangThai) || "all";
  const page = text(filter.trang);
  const q = fold(filter.q ?? "");
  return jobs.filter((j) => {
    const effective = j.trangThai === "deleted" ? "cancelled" : j.trangThai;
    if (status !== "all" && effective !== status) return false;
    if (page !== "" && page !== "all" && j.trang !== page) return false;
    return q === "" || fold(`${j.tenTrang} ${j.noiDung}`).includes(q);
  });
}

export function fold(v: string): string {
  return String(v ?? "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").trim();
}

export function saveTemplate(book: Partial<TemplateBook> | null, body: unknown, id: string, at: string): { book: TemplateBook; item: CommentTemplate } | { error: string } {
  const o = asObject(body);
  const name = text(o["ten"], 120);
  const content = text(o["noiDung"], 4000);
  if (name === "" || content === "") return { error: "Cần tên mẫu và nội dung." };
  const group = text(o["nhom"]);
  const current = Array.isArray(book?.mau) ? book.mau : defaultTemplateBook().mau;
  const wanted = text(o["id"], 80);
  const existing = current.find((m) => m.id === wanted);
  const item: CommentTemplate = {
    id: existing?.id ?? id, ten: name, noiDung: content,
    nhom: (TEMPLATE_CATEGORIES as readonly string[]).includes(group) ? group : "shop_link",
    bat: o["bat"] === false ? false : true, suaLuc: at
  };
  const mau = existing ? current.map((m) => (m.id === item.id ? item : m)) : [item, ...current];
  return { book: { version: 1, mau: mau.slice(0, 100), updatedAt: at }, item };
}

export function templatesOf(book: Partial<TemplateBook> | null): CommentTemplate[] {
  return Array.isArray(book?.mau) ? book.mau : defaultTemplateBook().mau;
}

/** Desk `contentPerformance` in one number: reactions + 2×comments + 3×shares against reach. */
export function performanceScore(m: JobMetrics | null): { diem: number; nhan: string } | null {
  if (m === null) return null;
  const engaged = m.camXuc + 2 * m.binhLuan + 3 * m.chiaSe;
  const rate = m.tiepCan > 0 ? engaged / m.tiepCan : 0;
  const diem = Math.max(0, Math.min(100, Math.round(rate * 1000)));
  return { diem, nhan: diem >= 60 ? "tốt" : diem >= 40 ? "khá" : "thấp" };
}

/** Desk `FACEBOOK_TEXT_BACKGROUND_PRESETS`: Facebook's own ids; the screen draws the swatch. */
export const TEXT_PRESETS: readonly { id: string; label: string }[] = [
  { id: "303063890126415", label: "Gradient vàng-cam-hồng" }, { id: "175493843120364", label: "Gradient hồng-vàng" },
  { id: "1777259169190672", label: "Gradient tím-hồng" }, { id: "901751159967576", label: "Gradient cam-đỏ" },
  { id: "446330032368780", label: "Gradient đỏ" }, { id: "249307305544279", label: "Gradient đỏ-xanh" },
  { id: "688479024672716", label: "Gradient xanh ngọc" }, { id: "106018623298955", label: "Tím trơn" },
  { id: "219266485227663", label: "Hồng cánh sen" }, { id: "1903718606535395", label: "Đỏ trơn" },
  { id: "217761075370932", label: "Xanh dương" }, { id: "1881421442117417", label: "Đen" }
];
