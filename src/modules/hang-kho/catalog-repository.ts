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
import { isoFromMysql, toMysqlDateTime } from "../../shared/mysql-time";
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

/** One line of the bulk "Sửa nhanh web" screen: the code plus only the fields being changed. */
export interface QuickEditPatch {
  code: string;
  listPrice?: number | undefined;
  discountPercent?: number | undefined;
  status?: string | undefined;
  /** The name shown on the web (the running site's admin edited it inline). */
  name?: string | undefined;
  /**
   * The sale price typed on the fast screen. Since Đ5 it is the MANUAL price (Desk's rule): it sells
   * while it is not below the source price; "về giá nguồn" clears it.
   */
  price?: number | undefined;
  brand?: string | undefined;
  productKind?: string | undefined;
  category?: string | undefined;
  gender?: string | undefined;
}

/** What the bulk edit did: the codes really written, and the ones nothing matched. */
/** `hang.tim` filters: only items with a size / a source still in stock. */
export interface SearchFilter {
  size?: string;
  source?: string;
  /**
   * Only items with at least one line in this warehouse — ANY stock, 0 included (OMI's warehouse
   * screen lists a whole warehouse, 18/09/2026). The items still come back with ALL their sizes.
   */
  warehouseId?: string;
}

/** The most items one warehouse listing may return. */
export const WAREHOUSE_LIST_CAP = 5000;

export interface QuickEditResult {
  changed: string[];
  missing: string[];
}

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
  nhom_hang: string; seo_tieu_de: string; seo_mo_ta: string; seo_tu_khoa: string; chinh_sach: string; gia_nguon: number;
};

/** A row of `hang_kho_bien_the` as written by this module. */
export type VariantRow = {
  ma_bien_the: string; ma_mon: string; size: string; ma_kho: string; ton: number; gia: number; gia_niem_yet: number;
  thu_tu_kho: number; nguon: Source; ma_chien_dich: string; ma_dong_doi_tac: string; sua_luc: string;
  ma_sku: string; gia_von: number; gia_nguon: number;
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
    sua_luc: at,
    nhom_hang: item.division || "",
    seo_tieu_de: (item.seoTitle || "").slice(0, 255),
    seo_mo_ta: (item.seoDescription || "").slice(0, 500),
    seo_tu_khoa: (item.seoKeywords || "").slice(0, 500),
    chinh_sach: item.policy || "",
    gia_nguon: item.preMarkupSalePrice || item.price || 0
  };

  const variantRows: VariantRow[] = item.sizes
    .map((line): VariantRow => {
      const price = firstPositive(line.suggestedPrice, line.salePrice, line.sellPrice, line.price);
      return {
        ma_bien_the: variantId(item, line),
        ma_mon: item.code,
        size: String(line.size || "").trim(),
        ma_kho: String(line.warehouseId || "").trim() || warehouseKey(line.warehouse || line.warehouseName),
        ton: Math.max(0, Math.trunc(Number(line.qty ?? line.available ?? line.stockQty ?? 0))),
        gia: price,
        gia_niem_yet: firstPositive(line.listPrice, line.originalPrice, item.listPrice),
        thu_tu_kho: Math.min(warehouseRank(item, line), 2147483647),
        nguon: source,
        ma_chien_dich: String(line.campaignId || item.campaignId || "").trim(),
        ma_dong_doi_tac: String(line.partnerCampaignLineId || "").trim(),
        sua_luc: at,
        ma_sku: String(line.sku || line.variantSku || "").trim().slice(0, 128),
        gia_von: firstPositive(line.costPrice, line.cost),
        gia_nguon: firstPositive(line.saleFilePrice, line.sourcePrice, line.baseSalePrice, line.rawSalePrice, price)
      };
    })
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
  /** SKU of this size (Desk "Mã SKU biến thể"). */
  sku: string;
  /** Cost price of this size — house view only, `publicSize` never copies it. */
  costPrice: number;
  /** The price the source wrote; `price` differs from it while a manual price sells. */
  sourcePrice: number;
  // ---- OMI "Hàng hóa & Kho" v1 (18/09/2026) — house view only; `publicSize` copies none of them ----
  /** Raw `ton` on the shelf (`qty` = this minus what is held). */
  stock: number;
  /** Pairs held by unexpired reservations. */
  reserved: number;
  barcode: string;
  color: string;
  /** Free text ("950g"). */
  weight: string;
  /** ISO time of the line's last change. */
  updatedAt: string;
};

/** How the selling price was decided (Desk `priceMode`). Values are wire. */
export type PriceMode = "source" | "manual" | "source_higher_than_manual";

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
  division: string;
  seoTitle: string;
  seoDescription: string;
  seoKeywords: string;
  policy: string;
  /** The product page text written in OMI (`PUT /api/hang-kho/mon/:ma/noi-dung-web`). */
  webContent: Record<string, unknown>;
  manualPrice: number;
  sourcePrice: number;
  priceMode: PriceMode;
  priceManual: boolean;
  priceWarning: string;
  /**
   * Free attributes of the product page (`thuoc_tinh_json`): skuNoiBo, maVach, mua, xuatXu, chatLieu,
   * donViTinh, mau, choPhepDat, khoaTrungTam, doiTacCungCap, chinhSachKho. House view only.
   */
  attributes: Record<string, unknown>;
  /** ISO time of the item row's last change. */
  updatedAt: string;
};

/** Table rows -> the item shape `publicView` and the services read. */
export function rowsToItem(itemRow: Row, variantRows: Row[], reserved: ReadonlyMap<string, number> = new Map()): StoredItem {
  // Item price = the SMALLEST price among variants in stock (the rule the old site runs on).
  const inStock = variantRows.filter((v) => Number(v["ton"] || 0) > 0).map((v) => Number(v["gia"] || 0)).filter((p) => p > 0);
  const any = variantRows.map((v) => Number(v["gia"] || 0)).filter((p) => p > 0);
  const price = inStock.length ? Math.min(...inStock) : (any.length ? Math.min(...any) : 0);
  const discountPercent = Number(itemRow["phan_tram_giam"] || 0);
  const source = String(itemRow["nguon"] || "");
  const manualPrice = Number(itemRow["gia_tay"] || 0);
  const sourcePrice = Number(itemRow["gia_nguon"] || 0);
  const priceMode: PriceMode = manualPrice <= 0 ? "source" : sourcePrice > manualPrice ? "source_higher_than_manual" : "manual";
  const webContent = parseJson(itemRow["noi_dung_web_json"], {});
  const attributes = parseJson(itemRow["thuoc_tinh_json"], {});
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
    division: String(itemRow["nhom_hang"] || ""),
    seoTitle: String(itemRow["seo_tieu_de"] || ""),
    seoDescription: String(itemRow["seo_mo_ta"] || ""),
    seoKeywords: String(itemRow["seo_tu_khoa"] || ""),
    policy: String(itemRow["chinh_sach"] || ""),
    webContent: webContent && typeof webContent === "object" && !Array.isArray(webContent) ? (webContent as Record<string, unknown>) : {},
    manualPrice,
    sourcePrice,
    priceMode,
    priceManual: manualPrice > 0,
    priceWarning: priceMode === "source_higher_than_manual" ? `Giá nguồn ${sourcePrice} cao hơn giá tay ${manualPrice}.` : "",
    attributes: attributes && typeof attributes === "object" && !Array.isArray(attributes) ? (attributes as Record<string, unknown>) : {},
    updatedAt: isoFromMysql(itemRow["sua_luc"]),
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
        partnerCampaignLineId: String(v["ma_dong_doi_tac"] || ""),
        sku: String(v["ma_sku"] || ""),
        costPrice: Number(v["gia_von"] || 0),
        sourcePrice: Number(v["gia_nguon"] || 0) || Number(v["gia"] || 0),
        stock: Number(v["ton"] || 0),
        reserved: reserved.get(id) ?? 0,
        barcode: String(v["ma_vach"] ?? ""),
        color: String(v["mau"] ?? ""),
        weight: String(v["khoi_luong"] ?? ""),
        updatedAt: isoFromMysql(v["sua_luc"])
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

/** Result of turning a reservation into a sale. Reason VALUES are wire. */
export type CommitOutcome =
  | { ok: false; reason: "khong_co_phieu" }
  | { ok: true; variantId: string; code: string; size: string; quantity: number };

/** Result of putting pairs back. `before`/`after` let the caller announce "back in stock". */
export type RestockOutcome =
  | { ok: false; reason: "thieu_bien_the" | "khong_co_bien_the" }
  | { ok: true; variantId: string; code: string; size: string; before: number; after: number };

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

/**
 * A push REPLACES a source's size rows (delete + insert). What a person typed on a size in OMI — SKU,
 * barcode, weight, cost — is not in the pushed file, and was wiped by every push (review 18/09/2026).
 * The new rows keep the old row's values (same `ma_bien_the`) wherever the push leaves them empty.
 * Every row gets the same columns, as `insertMany` requires.
 */
async function keptDetails(tx: DataStore, rows: VariantRow[], source: Source, code?: string): Promise<Row[]> {
  if (rows.length === 0) return [];
  const old = await tx.rows(
    `SELECT ma_bien_the, ma_sku, ma_vach, khoi_luong, gia_von FROM ${TABLES.variants} WHERE nguon = ?${code === undefined ? "" : " AND ma_mon = ?"}`,
    code === undefined ? [source] : [source, code]
  );
  const byId = new Map(old.map((r) => [String(r["ma_bien_the"]), r]));
  return rows.map((row) => {
    const before = byId.get(row.ma_bien_the);
    return {
      ...row,
      ma_sku: row.ma_sku || String(before?.["ma_sku"] ?? ""),
      gia_von: Number(row.gia_von) > 0 ? row.gia_von : Number(before?.["gia_von"] || 0),
      ma_vach: String(before?.["ma_vach"] ?? ""),
      khoi_luong: String(before?.["khoi_luong"] ?? "")
    };
  });
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
  async searchItems(query: unknown, limit = 10, filter: SearchFilter = {}): Promise<StoredItem[]> {
    const text = String(query || "").trim();
    const size = String(filter.size || "").trim();
    const source = String(filter.source || "").trim();
    const warehouseId = String(filter.warehouseId || "").trim();
    if (warehouseId !== "") return this.searchInWarehouse(text, limit, size, source, warehouseId);
    if (size !== "" || source !== "") return this.searchFiltered(text, limit, size, source);
    // No query = the whole catalogue (the storefront needs it). Still capped — but the cap must
    // SAY when it is hit: on 12/09/2026 the real catalogue (house + ready + campaign) reached
    // 5,154 items, hit the old cap of 5,000 and 154 items quietly never reached the web. Exactly
    // the trap the old comment warned about.
    if (!text) {
      const cap = Math.trunc(Number(limit)) || CATALOG_CAP;
      const all = await this.readAll(cap);
      if (all.length >= cap) {
        this.logger.warn(`[hang-kho] danh mục đụng trần ${cap} món — có món KHÔNG lên web. Nâng trần lên.`);
      }
      return all;
    }
    const n = Math.min(Math.max(1, Math.trunc(Number(limit)) || 10), 50);
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

  /**
   * Search narrowed to items that HAVE a size / a source in stock (Đ5, OMI `hang.tim`). One
   * statement: the size and source test is an EXISTS on the variant table, the text test the same
   * scoring as `searchItems`. A size is compared as written ("42", "M") — the catalogue stores EU sizes.
   */
  private async searchFiltered(text: string, limit: number, size: string, source: string): Promise<StoredItem[]> {
    const n = Math.min(Math.max(1, Math.trunc(Number(limit)) || 50), 1000);
    const exists = `EXISTS (SELECT 1 FROM ${TABLES.variants} b WHERE b.ma_mon = m.ma AND b.ton > 0
      AND (? = '' OR LOWER(b.size) = LOWER(?)) AND (? = '' OR b.nguon = ?))`;
    const rows = await this.store.rows(
      `SELECT m.*,
              CASE WHEN ? = '' THEN 1
                   WHEN LOWER(m.ma) = LOWER(?) THEN 100
                   WHEN LOWER(m.ma) LIKE CONCAT(LOWER(?), '%') THEN 80
                   WHEN LOWER(m.ten) LIKE CONCAT('%', LOWER(?), '%') THEN 60
                   WHEN LOWER(m.hang) LIKE CONCAT('%', LOWER(?), '%') THEN 40
                   ELSE 0 END AS diem
         FROM ${TABLES.items} m
        WHERE ${exists}
       HAVING diem > 0
        ORDER BY diem DESC, m.ten ASC
        LIMIT ?`,
      [text, text, text, text, text, size, size, source, source, n]
    );
    const blocked = await this.blockedCodes();
    const reserved = await this.reservedByVariant();
    const kept = rows.filter((r) => !blocked.has(String(r["ma"]).toLowerCase()));
    if (kept.length === 0) return [];
    const variants = await this.variantsOf(this.store, kept.map((r) => String(r["ma"])));
    const byCode = new Map<string, Row[]>();
    for (const v of variants) {
      const list = byCode.get(String(v["ma_mon"]));
      if (list) list.push(v); else byCode.set(String(v["ma_mon"]), [v]);
    }
    return kept.map((r) => rowsToItem(r, byCode.get(String(r["ma"])) ?? [], reserved));
  }

  /**
   * Items with a line in ONE warehouse (any stock, 0 included), optionally narrowed by text, size and
   * source ON THAT WAREHOUSE's lines — OMI's warehouse screen. Cap `WAREHOUSE_LIST_CAP`, default the cap:
   * the screen lists the whole warehouse. Every item comes back with all its sizes, every warehouse.
   */
  private async searchInWarehouse(text: string, limit: number, size: string, source: string, warehouseId: string): Promise<StoredItem[]> {
    const n = Math.min(Math.max(1, Math.trunc(Number(limit)) || WAREHOUSE_LIST_CAP), WAREHOUSE_LIST_CAP);
    const rows = await this.store.rows(
      `SELECT m.*,
              CASE WHEN ? = '' THEN 1
                   WHEN LOWER(m.ma) = LOWER(?) THEN 100
                   WHEN LOWER(m.ma) LIKE CONCAT(LOWER(?), '%') THEN 80
                   WHEN LOWER(m.ten) LIKE CONCAT('%', LOWER(?), '%') THEN 60
                   WHEN LOWER(m.hang) LIKE CONCAT('%', LOWER(?), '%') THEN 40
                   ELSE 0 END AS diem
         FROM ${TABLES.items} m
        WHERE EXISTS (SELECT 1 FROM ${TABLES.variants} b WHERE b.ma_mon = m.ma AND b.ma_kho = ?
                        AND (? = '' OR LOWER(b.size) = LOWER(?)) AND (? = '' OR b.nguon = ?))
       HAVING diem > 0
        ORDER BY diem DESC, m.ten ASC
        LIMIT ?`,
      [text, text, text, text, text, warehouseId, size, size, source, source, n]
    );
    const blocked = await this.blockedCodes();
    const kept = rows.filter((r) => !blocked.has(String(r["ma"]).toLowerCase()));
    if (kept.length === 0) return [];
    const reserved = await this.reservedByVariant();
    const variants = await this.variantsOf(this.store, kept.map((r) => String(r["ma"])));
    const byCode = new Map<string, Row[]>();
    for (const v of variants) {
      const list = byCode.get(String(v["ma_mon"]));
      if (list) list.push(v); else byCode.set(String(v["ma_mon"]), [v]);
    }
    return kept.map((r) => rowsToItem(r, byCode.get(String(r["ma"])) ?? [], reserved));
  }

  /**
   * "Đồng bộ giá lên web" of one warehouse: ONE price on every line of an item in that warehouse,
   * every source — a source price, like `setVariantPrice`, so the price rule runs after it.
   * Returns the lines changed.
   */
  async setWarehousePrice(input: { code: string; warehouseId: string; price: number }, at: Date): Promise<number> {
    const done = await this.store.table(TABLES.variants).update(
      { ma_mon: input.code, ma_kho: input.warehouseId },
      { gia: input.price, gia_nguon: input.price, sua_luc: mysqlTime(at) }
    );
    if (done > 0) await this.reprice(this.store, [input.code]);
    return done;
  }

  /**
   * THE PRICE RULE after any write (Desk `applyLandingManualPricePolicy`): the item's source price is
   * the smallest source price of its sizes; a manual price sells on every size while it is not below
   * that source price, otherwise every size sells at its own source price. `codes` = null: every item
   * that carries a manual price (after a whole-catalogue upload).
   */
  async reprice(store: DataStore, codes: string[] | null): Promise<void> {
    if (codes !== null && codes.length === 0) return;
    const where = codes === null ? "m.gia_tay > 0" : `m.ma IN (${codes.map(() => "?").join(", ")})`;
    const params = codes ?? [];
    const sourceOfVariant = "IF(b.gia_nguon > 0, b.gia_nguon, b.gia)";
    await store.execute(
      `UPDATE ${TABLES.items} m
          SET m.gia_nguon = COALESCE((SELECT MIN(${sourceOfVariant}) FROM ${TABLES.variants} b WHERE b.ma_mon = m.ma AND ${sourceOfVariant} > 0), 0)
        WHERE ${where}`,
      params
    );
    await store.execute(
      `UPDATE ${TABLES.variants} b JOIN ${TABLES.items} m ON m.ma = b.ma_mon
          SET b.gia = CASE WHEN m.gia_tay > 0 AND m.gia_tay >= m.gia_nguon THEN m.gia_tay ELSE ${sourceOfVariant} END
        WHERE ${where}`,
      params
    );
  }

  /** "Dùng lại giá nguồn": drops the manual price of one item. `false` = no such item. */
  async resetManualPrice(code: string, at: Date): Promise<boolean> {
    const done = await this.store.table(TABLES.items).update({ ma: code }, { gia_tay: 0, gia_tay_luc: null, sua_luc: mysqlTime(at) });
    if (done === 0) return false;
    await this.reprice(this.store, [code]);
    return true;
  }

  /** The web texts of one item (SEO + the product page content). `false` = no such item. */
  async writeWebContent(code: string, input: { seoTitle: string; seoDescription: string; seoKeywords: string; content: Record<string, unknown> }, at: Date): Promise<boolean> {
    const done = await this.store.table(TABLES.items).update({ ma: code }, {
      seo_tieu_de: input.seoTitle.slice(0, 255), seo_mo_ta: input.seoDescription.slice(0, 500), seo_tu_khoa: input.seoKeywords.slice(0, 500),
      noi_dung_web_json: JSON.stringify(input.content), sua_luc: mysqlTime(at)
    });
    return done > 0;
  }

  /**
   * Sales Desk "Đổi giá" on a ready-stock line (`rs-price`): the price of ONE size in ONE warehouse
   * of ONE source. It is a source price (the shop's own list), so the price rule runs after it.
   */
  async setVariantPrice(input: { code: string; size: string; warehouseId: string; source: Source; price: number }, at: Date): Promise<number> {
    const done = await this.store.table(TABLES.variants).update(
      { ma_mon: input.code, size: input.size, ma_kho: input.warehouseId, nguon: input.source },
      { gia: input.price, gia_nguon: input.price, sua_luc: mysqlTime(at) }
    );
    if (done > 0) await this.reprice(this.store, [input.code]);
    return done;
  }

  /** How many items the catalogue holds — the brain's "we do not sell X" gate uses this number; no item is read. */
  async countItems(): Promise<number> {
    const rows = await this.store.rows(`SELECT COUNT(*) AS n FROM \`${TABLES.items}\``, []);
    return Number(rows[0]?.["n"] || 0);
  }

  /** The whole catalogue (blocked codes removed, reservations deducted). Capped so it is never unbounded. */
  async readAll(limit = 5000): Promise<StoredItem[]> {
    const n = Math.min(Math.max(1, Math.trunc(Number(limit)) || 5000), CATALOG_CAP);
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
      const kept = await keptDetails(tx, variantRows, source);
      await tx.table(TABLES.variants).delete({ nguon: source });
      if (kept.length) await tx.table(TABLES.variants).insertMany(kept);

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
      // A new upload must not silently undo the manual prices the shop typed in OMI.
      await this.reprice(tx, null);
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
        const rows = await keptDetails(tx, [...byId.values()], source, item.code);
        await tx.table(TABLES.variants).delete({ ma_mon: item.code, nguon: source });
        if (rows.length) await tx.table(TABLES.variants).insertMany(rows);
        variantCount += rows.length;
        if (this.yieldsTo(await this.sourceOf(tx, item.code), source)) { yielded += 1; continue; }
        await tx.table(TABLES.items).upsert(itemRow);
        written += 1;
      }
      await this.reprice(tx, list.map((m) => m.code));
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
   * Every item that has stock FROM ONE SOURCE — ready stock, or a partner campaign.
   *
   * The three sources share one variant table (see the module header), so "show me the ready
   * stock" is a question about VARIANTS, not about items: an item can hold house sizes and ready
   * sizes at once. It therefore starts from the variant rows of that source and reads back the
   * items they belong to, rather than filtering items by `nguon` — which would miss exactly the
   * mixed items a seller most wants to see.
   */
  async itemsBySource(source: Source, limit = 500): Promise<StoredItem[]> {
    const cap = Math.min(Math.max(1, Math.trunc(Number(limit)) || 500), 2000);
    const codes = await this.store.rows(
      `SELECT DISTINCT ma_mon FROM \`${TABLES.variants}\` WHERE nguon = ? ORDER BY ma_mon ASC LIMIT ?`,
      [source, cap]
    );
    if (codes.length === 0) return [];
    const blocked = await this.blockedCodes();
    const reserved = await this.reservedByVariant();
    const out: StoredItem[] = [];
    for (const row of codes) {
      const code = String(row["ma_mon"]);
      if (blocked.has(code.toLowerCase())) continue;
      const itemRow = await this.store.table(TABLES.items).one({ ma: code });
      if (!itemRow) continue;
      out.push(rowsToItem(itemRow, await this.variantsOf(this.store, code), reserved));
    }
    return out;
  }

  /**
   * QUICK EDIT of many items at once — Sales Desk's "Sửa nhanh web" screen.
   *
   * It writes only the THREE fields a seller changes in bulk (list price, discount, shown/hidden)
   * and never touches stock, sizes, images or names. That is the whole point: the fast screen is
   * the one where a mistake is cheapest, so it is given the smallest possible reach. A code that
   * does not exist is reported back rather than created — a typo must not invent a product.
   *
   * Prices land on the ITEM row. Per-size prices live on the variants and are edited one item at
   * a time; mixing the two here would let one careless bulk save flatten a whole size ladder.
   */
  async quickEdit(patches: QuickEditPatch[], at: Date): Promise<QuickEditResult> {
    const changed: string[] = [];
    const missing: string[] = [];
    const blocked = await this.blockedCodes();
    for (const patch of patches) {
      const code = String(patch.code || "").trim();
      if (!code || blocked.has(code.toLowerCase())) { missing.push(code); continue; }
      const columns: Row = {};
      if (patch.listPrice !== undefined) columns["gia_niem_yet"] = Math.max(0, Math.round(Number(patch.listPrice) || 0));
      if (patch.discountPercent !== undefined) columns["phan_tram_giam"] = Math.min(99, Math.max(0, Math.round(Number(patch.discountPercent) || 0)));
      if (patch.status !== undefined) columns["trang_thai"] = String(patch.status) === "hidden" ? "hidden" : "orderable";
      const name = patch.name === undefined ? "" : String(patch.name).trim().slice(0, 255);
      if (name !== "") columns["ten"] = name;
      // Đ5 text fields: an empty value CLEARS (the seller erased a wrong brand), unlike the name.
      if (patch.brand !== undefined) columns["hang"] = String(patch.brand).trim().slice(0, 190);
      if (patch.productKind !== undefined) columns["loai"] = String(patch.productKind).trim().slice(0, 190);
      if (patch.category !== undefined) columns["nhom"] = String(patch.category).trim().slice(0, 190);
      if (patch.gender !== undefined) columns["gioi_tinh"] = String(patch.gender).trim().slice(0, 64);
      const price = patch.price === undefined ? 0 : Math.round(Number(patch.price) || 0);
      if (price > 0) { columns["gia_tay"] = price; columns["gia_tay_luc"] = mysqlTime(at); }
      if (Object.keys(columns).length === 0) continue;
      const done = await this.store.table(TABLES.items).update({ ma: code }, { ...columns, sua_luc: mysqlTime(at) });
      if (done > 0 && price > 0) await this.reprice(this.store, [code]);
      if (done > 0) changed.push(code); else missing.push(code);
    }
    return { changed, missing };
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

  /**
   * Turns a reservation into a SALE: the pairs leave the shelf for good and the ticket is dropped.
   *
   * The order flow calls this right after the order is written. Before 14/09/2026 nothing did:
   * the 30-minute hold simply expired and the sold pair reappeared as available (hole found on
   * 12/09/2026, KIEM-KE-TINH-NANG.md "Lỗ 1"). Ticket row and variant row are both locked in one
   * transaction so a concurrent reserve on the same variant sees the new quantity.
   */
  async commit(ticket: unknown): Promise<CommitOutcome> {
    const id = String(ticket || "");
    if (id === "") return { ok: false, reason: "khong_co_phieu" };
    return this.store.transaction(async (tx): Promise<CommitOutcome> => {
      const held = await tx.rows(`SELECT ma_bien_the, ma_mon, size, so_luong FROM ${TABLES.reservations} WHERE ma_phieu = ? FOR UPDATE`, [id]);
      const row = held[0];
      if (!row) return { ok: false, reason: "khong_co_phieu" };
      const variantId = String(row["ma_bien_the"]);
      const quantity = Math.max(0, Number(row["so_luong"] || 0));
      // GREATEST(0, …): a hold written against stock that was later re-uploaded lower must not go negative.
      await tx.execute(`UPDATE ${TABLES.variants} SET ton = GREATEST(0, ton - ?), sua_luc = ? WHERE ma_bien_the = ?`, [quantity, this.now(), variantId]);
      await tx.table(TABLES.reservations).delete({ ma_phieu: id });
      return { ok: true, variantId, code: String(row["ma_mon"]), size: String(row["size"]), quantity };
    });
  }

  /**
   * Puts pairs back on the shelf — a cancelled order. Returns the quantity before and after so the
   * caller can announce "back in stock" when it crossed zero.
   */
  async restock(variantId: unknown, quantity: unknown): Promise<RestockOutcome> {
    const id = String(variantId || "");
    const qty = Math.max(0, Math.trunc(Number(quantity) || 0));
    if (id === "" || qty === 0) return { ok: false, reason: "thieu_bien_the" };
    return this.store.transaction(async (tx): Promise<RestockOutcome> => {
      const locked = await tx.rows(`SELECT ton, ma_mon, size FROM ${TABLES.variants} WHERE ma_bien_the = ? FOR UPDATE`, [id]);
      const row = locked[0];
      if (!row) return { ok: false, reason: "khong_co_bien_the" };
      const before = Number(row["ton"] || 0);
      await tx.execute(`UPDATE ${TABLES.variants} SET ton = ton + ?, sua_luc = ? WHERE ma_bien_the = ?`, [qty, this.now(), id]);
      return { ok: true, variantId: id, code: String(row["ma_mon"]), size: String(row["size"]), before, after: before + qty };
    });
  }
}
