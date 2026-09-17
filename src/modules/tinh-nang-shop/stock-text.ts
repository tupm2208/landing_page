/**
 * @file Pure text rules of the Đ10 stock features — no ports, no state, one test each.
 *
 *   - partner STOCK PHOTO text (Desk `parseRunnerStockImageText`): sizes still available + a price;
 *   - box TAG codes (Desk `scan_tem.js`): which catalogue code a read token is, allowing the one-letter
 *     slips a camera makes (I/1, O/0…), refusing to guess between several near codes;
 *   - STOCK COMMANDS by chat (Desk `stock_command_kit.js`, 15/09/2026): "tồn <mã> <size> [kho] <số>",
 *     "hết <mã> <size> [kho]", "hoàn", or a number answering "which warehouse?".
 */

const text = (v: unknown): string => String(v ?? "").trim();

/** "42,5" → "42.5"; spaces collapsed; upper-case letters (`xl` → `XL`). */
export function normaliseSize(value: unknown): string {
  return text(value).replace(",", ".").replace(/\s+/g, " ").toUpperCase();
}

// ------------------------------------------------------------------ partner stock photo

/** Shoe sizes 34–50 (half sizes too) found in a list or a sentence, in order, once each. */
export function stockSizes(value: unknown): string[] {
  const input = Array.isArray(value) ? value.map(text) : text(value).replace(/,/g, ".").split(/[\s;|/]+/);
  const out: string[] = [];
  for (const raw of input) {
    const size = normaliseSize(raw);
    if (/^(?:3[4-9]|4[0-9]|50)(?:\.5)?$/.test(size) && !out.includes(size)) out.push(size);
  }
  return out;
}

/** "1tr490" / "850k" / "1.490.000" → đồng; 0 when none. */
export function stockPrice(value: unknown): number {
  const raw = text(value).toLowerCase();
  const million = raw.match(/\b(\d{1,2})\s*tr\s*(\d{1,3})?\b/);
  if (million) return Number(million[1]) * 1_000_000 + Number((million[2] ?? "0").padEnd(3, "0")) * 1000;
  const k = raw.match(/\b([1-9]\d{2,4})\s*k\b/);
  if (k) return Number(k[1]) * 1000;
  const money = raw.match(/\b([1-9]\d{0,2}(?:[. ]\d{3}){1,3})\b/);
  if (money) return Number(money[1]!.replace(/[^\d]/g, ""));
  return 0;
}

/** Sizes + price read from a photo's text (Desk `parseRunnerStockImageText`). */
export function parseStockPhotoText(value: unknown): { rawText: string; sizes: string[]; price: number } {
  const normalized = text(value).replace(/[,，]/g, ".").replace(/\s+/g, " ");
  // A number right after a model word ("Pegasus 41", "Boston 13") is the model, not a size — unless the word says size.
  const withoutModels = normalized.replace(/(\p{L}+)\s+((?:3[4-9]|4[0-9]|50)(?:\.5)?)\b/gu, (all, word: string) => (/^(size|sz|còn|con|có|co|hết|het|tồn|ton|và|va)$/i.test(word) ? all : word));
  const sizes = stockSizes(Array.from(withoutModels.matchAll(/\b(?:3[4-9]|4[0-9]|50)(?:\.5)?\b/g)).map((m) => m[0]));
  return { rawText: normalized, sizes, price: stockPrice(normalized) };
}

// ------------------------------------------------------------------ box tag codes

/** The code shapes real catalogues use (Desk measured 18/08/2026: AA#### is ~89%). */
const CODE_PATTERNS = [/^[A-Z]{2}\d{4}$/, /^[A-Z]{2}\d{4}-\d{3}$/, /^\d{4}[A-Z]\d{3}-\d{3}$/, /^[A-Z]\d{2}-[A-Z]{4}-\d{2}$/];
const TO_LETTER: Record<string, string> = { "0": "O", "1": "I", "2": "Z", "5": "S", "6": "G", "8": "B" };
const TO_DIGIT: Record<string, string> = { O: "0", Q: "0", I: "1", L: "1", Z: "2", S: "5", G: "6", B: "8" };
export const NEAR_MATCH_LIMIT = 8;

export const looksLikeCode = (token: string): boolean => CODE_PATTERNS.some((p) => p.test(token));

function confusionVariants(token: string): string[] {
  const variants = new Set([token]);
  if (/^[A-Z0-9]{6}$/.test(token)) {
    const head = token.slice(0, 2).replace(/[0-9]/g, (ch) => TO_LETTER[ch] ?? ch);
    const tail = token.slice(2).replace(/[A-Z]/g, (ch) => TO_DIGIT[ch] ?? ch);
    variants.add(head + tail);
  }
  return [...variants];
}

/** Levenshtein ≤ 1: one letter changed, missing or extra. */
export function editDistanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i] && ++diff > 1) return false;
    return true;
  }
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  let i = 0, j = 0, skipped = false;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) { i += 1; j += 1; continue; }
    if (skipped) return false;
    skipped = true;
    j += 1;
  }
  return true;
}

export type CodeConfidence = "exact" | "fuzzy" | "ambiguous" | "pattern_only" | "none";

/**
 * Which catalogue code the tag shows. Exact (or a confusion variant) first, then ONE near code;
 * several near codes = "ambiguous" (the scanner asks a person), never a guess.
 */
export function resolveTagCode(tokensIn: string[], catalogCodes: readonly string[]): { code: string; confidence: CodeConfidence; candidates: string[] } {
  const catalog = new Set(catalogCodes.map((c) => c.toUpperCase()));
  const tokens = [...new Set(tokensIn.flatMap((t) => text(t).toUpperCase().split(/[^A-Z0-9-]+/)).filter((t) => t.length >= 5 && t.length <= 12))];
  let patternOnly = "";
  for (const token of tokens) {
    for (const variant of confusionVariants(token)) {
      if (catalog.has(variant)) return { code: variant, confidence: variant === token ? "exact" : "fuzzy", candidates: [variant] };
      if (!patternOnly && looksLikeCode(variant)) patternOnly = variant;
    }
  }
  let ambiguous: string[] | null = null;
  for (const token of tokens.filter((t) => /[A-Z]/.test(t) && /\d/.test(t))) {
    const found = new Set<string>();
    for (const variant of confusionVariants(token)) for (const code of catalog) if (editDistanceAtMostOne(variant, code)) found.add(code);
    if (found.size === 1) return { code: [...found][0]!, confidence: "fuzzy", candidates: [...found] };
    if (!ambiguous && found.size > 1 && found.size <= NEAR_MATCH_LIMIT) ambiguous = [...found];
  }
  if (ambiguous) return { code: "", confidence: "ambiguous", candidates: ambiguous };
  if (patternOnly) return { code: patternOnly, confidence: "pattern_only", candidates: [] };
  return { code: "", confidence: "none", candidates: [] };
}

/** The size of a tag: the one the reader chose if the item has it, else the only read size the item has; several = ask. */
export function resolveTagSize(read: string[], known: readonly string[]): { size: string; source: string; options: string[] } {
  const candidates = [...new Set(read.map((s) => normaliseSize(s).replace(/^(EU|FR|UK|US|CM)\s*/, "")).filter(Boolean))];
  if (known.length === 0) return { size: candidates[0] ?? "", source: candidates.length ? "doc_tho" : "none", options: candidates };
  const knownKeys = known.map(normaliseSize);
  const validated = candidates.filter((c) => knownKeys.includes(c));
  if (validated.length === 1) return { size: known[knownKeys.indexOf(validated[0]!)]!, source: "doc_khop", options: validated };
  if (validated.length > 1) return { size: "", source: "ambiguous", options: validated };
  return { size: "", source: "none", options: [...known] };
}

// ------------------------------------------------------------------ stock commands by chat

export type StockCommand =
  | { type: "set"; code: string; size: string; warehouseQuery: string; qty: number }
  | { type: "undo" }
  | { type: "choice"; index: number }
  | { type: "help" };

const fold = (v: string): string => v.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").trim().toLowerCase();

function isLikelySize(token: string | undefined): boolean {
  if (!token) return false;
  return /^\d+([.,]\d+)?$/.test(token) || /^[A-Za-z]\/\d{1,3}$/.test(token) || /^(XXS|XS|S|M|L|XL|XXL|2XL|3XL|4XL|NS|OS|FREE)$/i.test(token);
}

/** Desk `parseStockCommand`, same grammar. `null` = not a command (ordinary chat). */
export function parseStockCommand(input: unknown): StockCommand | null {
  const raw = text(input).normalize("NFC");
  if (!raw) return null;
  const folded = fold(raw);
  if (/^(hoan\s*tac|hoan)$/.test(folded)) return { type: "undo" };
  if (/^\d{1,2}$/.test(folded) && Number(folded) >= 1) return { type: "choice", index: Number(folded) };
  if (/^\d{3,}$/.test(folded)) return null;
  const withoutBot = raw.replace(/^bot\s+/i, "");
  const cmd = fold(withoutBot);
  const isTon = /^ton\b/.test(cmd);
  const isHet = /^het\b/.test(cmd);
  if (!isTon && !isHet) return null;
  const rest = withoutBot.replace(/^(tồn|ton|hết|het)\s*/i, "").trim();
  const parts = rest ? rest.split(/\s+/) : [];
  if (parts.length < 2 || !isLikelySize(parts[1])) return { type: "help" };
  let sizeEnd = 2;
  if (parts.length > 2 && /^[12]\/3$/.test(parts[2]!)) sizeEnd = 3;
  const code = parts[0]!.toUpperCase();
  const size = parts.slice(1, sizeEnd).join(" ").replace(",", ".");
  const tail = parts.slice(sizeEnd);
  if (isHet) return { type: "set", code, size, warehouseQuery: tail.join(" ").trim(), qty: 0 };
  if (tail.length === 0) return { type: "help" };
  const qty = Number(tail[tail.length - 1]);
  if (!Number.isInteger(qty) || qty < 0 || qty >= 10000) return { type: "help" };
  return { type: "set", code, size, warehouseQuery: tail.slice(0, -1).join(" ").trim(), qty };
}

export interface WarehouseRow { warehouseId: string; warehouseName?: string; quantity: number; source: string; size: string }

/** Which warehouse a command means: exact id, exact name, then a part of either. */
export function matchWarehouse(rows: WarehouseRow[], query: string): { status: "one" | "many" | "none"; rows: WarehouseRow[] } {
  if (rows.length === 0) return { status: "none", rows: [] };
  const q = fold(query);
  if (!q) return rows.length === 1 ? { status: "one", rows } : { status: "many", rows };
  const byId = rows.filter((r) => fold(r.warehouseId) === q);
  if (byId.length === 1) return { status: "one", rows: byId };
  const byName = rows.filter((r) => fold(r.warehouseName ?? "") === q);
  if (byName.length === 1) return { status: "one", rows: byName };
  const partial = rows.filter((r) => fold(r.warehouseName ?? "").includes(q) || fold(r.warehouseId).includes(q));
  if (partial.length === 1) return { status: "one", rows: partial };
  return partial.length > 1 ? { status: "many", rows: partial } : { status: "none", rows: [] };
}

export function choiceQuestion(code: string, size: string, rows: WarehouseRow[]): string {
  const lines = [`${code} · size ${size} có ở ${rows.length} kho, chưa sửa gì. Anh trả lời số:`];
  rows.forEach((r, i) => lines.push(`${i + 1}. ${r.warehouseName || r.warehouseId} (còn ${r.quantity})`));
  if (rows.length >= 2) lines.push(`${rows.length + 1}. ${rows.length === 2 ? "Cả hai" : "Tất cả"}`);
  return lines.join("\n");
}

export function resolveChoice(rows: WarehouseRow[], index: number): WarehouseRow[] | null {
  if (index >= 1 && index <= rows.length) return [rows[index - 1]!];
  if (index === rows.length + 1 && rows.length >= 2) return rows;
  return null;
}

export const STOCK_COMMAND_HELP = [
  "Lệnh sửa tồn (số là số còn bán trên web):",
  "  tồn <mã> <size> [kho] <số>",
  "  hết <mã> <size> [kho]",
  "  hoàn"
].join("\n");
