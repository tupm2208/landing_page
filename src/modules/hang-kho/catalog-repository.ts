/**
 * @file Reads and writes the catalogue on the tables — the layer between MySQL rows and the item
 * shape the rest of the module uses (`normalise.ts` does not change a line for it).
 *
 * The three stock sources — house stock, partner campaigns, ready stock — are all ROWS in the
 * same `hang_kho_bien_the` table, differing only in the `nguon` column. So there is no merge
 * function anywhere: reading IS merged. Syncing one source touches only that source's rows.
 *
 * A class because it carries the store, the clock and the logger for the duration of a request;
 * every public method is one business operation and hides its SQL.
 */

import type { Clock, DataStore, Logger, Row, Where } from "../../contract";
import { toMysqlDateTime } from "../../shared/mysql-time";
import {
  asList, firstPositive, normaliseItem, stringList, variantId, warehouseKey, warehouseRank, type NormalisedItem
} from "./normalise";
import { TABLES } from "./schema";

/** The three stock sources — the VALUES are the `nguon` column and stay as they are. */
export const SOURCE = { own: "own", campaign: "campaign", ready: "ready" } as const;
export type Source = (typeof SOURCE)[keyof typeof SOURCE];

/**
 * WHO DESCRIBES AN ITEM WHEN THREE SOURCES SHARE ONE CODE.
 *
 * One pair of shoes may sit in the house catalogue, in the ready-stock store AND in a partner
 * campaign. `hang_kho_mon` keeps ONE row per code (the code is the primary key), so one source
 * must be chosen to describe it: name, images, description, slug.
 *
 * The house catalogue describes best (real photos, description, SEO), so it wins. Syncing a
 * weaker source must NOT overwrite a stronger source's description — but variants (size, price,
 * stock) are written by every source for its own part, since they live in the other table.
 *
 * Before 12/09/2026 this did not exist: a ready-stock sync meeting a code already in the
 * catalogue THREW "Duplicate entry" and the whole sync failed — found when pushing Mr Dũng's real data.
 */
const SOURCE_PRIORITY: Record<string, number> = { [SOURCE.own]: 3, [SOURCE.campaign]: 2, [SOURCE.ready]: 1 };

/** The cap on items returned when reading the whole catalogue. Hitting it logs a warning, never silence. */
export const CATALOG_CAP = 20000;

/** A MySQL DATETIME(3) string of a moment. */
export const mysqlTime = (moment: Date | string | number): string => toMysqlDateTime(moment, { ms: true });

function parseJson(value: unknown, fallback: unknown): unknown {
  if (value === null || value === undefined || value === "") return fallback;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

/** A row of `hang_kho_mon` as written by this module. */
export type ItemRow = {
  ma: string; ma_goc: string; ten: string; hang: string; loai: string; nhom: string; gioi_tinh: string;
  duong_dan: string; gia_niem_yet: number; phan_tram_giam: number; trang_thai: string; vi_sao_an: string;
  anh_dai_dien: string; anh_lon: string; anh_khac_json: string; mo_ta_ngan: string; mo_ta: string;
  uu_tien_kho_json: string; nguon: Source; ten_nguon: string; sua_luc: string;
};

/** A row of `hang_kho_bien_the` as written by this module. */
export type VariantRow = {
  ma_bien_the: string; ma_mon: string; size: string; ma_kho: string; ton: number; gia: number; gia_niem_yet: number;
  thu_tu_kho: number; nguon: Source; ma_chien_dich: string; ma_dong_doi_tac: string; sua_luc: string;
};

/** A normalised item -> its item row plus one variant row per size line (lines without a size dropped). */
export function itemToRows(item: NormalisedItem, source: Source, at: string): { itemRow: ItemRow; variantRows: VariantRow[] } {
  const itemRow: ItemRow = {
    ma: item.code,
    ma_goc: item.originalCode || item.code,
    ten: item.name,
    hang: item.brand || "",
    loai: item.productKind || "",
    nhom: item.category || "",
    gioi_tinh: item.gender || "",
    duong_dan: item.slug || "",
    gia_niem_yet: item.listPrice || 0,
    phan_tram_giam: item.discountPercent || 0,
    trang_thai: item.status || "orderable",
    vi_sao_an: item.hiddenReason || "",
    anh_dai_dien: item.thumbnailImage || "",
    anh_lon: item.highImage || "",
    anh_khac_json: JSON.stringify(item.galleryImages ?? []),
    mo_ta_ngan: item.shortDescription || "",
    mo_ta: item.description || "",
    uu_tien_kho_json: JSON.stringify(stringList(item.warehousePriorityIds)),
    nguon: source,
    ten_nguon: item.sourceName || "",
    sua_luc: at
  };

  const variantRows: VariantRow[] = item.sizes
    .map((line): VariantRow => ({
      ma_bien_the: variantId(item, line),
      ma_mon: item.code,
      size: String(line.size || "").trim(),
      ma_kho: String(line.warehouseId || "").trim() || warehouseKey(line.warehouse || line.warehouseName),
      ton: Math.max(0, Math.trunc(Number(line.qty ?? line.available ?? line.stockQty ?? 0))),
      gia: firstPositive(line.suggestedPrice, line.salePrice, line.sellPrice, line.price),
      gia_niem_yet: firstPositive(line.listPrice, line.originalPrice, item.listPrice),
      thu_tu_kho: Math.min(warehouseRank(item, line), 2147483647),
      nguon: source,
      ma_chien_dich: String(line.campaignId || item.campaignId || "").trim(),
      ma_dong_doi_tac: String(line.partnerCampaignLineId || "").trim(),
      sua_luc: at
    }))
    .filter((row) => row.size !== "");

  return { itemRow, variantRows };
}

/** One size line of an item read back from the tables. */
export type StoredSize = {
  variantId: string;
  size: string;
  /** Stock minus what is reserved right now — a later customer must not see a reserved pair as available. */
  qty: number;
  price: number;
  listPrice: number;
  warehouseId: string;
  warehouse: string;
  selectionRank: number;
  /** The source of THIS line — the public view masks partner names per line, not per item. */
  nguon: string;
  stockMode?: "ready";
  partnerCampaignLineId: string;
};

/** An item read back from the tables — the house view (`publicView` strips it for the web). */
export type StoredItem = {
  code: string;
  originalCode: string;
  name: string;
  source: "own" | "partner";
  sourceName: string;
  brand: string;
  productKind: string;
  category: string;
  gender: string;
  slug: string;
  listPrice: number;
  discountPercent: number;
  saleRatio: number;
  status: string;
  hiddenReason: string;
  thumbnailImage: string;
  highImage: string;
  galleryImages: string[];
  shortDescription: string;
  description: string;
  warehousePriorityIds: string[];
  partnerCampaign: boolean;
  price: number;
  suggestedPrice: number;
  salePrice: number;
  sizes: StoredSize[];
};

/** Table rows -> the item shape `publicView` and the services read. */
export function rowsToItem(itemRow: Row, variantRows: Row[], reserved: ReadonlyMap<string, number> = new Map()): StoredItem {
  // Item price = the SMALLEST price among variants in stock (the rule the old site runs on).
  const inStock = variantRows.filter((v) => Number(v["ton"] || 0) > 0).map((v) => Number(v["gia"] || 0)).filter((p) => p > 0);
  const any = variantRows.map((v) => Number(v["gia"] || 0)).filter((p) => p > 0);
  const price = inStock.length ? Math.min(...inStock) : (any.length ? Math.min(...any) : 0);
  const discountPercent = Number(itemRow["phan_tram_giam"] || 0);
  const source = String(itemRow["nguon"] || "");
  return {
    code: String(itemRow["ma"]),
    originalCode: String(itemRow["ma_goc"] || itemRow["ma"]),
    name: String(itemRow["ten"]),
    source: source === SOURCE.own ? "own" : "partner",
    sourceName: String(itemRow["ten_nguon"] || ""),
    brand: String(itemRow["hang"] || ""),
    productKind: String(itemRow["loai"] || ""),
    category: String(itemRow["nhom"] || ""),
    gender: String(itemRow["gioi_tinh"] || ""),
    slug: String(itemRow["duong_dan"] || ""),
    listPrice: Number(itemRow["gia_niem_yet"] || 0),
    discountPercent,
    saleRatio: discountPercent / 100,
    status: String(itemRow["trang_thai"] || "orderable"),
    hiddenReason: String(itemRow["vi_sao_an"] || ""),
    thumbnailImage: String(itemRow["anh_dai_dien"] || ""),
    highImage: String(itemRow["anh_lon"] || ""),
    galleryImages: asList(parseJson(itemRow["anh_khac_json"], [])).map(String),
    shortDescription: String(itemRow["mo_ta_ngan"] || ""),
    description: String(itemRow["mo_ta"] || ""),
    warehousePriorityIds: asList(parseJson(itemRow["uu_tien_kho_json"], [])).map(String),
    partnerCampaign: source === SOURCE.campaign,
    price,
    suggestedPrice: price,
    salePrice: price,
    sizes: variantRows.map((v): StoredSize => {
      const id = String(v["ma_bien_the"]);
      const lineSource = String(v["nguon"] || "");
      return {
        variantId: id,
        size: String(v["size"] ?? ""),
        qty: Math.max(0, Number(v["ton"] || 0) - (reserved.get(id) ?? 0)),
        price: Number(v["gia"] || 0),
        listPrice: Number(v["gia_niem_yet"] || 0),
        warehouseId: String(v["ma_kho"] || ""),
        warehouse: String(v["ma_kho"] || ""),
        selectionRank: Number(v["thu_tu_kho"] ?? 2147483647),
        nguon: lineSource,
        ...(lineSource === SOURCE.ready ? { stockMode: "ready" as const } : {}),
        partnerCampaignLineId: String(v["ma_dong_doi_tac"] || "")
      };
    })
  };
}

/** What a source sync reports back. The HTTP routes translate it to the Vietnamese wire (`soMon`...). */
export interface SyncResult {
  /** Items accepted (after normalisation and the blocked-code filter). */
  itemCount: number;
  /** Variant rows written. */
  variantCount: number;
  /** Item rows written (upserted). */
  written: number;
  /** Items whose description was left to a stronger source. */
  yielded: number;
  /** Raw entries dropped: no code/name, or a blocked code. */
  dropped: number;
}

export interface WriteManyResult extends SyncResult {
  /** Codes written, in order. */
  codes: string[];
}

export interface WriteOneResult extends WriteManyResult {
  /** The item after writing (house view); `null` = dropped (no code/name, or a blocked code). */
  item: StoredItem | null;
}

/** Reason VALUES are wire (the DELETE route answers them as `error`). */
export type DeleteReason = "" | "thieu_ma" | "khong_thay";

export interface DeleteResult {
  deleted: boolean;
  /** The item row was kept because another source still has variants of it. */
  otherSourceRemains: boolean;
  reason: DeleteReason;
}

/** One line of stock the brain or the order module can act on. */
export interface StockLine {
  variantId: string;
  size: string;
  quantity: number;
  price: number;
  warehouseId: string;
  /** Warehouse priority: smaller ships first. */
  rank: number;
}

export interface ItemStock {
  code: string;
  name: string;
  lines: StockLine[];
}

export interface ReserveRequest {
  code: string;
  size: string;
  quantity: number;
  heldBy: string;
  ticket: string;
  at: Date;
  expiresAt: Date;
}

/** Reason VALUES are wire (they travel to the brain and Desk unchanged). */
export type ReserveFailure = "khong_du_hang";

export type ReserveOutcome =
  | { ok: false; reason: ReserveFailure }
  | {
    ok: true;
    /** The item code as stored (the request may have named it by slug or in another case). */
    code: string;
    ticket: string; variantId: string; size: string; price: number; warehouseId: string;
    /** What is left after this reservation — 0 or less means the variant just sold out. */
    remaining: number;
  };

export interface CatalogRepositoryDeps {
  store: DataStore;
  clock: Clock;
  logger: Logger;
  /** Codes blocked by configuration, on top of the `hang_kho_ma_chan` table. */
  configuredBlockedCodes?: string[];
}

/** Keeps the CHEAPER of two rows for the same variant id (an item's price is its smallest price anyway). */
function keepCheaper(byId: Map<string, VariantRow>, row: VariantRow): boolean {
  const seen = byId.get(row.ma_bien_the);
  if (!seen) { byId.set(row.ma_bien_the, row); return false; }
  if (Number(row.gia || 0) > 0 && (Number(seen.gia || 0) === 0 || Number(row.gia) < Number(seen.gia))) byId.set(row.ma_bien_the, row);
  return true;
}

export class CatalogRepository {
  private readonly store: DataStore;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly configuredBlockedCodes: string[];

  constructor(deps: CatalogRepositoryDeps) {
    this.store = deps.store;
    this.clock = deps.clock;
    this.logger = deps.logger;
    this.configuredBlockedCodes = deps.configuredBlockedCodes ?? [];
  }

  /** "Now" as MySQL DATETIME(3). */
  now(): string {
    return mysqlTime(this.clock.now());
  }

  /** Quantity reserved per variant (unexpired tickets only). */
  async reservedByVariant(variantIds: string[] | null = null): Promise<Map<string, number>> {
    const where: Where = { het_han_luc: { ">": this.now() } };
    if (variantIds) where["ma_bien_the"] = variantIds;
    const rows = await this.store.table(TABLES.reservations).find({ where });
    const out = new Map<string, number>();
    for (const r of rows) {
      const id = String(r["ma_bien_the"]);
      out.set(id, (out.get(id) ?? 0) + Number(r["so_luong"] || 0));
    }
    return out;
  }

  /** Blocked codes, lower-cased: from configuration plus the `hang_kho_ma_chan` table. */
  async blockedCodes(): Promise<Set<string>> {
    const fromConfig = this.configuredBlockedCodes.map((x) => String(x || "").trim().toLowerCase()).filter(Boolean);
    const rows = await this.store.table(TABLES.blockedCodes).find({});
    return new Set([...fromConfig, ...rows.map((r) => String(r["ma"] || "").toLowerCase())]);
  }

  private variantsOf(store: DataStore, codes: string | string[]): Promise<Row[]> {
    return store.table(TABLES.variants).find({ where: { ma_mon: codes }, orderBy: ["gia asc", "thu_tu_kho asc"] });
  }

  /** One item (house view) by code or slug. `null` when absent or blocked. */
  async readItem(key: unknown): Promise<StoredItem | null> {
    const text = String(key || "").trim();
    if (!text) return null;
    let itemRow = await this.store.table(TABLES.items).one({ ma: text });
    if (!itemRow) itemRow = await this.store.table(TABLES.items).one({ duong_dan: text.toLowerCase() });
    if (!itemRow) return null;
    if ((await this.blockedCodes()).has(String(itemRow["ma"]).toLowerCase())) return null;

    const variants = await this.variantsOf(this.store, String(itemRow["ma"]));
    return rowsToItem(itemRow, variants, await this.reservedByVariant(variants.map((v) => String(v["ma_bien_the"]))));
  }

  /**
   * Items by code or name — one statement, never the whole catalogue.
   * Exact code first, then code prefix, then name containing the query.
   */
  async searchItems(query: unknown, limit = 10): Promise<StoredItem[]> {
    const text = String(query || "").trim();
    // No query = the whole catalogue (the storefront needs it). Still capped — but the cap must
    // SAY when it is hit: on 12/09/2026 the real catalogue (house + ready + campaign) reached
    // 5,154 items, hit the old cap of 5,000 and 154 items quietly never reached the web. Exactly
    // the trap the old comment warned about.
    if (!text) {
      const cap = Number(limit) || CATALOG_CAP;
      const all = await this.readAll(cap);
      if (all.length >= cap) {
        this.logger.warn(`[hang-kho] danh mục đụng trần ${cap} món — có món KHÔNG lên web. Nâng trần lên.`);
      }
      return all;
    }
    const n = Math.min(Math.max(1, Number(limit) || 10), 50);
    // TODO (known, do not fix silently): the name clause runs `LOWER(ten) LIKE %query%` on the WHOLE
    // query string, so a full customer sentence ("còn giày pegasus 42 không") never matches an item
    // named "Giày chạy Nike Pegasus 40". Behaviour kept identical to the old site on purpose.
    const rows = await this.store.rows(
      `SELECT *,
              CASE WHEN LOWER(ma) = LOWER(?) THEN 100
                   WHEN LOWER(ma) LIKE CONCAT(LOWER(?), '%') THEN 80
                   WHEN LOWER(ten) LIKE CONCAT('%', LOWER(?), '%') THEN 60
                   ELSE 0 END AS diem
         FROM ${TABLES.items}
        HAVING diem > 0
        ORDER BY diem DESC, ten ASC
        LIMIT ?`,
      [text, text, text, n]
    );
    const blocked = await this.blockedCodes();
    const reserved = await this.reservedByVariant();
    const out: StoredItem[] = [];
    for (const itemRow of rows) {
      if (blocked.has(String(itemRow["ma"]).toLowerCase())) continue;
      const variants = await this.variantsOf(this.store, String(itemRow["ma"]));
      out.push(rowsToItem(itemRow, variants, reserved));
    }
    return out;
  }

  /** How many items the catalogue holds — the brain's "we do not sell X" gate uses this number; no item is read. */
  async countItems(): Promise<number> {
    const rows = await this.store.rows(`SELECT COUNT(*) AS n FROM \`${TABLES.items}\``, []);
    return Number(rows[0]?.["n"] || 0);
  }

  /** The whole catalogue (blocked codes removed, reservations deducted). Capped so it is never unbounded. */
  async readAll(limit = 5000): Promise<StoredItem[]> {
    const n = Math.min(Math.max(1, Number(limit) || 5000), CATALOG_CAP);
    const itemRows = await this.store.table(TABLES.items).find({ orderBy: "ten asc", limit: n });
    if (itemRows.length === 0) return [];

    const blocked = await this.blockedCodes();
    const reserved = await this.reservedByVariant();
    // One statement for every variant of those items — no per-item round trip.
    const variants = await this.variantsOf(this.store, itemRows.map((r) => String(r["ma"])));
    const byCode = new Map<string, Row[]>();
    for (const v of variants) {
      const code = String(v["ma_mon"]);
      const list = byCode.get(code);
      if (list) list.push(v); else byCode.set(code, [v]);
    }
    return itemRows
      .filter((r) => !blocked.has(String(r["ma"]).toLowerCase()))
      .map((r) => rowsToItem(r, byCode.get(String(r["ma"])) ?? [], reserved));
  }

  /** The in-stock lines of an item, reservations deducted; cheapest first, then warehouse priority. */
  async stockOf(code: unknown, size: unknown = ""): Promise<ItemStock | null> {
    const item = await this.readItem(code);
    if (!item) return null;
    const wanted = String(size || "").trim().toLowerCase();
    const lines = item.sizes
      .filter((s) => Number(s.qty || 0) > 0)
      .filter((s) => !wanted || String(s.size).toLowerCase() === wanted)
      .map((s): StockLine => ({
        variantId: s.variantId, size: s.size, quantity: Number(s.qty || 0),
        price: Number(s.price || 0), warehouseId: s.warehouseId, rank: Number(s.selectionRank ?? 2147483647)
      }))
      .sort((a, b) => (a.price || Number.MAX_SAFE_INTEGER) - (b.price || Number.MAX_SAFE_INTEGER) || a.rank - b.rank);
    return { code: item.code, name: item.name, lines };
  }

  /** Normalised items of a raw list, minus blocked codes (blocked at WRITE time, not only at read time). */
  private async normaliseAndFilter(rawItems: unknown): Promise<{ raw: unknown[]; items: NormalisedItem[] }> {
    const blocked = await this.blockedCodes();
    const raw = asList(rawItems);
    const items = raw
      .map(normaliseItem)
      .filter((m): m is NormalisedItem => m !== null)
      .filter((m) => !blocked.has(m.code.toLowerCase()) && !blocked.has(String(m.originalCode || "").toLowerCase()));
    return { raw, items };
  }

  /** The current source of a code, "" when the code is unknown. */
  private async sourceOf(store: DataStore, code: string): Promise<string> {
    const rows = await store.rows(`SELECT nguon FROM \`${TABLES.items}\` WHERE ma = ?`, [code]);
    return rows.length ? String(rows[0]?.["nguon"] || "") : "";
  }

  /** A stronger source already describes this code: leave its description alone. */
  private yieldsTo(currentSource: string, source: Source): boolean {
    return Boolean(currentSource) && currentSource !== source && (SOURCE_PRIORITY[currentSource] ?? 0) > (SOURCE_PRIORITY[source] ?? 0);
  }

  /**
   * Replaces ALL stock of one source. In ONE transaction: a failure half-way leaves the old
   * catalogue intact — there is never a "half the catalogue is gone" state.
   */
  async replaceSource(source: Source, rawItems: unknown): Promise<SyncResult> {
    const at = this.now();
    const { raw, items } = await this.normaliseAndFilter(rawItems);

    const itemRows: ItemRow[] = [];
    // Variant id = hash(item code + warehouse + size). Two lines with the same triple get the
    // SAME id — in the file build they coexisted unnoticed; in a table it is a duplicate primary
    // key and THE WHOLE CATALOGUE UPLOAD FAILS. One bad line must not be allowed to kill the
    // catalogue. Fix: keep the CHEAPER line (an item's price is its smallest price anyway) and
    // LOG A WARNING so the operator knows to fix the source.
    const byId = new Map<string, VariantRow>();
    const duplicates: string[] = [];
    for (const item of items) {
      const { itemRow, variantRows } = itemToRows(item, source, at);
      itemRows.push(itemRow);
      for (const row of variantRows) {
        if (keepCheaper(byId, row)) duplicates.push(`${row.ma_mon} size ${row.size} kho ${row.ma_kho}`);
      }
    }
    const variantRows = [...byId.values()];
    if (duplicates.length > 0) {
      this.logger.warn(
        `[hang-kho] ${duplicates.length} dòng bị trùng (cùng món + size + kho), đã giữ dòng giá thấp hơn: ` +
        `${duplicates.slice(0, 5).join("; ")}${duplicates.length > 5 ? "..." : ""}`
      );
    }

    let written = 0;
    let yielded = 0;
    await this.store.transaction(async (tx) => {
      // Variants: a source touches only its own rows.
      await tx.table(TABLES.variants).delete({ nguon: source });
      if (variantRows.length) await tx.table(TABLES.variants).insertMany(variantRows);

      // Items: ONE row per code, shared by the three sources.
      const existing = await tx.rows(`SELECT ma, nguon FROM \`${TABLES.items}\``, []);
      const sourceByCode = new Map(existing.map((r) => [String(r["ma"]), String(r["nguon"] || "")]));
      const incoming = new Set(itemRows.map((r) => r.ma));

      // Items of this source missing from the new payload: delete only when NO variant (of any
      // source) still points at them. Deleting early orphans another source's variants.
      const candidates = [...sourceByCode.entries()].filter(([code, s]) => s === source && !incoming.has(code)).map(([code]) => code);
      if (candidates.length) {
        const stillUsed = await tx.rows(
          `SELECT DISTINCT ma_mon FROM \`${TABLES.variants}\` WHERE ma_mon IN (${candidates.map(() => "?").join(", ")})`,
          candidates
        );
        const used = new Set(stillUsed.map((r) => String(r["ma_mon"])));
        const gone = candidates.filter((code) => !used.has(code));
        if (gone.length) await tx.table(TABLES.items).delete({ ma: gone });
      }

      for (const row of itemRows) {
        // A source describing the item better keeps its description.
        if (this.yieldsTo(sourceByCode.get(row.ma) ?? "", source)) { yielded += 1; continue; }
        await tx.table(TABLES.items).upsert(row);
        written += 1;
      }
    });

    if (yielded > 0) {
      this.logger.info(`[hang-kho] ${yielded} món đã có mô tả từ nguồn kỹ hơn, chỉ nhận thêm biến thể (nguồn "${source}")`);
    }

    return {
      itemCount: itemRows.length, variantCount: variantRows.length,
      written, yielded,
      dropped: raw.length - itemRows.length
    };
  }

  /**
   * ADDS / UPDATES a group of items of one source WITHOUT touching the source's other items
   * (unlike `replaceSource`, which replaces the whole catalogue). For OMI: the shop adds or
   * edits single items, or imports a brand's Excel file, without losing what it has. One
   * transaction for the whole group.
   */
  async writeItems(source: Source, rawItems: unknown): Promise<WriteManyResult> {
    const at = this.now();
    const { raw, items } = await this.normaliseAndFilter(rawItems);
    // The same code twice in one payload: the LATER line wins (the person fixed it further down).
    const byCode = new Map<string, NormalisedItem>();
    for (const m of items) byCode.set(m.code, m);
    const list = [...byCode.values()];

    let variantCount = 0;
    let yielded = 0;
    let written = 0;
    await this.store.transaction(async (tx) => {
      for (const item of list) {
        const { itemRow, variantRows } = itemToRows(item, source, at);
        const byId = new Map<string, VariantRow>();
        for (const row of variantRows) keepCheaper(byId, row);
        await tx.table(TABLES.variants).delete({ ma_mon: item.code, nguon: source });
        const rows = [...byId.values()];
        if (rows.length) await tx.table(TABLES.variants).insertMany(rows);
        variantCount += rows.length;
        if (this.yieldsTo(await this.sourceOf(tx, item.code), source)) { yielded += 1; continue; }
        await tx.table(TABLES.items).upsert(itemRow);
        written += 1;
      }
    });
    return {
      itemCount: list.length, variantCount, written, yielded,
      dropped: raw.length - items.length, codes: list.map((m) => m.code)
    };
  }

  /** Writes ONE item; returns it after writing (house view). `item: null` = dropped (no code/name, or blocked). */
  async writeItem(source: Source, rawItem: unknown): Promise<WriteOneResult> {
    const result = await this.writeItems(source, [rawItem]);
    if (result.itemCount === 0) return { ...result, item: null };
    return { ...result, item: await this.readItem(result.codes[0]) };
  }

  /**
   * DELETES an item from one source: drops that source's variants; the item row goes only when
   * NO variant (of any source) still points at it — deleting early orphans another source's stock.
   */
  async deleteItem(source: Source, code: unknown): Promise<DeleteResult> {
    const clean = String(code || "").trim();
    if (!clean) return { deleted: false, otherSourceRemains: false, reason: "thieu_ma" };
    let deleted = false;
    let otherSourceRemains = false;
    await this.store.transaction(async (tx) => {
      const found = await tx.rows(`SELECT ma FROM \`${TABLES.items}\` WHERE ma = ?`, [clean]);
      if (!found.length) return;
      await tx.table(TABLES.variants).delete({ ma_mon: clean, nguon: source });
      const left = await tx.rows(`SELECT COUNT(*) AS n FROM \`${TABLES.variants}\` WHERE ma_mon = ?`, [clean]);
      if (Number(left[0]?.["n"] || 0) > 0) { otherSourceRemains = true; deleted = true; return; }
      await tx.table(TABLES.items).delete({ ma: clean });
      deleted = true;
    });
    return { deleted, otherSourceRemains, reason: deleted ? "" : "khong_thay" };
  }

  /**
   * Reserves one variant.
   *
   * Reading the stock and then writing the ticket has a gap: two people asking for the last pair
   * both see "1 left". So both steps run in ONE transaction and the variant row is LOCKED
   * (`FOR UPDATE`) — the second person waits, and on re-reading finds it gone.
   */
  async reserve(request: ReserveRequest): Promise<ReserveOutcome> {
    const stock = await this.stockOf(request.code, request.size);
    const line = stock?.lines[0];
    if (!stock || !line) return { ok: false, reason: "khong_du_hang" };

    const outcome = await this.store.transaction(async (tx): Promise<{ ok: false } | { ok: true; remaining: number }> => {
      const locked = await tx.rows(`SELECT ton FROM ${TABLES.variants} WHERE ma_bien_the = ? FOR UPDATE`, [line.variantId]);
      if (locked.length === 0) return { ok: false };

      const held = await tx.rows(
        `SELECT COALESCE(SUM(so_luong), 0) AS n FROM ${TABLES.reservations} WHERE ma_bien_the = ? AND het_han_luc > ?`,
        [line.variantId, this.now()]
      );
      const left = Number(locked[0]?.["ton"] || 0) - Number(held[0]?.["n"] || 0);
      if (left < request.quantity) return { ok: false };

      await tx.table(TABLES.reservations).insert({
        ma_phieu: request.ticket, ma_bien_the: line.variantId, ma_mon: stock.code, size: line.size,
        so_luong: request.quantity, cua_ai: request.heldBy,
        giu_luc: mysqlTime(request.at),
        het_han_luc: mysqlTime(request.expiresAt)
      });
      return { ok: true, remaining: left - request.quantity };
    });

    if (!outcome.ok) return { ok: false, reason: "khong_du_hang" };
    return {
      ok: true, code: stock.code, ticket: request.ticket, variantId: line.variantId, size: line.size, price: line.price,
      warehouseId: line.warehouseId, remaining: outcome.remaining
    };
  }

  /** Releases a reservation ticket. `true` when a ticket was actually removed. */
  async release(ticket: unknown): Promise<boolean> {
    const removed = await this.store.table(TABLES.reservations).delete({ ma_phieu: String(ticket || "") });
    return removed > 0;
  }
}
