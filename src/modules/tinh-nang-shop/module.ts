/**
 * @file MODULE "tinh-nang-shop" — Đ10 (17/09/2026): Sales Desk features that were TopRun-only, now every shop's.
 *
 * Decided 14/09/2026 ("các shop khác đều có, chỉ cần cấu hình đúng config") and 17/09/2026 (partner scraping and
 * the automatic purchase queue are offered to EVERY shop through its config — nothing names TopRun, Dasbui or
 * Runner here). What this module owns:
 *
 *   1. PARTNER SOURCES — the shop's list of partner web shops (replaces Desk `PARTNER_SOURCES` and the ready-stock
 *      warehouse list): fetch a partner's public catalogue, sync it as partner stock, push it as ready stock,
 *      and "manual" partners whose stock is ticked by hand or read from a photo (AI on Xeon).
 *   2. REALTIME LOOKUP — one search over the shop's stock, each partner source and Sapo (the shop's own keys).
 *   3. TAG SCANNING — `/scan` (Desk scan.html) reads a box tag through Xeon and books goods-in / stocktake
 *      through `hang-kho`'s stock book; `/m` is the seller's phone page.
 *   4. AUTOMATIC PURCHASE QUEUE — paid lines of the partner the shop buys online from, claimed by a browser
 *      extension that holds a key minted here (`/api/tien-ich/:viec`).
 *   5. GOOGLE DRIVE BACKUP — orders, customers, waybills to the shop's Apps Script.
 *   6. STOCK COMMANDS BY ZALO — "tồn / hết / hoàn" from the people the shop listed (event from `hop-thu`).
 *
 * It writes no catalogue table itself: every stock change goes through `hang-kho` services (and so through the
 * stock book). AI (reading a tag, a stock photo) is on Xeon, called with the landing's inbox token.
 */

import crypto from "node:crypto";
import { ACCESS, EVENTS, defineModule, reply, type KernelRequest, type ModuleContext, type ReplyDraft } from "../../contract";
import type { InventoryServices } from "../hang-kho/module";
import type { OrderServices } from "../don-khach/module";
import type { PlatformServices } from "../khung-nen-tang/module";
import { QUEUE_DOCUMENT, alertText, applyResult, claimNext, queueSettingsOf, requeue, scanOrders, snapshot, type OrderLike, type QueueBook } from "./auto-purchase";
import { backupPayload, forwardBackup, validBackupUrl, type BackupOrder, type ShipmentLike } from "./drive-backup";
import { catalogueItemOf, fetchSourceRows, groupRows, isShoeRow, normaliseSource, type PartnerProduct, type PartnerRow, type PartnerSource } from "./partner-sources";
import { lookupSapo, sapoSettingsOf } from "./sapo";
import { callXeon } from "../../shared/xeon-call";
import {
  STOCK_COMMAND_HELP, choiceQuestion, matchWarehouse, normaliseSize, parseStockCommand, parseStockPhotoText, resolveChoice, resolveTagCode, resolveTagSize,
  stockSizes, type WarehouseRow
} from "./stock-text";

const TEN_MINUTES = 10 * 60 * 1000;
const NO_STORE = { "Cache-Control": "no-store" };
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export const SOURCES_DOCUMENT = "tinh-nang-shop-nguon";
export const FETCH_DOCUMENT = "tinh-nang-shop-tai-ve";
export const KEY_DOCUMENT = "tinh-nang-shop-khoa";
export const BACKUP_DOCUMENT = "tinh-nang-shop-sao-luu";
export const COMMAND_DOCUMENT = "tinh-nang-shop-lenh-ton";
/** Header the browser extensions send their key in. */
export const EXTENSION_HEADER = "x-omi-tien-ich";

export type Config = Record<string, never>;

type Inventory = Pick<InventoryServices, "adminSearch" | "bySource" | "writeWarehouse" | "setStock" | "stockRows" | "addPhoto" | "setPrice">;

interface Services {
  "hang-kho"?: Inventory;
  "don-khach"?: Pick<OrderServices["don-khach"], "search">;
  "khung-nen-tang"?: Pick<PlatformServices, "settings" | "xeon">;
  "van-chuyen"?: { shipmentBook(): Promise<Record<string, ShipmentLike>> };
  "tien-doi-soat"?: { sendTelegram(input: { chatId: string; text: string }): Promise<unknown> };
  "hop-thu"?: { send(input: { kenh?: string; nguoi: string; chu: string; nguon?: string }): Promise<unknown> };
}

type Ctx = ModuleContext<Config, Services>;
type Body = Record<string, unknown>;

const text = (v: unknown, n = 300): string => String(v ?? "").trim().slice(0, n);
const asObject = (v: unknown): Body => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Body) : {});
const refuse = (status: number, error: string, message: string, extra: Body = {}): ReplyDraft => reply.json({ ok: false, error, message, ...extra }, status, NO_STORE);
const actorOf = (request: { caller?: { name?: string } }): string => text(request.caller?.name, 80) || "quan-tri";

async function settingsOf(ctx: Ctx): Promise<Record<string, string>> {
  try { return (await ctx.services["khung-nen-tang"]?.settings()) ?? {}; } catch { return {}; }
}

function inventory(ctx: Ctx): Inventory {
  const inv = ctx.services["hang-kho"];
  if (!inv) throw Object.assign(new Error("Landing chưa bật mảnh Hàng hoá & kho."), { status: 503 });
  return inv;
}

// ------------------------------------------------------------------ Xeon (vision)

async function readImageOnXeon(ctx: Ctx, image: string, purpose: "tem" | "ton-anh", hint = ""): Promise<{ ok: true; doc: Body; ungVien: Body[] } | { ok: false; message: string }> {
  const r = await callXeon(ctx, "POST", "/ai/doc-anh", { anh: [image], goiY: text(hint, 300), maHoiThoai: "", kenh: "kho", mucDich: purpose }, {
    timeoutMs: 90_000, unregistered: "Landing chưa đăng ký với Xeon — đọc ảnh bằng AI chạy trên Xeon nên chưa dùng được."
  });
  if (!r.ok) return { ok: false, message: r.viSao };
  return { ok: true, doc: asObject(r.body["doc"]), ungVien: Array.isArray(r.body["ungVien"]) ? r.body["ungVien"].map(asObject) : [] };
}

/** A `data:image/…;base64,` string within the size cap, else "". */
function dataImage(value: unknown): string {
  const s = String(value ?? "");
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s)) return "";
  return Math.floor((s.length - s.indexOf(",") - 1) * 3 / 4) <= MAX_IMAGE_BYTES ? s : "";
}

// ------------------------------------------------------------------ partner sources

interface SourcesBook { version: 1; nguon: PartnerSource[] }
interface FetchBook { version: 1; luc: string; nguon: string; chiConHang: boolean; rows: PartnerRow[]; products: PartnerProduct[]; logs: string[] }

async function sources(ctx: Ctx): Promise<PartnerSource[]> {
  return (await ctx.ports.store.document<SourcesBook>(SOURCES_DOCUMENT).read(null))?.nguon ?? [];
}

async function sourceByCode(ctx: Ctx, code: unknown): Promise<PartnerSource | null> {
  const ma = text(code, 40).toLowerCase();
  return (await sources(ctx)).find((s) => s.ma === ma) ?? null;
}

/** Display rows (one per product) for the partner table — Desk `partnerProductsToDisplayRows`. */
function displayRows(products: PartnerProduct[]) {
  return products.map((p) => ({
    code: p.code, name: p.name, partner: p.sourceName, source: p.source, brand: p.brand, category: p.category, imageUrl: p.imageUrl, productUrl: p.productUrl,
    sizes: p.sizes.filter((s) => s.qty > 0).map((s) => s.size), price: p.price, listPrice: p.listPrice, available: p.available
  }));
}

/** Items of one partner source in the catalogue (campaign lines in its warehouse), house view. */
async function manualItems(ctx: Ctx, source: PartnerSource) {
  const items = await inventory(ctx).bySource({ source: "campaign", limit: 2000 });
  return items
    .map((i) => ({ ...i, sizes: i.sizes.filter((s) => s.nguon === "campaign" && s.warehouseId === source.maKho) }))
    .filter((i) => i.sizes.length > 0);
}

// ------------------------------------------------------------------ realtime lookup

interface LookupVariant { productCode: string; productName: string; size: string; available: number; onHand: number; price: number; imageUrl: string; warehouseId: string }
interface LookupSource { source: string; sourceName: string; ok: boolean; message: string; editable: boolean; variants: LookupVariant[] }

async function lookup(ctx: Ctx, body: Body): Promise<Body> {
  const query = text(body["q"] ?? body["query"], 120);
  if (query.length < 2) return { ok: false, message: "Nhập tên hoặc mã sản phẩm (ít nhất 2 ký tự)." };
  const size = normaliseSize(body["size"]);
  const minPrice = Math.max(0, Number(body["giaTu"] ?? body["minPrice"]) || 0);
  const maxPrice = Math.max(0, Number(body["giaDen"] ?? body["maxPrice"]) || 0);
  const onlyAvailable = body["chiConHang"] !== false && body["onlyAvailable"] !== false;
  const partnerSources = await sources(ctx);
  const settings = await settingsOf(ctx);
  const sapo = sapoSettingsOf(settings);
  const wanted = (Array.isArray(body["nguon"] ?? body["sources"]) ? (body["nguon"] ?? body["sources"]) as unknown[] : []).map((x) => text(x, 40).toLowerCase()).filter(Boolean);
  const all = ["kho", ...partnerSources.map((s) => s.ma), ...(sapo ? ["sapo"] : [])];
  const selected = wanted.length ? all.filter((s) => wanted.includes(s)) : all;
  const keep = (v: LookupVariant) => (!size || normaliseSize(v.size) === size) && (!minPrice || v.price >= minPrice) && (!maxPrice || v.price <= maxPrice) && (!onlyAvailable || v.available > 0);

  const items = ctx.services["hang-kho"] ? await inventory(ctx).adminSearch({ query, limit: 50 }) : [];
  const variantsOf = (filter: (s: { nguon: string; warehouseId: string }) => boolean) => items.flatMap((i) => i.sizes.filter(filter).map((s): LookupVariant => ({
    productCode: i.code, productName: i.name, size: s.size, available: s.qty, onHand: s.qty, price: s.price || i.price, imageUrl: i.thumbnailImage || i.highImage, warehouseId: s.warehouseId
  }))).filter(keep);
  const results: LookupSource[] = [];
  if (selected.includes("kho")) results.push({ source: "kho", sourceName: "Kho shop", ok: true, message: "", editable: true, variants: variantsOf((s) => s.nguon !== "campaign").slice(0, 80) });
  for (const p of partnerSources.filter((s) => selected.includes(s.ma))) {
    results.push({ source: p.ma, sourceName: p.ten, ok: true, message: "", editable: true, variants: variantsOf((s) => s.nguon === "campaign" && s.warehouseId === p.maKho).slice(0, 80) });
  }
  if (sapo && selected.includes("sapo")) {
    const r = await lookupSapo(ctx.ports.http, sapo, query);
    results.push(r.ok
      ? { source: "sapo", sourceName: sapo.name, ok: true, message: "", editable: false, variants: r.variants.map((v): LookupVariant => ({ productCode: v.productCode, productName: v.productName, size: v.size, available: v.available, onHand: v.onHand, price: v.price, imageUrl: v.imageUrl, warehouseId: "" })).filter(keep).slice(0, 80) }
      : { source: "sapo", sourceName: sapo.name, ok: false, message: r.message, editable: false, variants: [] });
  }
  const codes = new Set(results.flatMap((r) => r.variants.map((v) => v.productCode)));
  const matched = items.filter((i) => codes.has(i.code) || !onlyAvailable);
  const imageAssets: Body[] = [];
  for (const i of matched) {
    for (const url of [i.thumbnailImage || i.highImage, ...i.galleryImages].filter(Boolean).slice(0, 2)) {
      if (imageAssets.length < 8 && !imageAssets.some((a) => a["url"] === url)) imageAssets.push({ url, code: i.code, source: i.sizes.some((s) => s.nguon === "campaign") ? "doi-tac" : "kho", label: `${i.code} · ${i.sourceName || "Kho shop"}` });
    }
  }
  for (const r of results) for (const v of r.variants) {
    if (imageAssets.length < 8 && v.imageUrl && !imageAssets.some((a) => a["url"] === v.imageUrl)) imageAssets.push({ url: v.imageUrl, code: v.productCode, source: r.source, label: `${v.productCode} · ${r.sourceName}` });
  }
  return {
    ok: true, query, size, minPrice, maxPrice, onlyAvailable, checkedAt: ctx.ports.clock.now().toISOString(),
    products: matched.slice(0, 12).map((i) => ({ code: i.code, name: i.name, sourceName: i.sourceName || "Kho shop", price: i.price, listPrice: i.listPrice })),
    imageAssets, sources: results
  };
}

/** "Lưu" next to a number: sets that size of a LOCAL source (the shop's stock or a partner source). Sapo is edited in Sapo. */
async function editStock(ctx: Ctx, body: Body, actor: string): Promise<{ status: number; body: Body }> {
  const nguon = text(body["nguon"] ?? body["source"], 40).toLowerCase();
  const code = text(body["ma"] ?? body["code"], 80);
  const size = text(body["size"], 20);
  const qty = Number(body["soLuong"] ?? body["qty"]);
  if (nguon === "sapo") return { status: 409, body: { ok: false, error: "nguon_ngoai", message: "Tồn Sapo sửa trong Sapo — landing chỉ đọc." } };
  if (!code || !size || !Number.isInteger(qty) || qty < 0 || qty > 100000) return { status: 400, body: { ok: false, error: "thieu_thong_tin", message: "Cần mã, size và số lượng (số nguyên không âm)." } };
  let warehouseId = text(body["maKho"] ?? body["warehouseId"], 60);
  let source: string | undefined;
  if (nguon !== "kho") {
    const partner = await sourceByCode(ctx, nguon);
    if (!partner) return { status: 404, body: { ok: false, error: "khong_thay_nguon", message: `Không có nguồn "${nguon}".` } };
    warehouseId = partner.maKho;
    source = "campaign";
  } else if (!warehouseId) {
    const rows = (await inventory(ctx).stockRows({ code, size })).filter((r) => r.source !== "campaign");
    if (rows.length !== 1) return { status: 409, body: { ok: false, error: "can_chon_kho", message: rows.length ? `Size này có ở ${rows.length} kho — chọn kho.` : "Size này chưa có dòng tồn — nhập kho ở màn Kho hàng sẵn." } };
    warehouseId = rows[0]!.warehouseId;
    source = rows[0]!.source;
  }
  const r = await inventory(ctx).setStock({ code, size, warehouseId, quantity: qty, note: "Tra kho: sửa tồn", actor, ...(source ? { source } : {}) });
  if (!r.ok) return { status: 400, body: { ok: false, error: r.reason, message: r.message } };
  return { status: 200, body: { ok: true, truoc: r.before, sau: r.after, message: `${code} size ${size} (${warehouseId}): tồn ${qty}.` } };
}

// ------------------------------------------------------------------ extension key

interface KeyBook { version: 1; bam: string; taoLuc: string; duoi: string }
const sha = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

async function extensionAllowed(ctx: Ctx, request: KernelRequest): Promise<boolean> {
  const given = text(request.headers[EXTENSION_HEADER] as string | undefined, 200);
  if (!given) return false;
  const book = await ctx.ports.store.document<KeyBook>(KEY_DOCUMENT).read(null);
  if (!book?.bam) return false;
  const a = Buffer.from(sha(given));
  const b = Buffer.from(book.bam);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ------------------------------------------------------------------ automatic purchase queue

async function queueSettings(ctx: Ctx) { return queueSettingsOf(await settingsOf(ctx)); }
const queueDoc = (ctx: Ctx) => ctx.ports.store.document<QueueBook>(QUEUE_DOCUMENT);

async function alert(ctx: Ctx, message: string): Promise<void> {
  const chat = text((await settingsOf(ctx))["telegram_chat_bao_dong"], 80);
  if (!chat || !ctx.services["tien-doi-soat"]) return;
  try { await ctx.services["tien-doi-soat"].sendTelegram({ chatId: chat, text: message }); } catch (e) { ctx.ports.logger.warn(`[tinh-nang-shop] bao Telegram mua ho that bai: ${e instanceof Error ? e.message : String(e)}`); }
}

async function scanQueue(ctx: Ctx): Promise<Body> {
  const settings = await queueSettings(ctx);
  if (!settings.enabled) return { ok: true, boQua: true, added: 0, message: settings.problems.length ? `Chưa đủ cấu hình: ${settings.problems.join(", ")}.` : "Mua hộ tự động đang tắt (mua_ho_bat)." };
  const orders = ctx.services["don-khach"] ? (await ctx.services["don-khach"].search({ limit: 500 })) as unknown as OrderLike[] : [];
  let outcome: ReturnType<typeof scanOrders> | null = null;
  await queueDoc(ctx).update((current) => { outcome = scanOrders(current, orders, settings, ctx.ports.clock.now()); return outcome.book; }, { version: 1, items: [] });
  const done = outcome as unknown as ReturnType<typeof scanOrders>;
  for (const item of done.blocked) await alert(ctx, alertText(item));
  return { ok: true, added: done.added.length, blocked: done.blocked.length, reopened: done.reopened, message: `Xếp ${done.added.length} dòng, chặn ${done.blocked.length}, mở lại ${done.reopened}.` };
}

async function extensionJob(ctx: Ctx, job: string, body: Body): Promise<{ status: number; body: Body }> {
  const now = ctx.ports.clock.now();
  if (job === "nguon") return { status: 200, body: await sourcesReply(ctx) };
  if (job === "tra-ton") { const r = await lookup(ctx, body); return { status: r["ok"] === false ? 400 : 200, body: r }; }
  if (job === "sua-ton") return editStock(ctx, body, "tien-ich");
  const settings = await queueSettings(ctx);
  if (job === "mua-ho-hang-doi") return { status: 200, body: { ok: true, ...snapshot(await queueDoc(ctx).read(null), settings) } };
  if (job === "mua-ho-nhan") {
    if (!settings.enabled) return { status: 200, body: { ok: true, item: null, busy: false, disabled: true } };
    let claimed: ReturnType<typeof claimNext> | null = null;
    await queueDoc(ctx).update((current) => { claimed = claimNext(current, now); return claimed.book; }, { version: 1, items: [] });
    const c = claimed as unknown as ReturnType<typeof claimNext>;
    return { status: 200, body: { ok: true, item: c.item, busy: c.busy } };
  }
  if (job === "mua-ho-ket-qua") {
    let applied: ReturnType<typeof applyResult> | null = null;
    await queueDoc(ctx).update((current) => { applied = applyResult(current, body, now); return applied.book; }, { version: 1, items: [] });
    const a = applied as unknown as ReturnType<typeof applyResult>;
    if (!a.item) return { status: 404, body: { ok: false, error: "khong_thay", message: "Không thấy việc này trong hàng đợi." } };
    await alert(ctx, alertText(a.item));
    ctx.ports.logger.info(`[tinh-nang-shop] mua ho ${a.item.orderCode} / ${a.item.productCode} ${a.item.size} -> ${a.item.status}`);
    return { status: 200, body: { ok: true, status: a.item.status } };
  }
  return { status: 404, body: { ok: false, error: "khong_co_viec", message: `Việc "${job}" không có.` } };
}

async function sourcesReply(ctx: Ctx): Promise<Body> {
  const sapo = sapoSettingsOf(await settingsOf(ctx));
  return { ok: true, nguon: await sources(ctx), sapo: { daCauHinh: sapo !== null, ten: sapo?.name ?? "Sapo" } };
}

// ------------------------------------------------------------------ stock commands by Zalo

interface CommandState { cho?: { code: string; size: string; qty: number; rows: WarehouseRow[] }; cuoi?: { code: string; size: string; warehouseId: string; source: string; before: number; after: number } }
interface CommandBook { version: 1; theoNguoi: Record<string, CommandState> }

/** Runs one chat line from a listed person. Returns the reply text, or "" when it is not a command. */
export async function runStockCommand(ctx: Ctx, person: string, message: string): Promise<string> {
  const command = parseStockCommand(message);
  if (!command) return "";
  if (command.type === "help") return STOCK_COMMAND_HELP;
  const doc = ctx.ports.store.document<CommandBook>(COMMAND_DOCUMENT);
  const book = (await doc.read(null)) ?? { version: 1 as const, theoNguoi: {} };
  const state: CommandState = { ...(book.theoNguoi[person] ?? {}) };
  const save = async () => { await doc.update((c) => ({ version: 1, theoNguoi: { ...(c?.theoNguoi ?? {}), [person]: state } }), { version: 1, theoNguoi: {} }); };
  const inv = inventory(ctx);
  const apply = async (rows: WarehouseRow[], code: string, size: string, qty: number) => {
    const lines: string[] = [];
    for (const row of rows) {
      const r = await inv.setStock({ code, size: row.size, warehouseId: row.warehouseId, source: row.source, quantity: qty, note: `Lệnh Zalo của ${person}`, actor: `zalo:${person}` });
      if (!r.ok) { lines.push(`${code} · size ${size} · ${row.warehouseId}: ${r.message}`); continue; }
      state.cuoi = { code, size: row.size, warehouseId: row.warehouseId, source: row.source, before: r.before, after: r.after };
      lines.push(r.before === r.after ? `${code} · size ${size} · ${row.warehouseId}: đã là ${qty}. Không sửa gì.` : `Đã sửa ${code} · size ${size} · ${row.warehouseId}: ${r.before} → ${r.after}. Web đã nhận.`);
    }
    delete state.cho;
    await save();
    return lines.join("\n");
  };
  if (command.type === "undo") {
    const last = state.cuoi;
    if (!last) return "Chưa có lần sửa nào để hoàn.";
    const r = await inv.setStock({ code: last.code, size: last.size, warehouseId: last.warehouseId, source: last.source, quantity: last.before, note: `Hoàn lệnh Zalo của ${person}`, actor: `zalo:${person}` });
    if (!r.ok) return r.message;
    delete state.cuoi;
    await save();
    return `Đã hoàn ${last.code} · size ${last.size} · ${last.warehouseId}: ${last.after} → ${last.before}. Web đã nhận.`;
  }
  if (command.type === "choice") {
    const pending = state.cho;
    if (!pending) return "";
    const chosen = resolveChoice(pending.rows, command.index);
    if (!chosen) return choiceQuestion(pending.code, pending.size, pending.rows);
    return apply(chosen, pending.code, pending.size, pending.qty);
  }
  const rows = (await inv.stockRows({ code: command.code })).filter((r) => normaliseSize(r.size) === normaliseSize(command.size))
    .map((r): WarehouseRow => ({ warehouseId: r.warehouseId, warehouseName: r.warehouseId, quantity: r.quantity, source: r.source, size: r.size }));
  if (rows.length === 0) return `${command.code} · size ${command.size}: chưa có dòng tồn nào. Nhập kho trước rồi sửa.`;
  const match = matchWarehouse(rows, command.warehouseQuery);
  if (match.status === "none") return `Không thấy kho "${command.warehouseQuery}" cho ${command.code} · size ${command.size}.`;
  if (match.status === "many") {
    state.cho = { code: command.code, size: command.size, qty: command.qty, rows: match.rows };
    await save();
    return choiceQuestion(command.code, command.size, match.rows);
  }
  return apply(match.rows, command.code, command.size, command.qty);
}

// ------------------------------------------------------------------ pages (/scan, /m)

async function servePage(ctx: Ctx, request: KernelRequest, file: string): Promise<ReplyDraft> {
  const signedIn = ctx.ports.auth.callerAllows(await ctx.ports.auth.resolve(request), ACCESS.admin);
  if (!signedIn) return file.endsWith(".html") ? reply.redirect("/admin-login") : reply.json({ ok: false, error: "khong_thay" }, 404, NO_STORE);
  const found = await ctx.ports.staticFiles.open(`${ctx.id}/goc`).read(file);
  if (!found) return reply.json({ ok: false, error: "khong_thay" }, 404, NO_STORE);
  return reply.file(found.data, found.type, 200, { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });
}

const page = (path: string, file: string) => ({
  method: "GET" as const, path, access: ACCESS.public,
  whyPublic: "Trang nội bộ (quét tem / điện thoại người bán). Tự kiểm phiên: chưa đăng nhập quản trị thì chuyển về /admin-login hoặc 404, không trả tệp nào.",
  rateLimit: { calls: 600, windowMs: TEN_MINUTES },
  handle: (ctx: Ctx, request: KernelRequest) => servePage(ctx, request, file)
});

// ------------------------------------------------------------------ manifest

async function bodyOf(request: KernelRequest): Promise<Body> {
  return asObject(await request.json());
}

export const manifest = defineModule<Config, Services>({
  id: "tinh-nang-shop",
  name: "Tính năng theo cấu hình shop",
  tier: "van-hanh",
  runsOn: "server-khach",
  feature: "hang-kho",
  version: "0.1.0",
  ports: ["store", "logger", "clock", "http", "auth", "staticFiles"],
  requiresOptional: [
    "hang-kho.adminSearch", "hang-kho.bySource", "hang-kho.writeWarehouse", "hang-kho.setStock", "hang-kho.stockRows", "hang-kho.addPhoto", "hang-kho.setPrice",
    "don-khach.search", "khung-nen-tang.settings", "khung-nen-tang.xeon", "van-chuyen.shipmentBook", "tien-doi-soat.sendTelegram", "hop-thu.send"
  ],

  events: {
    emits: [],
    listens: {
      // A listed person wrote in Zalo: run the stock command and answer in the same chat.
      [EVENTS.stockCommand]: async (ctx, payload) => {
        const m = asObject(payload);
        const person = text(m["nguoi"], 120);
        if (!person) return;
        try {
          const answer = await runStockCommand(ctx as Ctx, person, text(m["chu"], 500));
          if (answer && (ctx as Ctx).services["hop-thu"]) await (ctx as Ctx).services["hop-thu"]!.send({ kenh: "zalo", nguoi: person, chu: answer, nguon: "lenh-ton" });
        } catch (e) {
          ctx.ports.logger.warn(`[tinh-nang-shop] lenh ton Zalo hong: ${e instanceof Error ? e.message : String(e)}`);
        }
      },
      // A payment came in: paid lines may join the purchase queue.
      [EVENTS.paymentReceived]: async (ctx) => {
        try { await scanQueue(ctx as Ctx); } catch (e) { ctx.ports.logger.warn(`[tinh-nang-shop] quet hang doi mua ho hong: ${e instanceof Error ? e.message : String(e)}`); }
      }
    }
  },

  routes: [
    // ---------------- partner sources (config) ----------------
    {
      method: "GET", path: "/api/tinh-nang-shop/nguon", access: ACCESS.admin, rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx) => reply.json(await sourcesReply(ctx), 200, NO_STORE)
    },
    {
      method: "POST", path: "/api/tinh-nang-shop/nguon", access: ACCESS.admin, rateLimit: { calls: 60, windowMs: TEN_MINUTES }, bodyLimit: 64 * 1024,
      handle: async (ctx, request) => {
        const raw = (await bodyOf(request))["nguon"];
        if (!Array.isArray(raw) || raw.length > 30) return refuse(400, "can_danh_sach", "Gửi danh sách nguồn (tối đa 30).");
        const list: PartnerSource[] = [];
        for (const item of raw) {
          const r = normaliseSource(item);
          if (!r.ok) return refuse(400, "nguon_sai", r.message);
          if (list.some((s) => s.ma === r.source.ma)) return refuse(400, "nguon_trung", `Mã nguồn "${r.source.ma}" bị trùng.`);
          list.push(r.source);
        }
        await ctx.ports.store.document<SourcesBook>(SOURCES_DOCUMENT).write({ version: 1, nguon: list });
        return reply.json({ ok: true, ...(await sourcesReply(ctx)), message: `Đã lưu ${list.length} nguồn đối tác.` }, 200, NO_STORE);
      }
    },
    // ---------------- partner catalogue: fetch / sync / push ready ----------------
    {
      method: "POST", path: "/api/tinh-nang-shop/doi-tac/tai", access: ACCESS.admin, rateLimit: { calls: 30, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = await bodyOf(request);
        const wanted = text(body["nguon"], 40).toLowerCase() || "all";
        const list = (await sources(ctx)).filter((s) => s.cheDo === "web" && (wanted === "all" || s.ma === wanted));
        if (list.length === 0) return refuse(404, "chua_co_nguon", wanted === "all" ? "Chưa có nguồn đối tác dạng web — thêm ở khung Nguồn đối tác." : `Không có nguồn web "${wanted}".`);
        const onlyAvailable = body["chiConHang"] !== false;
        const rows: PartnerRow[] = [];
        const logs: string[] = [];
        for (const source of list) {
          const r = await fetchSourceRows(ctx.ports.http, source);
          logs.push(...r.logs);
          rows.push(...r.rows.filter((row) => (!source.chiGiay || isShoeRow(row)) && (!onlyAvailable || row.available)));
        }
        const products = groupRows(rows);
        const book: FetchBook = { version: 1, luc: ctx.ports.clock.now().toISOString(), nguon: wanted, chiConHang: onlyAvailable, rows: rows.slice(0, 5000), products: products.slice(0, 3000), logs: logs.slice(-50) };
        await ctx.ports.store.document<FetchBook>(FETCH_DOCUMENT).write(book);
        ctx.ports.logger.info(`[tinh-nang-shop] tai doi tac ${wanted}: ${products.length} ma / ${rows.length} dong`);
        return reply.json({ ok: true, rows: displayRows(products), result: { rows: products.length, rawRows: rows.length, products: products.length, luc: book.luc }, logs: book.logs }, 200, NO_STORE);
      }
    },
    {
      method: "GET", path: "/api/tinh-nang-shop/doi-tac/tai", access: ACCESS.admin, rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx) => {
        const book = await ctx.ports.store.document<FetchBook>(FETCH_DOCUMENT).read(null);
        return reply.json({ ok: true, rows: displayRows(book?.products ?? []), result: book ? { rows: book.products.length, rawRows: book.rows.length, products: book.products.length, luc: book.luc } : null, logs: book?.logs ?? [] }, 200, NO_STORE);
      }
    },
    ...(["dong-bo", "day-kho-san"] as const).map((kind) => ({
      method: "POST" as const, path: `/api/tinh-nang-shop/doi-tac/${kind}`, access: ACCESS.admin, rateLimit: { calls: 30, windowMs: TEN_MINUTES },
      handle: async (ctx: Ctx, request: KernelRequest): Promise<ReplyDraft> => {
        // "Đồng bộ vào catalog" = partner stock (campaign lines in the source's warehouse);
        // "Đẩy kho sẵn" = the same products as READY stock, only for a source the shop marked `dayKhoSan`.
        const body = await bodyOf(request);
        const book = await ctx.ports.store.document<FetchBook>(FETCH_DOCUMENT).read(null);
        if (!book?.products.length) return refuse(409, "chua_tai", "Chưa có sản phẩm đối tác. Bấm Tải / phân tích trước.");
        const wanted = text(body["nguon"], 40).toLowerCase();
        const list = (await sources(ctx)).filter((s) => (!wanted || s.ma === wanted) && (kind === "dong-bo" || s.dayKhoSan));
        if (list.length === 0) return refuse(409, "nguon_khong_duoc", kind === "dong-bo" ? "Không có nguồn nào khớp." : "Nguồn này chưa được đánh dấu đẩy kho sẵn (dayKhoSan).");
        let items = 0, variants = 0;
        for (const source of list) {
          const products = book.products.filter((p) => p.source === source.ma);
          if (products.length === 0) continue;
          const r = await inventory(ctx).writeWarehouse({ source: kind === "dong-bo" ? "campaign" : "ready", warehouseId: source.maKho, items: products.map((p) => catalogueItemOf(p, source)) });
          items += r.itemCount;
          variants += r.variantCount;
        }
        ctx.ports.logger.info(`[tinh-nang-shop] ${kind}: ${items} ma / ${variants} size (${actorOf(request)})`);
        return reply.json({ ok: true, result: { total: items, variants }, synced: { products: items, variants }, message: kind === "dong-bo" ? `Đã đồng bộ ${items} sản phẩm đối tác vào catalog.` : `Hoàn tất: ${items} mã / ${variants} size vào kho sẵn.` }, 200, NO_STORE);
      }
    })),
    // ---------------- manual partner stock ----------------
    {
      method: "GET", path: "/api/tinh-nang-shop/thu-cong", access: ACCESS.admin, rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const source = await sourceByCode(ctx, request.query["nguon"]);
        if (!source) return refuse(404, "khong_thay_nguon", "Chọn một nguồn đối tác.");
        const items = await manualItems(ctx, source);
        return reply.json({ ok: true, nguon: source, sanPham: items.map((i) => ({ code: i.code, name: i.name, brand: i.brand, imageUrl: i.thumbnailImage || i.highImage, galleryImages: i.galleryImages, price: i.price, sizes: i.sizes.map((s) => ({ size: s.size, qty: s.qty, price: s.price })) })) }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/tinh-nang-shop/thu-cong/tai", access: ACCESS.admin, rateLimit: { calls: 20, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const source = await sourceByCode(ctx, (await bodyOf(request))["nguon"]);
        if (!source) return refuse(404, "khong_thay_nguon", "Chọn một nguồn đối tác.");
        const fetched = await fetchSourceRows(ctx.ports.http, source);
        if (!fetched.ok) return refuse(502, "khong_tai_duoc", fetched.logs.at(-1) ?? "Không tải được danh mục.");
        const existing = new Map((await manualItems(ctx, source)).map((i) => [i.code.toUpperCase(), i]));
        const products = groupRows(fetched.rows.filter((row) => !source.chiGiay || isShoeRow(row)));
        const items = products.map((p) => {
          const old = existing.get(p.code);
          // A manual source's stock is what the shop ticked, never what the partner's web says: keep ticks.
          const ticked = new Set((old?.sizes ?? []).filter((s) => s.qty > 0).map((s) => normaliseSize(s.size)));
          return catalogueItemOf({ ...p, sizes: p.sizes.map((s) => ({ size: s.size, qty: ticked.has(normaliseSize(s.size)) ? 1 : 0 })) }, source, { manual: true });
        });
        const r = items.length ? await inventory(ctx).writeWarehouse({ source: "campaign", warehouseId: source.maKho, items }) : { itemCount: 0, variantCount: 0 };
        return reply.json({ ok: true, result: { products: products.length, added: products.filter((p) => !existing.has(p.code)).length, updated: products.filter((p) => existing.has(p.code)).length, logs: fetched.logs }, message: `Đã tải ${r.itemCount} sản phẩm ${source.ten}.` }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/tinh-nang-shop/thu-cong/size", access: ACCESS.admin, rateLimit: { calls: 1200, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = await bodyOf(request);
        const source = await sourceByCode(ctx, body["nguon"]);
        if (!source) return refuse(404, "khong_thay_nguon", "Chọn một nguồn đối tác.");
        const code = text(body["ma"], 80), size = text(body["size"], 20);
        if (!code || !size) return refuse(400, "thieu_thong_tin", "Thiếu mã hoặc size.");
        const r = await inventory(ctx).setStock({ code, size, warehouseId: source.maKho, source: "campaign", quantity: body["con"] === false ? 0 : 1, note: `${source.ten}: tick còn/hết`, actor: actorOf(request) });
        if (!r.ok) return refuse(400, r.reason, r.message);
        return reply.json({ ok: true, message: `${code} size ${size}: ${body["con"] === false ? "hết hàng" : "còn hàng"}.` }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/tinh-nang-shop/thu-cong/anh-url", access: ACCESS.admin, rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = await bodyOf(request);
        const code = text(body["ma"], 80);
        const url = text(body["url"], 2000);
        if (!code || !/^https?:\/\//i.test(url)) return refuse(400, "url_sai", "Asset URL ảnh không hợp lệ.");
        let bytes: Buffer;
        try {
          const r = await ctx.ports.http.fetch(url, { method: "GET", timeoutMs: 20_000 });
          if (!r.ok || !r.arrayBuffer) return refuse(502, "khong_tai_duoc", `Không tải được ảnh (HTTP ${r.status}).`);
          bytes = Buffer.from(await r.arrayBuffer());
        } catch (e) {
          return refuse(502, "khong_tai_duoc", `Không tải được ảnh: ${e instanceof Error ? e.message : String(e)}`);
        }
        if (bytes.length > MAX_IMAGE_BYTES) return refuse(413, "qua_lon", "Ảnh vượt 8 MB.");
        const r = await inventory(ctx).addPhoto({ code, bytes, primary: body["chinh"] === true, actor: actorOf(request) });
        if (!r.ok) return refuse(r.error === "khong_thay" ? 404 : 400, r.error, r.message);
        return reply.json({ ...r, message: `Đã tải ảnh góc ${Number(body["goc"]) || 1} cho ${code}.` }, 200, NO_STORE);
      }
    },
    {
      // A partner's stock PHOTO (Desk: Runner sends Zalo pictures): Xeon reads sizes + price, candidates come from that source's items.
      method: "POST", path: "/api/tinh-nang-shop/anh-ton/doc", access: ACCESS.admin, rateLimit: { calls: 120, windowMs: TEN_MINUTES }, bodyLimit: 12 * 1024 * 1024,
      handle: async (ctx, request) => {
        const body = await bodyOf(request);
        const source = await sourceByCode(ctx, body["nguon"]);
        if (!source) return refuse(404, "khong_thay_nguon", "Chọn một nguồn đối tác.");
        const image = dataImage(body["anh"]);
        if (!image) return refuse(400, "thieu_anh", "Cần ảnh (jpeg/png/webp, tối đa 8 MB).");
        const read = await readImageOnXeon(ctx, image, "ton-anh", text(body["chuThich"], 300));
        const caption = parseStockPhotoText(text(body["chuThich"], 300));
        const doc = read.ok ? read.doc : {};
        const parsed = parseStockPhotoText(`${text(doc["text"], 2000)} ${caption.rawText}`);
        const sizes = [...new Set([...stockSizes(doc["sizes"]), ...parsed.sizes])];
        const price = Number(doc["price"]) > 0 ? Number(doc["price"]) : parsed.price;
        const words = `${text(doc["code"])} ${text(doc["model"])} ${text(doc["brand"])}`.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
        const candidates = (await manualItems(ctx, source)).map((i) => {
          const hay = `${i.code} ${i.name} ${i.brand}`.toLowerCase();
          const exact = text(doc["code"]) !== "" && i.code.toUpperCase() === text(doc["code"]).toUpperCase();
          const hits = words.filter((w) => hay.includes(w)).length;
          return { code: i.code, name: i.name, imageUrl: i.thumbnailImage || i.highImage, confidence: exact ? 0.95 : words.length ? Math.min(0.9, hits / words.length) : 0 };
        }).filter((c) => c.confidence >= 0.34).sort((a, b) => b.confidence - a.confidence).slice(0, 2);
        return reply.json({
          ok: true, parsed: { sizes, price, rawText: parsed.rawText }, candidates, primary: candidates[0] ?? null, doc, loiXeon: read.ok ? "" : read.message,
          message: sizes.length ? `Đọc được size ${sizes.join(", ")}${price ? `, giá ${price}` : ""}.` : "Chưa đọc được size từ ảnh; cần nhập tay trước khi áp dụng."
        }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/tinh-nang-shop/anh-ton/ap-dung", access: ACCESS.admin, rateLimit: { calls: 240, windowMs: TEN_MINUTES }, bodyLimit: 12 * 1024 * 1024,
      handle: async (ctx, request) => {
        const body = await bodyOf(request);
        const source = await sourceByCode(ctx, body["nguon"]);
        if (!source) return refuse(404, "khong_thay_nguon", "Chọn một nguồn đối tác.");
        const code = text(body["ma"], 80);
        const sizes = stockSizes(body["sizes"]);
        if (!code) return refuse(400, "thieu_ma", "Tick catalog hoặc nhập mã trước khi áp dụng.");
        if (sizes.length === 0) return refuse(400, "thieu_size", "Thiếu size cần cập nhật.");
        const item = (await manualItems(ctx, source)).find((i) => i.code.toUpperCase() === code.toUpperCase());
        if (!item) return refuse(404, "khong_thay", `Không tìm thấy ${code} trong ${source.ten}.`);
        const replace = text(body["cheDo"], 10) === "replace";
        const inv = inventory(ctx);
        const actor = actorOf(request);
        if (replace) for (const s of item.sizes) if (!sizes.includes(normaliseSize(s.size)) && s.qty > 0) await inv.setStock({ code: item.code, size: s.size, warehouseId: source.maKho, source: "campaign", quantity: 0, note: "Ảnh tồn: thay tồn", actor });
        for (const size of sizes) {
          const known = item.sizes.find((s) => normaliseSize(s.size) === size);
          const r = await inv.setStock({ code: item.code, size: known?.size ?? size, warehouseId: source.maKho, source: "campaign", quantity: 1, note: "Ảnh tồn: còn hàng", actor });
          if (!r.ok) return refuse(400, r.reason, r.message);
        }
        const price = Math.round(Number(body["gia"]) || 0);
        if (price > 0) for (const size of sizes) await inv.setPrice({ code: item.code, size: item.sizes.find((s) => normaliseSize(s.size) === size)?.size ?? size, warehouseId: source.maKho, source: "campaign", price });
        const image = dataImage(body["anh"]);
        if (image && body["luuAnh"] !== false) await inv.addPhoto({ code: item.code, bytes: Buffer.from(image.slice(image.indexOf(",") + 1), "base64"), actor });
        return reply.json({ ok: true, message: `${item.code}: đã ${replace ? "thay thế" : "cập nhật"} size ${sizes.join(", ")}${price ? `, giá ${price}` : ""}.` }, 200, NO_STORE);
      }
    },
    // ---------------- realtime lookup ----------------
    {
      method: "POST", path: "/api/tinh-nang-shop/tra-ton", access: ACCESS.admin, rateLimit: { calls: 1200, windowMs: TEN_MINUTES }, bodyLimit: 16 * 1024,
      handle: async (ctx, request) => { const r = await lookup(ctx, await bodyOf(request)); return reply.json(r, r["ok"] === false ? 400 : 200, NO_STORE); }
    },
    {
      method: "POST", path: "/api/tinh-nang-shop/sua-ton", access: ACCESS.admin, rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => { const r = await editStock(ctx, await bodyOf(request), actorOf(request)); return reply.json(r.body, r.status, NO_STORE); }
    },
    // ---------------- tag scanning ----------------
    {
      method: "POST", path: "/api/tinh-nang-shop/quet-tem/doc", access: ACCESS.admin, rateLimit: { calls: 600, windowMs: TEN_MINUTES }, bodyLimit: 12 * 1024 * 1024,
      handle: async (ctx, request) => {
        const started = Date.now();
        const body = await bodyOf(request);
        const image = dataImage(body["anh"] ?? body["imageBase64"]);
        if (!image) return refuse(422, "thieu_anh", "Thiếu ảnh để đọc tem (jpeg/png, tối đa 8 MB).");
        const read = await readImageOnXeon(ctx, image, "tem");
        if (!read.ok) return refuse(503, "khong_doc_duoc", read.message);
        const doc = read.doc;
        const items = await inventory(ctx).adminSearch({ query: "", limit: 20000 });
        const tokens = [text(doc["code"], 40), ...text(doc["text"], 2000).split(/\s+/)];
        const code = resolveTagCode(tokens, items.map((i) => i.code));
        const entry = code.code ? items.find((i) => i.code.toUpperCase() === code.code) ?? null : null;
        const warehouse = text(body["maKho"] ?? body["branchId"], 60).toLowerCase();
        const product = entry ? knownProduct(entry, warehouse) : null;
        const size = resolveTagSize([text(doc["primarySize"], 16), ...(Array.isArray(doc["sizes"]) ? doc["sizes"].map((x) => text(x, 16)) : [])], product ? product.sizes.map((s) => s.size) : []);
        return reply.json({
          ok: true, scanId: `scan_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`, engine: "xeon", elapsedMs: Date.now() - started,
          code: code.code, codeConfidence: code.confidence,
          codeCandidates: code.candidates.filter((c) => c !== code.code).slice(0, 8).map((c) => ({ code: c, name: items.find((i) => i.code.toUpperCase() === c)?.name ?? "" })),
          knownProduct: product, size: size.size, sizeSource: size.source, sizeOptions: size.options.slice(0, 24), aiNote: "", rawTextPreview: text(doc["text"], 400)
        }, 200, NO_STORE);
      }
    },
    {
      method: "GET", path: "/api/tinh-nang-shop/quet-tem/mon", access: ACCESS.admin, rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const code = text(request.query["ma"] ?? request.query["code"], 80).toUpperCase();
        const found = code ? (await inventory(ctx).adminSearch({ query: code, limit: 5 })).find((i) => i.code.toUpperCase() === code) : undefined;
        if (!found) return refuse(404, "product_not_found", "Mã này chưa có trong catalog.");
        return reply.json({ ok: true, knownProduct: knownProduct(found, text(request.query["maKho"] ?? request.query["branchId"], 60).toLowerCase()) }, 200, NO_STORE);
      }
    },
    page("/scan", "/scan.html"), page("/scan.js", "/scan.js"), page("/scan.css", "/scan.css"), page("/scan-api.js", "/scan-api.js"),
    page("/m", "/m.html"), page("/m.js", "/m.js"), page("/m.css", "/m.css"),
    // ---------------- automatic purchase queue (screen side) ----------------
    {
      method: "GET", path: "/api/tinh-nang-shop/mua-ho", access: ACCESS.admin, rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx) => reply.json({ ok: true, ...snapshot(await queueDoc(ctx).read(null), await queueSettings(ctx)) }, 200, NO_STORE)
    },
    {
      method: "POST", path: "/api/tinh-nang-shop/mua-ho/quet", access: ACCESS.admin, rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: async (ctx) => reply.json(await scanQueue(ctx), 200, NO_STORE)
    },
    {
      method: "POST", path: "/api/tinh-nang-shop/mua-ho/xep-lai", access: ACCESS.admin, rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = await bodyOf(request);
        const ids = (Array.isArray(body["ids"]) ? body["ids"] : [body["id"]]).map((x) => text(x, 80)).filter(Boolean);
        let count = 0;
        await queueDoc(ctx).update((current) => { const r = requeue(current, ids); count = r.count; return r.book; }, { version: 1, items: [] });
        return reply.json({ ok: true, requeued: count, message: `Đã xếp lại ${count} việc.` }, 200, NO_STORE);
      }
    },
    // ---------------- browser extension key + door ----------------
    {
      method: "GET", path: "/api/tinh-nang-shop/tien-ich/khoa", access: ACCESS.admin, rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx) => {
        const book = await ctx.ports.store.document<KeyBook>(KEY_DOCUMENT).read(null);
        return reply.json({ ok: true, daCo: Boolean(book?.bam), taoLuc: book?.taoLuc ?? "", duoi: book?.duoi ?? "" }, 200, NO_STORE);
      }
    },
    {
      // Mints a NEW key (the old one stops working) and shows it ONCE — only its hash is kept.
      method: "POST", path: "/api/tinh-nang-shop/tien-ich/khoa", access: ACCESS.admin, rateLimit: { calls: 10, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const key = `TI1.${crypto.randomBytes(24).toString("base64url")}`;
        const at = ctx.ports.clock.now().toISOString();
        await ctx.ports.store.document<KeyBook>(KEY_DOCUMENT).write({ version: 1, bam: sha(key), taoLuc: at, duoi: key.slice(-4) });
        ctx.ports.logger.info(`[tinh-nang-shop] tao khoa tien ich moi (${actorOf(request)})`);
        return reply.json({ ok: true, khoa: key, taoLuc: at, message: "Khoá mới đã tạo — dán vào tiện ích ngay, màn hình sẽ không hiện lại khoá này." }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/tien-ich/:viec", access: ACCESS.public,
      whyPublic: "Tiện ích trình duyệt của shop (tra tồn, mua hộ tự động) không có vé máy. Tự kiểm khoá tiện ích (chỉ giữ bản băm, so sánh hằng thời gian) trước khi đọc gì; chỉ các việc trong danh sách.",
      rateLimit: { calls: 1200, windowMs: TEN_MINUTES }, bodyLimit: 16 * 1024,
      handle: async (ctx, request) => {
        if (!(await extensionAllowed(ctx, request))) return refuse(401, "sai_khoa_tien_ich", "Khoá tiện ích sai hoặc chưa tạo — tạo khoá ở màn Kết nối trong OMI.");
        const r = await extensionJob(ctx, text(request.params["viec"], 40), await bodyOf(request));
        return reply.json(r.body, r.status, NO_STORE);
      }
    },
    // ---------------- Google Drive backup ----------------
    {
      method: "GET", path: "/api/tinh-nang-shop/sao-luu", access: ACCESS.admin, rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx) => {
        const s = await settingsOf(ctx);
        return reply.json({ ok: true, daCauHinh: validBackupUrl(s["google_sao_luu_url"]) !== "" && text(s["google_sao_luu_token"]) !== "", ganNhat: await ctx.ports.store.document<Body>(BACKUP_DOCUMENT).read(null) }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/tinh-nang-shop/sao-luu/chay", access: ACCESS.admin, rateLimit: { calls: 10, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = await bodyOf(request);
        const s = await settingsOf(ctx);
        const url = validBackupUrl(s["google_sao_luu_url"]);
        if (!url) return refuse(400, "chua_cau_hinh", "Cần nhập Web app URL Google Apps Script hợp lệ (Cấu hình Google Drive).");
        if (!text(s["google_sao_luu_token"])) return refuse(400, "chua_cau_hinh", "Cần nhập Secret token đã đặt trong Apps Script.");
        const orders = ctx.services["don-khach"] ? (await ctx.services["don-khach"].search({ limit: 500 })) as unknown as BackupOrder[] : [];
        const shipments = ctx.services["van-chuyen"] ? await ctx.services["van-chuyen"].shipmentBook() : {};
        const reason = ["manual", "daily", "before-update", "before-import", "after-import"].includes(text(body["lyDo"], 20)) ? text(body["lyDo"], 20) : "manual";
        const result = await forwardBackup(ctx.ports.http, { url, token: s["google_sao_luu_token"]!, reason, note: text(body["ghiChu"], 500), payload: backupPayload(orders, shipments, ctx.ports.clock.now()) });
        if (result["ok"] !== true) return reply.json(result, 502, NO_STORE);
        const last = { ...result, reason, note: text(body["ghiChu"], 500), createdAt: ctx.ports.clock.now().toISOString(), soDon: orders.length };
        await ctx.ports.store.document<Body>(BACKUP_DOCUMENT).write(last);
        return reply.json({ ...last, ok: true, message: `Đã tạo backup Google Sheet: ${text(result["fileName"] ?? result["backupId"]) || "thành công"}.` }, 200, NO_STORE);
      }
    },
    // ---------------- stock command (same as Zalo, for the screen) ----------------
    {
      method: "POST", path: "/api/tinh-nang-shop/lenh-ton", access: ACCESS.admin, rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = await bodyOf(request);
        const answer = await runStockCommand(ctx, text(body["nguoi"], 120) || `omi:${actorOf(request)}`, text(body["chu"], 500));
        return reply.json({ ok: true, traLoi: answer || "Không phải lệnh tồn / hết / hoàn." }, 200, NO_STORE);
      }
    }
  ],

  botTools: []
});

/** Desk's `productPayload`: one entry per size with the price and what the chosen warehouse holds as ready stock. */
function knownProduct(item: { code: string; name: string; thumbnailImage: string; highImage: string; price: number; listPrice: number; sizes: { size: string; qty: number; price: number; listPrice: number; warehouseId: string; nguon: string }[] }, warehouse: string) {
  const bySize = new Map<string, { size: string; salePrice: number; listPrice: number; branchQty: number }>();
  for (const s of item.sizes) {
    const key = normaliseSize(s.size);
    const row = bySize.get(key) ?? { size: s.size, salePrice: 0, listPrice: 0, branchQty: 0 };
    row.salePrice = Math.max(row.salePrice, s.price || item.price);
    row.listPrice = Math.max(row.listPrice, s.listPrice || item.listPrice);
    if (s.nguon === "ready" && (!warehouse || s.warehouseId.toLowerCase() === warehouse)) row.branchQty += s.qty;
    bySize.set(key, row);
  }
  return { code: item.code, name: item.name, imageUrl: item.thumbnailImage || item.highImage, sizes: [...bySize.values()] };
}
