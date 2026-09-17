/**
 * @file MODULE "hang-kho" — catalogue & inventory. Tier "van-hanh", runs on the merchant server.
 *
 * This is the ROOT of the whole system: every other part asks it "is it in stock". That is why
 * it provides more services than any other module, and why it is the only module allowed to
 * WRITE the catalogue tables.
 *
 * Three doors, no fourth:
 *   1. Image Tool pushes the catalogue          -> POST /api/products          (admin)
 *   2. Desk pushes ready stock / campaigns      -> POST /api/ready-stock/sync  (admin)
 *                                                  POST /api/partner-campaigns (admin)
 *   3. Web and bot read                         -> GET /api/products (public) + services
 *
 * THREE STOCK SOURCES IN ONE TABLE (`hang_kho_bien_the`, told apart by `nguon`), so there is no
 * merge function on every read — and no three versions of the truth to drift apart. Syncing one
 * source touches only that source's rows.
 *
 * BLOCKED CODES (v-block) apply at BOTH ends — on WRITE and on READ. Block one end only and
 * some detour lets a code through; that actually happened, so the old site blocked both, and so
 * does this one.
 *
 * NAMES: in-process services (`ctx.services["hang-kho"].reserve(...)`) speak English; the HTTP
 * routes keep the Vietnamese wire (`soMon`, `cacDong`, `viSao`...) that OMI, Desk, Image Tool and
 * the brain read. The translation happens here, at the boundary, and nowhere deeper.
 */

import { ACCESS, ERROR_CODES, EVENTS, defineModule, reply, type KernelRequest, type ModuleContext, type ReplyDraft } from "../../contract";
import { bytesFromDataUrl } from "../../shared/data-url";
import {
  CatalogRepository, SOURCE, mysqlTime, type StoredItem, type CommitOutcome, type DeleteResult, type QuickEditPatch, type ReserveFailure, type RestockOutcome,
  type Source, type StockLine, type SyncResult, type WriteOneResult
} from "./catalog-repository";
import { CatalogHistory } from "./catalog-history";
import { DEFAULT_READY_WAREHOUSES, convertCampaignPayload, convertReadyStockPayload } from "./desk-payloads";
import { SIZE_SYSTEMS, SheetInputError, googleSheetCsvUrl, itemsFromRows, looksLikeHtml, parseCsv, type SizeSystem } from "./import-sheet";
import { asRecord, publicView, type PublicItem } from "./normalise";
import { MOVEMENT_KINDS, StockLedger, type AdjustOutcome } from "./stock-ledger";
import { SCHEMA, TABLES } from "./schema";

const RESERVATION_TTL_MS = 30 * 60 * 1000;   // hold 30 minutes, then give back if the order was not placed
const TEN_MINUTES_MS = 10 * 60 * 1000;
/** Document remembering the last ready-stock revision Desk sent. Name is on-disk contract. */
const READY_STOCK_REVISION_DOCUMENT = "hang-kho-hang-co-san";
/** The most items one OMI import may carry. */
const IMPORT_CAP = 20000;
/** Document remembering the last imports. Name is on-disk contract. */
const IMPORT_LOG_DOCUMENT = "hang-kho-lich-su-nap";
const IMPORT_LOG_CAP = 50;
const WAREHOUSE_BOOK_DOCUMENT = "hang-kho-danh-muc-kho-v2";
const WAREHOUSE_POLICY_DOCUMENT = "hang-kho-chinh-sach-theo-kho-v2";
const WAREHOUSE_MIGRATION_DOCUMENT = "hang-kho-migration-nguon-v2";
const STOCK_IMPORT_SESSION_DOCUMENT = "hang-kho-phien-nhap-file-v2";

interface WarehouseRecord { id: string; name: string; type: "ready" | "order"; status: "active" | "inactive"; priority: number; description: string; updatedAt: string }
interface WarehouseBook { version: 2; warehouses: WarehouseRecord[]; legacyMap: Record<string, string>; updatedAt: string }
interface WarehousePolicy { warehouseId: string; version: number; effectiveAt: string; summary: string; enabled: boolean; cod: boolean; depositPercent: number; leadTimeDays: number; orderLimit: number; surcharge: number; returns: string; channels: string }
interface WarehousePolicyBook { version: 2; policies: WarehousePolicy[]; updatedAt: string }

const emptyWarehouseBook = (): WarehouseBook => ({ version: 2, warehouses: [], legacyMap: {}, updatedAt: "" });
const emptyPolicyBook = (): WarehousePolicyBook => ({ version: 2, policies: [], updatedAt: "" });

/** The import book: newest first, at most `IMPORT_LOG_CAP` entries. Field names are wire (OMI reads them). */
interface ImportLog {
  lan: Record<string, unknown>[];
}
/** The most items ONE quick edit may touch — a bulk screen with no ceiling is a bulk mistake. */
const QUICK_EDIT_CAP = 1000;

/** Error strings answered by this module's doors. Wire: OMI, Desk and Image Tool branch on them. */
export const CATALOG_ERRORS = {
  needProductArray: "can_mot_mang_san_pham",
  needReadyStockPayload: "can_mot_goi_hang_co_san",
  staleReadyStock: "goi_hang_co_san_cu",
  needCampaignPayload: "can_mot_goi_chien_dich",
  needItem: "can_mot_mon",
  codeMismatch: "ma_khong_khop_duong_dan",
  itemDropped: "mon_bi_bo",
  tooManyItems: "qua_nhieu_mon",
  notFound: "khong_thay"
} as const;

/** The public product page's 404 code — the old site's, which the storefront was written against. */
export const PUBLIC_PRODUCT_NOT_FOUND = "product_not_found";

/**
 * `ctx.config` for this module. The composition root currently hands it `{}`; every key is
 * optional so that stays valid. The keys carry over hooks the old code read (`khoHangCoSan`,
 * `maChanSan`, `maChanThem`) which no composition root has ever set.
 */
export interface Config {
  /** Ready-stock warehouses this shop may sell (`*` suffix = prefix match). Unset = TopRun's default list. */
  readyStockWarehouses?: string[];
  /** Codes blocked from the catalogue, on top of the `hang_kho_ma_chan` table. */
  blockedCodes?: string[];
  /** More blocked codes, comma-separated. */
  extraBlockedCodes?: string;
}

type Ctx = ModuleContext<Config>;

// ---- service inputs and results (in-process, English; reason VALUES are wire) --------------

export interface SearchInput { query?: string; limit?: number }
export interface StockInput { code?: string; size?: string }
export type StockResult =
  | { found: false; available: false; reason: "khong_co_ma"; lines: StockLine[] }
  | { found: true; available: boolean; code: string; name: string; lines: StockLine[] };
export interface ReserveInput { code: string; size: string; quantity: number; heldBy: string }
export type ReserveResult =
  | { ok: true; ticket: string; variantId: string; size: string; price: number; warehouseId: string }
  | { ok: false; reason: ReserveFailure };
export interface ReleaseInput { ticket: string }
export interface ReleaseResult { ok: boolean }
export interface CommitInput { ticket: string }
export type CommitResult = CommitOutcome;
export interface RestockInput { variantId: string; quantity: number }
export type RestockResult = RestockOutcome;

/** The services this module PROVIDES (`hang-kho.search` ...). Consumers `import type` this. */
export interface InventoryServices {
  /** Items matching a query (public view); no query = the whole catalogue. */
  search(input?: SearchInput): Promise<PublicItem[]>;
  /** In-stock lines of one item, optionally of one size. */
  stock(input?: StockInput): Promise<StockResult>;
  /** Holds one variant for 30 minutes. */
  reserve(input: ReserveInput): Promise<ReserveResult>;
  /** Gives a reservation back. */
  release(input: ReleaseInput): Promise<ReleaseResult>;
  /** Turns a reservation into a sale: stock goes down for good, the ticket is gone. */
  commit(input: CommitInput): Promise<CommitResult>;
  /** Puts pairs back on the shelf (a cancelled order). */
  restock(input: RestockInput): Promise<RestockResult>;
  /** Puts returned pairs into a CHOSEN warehouse, written in the stock book (a return). */
  restockInto(input: { code: string; size: string; warehouseId: string; quantity: number; note?: string; actor?: string; reference?: string }): Promise<AdjustOutcome>;
  /** How many items the catalogue holds. */
  count(): Promise<number>;
  /** Writes ONE house item (add or edit). */
  write(item: unknown): Promise<WriteOneResult>;
  /** One item by code or slug (public view). */
  read(key: string): Promise<PublicItem | null>;
  // ----- Đ10 (17/09/2026): features that used to be TopRun-only, now per shop configuration -----
  /** House view (real stock, partner names) of what a search finds; `source` / `size` narrow it. */
  adminSearch(input: { query?: string; limit?: number; source?: string; size?: string }): Promise<StoredItem[]>;
  /** House view of everything stocked from one source. */
  bySource(input: { source: string; limit?: number }): Promise<StoredItem[]>;
  /** Writes items of ONE warehouse of one source, keeping that source's lines in OTHER warehouses. */
  writeWarehouse(input: { source: string; warehouseId: string; items: Record<string, unknown>[] }): Promise<{ itemCount: number; variantCount: number; written: number; yielded: number; dropped: number }>;
  /** Sets the stock of one size in one warehouse to an exact number, through the stock book. */
  setStock(input: SetStockInput): Promise<SetStockOutcome>;
  /** Every stock row of a code (+ size): warehouse, source, number. For "which warehouse?" questions. */
  stockRows(input: { code: string; size?: string }): Promise<StockRow[]>;
  /** Keeps a photo (bytes) and sets it as the main image or adds it to the gallery. */
  addPhoto(input: { code: string; bytes: Buffer; primary?: boolean; actor?: string }): Promise<AddPhotoOutcome>;
  /** The selling price of one size line (manual partner stock read from a photo). Returns the rows changed. */
  setPrice(input: { code: string; size: string; warehouseId: string; source?: string; price: number }): Promise<number>;
}

export interface SetStockInput { code: string; size: string; warehouseId: string; source?: string; quantity: number; note?: string; actor?: string }
export type SetStockOutcome = AdjustOutcome | { ok: true; unchanged: true; before: number; after: number };
export interface StockRow { code: string; size: string; warehouseId: string; source: string; quantity: number }
export type AddPhotoOutcome = { ok: true; url: string; chinh: boolean } | { ok: false; error: string; message: string };

function repository(ctx: Ctx): CatalogRepository {
  return new CatalogRepository({
    store: ctx.ports.store, clock: ctx.ports.clock, logger: ctx.ports.logger,
    configuredBlockedCodes: [...(ctx.config.blockedCodes ?? []), ...String(ctx.config.extraBlockedCodes || "").split(",")]
  });
}

const notNull = <T>(value: T | null): value is T => value !== null;

// ---- services --------------------------------------------------------------------------------

async function search(ctx: Ctx, { query = "", limit = 10 }: SearchInput = {}): Promise<PublicItem[]> {
  const items = await repository(ctx).searchItems(query, limit);
  return items.map(publicView).filter(notNull);
}

async function stock(ctx: Ctx, { code = "", size = "" }: StockInput = {}): Promise<StockResult> {
  const found = await repository(ctx).stockOf(code, size);
  if (!found) return { found: false, available: false, reason: "khong_co_ma", lines: [] };
  return { found: true, available: found.lines.length > 0, code: found.code, name: found.name, lines: found.lines };
}

/**
 * Holds one variant for 30 minutes. The read-then-write race is closed inside the repository
 * (one transaction, row locked); this layer only mints the ticket and announces a sell-out.
 */
async function reserve(ctx: Ctx, input: ReserveInput): Promise<ReserveResult> {
  const quantity = Math.max(1, Math.trunc(Number(input.quantity) || 1));
  const at = ctx.ports.clock.now();
  const ticket = `giu_${at.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
  const outcome = await repository(ctx).reserve({
    code: String(input.code || ""), size: String(input.size || ""), quantity, heldBy: String(input.heldBy || ""),
    ticket, at, expiresAt: new Date(at.getTime() + RESERVATION_TTL_MS)
  });
  if (!outcome.ok) return outcome;
  if (outcome.remaining <= 0) {
    // Bus payload keeps the field names listeners have always read.
    ctx.bus.emit(EVENTS.stockOut, { ma: outcome.code, size: outcome.size, maBienThe: outcome.variantId });
  }
  return { ok: true, ticket: outcome.ticket, variantId: outcome.variantId, size: outcome.size, price: outcome.price, warehouseId: outcome.warehouseId };
}

async function release(ctx: Ctx, input: ReleaseInput): Promise<ReleaseResult> {
  return { ok: await repository(ctx).release(input.ticket) };
}

/** The order was written: the hold becomes a sale (see `CatalogRepository.commit`). */
async function commit(ctx: Ctx, input: CommitInput): Promise<CommitResult> {
  return repository(ctx).commit(input.ticket);
}

/** A cancelled order gives its pairs back; crossing zero announces "back in stock" to the bus. */
async function restock(ctx: Ctx, input: RestockInput): Promise<RestockResult> {
  const outcome = await repository(ctx).restock(input.variantId, input.quantity);
  if (outcome.ok && outcome.before <= 0 && outcome.after > 0) {
    ctx.bus.emit(EVENTS.stockBack, { ma: outcome.code, size: outcome.size, maBienThe: outcome.variantId });
  }
  return outcome;
}

// ---- the Vietnamese wire of the HTTP doors -----------------------------------------------------

/** A sync result as Desk / Image Tool / OMI read it. */
function syncWire(result: SyncResult): Record<string, unknown> {
  return { soMon: result.itemCount, soBienThe: result.variantCount, soMonGhi: result.written, soMonNhuong: result.yielded, biBo: result.dropped };
}

/** A delete result as OMI reads it. */
function deleteWire(result: DeleteResult): Record<string, unknown> {
  return { daXoa: result.deleted, conNguonKhac: result.otherSourceRemains, viSao: result.reason };
}

/** A stock answer as the brain reads it (`GET /api/hang-kho/ton/:ma`). */
function stockWire(result: StockResult): Record<string, unknown> {
  const cacDong = result.lines.map((l) => ({ maBienThe: l.variantId, size: l.size, soLuong: l.quantity, gia: l.price, maKho: l.warehouseId, thuTu: l.rank }));
  if (!result.found) return { co: false, viSao: result.reason, cacDong };
  return { co: result.available, ma: result.code, ten: result.name, cacDong };
}

// ---- writing ---------------------------------------------------------------------------------

/** The product list of an upload body: a bare array, or `{ products }` / `{ items }`. `null` = not a list. */
function productList(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body as unknown[];
  const record = asRecord(body);
  if (Array.isArray(record.products)) return record.products as unknown[];
  if (Array.isArray(record.items)) return record.items as unknown[];
  return null;
}

type SyncOutcome = { ok: true; result: SyncResult } | { ok: false; error: string };

/** Replaces one source with the uploaded list and logs what happened. */
async function loadSource(ctx: Ctx, source: Source, body: unknown, label: string): Promise<SyncOutcome> {
  const list = productList(body);
  if (!list) return { ok: false, error: CATALOG_ERRORS.needProductArray };
  const result = await repository(ctx).replaceSource(source, list);
  ctx.ports.logger.info(
    `[hang-kho] nạp ${label}: ${result.itemCount} món / ${result.variantCount} biến thể` +
    (result.dropped > 0 ? `, bỏ ${result.dropped} (mã bị chặn hoặc thiếu mã/tên)` : "")
  );
  await noteImport(ctx, { nguon: source, viec: label, ...syncWire(result) });
  return { ok: true, result };
}

/**
 * Remembers what the last imports did — "Đồng bộ kho" in Sales Desk.
 *
 * Without this, a catalogue that suddenly lost 400 items has no story: the operating log rolls
 * over, and the tables only ever show the present. The book is deliberately small and bounded —
 * the last `IMPORT_LOG_CAP` runs — because it is a place to look when something went wrong, not
 * an audit trail. It can never fail an import: a write that throws is logged and swallowed.
 */
async function noteImport(ctx: Ctx, entry: Record<string, unknown>): Promise<void> {
  try {
    const book = ctx.ports.store.document<ImportLog>(IMPORT_LOG_DOCUMENT);
    const now = (await book.read(null))?.lan ?? [];
    const next = [{ luc: ctx.ports.clock.now().toISOString(), ...entry }, ...now].slice(0, IMPORT_LOG_CAP);
    await book.write({ lan: next });
  } catch (e) {
    ctx.ports.logger.warn(`[hang-kho] khong ghi duoc lich su nap: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function syncReply(outcome: SyncOutcome, extra: Record<string, unknown> = {}) {
  return outcome.ok ? reply.json({ ok: true, ...syncWire(outcome.result), ...extra }) : reply.json({ ok: false, error: outcome.error }, 400);
}

interface ReadyStockRevision {
  revision: number;
  luc: string;
}

/** Product photos uploaded from the warehouse page (upload port zone), served at `/api/hang-kho/anh/<name>`. */
const PHOTO_ZONE = "hang-kho/anh";

/** The warehouse page is the shop's own tool: signed-in people and admin machines only. */
async function signedIn(ctx: Ctx, request: KernelRequest): Promise<boolean> {
  return ctx.ports.auth.callerAllows(await ctx.ports.auth.resolve(request), ACCESS.admin);
}

async function serveWarehouseFile(ctx: Ctx, request: KernelRequest, file: string): Promise<ReplyDraft> {
  if (!(await signedIn(ctx, request))) {
    // no-store: without it Cloudflare stamps the 404 "max-age=14400" and the browser keeps the page
    // unstyled for four hours after the person signs in (17/09/2026).
    return file.endsWith(".html") ? reply.redirect("/admin-login") : reply.json({ ok: false, error: ERROR_CODES.notFound }, 404, { "Cache-Control": "no-store" });
  }
  const found = await ctx.ports.staticFiles.open(`${ctx.id}/goc`).read(file);
  if (!found) return reply.json({ ok: false, error: ERROR_CODES.notFound }, 404);
  return reply.file(found.data, found.type, 200, { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });
}

/** A bucket named on the wire (`ready` / `own` / `campaign`), or `null`. */
function sourceOf(value: unknown): Source | null {
  const v = String(value ?? "").trim();
  return (Object.values(SOURCE) as string[]).includes(v) ? (v as Source) : null;
}

function ledger(ctx: Ctx): StockLedger {
  return new StockLedger(ctx.ports.store, () => ctx.ports.clock.now());
}

/** Who changed the shelf, for the stock book: the person or machine the kernel resolved. */
function actorOf(request: { caller?: { name?: string } }): string {
  return String(request.caller?.name || "quan-tri");
}

function history(ctx: Ctx): CatalogHistory {
  return new CatalogHistory(ctx.ports.store, () => ctx.ports.clock.now());
}

/** Document with Sales Desk's ready-stock selling policy (`rs-policy`). Name is on-disk contract. */
const READY_POLICY_DOCUMENT = "hang-kho-chinh-sach-hang-san";

/** Wire names: `tomTat` (shown on the web), `choCod`, `phanTramCoc`. */
interface ReadyPolicy {
  tomTat: string;
  choCod: boolean;
  phanTramCoc: number;
}

async function readyPolicy(ctx: Ctx): Promise<ReadyPolicy> {
  const saved = await ctx.ports.store.document<ReadyPolicy>(READY_POLICY_DOCUMENT).read(null);
  return { tomTat: String(saved?.tomTat ?? ""), choCod: saved?.choCod !== false, phanTramCoc: Number(saved?.phanTramCoc ?? 0) };
}

/** The public view plus the ready-stock policy line on items that sell ready stock. */
async function withReadyPolicy(ctx: Ctx, items: unknown[]): Promise<PublicItem[]> {
  const summary = (await readyPolicy(ctx)).tomTat;
  return items
    .map((item) => {
      const record = asRecord(item);
      const hasReady = summary !== "" && Array.isArray(record["sizes"]) && (record["sizes"] as unknown[]).some((s) => asRecord(s)["nguon"] === SOURCE.ready);
      return publicView(hasReady ? { ...record, readyPolicySummary: summary } : item);
    })
    .filter(notNull);
}

/** The most items one "tải ảnh về" call works on, and images per item — one call must end in seconds, not hours. */
const CACHE_ITEMS_CAP = 30;
const CACHE_IMAGES_PER_ITEM = 12;

/**
 * Sales Desk "Tải gallery ảnh" (`cache-product-images`): copies remote product photos into the
 * shop's own photo zone and points the item at the copies. An image that fails stays as it was
 * (and is counted), so a dead partner link never empties a gallery.
 */
async function cacheImages(ctx: Ctx, codes: string[], actor: string): Promise<{ soMon: number; taiDuoc: number; hong: number; loi: string[] }> {
  const table = ctx.ports.store.table("hang_kho_mon");
  let saved = 0;
  let failed = 0;
  const errors: string[] = [];
  let touched = 0;
  for (const code of codes) {
    const row = await table.one({ ma: code });
    if (!row) continue;
    const gallery = (() => { try { return JSON.parse(String(row["anh_khac_json"] || "[]")) as string[]; } catch { return []; } })();
    const all = [String(row["anh_dai_dien"] || ""), ...gallery].filter(Boolean);
    const remote = [...new Set(all.filter((u) => /^https?:\/\//i.test(u)))].slice(0, CACHE_IMAGES_PER_ITEM);
    if (remote.length === 0) continue;
    const copies = new Map<string, string>();
    for (const url of remote) {
      try {
        const response = await ctx.ports.http.fetch(url, { timeoutMs: 20000 });
        if (!response.ok || typeof response.arrayBuffer !== "function") throw new Error(`HTTP ${response.status}`);
        const file = await ctx.ports.uploads.saveImage(PHOTO_ZONE, Buffer.from(await response.arrayBuffer()), code);
        copies.set(url, `/api/hang-kho/anh/${file.name}`);
        saved += 1;
      } catch (e) {
        failed += 1;
        if (errors.length < 10) errors.push(`${code}: ${url.slice(0, 80)} — ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (copies.size === 0) continue;
    if (touched === 0) await history(ctx).capture(codes.length === 1 ? `Trước khi tải ảnh về ${code}` : "Trước khi tải gallery toàn bộ", codes, actor);
    touched += 1;
    const swap = (u: string) => copies.get(u) ?? u;
    const main = swap(String(row["anh_dai_dien"] || ""));
    await table.update({ ma: code }, {
      anh_dai_dien: main, anh_lon: row["anh_lon"] ? swap(String(row["anh_lon"])) : main,
      anh_khac_json: JSON.stringify(gallery.map(swap)), sua_luc: mysqlTime(ctx.ports.clock.now())
    });
  }
  return { soMon: touched, taiDuoc: saved, hong: failed, loi: errors };
}

/** Puts returned pairs into a CHOSEN warehouse (a return goes to ready stock, whatever it was sold from). */
async function restockInto(ctx: Ctx, input: { code: string; size: string; warehouseId: string; quantity: number; note?: string; actor?: string; reference?: string }): Promise<AdjustOutcome> {
  const quantity = Math.max(0, Math.trunc(Number(input.quantity) || 0));
  const outcome = await ledger(ctx).adjust({
    code: input.code, size: input.size, warehouseId: input.warehouseId, quantity, note: input.note ?? "", actor: input.actor ?? "don-khach",
    kind: MOVEMENT_KINDS.returned, reference: input.reference ?? ""
  });
  if (outcome.ok && outcome.before <= 0 && outcome.after > 0) ctx.bus.emit(EVENTS.stockBack, { ma: input.code, size: input.size, maBienThe: outcome.variantId });
  return outcome;
}

// ---- Đ10 services ------------------------------------------------------------------------------

async function writeWarehouse(ctx: Ctx, input: { source: string; warehouseId: string; items: Record<string, unknown>[] }, replaceMissing = false) {
  const source = sourceOf(input.source);
  const warehouseId = String(input.warehouseId ?? "").trim();
  if (!source || !warehouseId) throw new Error("writeWarehouse needs a source and a warehouse id.");
  const repo = repository(ctx);
  const raw: Record<string, unknown>[] = [];
  const incoming = Array.isArray(input.items) ? input.items : [];
  const incomingCodes = new Set(incoming.map((i) => String(i["code"] ?? "").trim()).filter(Boolean));
  const missingCodes = replaceMissing ? (await ctx.ports.store.rows(`SELECT DISTINCT ma_mon FROM ${TABLES.variants} WHERE nguon = ? AND ma_kho = ?`, [source, warehouseId])).map((r) => String(r["ma_mon"])).filter((c) => !incomingCodes.has(c)) : [];
  const allItems: Record<string, unknown>[] = [...incoming];
  for (const code of missingCodes) { const old = await repo.readItem(code); if (old) allItems.push({ ...old, sizes: [] }); }
  for (const item of allItems) {
    const code = String(item["code"] ?? "").trim();
    // writeItems replaces EVERY line of (code, source): keep the lines this source has in other warehouses.
    const existing = code ? await repo.readItem(code) : null;
    const kept = (existing?.sizes ?? [])
      .filter((sz) => sz.nguon === source && sz.warehouseId !== warehouseId)
      .map((sz) => ({ size: sz.size, qty: sz.qty, price: sz.price, listPrice: sz.listPrice, warehouseId: sz.warehouseId, sku: sz.sku, costPrice: sz.costPrice }));
    const mine = (Array.isArray(item["sizes"]) ? (item["sizes"] as Record<string, unknown>[]) : []).map((sz) => ({ ...sz, warehouseId }));
    raw.push({ ...item, sizes: [...mine, ...kept] });
  }
  const r = await repo.writeItems(source, raw);
  return { itemCount: r.itemCount, variantCount: r.variantCount, written: r.written, yielded: r.yielded, dropped: r.dropped, missingCodes };
}

async function setStock(ctx: Ctx, input: SetStockInput): Promise<SetStockOutcome> {
  const target = Math.trunc(Number(input.quantity));
  if (!Number.isFinite(target) || target < 0) return { ok: false, reason: "so_luong_sai", message: "Số lượng phải là số nguyên không âm." };
  const source = sourceOf(input.source);
  const rows = await ctx.ports.store.rows(
    `SELECT ton FROM hang_kho_bien_the WHERE ma_mon = ? AND size = ? AND ma_kho = ?${source ? " AND nguon = ?" : ""} ORDER BY ton DESC LIMIT 1`,
    source ? [input.code, input.size, input.warehouseId, source] : [input.code, input.size, input.warehouseId]
  );
  const before = Number(rows[0]?.["ton"] ?? 0);
  if (before === target) return { ok: true, unchanged: true, before, after: target };
  return ledger(ctx).adjust({
    code: input.code, size: input.size, warehouseId: input.warehouseId, quantity: target - before,
    note: input.note ?? "", actor: input.actor ?? "tinh-nang-shop", ...(source ? { source } : {})
  });
}

async function stockRows(ctx: Ctx, input: { code: string; size?: string }): Promise<StockRow[]> {
  const size = String(input.size ?? "").trim();
  const rows = await ctx.ports.store.rows(
    `SELECT ma_mon, size, ma_kho, nguon, ton FROM hang_kho_bien_the WHERE ma_mon = ?${size ? " AND size = ?" : ""} ORDER BY ma_kho, size`,
    size ? [input.code, size] : [input.code]
  );
  return rows.map((r) => ({ code: String(r["ma_mon"]), size: String(r["size"]), warehouseId: String(r["ma_kho"]), source: String(r["nguon"]), quantity: Number(r["ton"] || 0) }));
}

/** A photo kept by the upload port, set as the main image (or added to the gallery). Shared by the route and the service. */
async function addPhoto(ctx: Ctx, input: { code: string; bytes: Buffer; primary?: boolean; actor?: string }): Promise<AddPhotoOutcome> {
  const code = String(input.code ?? "").trim();
  const item = await ctx.ports.store.table("hang_kho_mon").one({ ma: code });
  if (!item) return { ok: false, error: CATALOG_ERRORS.notFound, message: "Chưa có sản phẩm này — lưu sản phẩm trước." };
  let saved;
  try {
    saved = await ctx.ports.uploads.saveImage(PHOTO_ZONE, input.bytes, code);
  } catch (e) {
    const refusal = (e as { code?: string })?.code;
    if (refusal) return { ok: false, error: refusal, message: e instanceof Error ? e.message : String(e) };
    throw e;
  }
  await history(ctx).capture(`Trước khi thêm ảnh ${code}`, [code], input.actor ?? "quan-tri");
  const url = `/api/hang-kho/anh/${saved.name}`;
  const gallery = (() => { try { return JSON.parse(String(item["anh_khac_json"] || "[]")) as string[]; } catch { return []; } })();
  const makeMain = input.primary === true || !String(item["anh_dai_dien"] || "");
  await ctx.ports.store.table("hang_kho_mon").update({ ma: code }, makeMain
    ? { anh_dai_dien: url, anh_lon: url, anh_khac_json: JSON.stringify([...(item["anh_dai_dien"] ? [String(item["anh_dai_dien"])] : []), ...gallery]) }
    : { anh_khac_json: JSON.stringify([...gallery, url]) });
  return { ok: true, url, chinh: makeMain };
}

/** Ready-stock warehouses: the shop's setting (`kho_hang_san`), else the server config, else the legacy list. */
async function readyWarehouses(ctx: Ctx): Promise<readonly string[]> {
  const services = ctx.services as unknown as { "khung-nen-tang"?: { settings(): Promise<Record<string, string>> } };
  try {
    const typed = String((await services["khung-nen-tang"]?.settings())?.["kho_hang_san"] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (typed.length) return typed;
  } catch { /* a settings read never stops a sync */ }
  const configured = ctx.config.readyStockWarehouses;
  return Array.isArray(configured) && configured.length ? configured : DEFAULT_READY_WAREHOUSES;
}

export const manifest = defineModule<Config>({
  id: "hang-kho",
  name: "Hàng hoá & kho",
  tier: "van-hanh",
  runsOn: "server-khach",
  feature: "hang-kho",
  version: "0.2.0",
  ports: ["store", "logger", "clock", "bus", "config", "uploads", "staticFiles", "auth", "http"],
  schema: SCHEMA,

  events: { emits: [EVENTS.stockOut, EVENTS.stockBack], listens: {} },

  provides: {
    "hang-kho.search": search,
    "hang-kho.stock": stock,
    "hang-kho.reserve": reserve,
    "hang-kho.release": release,
    "hang-kho.commit": commit,
    "hang-kho.restock": restock,
    "hang-kho.restockInto": restockInto,
    "hang-kho.count": (ctx) => repository(ctx).countItems(),
    "hang-kho.write": (ctx, item: unknown) => repository(ctx).writeItem(SOURCE.own, item),
    "hang-kho.read": async (ctx, key: string) => {
      const item = await repository(ctx).readItem(key);
      return item ? publicView(item) : null;
    },
    "hang-kho.adminSearch": (ctx, input: { query?: string; limit?: number; source?: string; size?: string }) =>
      repository(ctx).searchItems(String(input?.query ?? ""), Number(input?.limit ?? 50), { size: String(input?.size ?? ""), source: String(input?.source ?? "") }),
    "hang-kho.bySource": async (ctx, input: { source: string; limit?: number }) => {
      const source = sourceOf(input?.source);
      return source ? repository(ctx).itemsBySource(source, Number(input?.limit ?? 500)) : [];
    },
    "hang-kho.writeWarehouse": (ctx, input: { source: string; warehouseId: string; items: Record<string, unknown>[] }) => writeWarehouse(ctx, input),
    "hang-kho.setStock": (ctx, input: SetStockInput) => setStock(ctx, input),
    "hang-kho.stockRows": (ctx, input: { code: string; size?: string }) => stockRows(ctx, input),
    "hang-kho.addPhoto": (ctx, input: { code: string; bytes: Buffer; primary?: boolean; actor?: string }) => addPhoto(ctx, input),
    "hang-kho.setPrice": async (ctx, input: { code: string; size: string; warehouseId: string; source?: string; price: number }) => {
      const price = Math.round(Number(input?.price));
      if (!(price > 0)) return 0;
      return repository(ctx).setVariantPrice({ code: String(input.code), size: String(input.size), warehouseId: String(input.warehouseId), source: sourceOf(input.source) ?? SOURCE.ready, price }, ctx.ports.clock.now());
    }
  },
  requiresOptional: ["khung-nen-tang.settings"],

  routes: [
    {
      method: "GET", path: "/api/products", access: ACCESS.public,
      whyPublic: "Danh mục để web bán hàng hiển thị. Bản trả ra đã bỏ giá vốn và tồn thật.",
      rateLimit: { calls: 600, windowMs: TEN_MINUTES_MS },
      handle: async (ctx, request) => {
        const items = await repository(ctx).searchItems(String(request.query["q"] || ""), Number(request.query["limit"] || 0));
        return reply.json(await withReadyPolicy(ctx, items), 200, { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" });
      }
    },
    {
      method: "GET", path: "/api/products/:khoa", access: ACCESS.public,
      whyPublic: "Trang sản phẩm công khai. Cùng bản đã bỏ giá vốn như danh mục.",
      rateLimit: { calls: 600, windowMs: TEN_MINUTES_MS },
      handle: async (ctx, request) => {
        // Envelope of the old site, kept byte for byte: `product.js` reads `payload.ok` / `payload.data`.
        // Returning the bare item (15/09/2026) left every product page on "Không tìm thấy sản phẩm".
        const item = await repository(ctx).readItem(request.params["khoa"]);
        if (!item) return reply.json({ ok: false, error: PUBLIC_PRODUCT_NOT_FOUND }, 404);
        return reply.json({ ok: true, data: (await withReadyPolicy(ctx, [item]))[0] ?? null }, 200, { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" });
      }
    },
    {
      // Image Tool pushes the whole house catalogue.
      method: "POST", path: "/api/products", access: ACCESS.admin,
      rateLimit: { calls: 20, windowMs: TEN_MINUTES_MS },
      // MEASURED 12/09/2026: Mr Dũng's full catalogue of 4,834 items weighs 10.2 MB when re-sent.
      // The old site capped at 10 MB — right at the edge; a slightly bigger catalogue is refused.
      // The split build allows 16 MB to leave room to breathe.
      bodyLimit: 16 * 1024 * 1024,
      handle: async (ctx, request) => syncReply(await loadSource(ctx, SOURCE.own, await request.json(), "danh mục"))
    },
    {
      // Sales Desk pushes ready stock. Touches ONLY rows with `nguon = ready`.
      //
      // Desk's real payload does NOT use `sizes`; it uses `variants` + `branches` + `policy` +
      // `pendingSales`, so it goes through the translation layer in `desk-payloads.ts`. Before
      // 12/09/2026 this route read `sizes` directly — all 80 ready-stock items were dropped
      // without a single error.
      method: "POST", path: "/api/ready-stock/sync", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES_MS },
      bodyLimit: 2 * 1024 * 1024,
      handle: async (ctx, request) => {
        const payload = await request.json();
        if (!payload || typeof payload !== "object") return reply.json({ ok: false, error: CATALOG_ERRORS.needReadyStockPayload }, 400);

        // AN OLD PAYLOAD MUST NOT OVERWRITE A NEWER ONE. Desk sends an increasing `revision`; an
        // old payload re-sent (flaky network, a retry click) would wipe the stock just synced.
        // Refused outright.
        const document = ctx.ports.store.document<ReadyStockRevision>(READY_STOCK_REVISION_DOCUMENT);
        const revision = Number(asRecord(payload).revision);
        const hasRevision = Number.isFinite(revision) && revision > 0;
        if (hasRevision) {
          const current = await document.read();
          if (current && Number(current.revision || 0) > revision) {
            ctx.ports.logger.warn(`[hang-kho] từ chối gói hàng có sẵn cũ: revision ${revision} < ${current.revision}`);
            return reply.json({ ok: false, error: CATALOG_ERRORS.staleReadyStock, revisionHienTai: Number(current.revision || 0) }, 409);
          }
        }

        const allowedWarehouses = await readyWarehouses(ctx);
        const items = convertReadyStockPayload(Array.isArray(payload) ? { products: payload } : payload, { allowedWarehouses });
        const outcome = await loadSource(ctx, SOURCE.ready, items, "hàng có sẵn");
        if (hasRevision && outcome.ok) {
          await document.write({ revision, luc: ctx.ports.clock.now().toISOString() });
          return syncReply(outcome, { revision });
        }
        return syncReply(outcome);
      }
    },
    {
      // Partner campaigns (Supersports/MaxxSport). Touches ONLY rows with `nguon = campaign`.
      //
      // The translation layer drops switched-off / expired campaigns and gives every size a LINE
      // ID — a sell-out report is keyed by line id, not by position (incident 10/09).
      method: "POST", path: "/api/partner-campaigns", access: ACCESS.admin,
      rateLimit: { calls: 20, windowMs: TEN_MINUTES_MS },
      bodyLimit: 5 * 1024 * 1024,
      handle: async (ctx, request) => {
        const payload = await request.json();
        if (!payload || typeof payload !== "object") return reply.json({ ok: false, error: CATALOG_ERRORS.needCampaignPayload }, 400);
        const items = convertCampaignPayload(Array.isArray(payload) ? { products: payload } : payload, { now: ctx.ports.clock.now() });
        return syncReply(await loadSource(ctx, SOURCE.campaign, items, "chiến dịch đối tác"));
      }
    },
    {
      // OMI (round L8, 14/09/2026): the shop ADDS / EDITS one house item itself — no Image Tool
      // needed. Touches only this item; the rest of the catalogue stays as it is.
      method: "PUT", path: "/api/hang-kho/mon/:ma", access: ACCESS.admin,
      rateLimit: { calls: 300, windowMs: TEN_MINUTES_MS },
      bodyLimit: 512 * 1024,
      handle: async (ctx, request) => {
        const body = await request.json();
        if (!body || typeof body !== "object" || Array.isArray(body)) return reply.json({ ok: false, error: CATALOG_ERRORS.needItem }, 400);
        const pathCode = String(request.params["ma"] ?? "").trim();
        const item = { ...(body as Record<string, unknown>), code: String(asRecord(body).code || pathCode || "").trim() };
        if (item.code !== pathCode) return reply.json({ ok: false, error: CATALOG_ERRORS.codeMismatch }, 400);
        const repo = repository(ctx);
        const existed = (await ctx.ports.store.table("hang_kho_mon").one({ ma: item.code })) !== null;
        await history(ctx).capture(existed ? `Trước khi sửa ${item.code}` : `Trước khi tạo ${item.code}`, [item.code], actorOf(request));
        const result = await repo.writeItem(SOURCE.own, item);
        if (!result.item) return reply.json({ ok: false, error: CATALOG_ERRORS.itemDropped, viSao: "Thiếu mã hoặc tên, hoặc mã đang bị chặn." }, 400);
        // Đ5: `giaTay` present = the editor decided the manual price (0 = sell at the source price).
        const manual = (body as Record<string, unknown>)["giaTay"];
        if (manual !== undefined) {
          const price = Math.max(0, Math.round(Number(manual) || 0));
          await ctx.ports.store.table("hang_kho_mon").update({ ma: item.code }, { gia_tay: price, gia_tay_luc: price > 0 ? mysqlTime(ctx.ports.clock.now()) : null });
          await repo.reprice(ctx.ports.store, [item.code]);
        }
        ctx.ports.logger.info(`[hang-kho] OMI ghi món ${item.code}: ${result.variantCount} biến thể`);
        return reply.json({ ok: true, mon: manual === undefined ? result.item : await repo.readItem(item.code), soBienThe: result.variantCount });
      }
    },
    {
      method: "DELETE", path: "/api/hang-kho/mon/:ma", access: ACCESS.admin,
      rateLimit: { calls: 300, windowMs: TEN_MINUTES_MS },
      handle: async (ctx, request) => {
        const code = request.params["ma"] ?? "";
        if (await ctx.ports.store.table("hang_kho_mon").one({ ma: code })) await history(ctx).capture(`Trước khi xoá ${code}`, [code], actorOf(request));
        const result = await repository(ctx).deleteItem(SOURCE.own, code);
        if (!result.deleted) return reply.json({ ok: false, error: result.reason }, 404);
        ctx.ports.logger.info(`[hang-kho] OMI xoá món ${code}${result.otherSourceRemains ? " (còn hàng của nguồn khác, giữ dòng món)" : ""}`);
        return reply.json({ ok: true, ...deleteWire(result) });
      }
    },
    {
      // OMI imports an Excel/CSV file: ADDS to the catalogue, never deletes existing items (unlike POST /api/products).
      method: "POST", path: "/api/hang-kho/nap-them", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES_MS },
      bodyLimit: 16 * 1024 * 1024,
      handle: async (ctx, request) => {
        const list = productList(await request.json());
        if (!list) return reply.json({ ok: false, error: CATALOG_ERRORS.needProductArray }, 400);
        if (list.length > IMPORT_CAP) return reply.json({ ok: false, error: CATALOG_ERRORS.tooManyItems, tran: IMPORT_CAP }, 400);
        const result = await repository(ctx).writeItems(SOURCE.own, list);
        ctx.ports.logger.info(`[hang-kho] OMI nạp thêm: ${result.itemCount} món / ${result.variantCount} biến thể${result.dropped ? `, bỏ ${result.dropped}` : ""}`);
        await noteImport(ctx, { nguon: SOURCE.own, viec: "nạp thêm từ OMI", ...syncWire(result) });
        // The code list is for callers of the service, not for the HTTP reply.
        return reply.json({ ok: true, ...syncWire(result) });
      }
    },
    {
      // Import file safely: keep the payload in a staging session and return a warehouse-scoped diff.
      method: "POST", path: "/api/hang-kho/phien-nhap-file/xem-truoc", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES_MS }, bodyLimit: 16 * 1024 * 1024,
      handle: async (ctx, request) => {
        const body = asRecord(await request.json()); const warehouseId = String(body["maKho"] ?? "").trim();
        const mode = body["cheDo"] === "replace" ? "replace" : "merge"; const items = Array.isArray(body["mon"]) ? body["mon"] as Record<string, unknown>[] : [];
        if (!warehouseId || items.length === 0 || items.length > IMPORT_CAP) return reply.json({ ok: false, error: "phien_nhap_sai", message: "Cần chọn kho và file có từ 1 đến 20.000 sản phẩm." }, 400);
        const warehouseBook = (await ctx.ports.store.document<WarehouseBook>(WAREHOUSE_BOOK_DOCUMENT).read(null)) ?? emptyWarehouseBook();
        const warehouse = warehouseBook.warehouses.find((w) => w.id === warehouseId); if (!warehouse) return reply.json({ ok: false, error: "khong_thay_kho", message: "Kho chưa được khai báo trong module Kho hàng." }, 404);
        const source = warehouse.type === "order" ? SOURCE.campaign : SOURCE.own;
        const current = await ctx.ports.store.rows(`SELECT ma_bien_the, ma_mon, size, ton, sua_luc FROM ${TABLES.variants} WHERE nguon = ? AND ma_kho = ? ORDER BY ma_mon, size`, [source, warehouseId]);
        const incoming = new Map<string, number>();
        for (const item of items) for (const size of (Array.isArray(item["sizes"]) ? item["sizes"] as Record<string, unknown>[] : [])) incoming.set(`${String(item["code"])}\u0000${String(size["size"])}`, Number(size["qty"] ?? 0));
        const existing = new Map(current.map((r) => [`${String(r["ma_mon"])}\u0000${String(r["size"])}`, Number(r["ton"] ?? 0)]));
        let them = 0, thayDoi = 0, giuNguyen = 0; for (const [key, qty] of incoming) { if (!existing.has(key)) them += 1; else if (existing.get(key) === qty) giuNguyen += 1; else thayDoi += 1; }
        const missingKeys = new Set([...existing.keys()].filter((key) => !incoming.has(key))); const vangFile = missingKeys.size;
        const reserved = mode === "replace" ? await ctx.ports.store.rows(`SELECT g.ma_bien_the FROM ${TABLES.reservations} g WHERE g.het_han_luc > ?`, [mysqlTime(ctx.ports.clock.now())]) : [];
        const reservedIds = new Set(reserved.map((r) => String(r["ma_bien_the"])));
        const dangGiuCho = current.filter((r) => missingKeys.has(`${String(r["ma_mon"])}\u0000${String(r["size"])}`) && reservedIds.has(String(r["ma_bien_the"]))).length;
        const fingerprint = `${current.length}:${current.reduce((n, r) => n + Number(r["ton"] ?? 0), 0)}:${current.map((r) => String(r["sua_luc"] ?? "")).sort().at(-1) ?? ""}`;
        const id = `imp_${ctx.ports.clock.now().getTime()}`; const expiresAt = new Date(ctx.ports.clock.now().getTime() + 2 * 60 * 60 * 1000).toISOString();
        await ctx.ports.store.document<Record<string, unknown>>(STOCK_IMPORT_SESSION_DOCUMENT).write({ id, warehouseId, warehouseType: warehouse.type, source, mode, items, fingerprint, expiresAt, dangGiuCho, actor: actorOf(request) });
        return reply.json({ ok: true, phien: { id, maKho: warehouseId, loaiKho: warehouse.type, cheDo: mode, hetHanLuc: expiresAt, them, thayDoi, giuNguyen, vangFile, seNgungBan: mode === "replace" ? vangFile : 0, dangGiuCho } }, 200, { "Cache-Control": "no-store" });
      }
    },
    {
      method: "POST", path: "/api/hang-kho/phien-nhap-file/ap-dung", access: ACCESS.admin,
      rateLimit: { calls: 30, windowMs: TEN_MINUTES_MS },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json()); const session = await ctx.ports.store.document<Record<string, unknown>>(STOCK_IMPORT_SESSION_DOCUMENT).read(null);
        if (!session || session["id"] !== body["maPhien"] || Date.parse(String(session["expiresAt"])) <= ctx.ports.clock.now().getTime()) return reply.json({ ok: false, error: "phien_het_han", message: "Phiên xem trước đã hết hạn; hãy đọc lại file." }, 409);
        if (Number(session["dangGiuCho"] ?? 0) > 0) return reply.json({ ok: false, error: "dang_giu_cho", message: `Có ${Number(session["dangGiuCho"])} dòng vắng file đang giữ chỗ cho đơn mở; chưa thể thay mới kho.` }, 409);
        const warehouseId = String(session["warehouseId"]); const source = sourceOf(session["source"]); if (!source) return reply.json({ ok: false, error: "nguon_sai" }, 409);
        const current = await ctx.ports.store.rows(`SELECT ton, sua_luc FROM ${TABLES.variants} WHERE nguon = ? AND ma_kho = ? ORDER BY ma_mon, size`, [source, warehouseId]);
        const fingerprint = `${current.length}:${current.reduce((n, r) => n + Number(r["ton"] ?? 0), 0)}:${current.map((r) => String(r["sua_luc"] ?? "")).sort().at(-1) ?? ""}`;
        if (fingerprint !== session["fingerprint"]) return reply.json({ ok: false, error: "kho_da_thay_doi", message: "Kho đã thay đổi sau lúc xem trước; không ghi đè. Hãy xem trước lại." }, 409);
        const items = session["items"] as Record<string, unknown>[]; const codes = items.map((i) => String(i["code"] ?? "")).filter(Boolean);
        if (session["mode"] === "replace") { const old = await ctx.ports.store.rows(`SELECT DISTINCT ma_mon FROM ${TABLES.variants} WHERE nguon = ? AND ma_kho = ?`, [source, warehouseId]); for (const r of old) codes.push(String(r["ma_mon"])); }
        await history(ctx).capture(`Trước phiên nhập file ${String(session["id"])}`, codes, actorOf(request));
        const result = await writeWarehouse(ctx, { source, warehouseId, items }, session["mode"] === "replace");
        await noteImport(ctx, { nguon: source, viec: session["mode"] === "replace" ? `thay mới kho ${warehouseId}` : `bổ sung kho ${warehouseId}`, ...syncWire(result) });
        await ctx.ports.store.document<Record<string, unknown>>(STOCK_IMPORT_SESSION_DOCUMENT).write({ ...session, appliedAt: ctx.ports.clock.now().toISOString(), result });
        return reply.json({ ok: true, maPhien: session["id"], ...syncWire(result) }, 200, { "Cache-Control": "no-store" });
      }
    },
    {
      // "Đồng bộ kho" in OMI: what the last imports did, newest first.
      method: "GET", path: "/api/hang-kho/lich-su-nap", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES_MS },
      handle: async (ctx) => reply.json(
        { ok: true, lan: (await ctx.ports.store.document<ImportLog>(IMPORT_LOG_DOCUMENT).read(null))?.lan ?? [] },
        200, { "Cache-Control": "no-store" }
      )
    },
    {
      // "Kho hàng sẵn" and "Kho đối tác" in OMI: everything stocked from ONE source. One door for
      // both screens — the source is the only thing that differs.
      method: "GET", path: "/api/hang-kho/theo-nguon/:nguon", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES_MS },
      handle: async (ctx, request) => {
        const asked = String(request.params["nguon"] ?? "").trim();
        const source = (Object.values(SOURCE) as string[]).includes(asked) ? (asked as Source) : null;
        if (source === null) {
          return reply.json({ ok: false, error: "nguon_khong_co", nguonDangCo: Object.values(SOURCE) }, 400);
        }
        const items = await repository(ctx).itemsBySource(source, Number(request.query["limit"] || 0));
        return reply.json({ ok: true, nguon: source, mon: items }, 200, { "Cache-Control": "no-store" });
      }
    },
    {
      // OMI's "Sửa nhanh web" (Sales Desk's `landingquickedit`): many items, three fields — list
      // price, discount, shown/hidden. Deliberately narrow; see `CatalogRepository.quickEdit`.
      method: "POST", path: "/api/hang-kho/sua-nhanh", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES_MS },
      bodyLimit: 512 * 1024,
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const raw = Array.isArray(body["mon"]) ? (body["mon"] as unknown[]) : Array.isArray(body) ? (body as unknown[]) : null;
        if (raw === null) return reply.json({ ok: false, error: CATALOG_ERRORS.needProductArray }, 400);
        if (raw.length > QUICK_EDIT_CAP) return reply.json({ ok: false, error: CATALOG_ERRORS.tooManyItems, tran: QUICK_EDIT_CAP }, 400);
        const patches: QuickEditPatch[] = raw.map((x) => {
          const m = asRecord(x);
          return {
            code: String(m["ma"] ?? m["code"] ?? "").trim(),
            ...(m["giaNiemYet"] === undefined ? {} : { listPrice: Number(m["giaNiemYet"]) }),
            ...(m["giamGia"] === undefined ? {} : { discountPercent: Number(m["giamGia"]) }),
            ...(m["trangThai"] === undefined ? {} : { status: String(m["trangThai"]) }),
            ...(m["ten"] === undefined ? {} : { name: String(m["ten"]) }),
            ...(m["gia"] === undefined ? {} : { price: Number(m["gia"]) }),
            ...(m["giaBan"] === undefined ? {} : { price: Number(m["giaBan"]) }),
            ...(m["hang"] === undefined ? {} : { brand: String(m["hang"]) }),
            ...(m["loai"] === undefined ? {} : { productKind: String(m["loai"]) }),
            ...(m["nhom"] === undefined ? {} : { category: String(m["nhom"]) }),
            ...(m["gioiTinh"] === undefined ? {} : { gender: String(m["gioiTinh"]) })
          };
        });
        await history(ctx).capture("Trước khi lưu sửa nhanh web", patches.map((p) => p.code), actorOf(request));
        const result = await repository(ctx).quickEdit(patches, ctx.ports.clock.now());
        ctx.ports.logger.info(`[hang-kho] sửa nhanh: ${result.changed.length} món đổi${result.missing.length ? `, ${result.missing.length} mã không thấy` : ""}`);
        return reply.json({ ok: true, daSua: result.changed, khongThay: result.missing }, 200, { "Cache-Control": "no-store" });
      }
    },
    // ---------------- Hàng hoá đầy đủ (Đ5, 17/09/2026): Desk landingproducts / quick edit / stock import ----------------
    {
      // "Dùng lại giá nguồn" (`reset-landing-manual-price`).
      method: "POST", path: "/api/hang-kho/mon/:ma/bo-gia-tay", access: ACCESS.admin,
      rateLimit: { calls: 300, windowMs: TEN_MINUTES_MS },
      handle: async (ctx, request) => {
        const code = String(request.params["ma"] ?? "").trim();
        if (!(await ctx.ports.store.table("hang_kho_mon").one({ ma: code }))) return reply.json({ ok: false, error: CATALOG_ERRORS.notFound }, 404);
        await history(ctx).capture(`Trước khi bỏ giá tay ${code}`, [code], actorOf(request));
        await repository(ctx).resetManualPrice(code, ctx.ports.clock.now());
        return reply.json({ ok: true, mon: await repository(ctx).readItem(code) }, 200, { "Cache-Control": "no-store" });
      }
    },
    {
      // "Lưu nội dung web" (`save-product-web-fields`): SEO + the product page text. Never prices or stock.
      method: "PUT", path: "/api/hang-kho/mon/:ma/noi-dung-web", access: ACCESS.admin,
      rateLimit: { calls: 300, windowMs: TEN_MINUTES_MS },
      bodyLimit: 512 * 1024,
      handle: async (ctx, request) => {
        const code = String(request.params["ma"] ?? "").trim();
        const body = asRecord(await request.json());
        if (!(await ctx.ports.store.table("hang_kho_mon").one({ ma: code }))) return reply.json({ ok: false, error: CATALOG_ERRORS.notFound }, 404);
        await history(ctx).capture(`Trước khi sửa nội dung web ${code}`, [code], actorOf(request));
        await repository(ctx).writeWebContent(code, {
          seoTitle: String(body["seoTitle"] ?? ""), seoDescription: String(body["seoDescription"] ?? ""), seoKeywords: String(body["seoKeywords"] ?? ""),
          content: asRecord(body["noiDung"])
        }, ctx.ports.clock.now());
        return reply.json({ ok: true, mon: await repository(ctx).readItem(code) }, 200, { "Cache-Control": "no-store" });
      }
    },
    {
      // The newest undoable catalogue action — OMI's "Hoàn tác: …" button label.
      method: "GET", path: "/api/hang-kho/hoan-tac", access: ACCESS.admin,
      handle: async (ctx) => reply.json({ ok: true, hoanTac: await history(ctx).head() }, 200, { "Cache-Control": "no-store" })
    },
    {
      // `undo-landing-products`: puts back the items the newest action touched (stock stays as the shelf says).
      method: "POST", path: "/api/hang-kho/hoan-tac", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES_MS },
      handle: async (ctx) => {
        const done = await history(ctx).undoLatest();
        if (done === null) return reply.json({ ok: false, error: "khong_co_gi_de_hoan_tac", message: "Chưa có thao tác nào để hoàn tác." }, 409);
        ctx.ports.logger.info(`[hang-kho] hoàn tác "${done.nhan}": ${done.maMon.join(", ")}`);
        return reply.json({ ok: true, daHoanTac: done, hoanTac: await history(ctx).head() }, 200, { "Cache-Control": "no-store" });
      }
    },
    {
      // `cache-product-images`: one item (`ma`) or the first items with remote photos (`tatCa`).
      method: "POST", path: "/api/hang-kho/tai-anh-ve", access: ACCESS.admin,
      rateLimit: { calls: 20, windowMs: TEN_MINUTES_MS },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const code = String(body["ma"] ?? "").trim();
        let codes: string[];
        if (code !== "") codes = [code];
        else {
          const rows = await ctx.ports.store.rows(
            "SELECT ma FROM hang_kho_mon WHERE anh_dai_dien LIKE 'http%' OR anh_khac_json LIKE '%\"http%' ORDER BY sua_luc DESC LIMIT ?", [CACHE_ITEMS_CAP]
          );
          codes = rows.map((r) => String(r["ma"]));
        }
        const result = await cacheImages(ctx, codes, actorOf(request));
        return reply.json({ ok: true, ...result }, 200, { "Cache-Control": "no-store" });
      }
    },
    {
      // "Đồng bộ kho" — pasted CSV or a public Google Sheet, sizes in EU / US / UK, stock of the shop
      // or of a partner. `xemTruoc: true` reads and answers without writing (the screen's preview).
      method: "POST", path: "/api/hang-kho/nhap-bang", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES_MS },
      bodyLimit: 8 * 1024 * 1024,
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const system = String(body["heSize"] ?? "EU") as SizeSystem;
        if (!(SIZE_SYSTEMS as readonly string[]).includes(system)) return reply.json({ ok: false, error: "he_size_khong_co", message: `Hệ size chỉ nhận ${SIZE_SYSTEMS.join(", ")}.` }, 400);
        const kind = String(body["nguon"] ?? "own") === "partner" ? "partner" : "own";
        const sourceName = String(body["tenNguon"] ?? "").trim().slice(0, 100);
        if (kind === "partner" && sourceName === "") return reply.json({ ok: false, error: "thieu_ten_doi_tac", message: "Nhập tên đối tác cho hàng của đối tác." }, 400);
        let text = String(body["csv"] ?? "");
        let from = "CSV dán tay";
        const sheet = String(body["sheetUrl"] ?? "").trim();
        if (sheet !== "") {
          try {
            const csvUrl = googleSheetCsvUrl(sheet);
            const response = await ctx.ports.http.fetch(csvUrl, { headers: { "User-Agent": "OMI-Landing/1.0" }, timeoutMs: 20000 });
            if (!response.ok) return reply.json({ ok: false, error: "sheet_khong_doc_duoc", message: `Không đọc được Google Sheet public. HTTP ${response.status}.` }, 400);
            text = await response.text();
            if (looksLikeHtml(text)) return reply.json({ ok: false, error: "sheet_chua_public", message: "Google Sheet đang không public/export CSV được. Hãy Share public hoặc dùng link Published CSV." }, 400);
            from = "Google Sheet";
          } catch (e) {
            if (e instanceof SheetInputError) return reply.json({ ok: false, error: "link_sheet_sai", message: e.message }, 400);
            throw e;
          }
        }
        if (text.trim() === "") return reply.json({ ok: false, error: "bang_trong", message: "Chưa có dữ liệu CSV để nhập." }, 400);
        const parsed = itemsFromRows(parseCsv(text), { sizeSystem: system, source: kind, sourceName });
        if (parsed.items.length > IMPORT_CAP) return reply.json({ ok: false, error: CATALOG_ERRORS.tooManyItems, tran: IMPORT_CAP }, 400);
        const summary = {
          nguonDoc: from, soDong: parsed.rowCount, soMonDoc: parsed.items.length, boQua: parsed.skipped, canhBao: parsed.warnings, cot: parsed.columns,
          xem: parsed.items.slice(0, 20).map((m) => ({ ma: m["code"], ten: m["name"], hang: m["brand"], size: (m["sizes"] as Record<string, unknown>[]).map((s) => `${String(s["size"])}:${String(s["qty"])}`).join(", ") }))
        };
        if (body["xemTruoc"] === true || parsed.items.length === 0) return reply.json({ ok: true, daGhi: false, ...summary }, 200, { "Cache-Control": "no-store" });
        const source = kind === "partner" ? SOURCE.campaign : SOURCE.own;
        const result = await repository(ctx).writeItems(source, parsed.items);
        const label = `${from} (${kind === "partner" ? `đối tác ${sourceName}` : "hàng của shop"}, size ${system})`;
        ctx.ports.logger.info(`[hang-kho] nhập bảng ${label}: ${result.itemCount} món / ${result.variantCount} size`);
        await noteImport(ctx, { nguon: source, viec: label, ...syncWire(result) });
        return reply.json({ ok: true, daGhi: true, ...summary, ...syncWire(result) }, 200, { "Cache-Control": "no-store" });
      }
    },
    {
      // Kho hàng sẵn "Đổi giá" (`rs-price`): one size in one warehouse of one source.
      method: "POST", path: "/api/hang-kho/doi-gia", access: ACCESS.admin,
      rateLimit: { calls: 240, windowMs: TEN_MINUTES_MS },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const price = Math.round(Number(body["gia"]));
        const code = String(body["ma"] ?? "").trim();
        if (!(price > 0)) return reply.json({ ok: false, error: "gia_khong_hop_le", message: "Giá bán phải lớn hơn 0." }, 400);
        await history(ctx).capture(`Trước khi đổi giá ${code} size ${String(body["size"] ?? "")}`, [code], actorOf(request));
        const done = await repository(ctx).setVariantPrice({
          code, size: String(body["size"] ?? ""), warehouseId: String(body["maKho"] ?? ""), source: sourceOf(body["nguon"]) ?? SOURCE.ready, price
        }, ctx.ports.clock.now());
        if (done === 0) return reply.json({ ok: false, error: CATALOG_ERRORS.notFound, message: "Không thấy dòng tồn này." }, 404);
        return reply.json({ ok: true, soDong: done }, 200, { "Cache-Control": "no-store" });
      }
    },
    {
      method: "GET", path: "/api/hang-kho/chinh-sach-hang-san", access: ACCESS.admin,
      handle: async (ctx) => reply.json({ ok: true, chinhSach: await readyPolicy(ctx) }, 200, { "Cache-Control": "no-store" })
    },
    {
      // `rs-policy`: the ready-stock selling policy; `tomTat` shows on web items that sell ready stock.
      method: "POST", path: "/api/hang-kho/chinh-sach-hang-san", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES_MS },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const policy: ReadyPolicy = {
          tomTat: String(body["tomTat"] ?? "").trim().slice(0, 2000),
          choCod: body["choCod"] !== false,
          phanTramCoc: Math.min(100, Math.max(0, Math.round(Number(body["phanTramCoc"]) || 0)))
        };
        await ctx.ports.store.document<ReadyPolicy>(READY_POLICY_DOCUMENT).write(policy);
        return reply.json({ ok: true, chinhSach: policy }, 200, { "Cache-Control": "no-store" });
      }
    },
    // ---------------- the warehouse page itself (Sales Desk's warehouse.html, 16/09/2026) ----------------
    {
      method: "GET", path: "/warehouse", access: ACCESS.public,
      whyPublic: "Trang kho nội bộ. Tự kiểm phiên: chưa đăng nhập quản trị thì chuyển về /admin-login, không trả tệp nào.",
      rateLimit: { calls: 300, windowMs: TEN_MINUTES_MS },
      handle: (ctx, request) => serveWarehouseFile(ctx, request, "/warehouse.html")
    },
    ...["/warehouse.js", "/warehouse.css", "/warehouse-api.js"].map((asset) => ({
      method: "GET" as const, path: asset, access: ACCESS.public,
      whyPublic: "Tệp của trang kho nội bộ. Tự kiểm phiên: chưa đăng nhập quản trị thì 404.",
      rateLimit: { calls: 600, windowMs: TEN_MINUTES_MS },
      handle: (ctx: Ctx, request: KernelRequest) => serveWarehouseFile(ctx, request, asset)
    })),
    {
      // A product photo from the warehouse page: kept by the upload port (images only, server-named),
      // then set as the main image or added to the gallery.
      method: "POST", path: "/api/hang-kho/mon/:ma/anh", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES_MS },
      bodyLimit: 12 * 1024 * 1024,
      handle: async (ctx, request) => {
        const code = String(request.params["ma"] ?? "").trim();
        const body = asRecord(await request.json());
        const bytes = bytesFromDataUrl(body["anh"] ?? body["dataBase64"]);
        if (!bytes) return reply.json({ ok: false, error: "thieu_anh", message: "Thiếu ảnh (base64)." }, 400);
        const item = await ctx.ports.store.table("hang_kho_mon").one({ ma: code });
        if (!item) return reply.json({ ok: false, error: CATALOG_ERRORS.notFound, message: "Chưa có sản phẩm này — lưu sản phẩm trước." }, 404);
        let saved;
        try {
          saved = await ctx.ports.uploads.saveImage(PHOTO_ZONE, bytes, code);
        } catch (e) {
          const refusal = (e as { code?: string })?.code;
          if (refusal) return reply.json({ ok: false, error: refusal, message: e instanceof Error ? e.message : String(e) }, 400);
          throw e;
        }
        await history(ctx).capture(`Trước khi thêm ảnh ${code}`, [code], actorOf(request));
        const url = `/api/hang-kho/anh/${saved.name}`;
        const gallery = (() => { try { return JSON.parse(String(item["anh_khac_json"] || "[]")) as string[]; } catch { return []; } })();
        const makeMain = body["chinh"] === true || body["primary"] === true || !String(item["anh_dai_dien"] || "");
        await ctx.ports.store.table("hang_kho_mon").update({ ma: code }, makeMain
          ? { anh_dai_dien: url, anh_lon: url, anh_khac_json: JSON.stringify([...(item["anh_dai_dien"] ? [String(item["anh_dai_dien"])] : []), ...gallery]) }
          : { anh_khac_json: JSON.stringify([...gallery, url]) });
        return reply.json({ ok: true, url, chinh: makeMain }, 200, { "Cache-Control": "no-store" });
      }
    },
    {
      method: "GET", path: "/api/hang-kho/anh/:tep", access: ACCESS.public,
      whyPublic: "Ảnh sản phẩm shop tự tải lên — web bán hàng hiển thị cho khách. Chỉ đọc ảnh do máy chủ tự đặt tên trong vùng ảnh của kho; không liệt kê, không ghi.",
      rateLimit: { calls: 6000, windowMs: TEN_MINUTES_MS },
      handle: async (ctx, request) => {
        const file = await ctx.ports.uploads.open(PHOTO_ZONE).read(String(request.params["tep"] ?? ""));
        if (!file) return reply.json({ ok: false, error: ERROR_CODES.notFound }, 404);
        return reply.file(file.data, file.type, 200, { "Cache-Control": "public, max-age=604800" });
      }
    },

    // ---------------- the stock book (warehouse page, 16/09/2026 — see stock-ledger.ts) ----------------
    {
      // ADJUST one size in one warehouse, or many at once (`dong: [...]`, each on its own: one bad
      // line does not undo the good ones, and the reply says which failed).
      method: "POST", path: "/api/hang-kho/dieu-chinh-ton", access: ACCESS.admin,
      rateLimit: { calls: 240, windowMs: TEN_MINUTES_MS },
      bodyLimit: 512 * 1024,
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const rows = Array.isArray(body["dong"]) ? (body["dong"] as unknown[]).map(asRecord) : [body];
        if (rows.length > QUICK_EDIT_CAP) return reply.json({ ok: false, error: CATALOG_ERRORS.tooManyItems, tran: QUICK_EDIT_CAP }, 400);
        const book = ledger(ctx);
        const ketQua = [];
        for (const row of rows) {
          const outcome = await book.adjust({
            code: String(row["ma"] ?? ""), size: String(row["size"] ?? ""), warehouseId: String(row["maKho"] ?? ""),
            quantity: Number(row["soLuong"]), note: String(row["ghiChu"] ?? ""), actor: actorOf(request),
            ...(sourceOf(row["nguon"]) ? { source: sourceOf(row["nguon"])! } : {})
          });
          ketQua.push({ ma: row["ma"], size: row["size"], maKho: row["maKho"], ...outcome });
        }
        const failed = ketQua.filter((r) => !r.ok).length;
        return reply.json({ ok: failed === 0, ketQua, hong: failed }, failed === rows.length ? 400 : 200, { "Cache-Control": "no-store" });
      }
    },
    {
      method: "POST", path: "/api/hang-kho/chuyen-kho", access: ACCESS.admin,
      rateLimit: { calls: 240, windowMs: TEN_MINUTES_MS },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const outcome = await ledger(ctx).transfer({
          code: String(body["ma"] ?? ""), size: String(body["size"] ?? ""), from: String(body["tuKho"] ?? ""), to: String(body["denKho"] ?? ""),
          ...(sourceOf(body["tuNguon"]) ? { fromSource: sourceOf(body["tuNguon"])! } : {}),
          ...(sourceOf(body["denNguon"]) ? { toSource: sourceOf(body["denNguon"])! } : {}),
          quantity: Number(body["soLuong"]), note: String(body["ghiChu"] ?? ""), actor: actorOf(request)
        });
        return reply.json(outcome, outcome.ok ? 200 : 400, { "Cache-Control": "no-store" });
      }
    },
    {
      method: "POST", path: "/api/hang-kho/phieu-nhap", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES_MS },
      bodyLimit: 1024 * 1024,
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const lines = (Array.isArray(body["dong"]) ? (body["dong"] as unknown[]) : []).map(asRecord).map((l) => ({
          code: String(l["ma"] ?? ""), size: String(l["size"] ?? ""), warehouseId: String(l["maKho"] ?? ""),
          quantity: Number(l["soLuong"]), cost: Number(l["giaVon"] ?? 0), note: String(l["ghiChu"] ?? ""),
          ...(sourceOf(l["nguon"]) ? { source: sourceOf(l["nguon"])! } : {})
        }));
        const outcome = await ledger(ctx).receipt({ supplier: String(body["nhaCungCap"] ?? ""), note: String(body["ghiChu"] ?? ""), lines, actor: actorOf(request) });
        if (outcome.ok) ctx.ports.logger.info(`[hang-kho] phiếu nhập ${outcome.id}: ${outcome.totalQuantity} đôi`);
        return reply.json(outcome, outcome.ok ? 200 : 400, { "Cache-Control": "no-store" });
      }
    },
    {
      method: "GET", path: "/api/hang-kho/phieu-nhap", access: ACCESS.admin,
      handle: async (ctx, request) => reply.json({ ok: true, phieu: await ledger(ctx).receipts(Number(request.query["limit"] || 50)) }, 200, { "Cache-Control": "no-store" })
    },
    {
      method: "GET", path: "/api/hang-kho/bien-dong", access: ACCESS.admin,
      handle: async (ctx, request) => reply.json(
        { ok: true, bienDong: await ledger(ctx).movements({ code: String(request.query["ma"] || ""), limit: Number(request.query["limit"] || 200) }) },
        200, { "Cache-Control": "no-store" }
      )
    },
    {
      // Every warehouse the shelf knows — the page's warehouse pickers.
      method: "GET", path: "/api/hang-kho/kho", access: ACCESS.admin,
      handle: async (ctx) => {
        const discovered = await ledger(ctx).warehouses();
        const book = (await ctx.ports.store.document<WarehouseBook>(WAREHOUSE_BOOK_DOCUMENT).read(null)) ?? emptyWarehouseBook();
        const configured = new Map(book.warehouses.map((w) => [w.id, w]));
        const kho = discovered.map((w) => ({ ...w, name: configured.get(w.id)?.name ?? w.id, type: configured.get(w.id)?.type ?? (w.sources.includes(SOURCE.campaign) ? "order" : "ready"), status: configured.get(w.id)?.status ?? "active", priority: configured.get(w.id)?.priority ?? 0, description: configured.get(w.id)?.description ?? "" }));
        for (const w of book.warehouses) if (!kho.some((x) => x.id === w.id)) kho.push({ id: w.id, pairs: 0, sizes: 0, sources: [], name: w.name, type: w.type, status: w.status, priority: w.priority, description: w.description });
        return reply.json({ ok: true, kho, legacyMap: book.legacyMap }, 200, { "Cache-Control": "no-store" });
      }
    },
    {
      method: "PUT", path: "/api/hang-kho/kho/:ma", access: ACCESS.admin,
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const id = String(request.params["ma"] ?? "").trim();
        const name = String(body["ten"] ?? "").trim();
        const type = String(body["loai"] ?? ""); const status = String(body["trangThai"] ?? "active");
        if (!id || !name || !["ready", "order"].includes(type) || !["active", "inactive"].includes(status)) return reply.json({ ok: false, error: "kho_khong_hop_le", message: "Kho cần mã, tên, loại ready/order và trạng thái hợp lệ." }, 400);
        const now = ctx.ports.clock.now().toISOString(); let saved!: WarehouseRecord;
        await ctx.ports.store.document<WarehouseBook>(WAREHOUSE_BOOK_DOCUMENT).update((current) => {
          const book = current ?? emptyWarehouseBook();
          saved = { id, name: name.slice(0, 190), type: type as WarehouseRecord["type"], status: status as WarehouseRecord["status"], priority: Math.max(0, Math.round(Number(body["uuTien"] ?? 0))), description: String(body["moTa"] ?? "").slice(0, 2000), updatedAt: now };
          return { ...book, version: 2, warehouses: [...book.warehouses.filter((w) => w.id !== id), saved], updatedAt: now };
        }, emptyWarehouseBook());
        return reply.json({ ok: true, kho: saved }, 200, { "Cache-Control": "no-store" });
      }
    },
    {
      method: "GET", path: "/api/hang-kho/kho/:ma/chinh-sach", access: ACCESS.admin,
      handle: async (ctx, request) => {
        const id = String(request.params["ma"] ?? "");
        const book = (await ctx.ports.store.document<WarehousePolicyBook>(WAREHOUSE_POLICY_DOCUMENT).read(null)) ?? emptyPolicyBook();
        return reply.json({ ok: true, chinhSach: book.policies.find((p) => p.warehouseId === id) ?? null }, 200, { "Cache-Control": "no-store" });
      }
    },
    {
      method: "POST", path: "/api/hang-kho/kho/:ma/chinh-sach", access: ACCESS.admin,
      handle: async (ctx, request) => {
        const body = asRecord(await request.json()); const warehouseId = String(request.params["ma"] ?? "");
        const now = ctx.ports.clock.now().toISOString(); let saved!: WarehousePolicy;
        await ctx.ports.store.document<WarehousePolicyBook>(WAREHOUSE_POLICY_DOCUMENT).update((current) => {
          const book = current ?? emptyPolicyBook(); const old = book.policies.find((p) => p.warehouseId === warehouseId);
          saved = { warehouseId, version: (old?.version ?? 0) + 1, effectiveAt: now, summary: String(body["tomTat"] ?? "").slice(0, 2000), enabled: body["choPhepBan"] !== false, cod: body["choCod"] !== false, depositPercent: Number(body["phanTramCoc"] ?? 0), leadTimeDays: Number(body["soNgayHangVe"] ?? 0), orderLimit: Number(body["hanMucDat"] ?? 0), surcharge: Number(body["phiPhuThu"] ?? 0), returns: String(body["doiTra"] ?? "").slice(0, 2000), channels: String(body["kenh"] ?? "").slice(0, 1000) };
          return { version: 2, policies: [...book.policies.filter((p) => p.warehouseId !== warehouseId), saved], updatedAt: now };
        }, emptyPolicyBook());
        return reply.json({ ok: true, chinhSach: saved }, 200, { "Cache-Control": "no-store" });
      }
    },
    {
      method: "POST", path: "/api/hang-kho/migration-nguon", access: ACCESS.admin,
      handle: async (ctx, request) => {
        const body = asRecord(await request.json()); const mapping = (Array.isArray(body["anhXa"]) ? body["anhXa"] as unknown[] : []).map(asRecord);
        const counts = await Promise.all(mapping.map(async (m) => ({ nguonCu: String(m["nguonCu"] ?? ""), maKho: String(m["maKho"] ?? ""), soDong: Number((await ctx.ports.store.rows(`SELECT COUNT(*) AS n FROM hang_kho_bien_the WHERE nguon = ?`, [String(m["nguonCu"] ?? "")]))[0]?.["n"] ?? 0) })));
        if (body["apDung"] !== true) {
          const token = `mig_${ctx.ports.clock.now().getTime()}`;
          await ctx.ports.store.document<Record<string, unknown>>(WAREHOUSE_MIGRATION_DOCUMENT).write({ token, mapping, counts, createdAt: ctx.ports.clock.now().toISOString() });
          return reply.json({ ok: true, xemTruoc: true, maBanXemTruoc: token, doiChieu: counts }, 200, { "Cache-Control": "no-store" });
        }
        const preview = await ctx.ports.store.document<Record<string, unknown>>(WAREHOUSE_MIGRATION_DOCUMENT).read(null);
        if (!preview || preview["token"] !== body["maBanXemTruoc"] || JSON.stringify(preview["mapping"]) !== JSON.stringify(mapping)) return reply.json({ ok: false, error: "ban_xem_truoc_cu", message: "Bản xem trước không còn khớp; hãy xem trước migration lại." }, 409);
        const now = ctx.ports.clock.now().toISOString();
        await ctx.ports.store.transaction(async (tx) => { for (const m of mapping) await tx.table(TABLES.variants).update({ nguon: String(m["nguonCu"] ?? "") }, { ma_kho: String(m["maKho"] ?? ""), sua_luc: mysqlTime(ctx.ports.clock.now()) }); });
        await ctx.ports.store.document<WarehouseBook>(WAREHOUSE_BOOK_DOCUMENT).update((current) => {
          const migrated = mapping.map((m) => ({ id: String(m["maKho"]), name: String(m["tenKho"]), type: String(m["loai"]) as WarehouseRecord["type"], status: "active" as const, priority: Number(m["uuTien"] ?? 0), description: "Được tạo từ migration nguồn cũ", updatedAt: now }));
          const ids = new Set(migrated.map((w) => w.id));
          return { version: 2, warehouses: [...(current?.warehouses ?? []).filter((w) => !ids.has(w.id)), ...migrated], legacyMap: { ...(current?.legacyMap ?? {}), ...Object.fromEntries(mapping.map((m) => [String(m["nguonCu"]), String(m["maKho"])])) }, updatedAt: now };
        }, emptyWarehouseBook());
        return reply.json({ ok: true, daApDung: true, doiChieu: counts }, 200, { "Cache-Control": "no-store" });
      }
    },
    {
      // The house view for the admin screen — WITH real stock.
      method: "GET", path: "/api/admin/products", access: ACCESS.admin,
      handle: async (ctx, request) => reply.json(
        await repository(ctx).searchItems(String(request.query["q"] || ""), Number(request.query["limit"] || 0), {
          size: String(request.query["size"] || ""), source: String(request.query["nguon"] || "")
        }),
        200,
        { "Cache-Control": "no-store" }
      )
    },
    {
      // The brain asks for stock to answer a customer.
      method: "GET", path: "/api/hang-kho/ton/:ma", access: ACCESS.service,
      handle: async (ctx, request) => reply.json(
        stockWire(await stock(ctx, { code: request.params["ma"] ?? "", size: request.query["size"] ?? "" })),
        200,
        { "Cache-Control": "no-store" }
      )
    }
  ],

  // Sent to the brain as they are -> field names stay Vietnamese.
  botTools: [
    { ten: "tim_hang", moTa: "Tìm món hàng theo mã hoặc tên", hieuUng: "doc" },
    { ten: "tra_ton", moTa: "Còn hàng không, size nào còn", hieuUng: "doc" },
    { ten: "giu_cho", moTa: "Giữ chỗ một size trong 30 phút khi khách chốt", hieuUng: "ghi" }
  ]
});
