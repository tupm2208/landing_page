/**
 * @file MODULE PUBLISHING ("dang-bai") — Đ8, tier "content": the posts really go to Facebook.
 *
 * Sales Desk's "Bài đã đăng" tab, the composer, the comment templates, "comment phủ link" and the
 * product cards, on the shop's own server:
 *
 *   - publish now / schedule on META (Meta keeps the schedule, the landing may sleep) / edit / cancel
 *     / publish a scheduled post now / delete / sync status and numbers / retry failed comments;
 *   - an album needs at least 5 pictures; pictures are public addresses on this landing, which Meta
 *     downloads — rendered cards and uploaded photos live in the upload zone below;
 *   - the first comment from a template with dynamic tags, posted once the post is live;
 *   - "comment phủ link": a sale link under every NEW post, topic → link, rotating sentences;
 *   - product cards and the cover with the hook's words (`sharp`), in the SHOP'S brand.
 *
 * Page tokens stay in `hop-thu` (`hop-thu.pageAccess`), read server-side only. `xuong-noi-dung`
 * schedules a whole day through the services below.
 *
 * Nothing runs on a timer inside the landing (shared hosting sleeps): `POST /api/dang-bai/nhip`
 * syncs posts and runs the link comments; OMI calls it while the Content screen is open and a cron
 * with a service key may call it too.
 */

import crypto from "node:crypto";
import { ACCESS, defineModule, reply, type ModuleContext } from "../../contract";
import type { InboxServices } from "../hop-thu/module";
import type { InventoryServices } from "../hang-kho/module";
import { bytesFromDataUrl } from "../../shared/data-url";
import {
  JOB_DOCUMENT, STATUS_LABEL, TEMPLATE_DOCUMENT, cleanInput, defaultJobBook, defaultTemplateBook, dropJob, filterJobs, imageCountError, newJob,
  TEXT_PRESETS, performanceScore, publishRefusal, putJob, renderTags, saveTemplate, statusCounts, templatesOf, commentState,
  type JobBook, type JobInput, type PublishJob, type TemplateBook
} from "./publish-jobs";
import { GraphError, GraphPublisher, isBlockingGraphError } from "./graph-publisher";
import {
  SEED_DOCUMENT, dueEntries, fallbackSeedTopic, patchSeedConfig, pauseSeed, pickSeedTopic, pickSeedVariant, publicSeedStore, readSeedStore,
  recordNewPosts, renderSeedComment, trackedLink, trimLedger, type SeedStore
} from "./seed-comments";
import { BRAND_DOCUMENT, SharpRenderer, cleanBrand, formatPrice, type BrandConfig, type PictureRenderer } from "./card-renderer";

const TEN_MINUTES = 10 * 60 * 1000;
const NO_STORE = { "Cache-Control": "no-store" };
const MEDIA_ZONE = "dang-bai/anh";
const SYNC_PER_RUN = 30;

export interface Config {
  /** The shop's public origin: Meta downloads pictures from it, links in comments point at it. */
  siteUrl?: string;
  /** Signs `tr_sig` on link comments (same secret `thong-ke` checks). */
  attributionSecret?: string;
}

interface Services {
  "hop-thu"?: Pick<InboxServices, "pageAccess">;
  "hang-kho"?: Pick<InventoryServices, "search" | "read">;
}

type Ctx = ModuleContext<Config, Services>;

/** What `xuong-noi-dung` may ask of this module. */
export interface PublishingServices {
  publish(input: { mode: "draft" | "now" | "schedule" } & Record<string, unknown>): Promise<{ ok: boolean; job?: PublishJob; message: string }>;
  renderCover(input: { main: string; sub?: string; key?: string }): Promise<{ ok: boolean; url: string; message: string }>;
  renderCard(input: { ma: string; anh?: string }): Promise<{ ok: boolean; url: string; message: string }>;
  jobs(): Promise<PublishJob[]>;
}

let renderer: PictureRenderer = new SharpRenderer();
/** Tests swap the picture renderer (no native library needed); production keeps `sharp`. */
export function usePictureRenderer(next: PictureRenderer): void { renderer = next; }

const text = (v: unknown, n = 2000): string => String(v ?? "").trim().slice(0, n);
const asObject = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const jobDocument = (ctx: Ctx) => ctx.ports.store.document<JobBook>(JOB_DOCUMENT);
const templateDocument = (ctx: Ctx) => ctx.ports.store.document<TemplateBook>(TEMPLATE_DOCUMENT);
const seedDocument = (ctx: Ctx) => ctx.ports.store.document<SeedStore>(SEED_DOCUMENT);
const site = (ctx: Ctx): string => text(ctx.config.siteUrl).replace(/\/+$/, "");
const nowIso = (ctx: Ctx): string => ctx.ports.clock.now().toISOString();

async function brand(ctx: Ctx): Promise<BrandConfig> {
  return cleanBrand(await ctx.ports.store.document<unknown>(BRAND_DOCUMENT).read(null), site(ctx));
}

/** `/api/dang-bai/anh/x.jpg` → `https://shop.vn/api/dang-bai/anh/x.jpg`. Meta cannot fetch a relative path. */
function absolute(ctx: Ctx, url: string): string {
  return url.startsWith("/") ? `${site(ctx)}${url}` : url;
}

async function pages(ctx: Ctx): Promise<{ graph: string; trang: { ma: string; ten: string; token: string }[] }> {
  const access = ctx.services["hop-thu"]?.pageAccess;
  return access ? await access() : { graph: "v21.0", trang: [] };
}

async function publisherFor(ctx: Ctx, pageId: string): Promise<{ publisher: GraphPublisher; ten: string } | null> {
  const all = await pages(ctx);
  const page = all.trang.find((p) => p.ma === pageId);
  return page ? { publisher: new GraphPublisher(ctx.ports.http, page.token, all.graph), ten: page.ten } : null;
}

async function saveJob(ctx: Ctx, job: PublishJob): Promise<void> {
  const at = nowIso(ctx);
  await jobDocument(ctx).update((current) => putJob(current, { ...job, suaLuc: at }, at), defaultJobBook());
}

async function findJob(ctx: Ctx, id: string): Promise<PublishJob | null> {
  return ((await jobDocument(ctx).read(null))?.lenh ?? []).find((j) => j.id === id) ?? null;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Posts the first comment once the post is live. Never throws; the verdict lands on the job. */
async function postFirstComment(ctx: Ctx, job: PublishJob, publisher: GraphPublisher): Promise<void> {
  if (job.trangThai !== "published" || job.maBaiMeta === "") return;
  await postTextComment(ctx, job, publisher);
  // Desk "Ảnh sẽ comment lần lượt": in order, stop at the first refusal so the order is never broken.
  for (const picture of job.anhBinhLuan ?? []) {
    if (picture.trangThai === "published") continue;
    try {
      await publisher.comment(job.maBaiMeta, "", absolute(ctx, picture.url));
      picture.trangThai = "published";
      picture.loi = "";
    } catch (e) {
      picture.trangThai = "failed";
      picture.loi = message(e);
      break;
    }
  }
}

async function postTextComment(ctx: Ctx, job: PublishJob, publisher: GraphPublisher): Promise<void> {
  if (job.binhLuan.trangThai !== "pending") return;
  const code = job.nguon.maSP[0] ?? "";
  const item = code && ctx.services["hang-kho"]?.read ? await ctx.services["hang-kho"].read(code).catch(() => null) : null;
  const rendered = renderTags(job.binhLuan.chu, {
    shopLink: site(ctx), productLink: item ? `${site(ctx)}/product/${encodeURIComponent(item.slug || item.code)}` : "",
    productName: item?.name ?? "", productCode: code, pageName: job.tenTrang
  });
  try {
    job.binhLuan.maBinhLuan = await publisher.comment(job.maBaiMeta, rendered);
    job.binhLuan = { ...job.binhLuan, trangThai: "published", chuDaDang: rendered, loi: "" };
  } catch (e) {
    job.binhLuan = { ...job.binhLuan, trangThai: "failed", loi: message(e) };
  }
}

/** Sends a job to Meta (album → post), now or on Meta's schedule. The job comes back with its fate. */
async function submit(ctx: Ctx, job: PublishJob, mode: "now" | "schedule"): Promise<PublishJob> {
  const access = await publisherFor(ctx, job.trang);
  const next: PublishJob = { ...job, loi: "", tenTrang: access?.ten || job.tenTrang };
  if (access === null) return { ...next, trangThai: "failed", loi: "Chưa có Fanpage / token để đăng bài — kết nối trang ở màn Kết nối." };
  try {
    const mediaIds: string[] = [];
    for (const picture of job.anh) mediaIds.push(await access.publisher.uploadPhoto(job.trang, absolute(ctx, picture)));
    const created = await access.publisher.createPost(job.trang, {
      message: job.noiDung, link: job.lienKet, mediaIds, textPreset: job.nenChu,
      scheduledUnix: mode === "schedule" ? Math.floor(Date.parse(job.lichDang) / 1000) : 0
    });
    next.maMeta = created.maMeta;
    next.maBaiMeta = created.maBai;
    next.trangThai = mode === "schedule" ? "scheduled" : "published";
    next.dangLuc = mode === "schedule" ? "" : nowIso(ctx);
    if (mode === "now") await postFirstComment(ctx, next, access.publisher);
    ctx.ports.logger.info(`[dang-bai] ${next.id} ${mode === "schedule" ? `len lich ${job.lichDang}` : "dang ngay"} tren trang ${job.trang}: ${mediaIds.length} anh`);
  } catch (e) {
    next.trangThai = "failed";
    next.loi = message(e);
    ctx.ports.logger.warn(`[dang-bai] ${next.id} Meta tu choi: ${next.loi}`);
  }
  return next;
}

/** Create (draft / now / schedule). Validation first: a refused job never half-uploads an album. */
async function createJob(ctx: Ctx, body: Record<string, unknown>, mode: string): Promise<{ ok: boolean; status: number; job?: PublishJob; message: string }> {
  const input = cleanInput(body);
  const templates = templatesOf(await templateDocument(ctx).read(null));
  const template = templates.find((t) => t.id === input.binhLuan.mauId && t.bat) ?? null;
  const page = (await pages(ctx)).trang.find((p) => p.ma === input.trang);
  const job = newJob(`fbpub_${crypto.randomUUID()}`, input, page?.ten ?? "", template, nowIso(ctx));
  if (mode === "draft") {
    await saveJob(ctx, job);
    return { ok: true, status: 200, job, message: "Đã lưu nháp — bài chưa gửi lên Meta." };
  }
  const how = mode === "schedule" ? "schedule" : "now";
  const refusal = publishRefusal(input, how, ctx.ports.clock.now().getTime(), template !== null);
  if (refusal !== "") return { ok: false, status: 400, message: refusal };
  const done = await submit(ctx, job, how);
  await saveJob(ctx, done);
  if (done.trangThai === "failed") return { ok: false, status: 502, job: done, message: done.loi };
  return { ok: true, status: 200, job: done, message: how === "schedule" ? "Meta đã nhận lịch đăng bài." : "Đã đăng bài lên Facebook." };
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Desk `updateFacebookPublishJob`, by status. */
async function updateJob(ctx: Ctx, job: PublishJob, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; job?: PublishJob; message: string }> {
  const mode = text(body["mode"]);
  const input: JobInput = cleanInput({ ...body, trang: body["trang"] ?? job.trang });
  const templates = templatesOf(await templateDocument(ctx).read(null));
  const template = templates.find((t) => t.id === input.binhLuan.mauId && t.bat) ?? null;
  const nowMs = ctx.ports.clock.now().getTime();

  if (job.trangThai === "draft" || job.trangThai === "failed" || job.trangThai === "cancelled") {
    const edited: PublishJob = { ...job, trang: input.trang, noiDung: input.noiDung, lienKet: input.lienKet, anh: input.anh, nenChu: input.nenChu, anhBinhLuan: input.anhBinhLuan.map((url) => ({ url, trangThai: "pending", loi: "" })), lichDang: input.lichDang, binhLuan: commentState(input, template), loi: "" };
    if (mode === "schedule" || mode === "now") {
      const refusal = publishRefusal(input, mode, nowMs, template !== null);
      if (refusal !== "") return { ok: false, status: 400, message: refusal };
      const done = await submit(ctx, { ...edited, maMeta: "", maBaiMeta: "", duongDan: "", lichDang: mode === "now" ? "" : input.lichDang }, mode);
      await saveJob(ctx, done);
      return done.trangThai === "failed" ? { ok: false, status: 502, job: done, message: done.loi } : { ok: true, status: 200, job: done, message: mode === "now" ? "Đã đăng bài lên Facebook." : "Meta đã nhận lịch đăng bài." };
    }
    const saved = { ...edited, trangThai: job.trangThai === "draft" ? "draft" as const : job.trangThai };
    await saveJob(ctx, saved);
    return { ok: true, status: 200, job: saved, message: "Đã cập nhật nháp." };
  }

  const access = await publisherFor(ctx, job.trang);
  if (access === null) return { ok: false, status: 409, message: "Trang của bài không còn token — kết nối lại Fanpage." };

  if (job.trangThai === "scheduled") {
    const whenChanged = input.lichDang !== "" && input.lichDang !== job.lichDang;
    if (whenChanged && Date.parse(input.lichDang) < nowMs + 10 * 60 * 1000) return { ok: false, status: 400, message: "Lịch Meta cần cách thời điểm hiện tại ít nhất 10 phút." };
    const imagesChanged = !sameList(input.anh, job.anh) || input.lienKet !== job.lienKet;
    try {
      if (imagesChanged) {
        const images = imageCountError(input.anh);
        if (images !== "") return { ok: false, status: 400, message: images };
        // Meta cannot swap the pictures of a scheduled post: cancel it and schedule the new one in the same press.
        await access.publisher.remove(job.maMeta);
        const redone = await submit(ctx, { ...job, noiDung: input.noiDung, lienKet: input.lienKet, anh: input.anh, lichDang: input.lichDang || job.lichDang, binhLuan: commentState(input, template) }, "schedule");
        await saveJob(ctx, redone);
        return redone.trangThai === "failed" ? { ok: false, status: 502, job: redone, message: redone.loi } : { ok: true, status: 200, job: redone, message: "Đã huỷ lịch cũ trên Meta và lên lịch lại với ảnh mới." };
      }
      await access.publisher.updatePost(job.maMeta, { message: input.noiDung, ...(whenChanged ? { scheduledUnix: Math.floor(Date.parse(input.lichDang) / 1000) } : {}) });
    } catch (e) {
      return { ok: false, status: 502, message: message(e) };
    }
    const saved: PublishJob = { ...job, noiDung: input.noiDung, lichDang: whenChanged ? input.lichDang : job.lichDang, binhLuan: commentState(input, template) };
    await saveJob(ctx, saved);
    return { ok: true, status: 200, job: saved, message: "Đã cập nhật bài đang chờ đăng trên Meta." };
  }

  if (job.trangThai === "published") {
    try {
      await access.publisher.updatePost(job.maBaiMeta, { message: input.noiDung });
    } catch (e) {
      return { ok: false, status: 502, message: message(e) };
    }
    const saved: PublishJob = { ...job, noiDung: input.noiDung };
    await saveJob(ctx, saved);
    return { ok: true, status: 200, job: saved, message: "Đã lưu chữ mới — ảnh bài đã đăng Meta khoá." };
  }
  return { ok: false, status: 409, message: "Bài đã xoá không sửa được." };
}

/** Reads scheduled / published posts back from Meta; runs first comments that were waiting. */
async function syncJobs(ctx: Ctx, onlyId = ""): Promise<{ soBai: number; daDang: number; loi: string[] }> {
  const book = await jobDocument(ctx).read(null);
  const targets = (book?.lenh ?? []).filter((j) => (onlyId === "" || j.id === onlyId) && (j.trangThai === "scheduled" || j.trangThai === "published") && (j.maBaiMeta || j.maMeta)).slice(0, SYNC_PER_RUN);
  let published = 0;
  const errors: string[] = [];
  for (const job of targets) {
    const access = await publisherFor(ctx, job.trang);
    if (access === null) { errors.push(`${job.tenTrang || job.trang}: chưa có token`); continue; }
    const next: PublishJob = { ...job, dongBoLuc: nowIso(ctx) };
    try {
      const reading = await access.publisher.readPost(job.maBaiMeta || job.maMeta);
      if (reading.daDang && job.trangThai === "scheduled") {
        next.trangThai = "published";
        next.dangLuc = reading.taoLuc || job.lichDang;
        published += 1;
      }
      next.duongDan = reading.duongDan || job.duongDan;
      if (reading.daDang) next.soLieu = { tiepCan: reading.tiepCan, camXuc: reading.camXuc, binhLuan: reading.binhLuan, chiaSe: reading.chiaSe, luc: nowIso(ctx) };
      await postFirstComment(ctx, next, access.publisher);
    } catch (e) {
      errors.push(`${job.id}: ${message(e)}`);
      if (e instanceof GraphError && e.code === 100 && job.trangThai === "scheduled") { next.trangThai = "cancelled"; next.loi = "Meta không còn bài này (đã huỷ ngoài OMI)."; }
    }
    await saveJob(ctx, next);
  }
  return { soBai: targets.length, daDang: published, loi: errors };
}

// ------------------------------------------------------------------ link comments

async function readSeed(ctx: Ctx): Promise<SeedStore> {
  return readSeedStore(await seedDocument(ctx).read(null), site(ctx));
}

/** One pass: record new posts of the chosen pages, comment on those whose wait is over. */
async function runSeed(ctx: Ctx): Promise<string> {
  const store = await readSeed(ctx);
  const settings = store.config.settings;
  if (!settings.enabled || settings.paused || store.ledger.enabledAt === "") return "Chưa bật hoặc đang tạm dừng.";
  const all = await pages(ctx);
  const chosen = all.trang.filter((p) => settings.pageIds.length === 0 || settings.pageIds.includes(p.ma));
  if (chosen.length === 0) return "Chưa có fanpage nào đủ điều kiện.";
  const jobs = (await jobDocument(ctx).read(null))?.lenh ?? [];
  const commented = new Set(jobs.filter((j) => j.binhLuan.trangThai === "published").map((j) => j.maBaiMeta));
  const nowMs = ctx.ports.clock.now().getTime();
  const spread = Math.max(1, settings.delayMaxMs - settings.delayMinMs);
  let added = 0;
  for (const page of chosen) {
    try {
      const posts = await new GraphPublisher(ctx.ports.http, page.token, all.graph).publishedPosts(page.ma, 10);
      added += recordNewPosts(store, page, posts, commented, () => settings.delayMinMs + crypto.randomInt(spread));
    } catch (e) {
      if (e instanceof GraphError && isBlockingGraphError(e.code)) { pauseSeed(store, e.message); break; }
    }
  }
  const today = nowIso(ctx).slice(0, 10);
  if (store.ledger.daily.date !== today) store.ledger.daily = { date: today, count: 0 };
  let posted = 0;
  for (const [postId, entry] of dueEntries(store, nowMs)) {
    if (store.config.settings.paused || store.ledger.daily.count >= settings.maxPerDay) break;
    const page = chosen.find((p) => p.ma === entry.pageId);
    if (!page) continue;
    const topic = pickSeedTopic(entry.excerpt, store.config.topics) ?? store.config.topics.find((t) => t.keywords.length === 0) ?? fallbackSeedTopic(site(ctx));
    const variant = pickSeedVariant(store.config.variants, store.ledger.variantCursor);
    store.ledger.variantCursor = variant.nextCursor;
    entry.trackingId ??= `fbseed_${crypto.randomUUID()}`;
    const link = trackedLink(topic.link, { pageId: entry.pageId, postId, topicId: topic.id, trackingId: entry.trackingId }, text(ctx.config.attributionSecret));
    const body = renderSeedComment(variant.template, { label: topic.label, link });
    entry.topicId = topic.id;
    entry.trackedLink = link;
    if (body === "") { entry.status = "failed"; entry.error = "Mẫu comment rỗng."; continue; }
    try {
      entry.commentId = await new GraphPublisher(ctx.ports.http, page.token, all.graph).comment(postId, body);
      entry.status = "published";
      entry.postedAt = nowIso(ctx);
      entry.renderedText = body;
      entry.error = "";
      store.ledger.daily.count += 1;
      posted += 1;
    } catch (e) {
      if (e instanceof GraphError && isBlockingGraphError(e.code)) { pauseSeed(store, e.message); entry.error = e.message; }
      else { entry.status = "failed"; entry.error = message(e); }
    }
  }
  trimLedger(store, nowMs);
  await seedDocument(ctx).write(store);
  return `Đã quét: ${added} bài mới, ${posted} comment.${store.config.settings.paused ? ` Tạm dừng: ${store.config.settings.pausedReason}` : ""}`;
}

// ------------------------------------------------------------------ pictures

async function savePicture(ctx: Ctx, bytes: Buffer, hint: string): Promise<string> {
  const saved = await ctx.ports.uploads.saveImage(MEDIA_ZONE, bytes, hint);
  return `/api/dang-bai/anh/${saved.name}`;
}

async function fetchBytes(ctx: Ctx, url: string): Promise<Buffer> {
  const response = await ctx.ports.http.fetch(absolute(ctx, url), { method: "GET", timeoutMs: 20000 });
  if (!response.ok || !response.arrayBuffer) throw new Error(`Không tải được ảnh ${url} (HTTP ${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

async function renderCard(ctx: Ctx, code: string, picture: string): Promise<{ ok: boolean; url: string; message: string }> {
  const item = ctx.services["hang-kho"]?.read ? await ctx.services["hang-kho"].read(code) : null;
  if (item === null) return { ok: false, url: "", message: `Không thấy mã ${code} trong danh mục.` };
  const photo = picture || item.highImage || item.thumbnailImage || item.galleryImages[0] || "";
  if (photo === "") return { ok: false, url: "", message: `Mã ${code} chưa có ảnh.` };
  try {
    const bytes = await renderer.card(await fetchBytes(ctx, photo), {
      code: item.code, name: item.name, salePrice: Number(item.salePrice || item.price || 0), listPrice: Number(item.listPrice || 0),
      sizes: item.sizes.filter((s) => Number(s.qty ?? 0) > 0).map((s) => String(s.size))
    }, await brand(ctx));
    return { ok: true, url: await savePicture(ctx, bytes, "the"), message: "Đã sinh card." };
  } catch (e) {
    return { ok: false, url: "", message: message(e) };
  }
}

interface CardRow { code: string; name: string; brand: string; thumb: string; gallery: string[]; priceText: string; salePercent: number; sourceId: string; sourceLabel: string; type: string; sport: string; salePrice: number }

async function searchCards(ctx: Ctx, query: Record<string, string | undefined>): Promise<{ products: CardRow[]; filters: Record<string, { id: string; label: string }[]> }> {
  const items = ctx.services["hang-kho"]?.search ? await ctx.services["hang-kho"].search({ query: text(query["q"], 120), limit: 2000 }) : [];
  const inStock = items.filter((i) => i.sizes.some((s) => Number(s.qty ?? 0) > 0));
  const rows: CardRow[] = inStock.map((i) => {
    const sale = Number(i.salePrice || i.price || 0);
    const list = Number(i.listPrice || 0);
    const percent = Number(i.discountPercent) || (list > sale && sale > 0 ? Math.round((1 - sale / list) * 100) : 0);
    return {
      code: i.code, name: i.name, brand: i.brand, thumb: i.thumbnailImage, gallery: i.galleryImages.slice(0, 12),
      priceText: formatPrice(sale), salePercent: percent, salePrice: sale,
      sourceId: i.partnerCampaign ? "campaign" : i.source === "partner" ? "partner" : "landing",
      sourceLabel: i.partnerCampaign ? "Campaign" : i.source === "partner" ? "Hàng đối tác" : "Hàng landing",
      type: i.productKind, sport: i.category
    };
  });
  const options = (values: string[]) => [...new Set(values.filter(Boolean))].sort().map((v) => ({ id: v, label: v }));
  const filters = {
    brands: options(rows.map((r) => r.brand)), types: options(rows.map((r) => r.type)), sports: options(rows.map((r) => r.sport)),
    sources: [{ id: "landing", label: "Hàng landing" }, { id: "partner", label: "Hàng đối tác" }, { id: "campaign", label: "Campaign" }]
  };
  const pick = (key: keyof CardRow, want: string | undefined) => (r: CardRow) => text(want) === "" || String(r[key]) === text(want);
  const sort = text(query["sort"]) || "sale-desc";
  const products = rows.filter(pick("brand", query["brand"])).filter(pick("type", query["type"])).filter(pick("sport", query["sport"])).filter(pick("sourceId", query["source"]))
    .sort((a, b) => sort === "price-asc" ? a.salePrice - b.salePrice : sort === "price-desc" ? b.salePrice - a.salePrice : b.salePercent - a.salePercent)
    .slice(0, 30);
  return { products, filters };
}

function jobView(job: PublishJob): Record<string, unknown> {
  return { ...job, nhanTrangThai: STATUS_LABEL[job.trangThai] ?? job.trangThai, hieuQua: performanceScore(job.soLieu) };
}

function refusal(status: number, text: string, extra: Record<string, unknown> = {}) {
  return reply.json({ ok: false, message: text, ...extra }, status, NO_STORE);
}

export const manifest = defineModule<Config, Services>({
  id: "dang-bai",
  name: "Đăng bài Facebook",
  tier: "content",
  runsOn: "server-khach",
  feature: "xuong-noi-dung",
  version: "0.1.0",
  ports: ["store", "logger", "clock", "http", "config", "uploads"],
  requiresOptional: ["hop-thu.pageAccess", "hang-kho.search", "hang-kho.read"],

  provides: {
    "dang-bai.publish": async (ctx, input: Record<string, unknown>) => {
      const r = await createJob(ctx, input, text(input?.["mode"]) || "draft");
      return { ok: r.ok, ...(r.job ? { job: r.job } : {}), message: r.message };
    },
    "dang-bai.renderCover": async (ctx, input: { main: string; sub?: string; key?: string }) => {
      try {
        const bytes = await renderer.cover({ main: text(input?.main, 200), sub: text(input?.sub, 120), key: text(input?.key, 60) }, await brand(ctx));
        return { ok: true, url: await savePicture(ctx, bytes, "bia"), message: "" };
      } catch (e) {
        return { ok: false, url: "", message: message(e) };
      }
    },
    "dang-bai.renderCard": (ctx, input: { ma: string; anh?: string }) => renderCard(ctx, text(input?.ma, 80), text(input?.anh, 2000)),
    "dang-bai.jobs": async (ctx) => (await jobDocument(ctx).read(null))?.lenh ?? []
  },

  routes: [
    {
      // "Bài đã đăng": the list with counts per tab, the comment templates, the pages to choose from.
      method: "GET", path: "/api/dang-bai/bai", access: ACCESS.admin, rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const jobs = (await jobDocument(ctx).read(null))?.lenh ?? [];
        return reply.json({
          ok: true,
          lenh: filterJobs(jobs, { trangThai: request.query["trangThai"], trang: request.query["trang"], q: request.query["q"] }).map(jobView),
          dem: statusCounts(jobs),
          mau: templatesOf(await templateDocument(ctx).read(null)),
          trang: (await pages(ctx)).trang.map((p) => ({ ma: p.ma, ten: p.ten })),
          toiThieuAnh: 5,
          nenChu: TEXT_PRESETS
        }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/dang-bai/bai", access: ACCESS.admin, rateLimit: { calls: 300, windowMs: TEN_MINUTES }, bodyLimit: 128 * 1024,
      handle: async (ctx, request) => {
        const body = asObject(await request.json());
        const r = await createJob(ctx, body, text(body["mode"]) || "draft");
        return reply.json({ ok: r.ok, ...(r.job ? { job: jobView(r.job) } : {}), message: r.message }, r.status, NO_STORE);
      }
    },
    {
      method: "PUT", path: "/api/dang-bai/bai/:ma", access: ACCESS.admin, rateLimit: { calls: 300, windowMs: TEN_MINUTES }, bodyLimit: 128 * 1024,
      handle: async (ctx, request) => {
        const job = await findJob(ctx, text(request.params["ma"], 120));
        if (job === null) return refusal(404, "Không tìm thấy bài cần sửa.");
        const r = await updateJob(ctx, job, asObject(await request.json()));
        return reply.json({ ok: r.ok, ...(r.job ? { job: jobView(r.job) } : {}), message: r.message }, r.status, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/dang-bai/bai/:ma/huy", access: ACCESS.admin, rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const job = await findJob(ctx, text(request.params["ma"], 120));
        if (job === null) return refusal(404, "Không tìm thấy lịch đăng.");
        if (job.trangThai !== "scheduled") return refusal(409, "Chỉ huỷ được bài đang ở trạng thái đã lên lịch.");
        const access = await publisherFor(ctx, job.trang);
        if (access === null || job.maMeta === "") return refusal(409, "Lịch đăng thiếu token hoặc mã Meta.");
        try { await access.publisher.remove(job.maMeta); } catch (e) { return refusal(502, message(e)); }
        const saved: PublishJob = { ...job, trangThai: "cancelled" };
        await saveJob(ctx, saved);
        return reply.json({ ok: true, job: jobView(saved), message: "Đã huỷ lịch đăng trên Meta." }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/dang-bai/bai/:ma/dang-ngay", access: ACCESS.admin, rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const job = await findJob(ctx, text(request.params["ma"], 120));
        if (job === null) return refusal(404, "Không tìm thấy bài.");
        if (job.trangThai !== "scheduled") return refusal(409, "Chỉ bài đang chờ lịch mới đăng ngay được.");
        const access = await publisherFor(ctx, job.trang);
        if (access === null) return refusal(409, "Trang của bài không còn token.");
        try { await access.publisher.publishNow(job.maMeta); } catch (e) { return refusal(502, message(e)); }
        const saved: PublishJob = { ...job, trangThai: "published", dangLuc: nowIso(ctx) };
        await postFirstComment(ctx, saved, access.publisher);
        await saveJob(ctx, saved);
        return reply.json({ ok: true, job: jobView(saved), message: "Đã đăng ngay bài đang chờ lịch." }, 200, NO_STORE);
      }
    },
    {
      // Published → deleted on Facebook too. Draft / failed / cancelled → just gone from the list.
      method: "POST", path: "/api/dang-bai/bai/:ma/xoa", access: ACCESS.admin, rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const job = await findJob(ctx, text(request.params["ma"], 120));
        if (job === null) return refusal(404, "Không tìm thấy bài.");
        if (job.trangThai === "scheduled") return refusal(409, "Bài đang chờ lịch — bấm Hủy lịch trước.");
        if (job.trangThai === "published") {
          const access = await publisherFor(ctx, job.trang);
          if (access === null) return refusal(409, "Trang của bài không còn token.");
          try { await access.publisher.remove(job.maBaiMeta); } catch (e) { return refusal(502, message(e)); }
          const saved: PublishJob = { ...job, trangThai: "deleted" };
          await saveJob(ctx, saved);
          return reply.json({ ok: true, job: jobView(saved), message: "Đã xoá bài trên Facebook." }, 200, NO_STORE);
        }
        await jobDocument(ctx).update((current) => dropJob(current, job.id, nowIso(ctx)), defaultJobBook());
        return reply.json({ ok: true, message: "Đã gỡ khỏi danh sách." }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/dang-bai/dong-bo", access: ACCESS.admin, rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const r = await syncJobs(ctx, text(asObject(await request.json())["ma"], 120));
        return reply.json({ ok: true, ...r, message: `Đã đồng bộ ${r.soBai} bài${r.daDang ? `, ${r.daDang} bài vừa lên sóng` : ""}.${r.loi.length ? ` ${r.loi.length} lỗi.` : ""}` }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/dang-bai/bai/:ma/binh-luan-lai", access: ACCESS.admin, rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const job = await findJob(ctx, text(request.params["ma"], 120));
        if (job === null) return refusal(404, "Không tìm thấy bài đăng.");
        const failedPictures = (job.anhBinhLuan ?? []).some((a) => a.trangThai === "failed");
        if (job.binhLuan.trangThai !== "failed" && !failedPictures) return refusal(409, "Bài này không có comment lỗi.");
        const next: PublishJob = { ...job, binhLuan: job.binhLuan.trangThai === "failed" ? { ...job.binhLuan, trangThai: "pending", loi: "" } : job.binhLuan, anhBinhLuan: (job.anhBinhLuan ?? []).map((a) => (a.trangThai === "failed" ? { ...a, trangThai: "pending", loi: "" } : a)) };
        const access = await publisherFor(ctx, job.trang);
        if (access !== null) await postFirstComment(ctx, next, access.publisher);
        await saveJob(ctx, next);
        return reply.json({ ok: true, job: jobView(next), message: next.binhLuan.trangThai === "published" ? "Đã đăng lại comment." : next.binhLuan.trangThai === "pending" ? "Comment chờ bài lên sóng." : `Vẫn lỗi: ${next.binhLuan.loi}` }, 200, NO_STORE);
      }
    },

    // ----- comment templates -----
    {
      method: "POST", path: "/api/dang-bai/mau-binh-luan", access: ACCESS.admin, rateLimit: { calls: 300, windowMs: TEN_MINUTES }, bodyLimit: 16 * 1024,
      handle: async (ctx, request) => {
        const body = await request.json();
        const holder: { saved: ReturnType<typeof saveTemplate> } = { saved: { error: "" } };
        await templateDocument(ctx).update((current) => {
          holder.saved = saveTemplate(current, body, `mau_${crypto.randomUUID().slice(0, 8)}`, nowIso(ctx));
          return "error" in holder.saved ? undefined : holder.saved.book;
        }, defaultTemplateBook());
        const saved = holder.saved;
        if ("error" in saved) return refusal(400, saved.error);
        return reply.json({ ok: true, mau: saved.item }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/dang-bai/mau-binh-luan/xoa", access: ACCESS.admin, rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const id = text(asObject(await request.json())["id"], 80);
        await templateDocument(ctx).update((current) => ({ version: 1, mau: templatesOf(current).filter((m) => m.id !== id), updatedAt: nowIso(ctx) }), defaultTemplateBook());
        return reply.json({ ok: true, message: "Đã xoá mẫu." }, 200, NO_STORE);
      }
    },

    // ----- link comments -----
    {
      method: "GET", path: "/api/dang-bai/phu-link", access: ACCESS.admin, rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx) => reply.json({ ok: true, ...publicSeedStore(await readSeed(ctx), nowIso(ctx)), trang: (await pages(ctx)).trang.map((p) => ({ ma: p.ma, ten: p.ten })) }, 200, NO_STORE)
    },
    {
      method: "POST", path: "/api/dang-bai/phu-link/cau-hinh", access: ACCESS.admin, rateLimit: { calls: 120, windowMs: TEN_MINUTES }, bodyLimit: 64 * 1024,
      handle: async (ctx, request) => {
        const patched = patchSeedConfig(await readSeed(ctx), asObject(await request.json()), nowIso(ctx));
        if ("error" in patched) return refusal(400, patched.error);
        await seedDocument(ctx).write(patched);
        return reply.json({ ok: true, ...publicSeedStore(patched, nowIso(ctx)), message: "Đã lưu cấu hình." }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/dang-bai/phu-link/quet", access: ACCESS.admin, rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: async (ctx) => {
        const said = await runSeed(ctx);
        return reply.json({ ok: true, ...publicSeedStore(await readSeed(ctx), nowIso(ctx)), message: said }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/dang-bai/phu-link/thu-lai", access: ACCESS.admin, rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const postId = text(asObject(await request.json())["postId"], 120);
        const store = await readSeed(ctx);
        const entry = store.ledger.posts[postId];
        if (!entry) return refusal(404, "Không thấy bài này trong sổ comment.");
        if (entry.status !== "failed") return refusal(409, "Chỉ thử lại được bài đang lỗi.");
        entry.status = "pending";
        entry.error = "";
        entry.dueAt = nowIso(ctx);
        await seedDocument(ctx).write(store);
        return reply.json({ ok: true, message: "Đã đưa lại vào hàng chờ — bấm Quét ngay để gửi." }, 200, NO_STORE);
      }
    },

    // ----- pictures -----
    {
      method: "GET", path: "/api/dang-bai/the-sp/tim", access: ACCESS.admin, rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => reply.json({ ok: true, ...(await searchCards(ctx, request.query)) }, 200, NO_STORE)
    },
    {
      method: "POST", path: "/api/dang-bai/the-sp", access: ACCESS.admin, rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asObject(await request.json());
        const r = await renderCard(ctx, text(body["ma"], 80), text(body["anh"], 2000));
        return reply.json({ ok: r.ok, url: r.url, urlCongKhai: r.url ? absolute(ctx, r.url) : "", message: r.message }, r.ok ? 200 : 400, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/dang-bai/anh-bia", access: ACCESS.admin, rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asObject(await request.json());
        if (text(body["main"]) === "") return refusal(400, "Chưa có chữ in trên ảnh.");
        try {
          const bytes = await renderer.cover({ main: text(body["main"], 200), sub: text(body["sub"], 120), key: text(body["key"], 60) }, await brand(ctx));
          const url = await savePicture(ctx, bytes, "bia");
          return reply.json({ ok: true, url, urlCongKhai: absolute(ctx, url) }, 200, NO_STORE);
        } catch (e) {
          return refusal(500, message(e));
        }
      }
    },
    {
      method: "POST", path: "/api/dang-bai/anh", access: ACCESS.admin, rateLimit: { calls: 300, windowMs: TEN_MINUTES }, bodyLimit: 12 * 1024 * 1024,
      handle: async (ctx, request) => {
        const bytes = bytesFromDataUrl(asObject(await request.json())["anh"]);
        if (!bytes) return refusal(400, "Thiếu ảnh (data URL base64).");
        try {
          const url = await savePicture(ctx, bytes, "tai");
          return reply.json({ ok: true, url, urlCongKhai: absolute(ctx, url) }, 200, NO_STORE);
        } catch (e) {
          const code = (e as { code?: string })?.code;
          if (code) return refusal(400, message(e), { error: code });
          throw e;
        }
      }
    },
    {
      method: "GET", path: "/api/dang-bai/anh/:tep", access: ACCESS.public,
      whyPublic: "Ảnh album bài đăng (card sản phẩm, ảnh bìa, ảnh tải lên): Meta tự tải ảnh về nên không có mã. Chỉ đọc ảnh máy chủ tự đặt tên trong vùng tải lên của module; không liệt kê, không ghi.",
      rateLimit: { calls: 1200, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const file = await ctx.ports.uploads.open(MEDIA_ZONE).read(String(request.params["tep"] ?? ""));
        if (!file) return reply.json({ ok: false, error: "khong_thay" }, 404);
        return reply.file(file.data, file.type, 200, { "Cache-Control": "public, max-age=604800" });
      }
    },
    {
      // Brand recognition is the SHOP'S setting: name, domain, accent, cover colours, badge.
      method: "GET", path: "/api/dang-bai/thuong-hieu", access: ACCESS.admin, rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx) => reply.json({ ok: true, thuongHieu: await brand(ctx) }, 200, NO_STORE)
    },
    {
      method: "POST", path: "/api/dang-bai/thuong-hieu", access: ACCESS.admin, rateLimit: { calls: 120, windowMs: TEN_MINUTES }, bodyLimit: 8 * 1024,
      handle: async (ctx, request) => {
        const cleaned = cleanBrand(await request.json(), site(ctx));
        await ctx.ports.store.document<BrandConfig>(BRAND_DOCUMENT).write(cleaned);
        return reply.json({ ok: true, thuongHieu: cleaned, message: "Đã lưu nhận diện thương hiệu." }, 200, NO_STORE);
      }
    },
    {
      // The heartbeat: sync posts, post waiting first comments, run link comments. OMI (screen open) or a cron.
      method: "POST", path: "/api/dang-bai/nhip", access: ACCESS.service, rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx) => {
        const synced = await syncJobs(ctx);
        const seeded = await runSeed(ctx);
        return reply.json({ ok: true, dongBo: synced, phuLink: seeded }, 200, NO_STORE);
      }
    }
  ],

  botTools: []
});
