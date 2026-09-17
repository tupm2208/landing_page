/**
 * @file "Đồng bộ kho" from pasted CSV or a public Google Sheet — Sales Desk's `inventory_import.js`
 * (`importGoogleSheet`, `parseCSV`, `normalizeEUSize`), cut down to what a shop types by hand.
 *
 * Pure functions: text in, items (the shape `normaliseItem` reads) out. Fetching the sheet and
 * writing the catalogue stay in `module.ts`, so every rule here is testable without a network.
 *
 * WHAT WAS LEFT OUT on purpose: the adidas size-matrix sheets and Japanese cm sizes. Brand files
 * with those layouts go through OMI's Excel reader (`omi/src/hang/bang-tinh.ts`), which already
 * knows them. A pasted sheet is the shop's own list: one row per size.
 */

/** The size systems a sheet may be written in. Values are wire (OMI sends them). */
export const SIZE_SYSTEMS = ["EU", "US_MEN", "UK"] as const;
export type SizeSystem = (typeof SIZE_SYSTEMS)[number];

/** Desk `SIZE_EU_MAP`, verbatim: [system, size as written, EU size]. */
const SIZE_EU_MAP: [SizeSystem, string, string][] = [
  ["US_MEN", "US 6", "38"], ["US_MEN", "US 6.5", "38.5"], ["US_MEN", "US 7", "39"], ["US_MEN", "US 7.5", "40"],
  ["US_MEN", "US 8", "41"], ["US_MEN", "US 8.5", "42"], ["US_MEN", "US 9", "42.5"], ["US_MEN", "US 9.5", "43"],
  ["US_MEN", "US 10", "44"], ["US_MEN", "US 10.5", "44.5"], ["US_MEN", "US 11", "45"],
  ["UK", "UK 5", "38"], ["UK", "UK 5.5", "38.5"], ["UK", "UK 6", "39.5"], ["UK", "UK 6.5", "40"], ["UK", "UK 7", "41"],
  ["UK", "UK 7.5", "41.5"], ["UK", "UK 8", "42"], ["UK", "UK 8.5", "42.5"], ["UK", "UK 9", "43"], ["UK", "UK 9.5", "44"],
  ["UK", "UK 10", "44.5"]
];

/** Thrown for input a person must fix (bad link, private sheet). The route answers 400 with the message. */
export class SheetInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SheetInputError";
  }
}

/**
 * The CSV export address of a Google Sheet link (Desk `googleSheetToCSVUrl`): an edit link, a
 * "publish to web" link, or a link that already ends in CSV.
 */
export function googleSheetCsvUrl(sheetUrl: string): string {
  let url: URL;
  try { url = new URL(String(sheetUrl || "").trim()); } catch { throw new SheetInputError("Link Google Sheet không hợp lệ."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new SheetInputError("Link Google Sheet không hợp lệ.");
  if (url.hostname !== "docs.google.com") {
    if (url.pathname.toLowerCase().endsWith(".csv") || url.searchParams.get("output") === "csv") return url.toString();
    throw new SheetInputError("Hiện chỉ hỗ trợ Google Sheet hoặc link CSV public.");
  }
  if (url.searchParams.get("output") === "csv") return url.toString();
  if (/\/spreadsheets\/d\/e\/([^/]+)/.test(url.pathname)) {
    url.searchParams.set("output", "csv");
    return url.toString();
  }
  const match = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
  if (!match) throw new SheetInputError("Không tìm thấy ID Google Sheet trong link.");
  const hashGid = url.hash.match(/gid=(\d+)/);
  const gid = url.searchParams.get("gid") || (hashGid ? hashGid[1] : "0");
  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`;
}

/** Google answers a private sheet with its sign-in page, not an error code. */
export function looksLikeHtml(text: string): boolean {
  return /^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text);
}

/** Desk `parseCSV`: quoted cells, doubled quotes, CRLF. A tab-separated paste (copied from a sheet) works too. */
export function parseCsv(text: string): string[][] {
  const input = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const firstLine = input.split("\n", 1)[0] ?? "";
  const separator = firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === '"' && quoted && input[i + 1] === '"') { cell += '"'; i += 1; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === separator && !quoted) { row.push(cell.trim()); cell = ""; }
    else if (ch === "\n" && !quoted) { row.push(cell.trim()); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ""));
}

const stripAccents = (value: string): string => value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d");
const headerKey = (value: string): string => stripAccents(String(value || "").toLowerCase()).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

function formatEuSize(value: number): string {
  if (!Number.isFinite(value)) return "";
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

/** Letter sizes and "one size" (Desk `normalizeAlphaSize`). */
function alphaSize(value: string): string {
  const token = headerKey(value).toUpperCase().replace(/_/g, " ");
  if (/^(XS|S|M|L|XL|XXL|2XL|3XL|4XL)$/.test(token)) return token;
  if (token === "XXXL") return "3XL";
  if (["NS", "MAC DINH", "ORDER", "ONE SIZE", "ONESIZE", "FREE SIZE", "OS"].includes(token)) return "OS";
  return "";
}

/**
 * A size as written in the sheet -> the EU size the web shows (Desk `normalizeEUSize`).
 * An explicit prefix ("US 9", "UK 8") wins over the system chosen for the whole sheet.
 * Returns "" when the size cannot be read — the row is then reported, never guessed.
 */
export function normaliseSize(raw: string, system: SizeSystem = "EU", brand = ""): string {
  const cleaned = String(raw || "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!cleaned) return "";
  const alpha = alphaSize(cleaned);
  if (alpha) return alpha;
  const explicit: SizeSystem | "" = /\bUK\b/.test(cleaned) ? "UK" : /\bUS\b/.test(cleaned) ? "US_MEN" : /\bEUR?\b/.test(cleaned) ? "EU" : "";
  const used = explicit || system;
  const isAdidas = headerKey(brand) === "adidas";
  if (used === "EU") {
    const fraction = cleaned.match(/(\d{2})\s+([12])\/3$/);
    if (fraction) {
      const base = Number(fraction[1]);
      return fraction[2] === "1" ? formatEuSize(base) : formatEuSize(base % 2 === 0 ? base + 0.5 : base);
    }
    const number = cleaned.match(/\d+(?:[.,]\d+)?/);
    if (!number) return "";
    const n = Number(number[0].replace(",", "."));
    // adidas has no x.5 on odd EU numbers: 43.5 is written for 43 1/3.
    if (isAdidas && Math.abs((n % 1) - 0.5) < 0.001 && Math.floor(n) % 2 === 1) return formatEuSize(Math.floor(n));
    return formatEuSize(n);
  }
  const number = cleaned.match(/\d+(?:\.\d+)?/);
  if (!number) return "";
  const prefix = used === "UK" ? "UK" : "US";
  const hit = SIZE_EU_MAP.find(([s, written]) => s === used && written === `${prefix} ${number[0]}`);
  return hit ? hit[2] : "";
}

/** Column names a sheet may use for each field — Desk's CSV header first, then what Vietnamese shops write. */
const COLUMNS: Record<string, string[]> = {
  code: ["product_code", "code", "ma", "ma_san_pham", "ma_sp", "ma_hang", "style_code", "article"],
  sku: ["sku", "variant_sku", "ma_sku", "sku_bien_the", "barcode", "ma_vach"],
  name: ["product_name", "name", "ten", "ten_san_pham", "ten_sp", "ten_hang"],
  brand: ["brand", "hang", "thuong_hieu"],
  category: ["category", "sport", "mon", "mon_the_thao", "danh_muc"],
  kind: ["product_kind", "kind", "loai", "loai_san_pham"],
  gender: ["gender", "gioi_tinh"],
  color: ["color", "mau"],
  size: ["size", "co", "kich_co"],
  qty: ["stock_qty", "qty", "quantity", "ton", "ton_kho", "so_luong", "sl"],
  price: ["sale_price", "price", "gia", "gia_ban", "gia_sale"],
  listPrice: ["list_price", "original_price", "gia_niem_yet", "gia_goc"],
  cost: ["cost_price", "cost", "gia_von", "gia_nhap"],
  image: ["image_url", "image", "anh", "link_anh"],
  productUrl: ["product_url", "link_san_pham"],
  policy: ["policy_note", "policy", "chinh_sach", "ghi_chu"],
  warehouse: ["warehouse", "warehouse_id", "kho", "ma_kho"]
};

export interface SheetImportOptions {
  sizeSystem: SizeSystem;
  /** `own` = the shop's stock; `partner` = a partner's stock (written as campaign lines, masked on the web). */
  source: "own" | "partner";
  sourceName: string;
}

export interface SheetImportResult {
  items: Record<string, unknown>[];
  rowCount: number;
  skipped: number;
  warnings: string[];
  /** field -> the header it was read from. */
  columns: Record<string, string>;
}

/** "3.650.000", "3,650,000", "3650000đ" and "42.5" all read as the number a person meant. */
const toNumber = (value: string | undefined): number => {
  const cleaned = String(value ?? "").replace(/[^\d.,-]/g, "");
  const grouped = /^-?\d{1,3}([.,]\d{3})+$/.test(cleaned);
  const n = Number(grouped ? cleaned.replace(/[.,]/g, "") : cleaned.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Rows of a sheet -> catalogue items, one per product code, one size line per row.
 * Rows without a code, name (on the first row of the code) or readable size are skipped and
 * counted; the first ten reasons are kept as warnings so the screen can say which rows.
 */
export function itemsFromRows(rows: string[][], options: SheetImportOptions): SheetImportResult {
  const warnings: string[] = [];
  const headerIndex = rows.findIndex((r) => r.some((c) => COLUMNS["code"]!.includes(headerKey(c))));
  if (headerIndex < 0) {
    return { items: [], rowCount: 0, skipped: 0, warnings: ["Không thấy dòng tiêu đề có cột mã sản phẩm (product_code / mã)."], columns: {} };
  }
  const header = rows[headerIndex]!.map(headerKey);
  const columns: Record<string, string> = {};
  const index: Record<string, number> = {};
  for (const [field, names] of Object.entries(COLUMNS)) {
    const i = header.findIndex((h) => names.includes(h));
    if (i >= 0) { index[field] = i; columns[field] = rows[headerIndex]![i]!; }
  }
  const cell = (row: string[], field: string): string => (index[field] === undefined ? "" : String(row[index[field]!] ?? "").trim());
  const partnerKey = headerKey(options.sourceName) || "doi_tac";
  const defaultWarehouse = options.source === "own" ? "kho_shop" : `partner_${partnerKey}`;

  const byCode = new Map<string, Record<string, unknown> & { sizes: Record<string, unknown>[] }>();
  const data = rows.slice(headerIndex + 1);
  let skipped = 0;
  const skip = (line: number, why: string) => {
    skipped += 1;
    if (warnings.length < 10) warnings.push(`Dòng ${line}: ${why}`);
  };
  data.forEach((row, i) => {
    const line = headerIndex + i + 2;
    const code = cell(row, "code");
    if (!code) return skip(line, "thiếu mã sản phẩm.");
    const brand = cell(row, "brand");
    const size = normaliseSize(cell(row, "size"), options.sizeSystem, brand);
    if (!size) return skip(line, `không đọc được size "${cell(row, "size")}" (hệ ${options.sizeSystem}).`);
    let item = byCode.get(code);
    if (!item) {
      const name = cell(row, "name");
      if (!name) return skip(line, `mã ${code} chưa có tên sản phẩm.`);
      item = {
        code, name, brand, category: cell(row, "category"), productKind: cell(row, "kind"), gender: cell(row, "gender"),
        thumbnailImage: /^https?:\/\//i.test(cell(row, "image")) ? cell(row, "image") : "",
        productUrl: cell(row, "productUrl"), policy: cell(row, "policy"),
        listPrice: toNumber(cell(row, "listPrice")),
        sourceName: options.sourceName || (options.source === "own" ? "Kho shop" : "Đối tác"),
        ...(options.source === "partner" ? { source: "partner", partnerCampaign: true } : {}),
        sizes: []
      };
      byCode.set(code, item);
    }
    item.sizes.push({
      size, rawSize: cell(row, "size"), qty: Math.max(0, Math.trunc(toNumber(cell(row, "qty")))),
      price: toNumber(cell(row, "price")), listPrice: toNumber(cell(row, "listPrice")),
      costPrice: toNumber(cell(row, "cost")), sku: cell(row, "sku") || `${code}-${size}`,
      warehouseId: headerKey(cell(row, "warehouse")) || defaultWarehouse
    });
  });
  return { items: [...byCode.values()], rowCount: data.length, skipped, warnings, columns };
}
