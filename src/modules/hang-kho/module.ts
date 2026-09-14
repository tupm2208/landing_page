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

import { ACCESS, EVENTS, defineModule, reply, type ModuleContext } from "../../contract";
import {
  CatalogRepository, SOURCE, type DeleteResult, type ReserveFailure, type Source, type StockLine, type SyncResult,
  type WriteOneResult
} from "./catalog-repository";
import { DEFAULT_READY_WAREHOUSES, convertCampaignPayload, convertReadyStockPayload } from "./desk-payloads";
import { asRecord, publicView, type PublicItem } from "./normalise";
import { SCHEMA } from "./schema";

const RESERVATION_TTL_MS = 30 * 60 * 1000;   // hold 30 minutes, then give back if the order was not placed
const TEN_MINUTES_MS = 10 * 60 * 1000;
/** Document remembering the last ready-stock revision Desk sent. Name is on-disk contract. */
const READY_STOCK_REVISION_DOCUMENT = "hang-kho-hang-co-san";
/** The most items one OMI import may carry. */
const IMPORT_CAP = 20000;

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
  /** How many items the catalogue holds. */
  count(): Promise<number>;
  /** Writes ONE house item (add or edit). */
  write(item: unknown): Promise<WriteOneResult>;
  /** One item by code or slug (public view). */
  read(key: string): Promise<PublicItem | null>;
}

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
  return { ok: true, result };
}

function syncReply(outcome: SyncOutcome, extra: Record<string, unknown> = {}) {
  return outcome.ok ? reply.json({ ok: true, ...syncWire(outcome.result), ...extra }) : reply.json({ ok: false, error: outcome.error }, 400);
}

interface ReadyStockRevision {
  revision: number;
  luc: string;
}

export const manifest = defineModule<Config>({
  id: "hang-kho",
  name: "Hàng hoá & kho",
  tier: "van-hanh",
  runsOn: "server-khach",
  feature: "hang-kho",
  version: "0.2.0",
  ports: ["store", "logger", "clock", "bus", "config"],
  schema: SCHEMA,

  events: { emits: [EVENTS.stockOut, EVENTS.stockBack], listens: {} },

  provides: {
    "hang-kho.search": search,
    "hang-kho.stock": stock,
    "hang-kho.reserve": reserve,
    "hang-kho.release": release,
    "hang-kho.count": (ctx) => repository(ctx).countItems(),
    "hang-kho.write": (ctx, item: unknown) => repository(ctx).writeItem(SOURCE.own, item),
    "hang-kho.read": async (ctx, key: string) => {
      const item = await repository(ctx).readItem(key);
      return item ? publicView(item) : null;
    }
  },

  routes: [
    {
      method: "GET", path: "/api/products", access: ACCESS.public,
      whyPublic: "Danh mục để web bán hàng hiển thị. Bản trả ra đã bỏ giá vốn và tồn thật.",
      rateLimit: { calls: 600, windowMs: TEN_MINUTES_MS },
      handle: async (ctx, request) => {
        const items = await repository(ctx).searchItems(String(request.query["q"] || ""), Number(request.query["limit"] || 0));
        return reply.json(items.map(publicView).filter(notNull), 200, { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" });
      }
    },
    {
      method: "GET", path: "/api/products/:khoa", access: ACCESS.public,
      whyPublic: "Trang sản phẩm công khai. Cùng bản đã bỏ giá vốn như danh mục.",
      rateLimit: { calls: 600, windowMs: TEN_MINUTES_MS },
      handle: async (ctx, request) => {
        const item = await repository(ctx).readItem(request.params["khoa"]);
        if (!item) return reply.json({ ok: false, error: CATALOG_ERRORS.notFound }, 404);
        return reply.json(publicView(item), 200, { "Cache-Control": "public, max-age=300" });
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

        const configured = ctx.config.readyStockWarehouses;
        const allowedWarehouses = Array.isArray(configured) && configured.length ? configured : DEFAULT_READY_WAREHOUSES;
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
        const result = await repository(ctx).writeItem(SOURCE.own, item);
        if (!result.item) return reply.json({ ok: false, error: CATALOG_ERRORS.itemDropped, viSao: "Thiếu mã hoặc tên, hoặc mã đang bị chặn." }, 400);
        ctx.ports.logger.info(`[hang-kho] OMI ghi món ${item.code}: ${result.variantCount} biến thể`);
        return reply.json({ ok: true, mon: result.item, soBienThe: result.variantCount });
      }
    },
    {
      method: "DELETE", path: "/api/hang-kho/mon/:ma", access: ACCESS.admin,
      rateLimit: { calls: 300, windowMs: TEN_MINUTES_MS },
      handle: async (ctx, request) => {
        const code = request.params["ma"] ?? "";
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
        // The code list is for callers of the service, not for the HTTP reply.
        return reply.json({ ok: true, ...syncWire(result) });
      }
    },
    {
      // The house view for the admin screen — WITH real stock.
      method: "GET", path: "/api/admin/products", access: ACCESS.admin,
      handle: async (ctx, request) => reply.json(
        await repository(ctx).searchItems(String(request.query["q"] || ""), Number(request.query["limit"] || 0)),
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
