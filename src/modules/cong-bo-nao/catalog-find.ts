/**
 * @file `catalog.find` — the stock finder the AI agent on Xeon calls ("tra_kho" in Sales Desk).
 *
 * Ported from Sales Desk `agent_level2.js` (toolTraKho) and `use_profile.js` on 16/09/2026, rule for
 * rule: every branch below is a real conversation that went wrong (the version tags are kept in the
 * comments so the Desk history can still be found). The difference: Desk read `data/store.json`,
 * here the finder reads the PUBLIC view of the catalogue from the inventory module — no cost price,
 * no warehouse name, and no real quantity (the public view says "in stock" or not).
 *
 * The answer's field names (`ma`, `ten`, `loai`, `cac_size`, `link`, `nhom`) are WIRE: the agent's
 * prompt on Xeon is written against them.
 *
 * Pure over the item list: no store, no clock — the handler passes the catalogue in.
 */

import type { CatalogItem } from "./context";

export interface FindInput {
  ten?: unknown;
  ma?: unknown;
  size?: unknown;
  chi_hang_san?: unknown;
  muc_dich?: unknown;
  gioi_tinh?: unknown;
}

export interface FoundSize {
  size: string;
  gia: number;
  loai?: string;
}

export interface FoundItem {
  ma: string;
  ten: string;
  loai?: string;
  cac_size: FoundSize[];
  anh: string;
  link: string;
  nhom?: string;
}

/** What the agent reads: a list, or a sentence telling it not to invent anything. */
export type FindResult = FoundItem[] | string;

const NOT_FOUND = "KHONG tim thay san pham nao khop (con hang) — dung bia; noi tu nhien kieu 'hien tai nha em chua co mau nay' (KHONG mo dau 'noi that') va goi y mau khac.";
const TOO_VAGUE = "KHONG tim thay san pham nao khop (con hang) — dung bia; hoi lai khach ten mau/loai hang cu the hon (vi du quan dai, ao khoac) roi tra lai.";
const READY = "HANG SAN (giao ngay, ho tro doi size)";
const ORDER = "HANG ORDER (3-7 ngay ve, CK toi thieu 20%, doi size chi khi kho CHUA di mua)";

type Group = "lifestyle" | "running_daily" | "training";
const GROUP_NAMES: Record<Group, string> = {
  lifestyle: "Sneaker thời trang",
  running_daily: "Running phổ thông",
  training: "Giày tập đa năng"
};
const GROUP_RANK: Record<Group, number> = { lifestyle: 0, running_daily: 1, training: 2 };

// ---- text helpers ------------------------------------------------------------------------------

/** Lower case, accents off, "đ" -> "d". */
export function stripAccents(text: unknown): string {
  return String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}

/** `stripAccents` plus punctuation to spaces (use_profile.normalizeText). */
function normaliseWords(text: unknown): string {
  return stripAccents(text).replace(/[^a-z0-9/.]+/g, " ").trim();
}

// ---- sport and everyday groups (use_profile.js) -------------------------------------------------

function inferProductSport(item: CatalogItem): string {
  const text = `${item.name} ${item.code} ${item.category} ${item.division}`;
  if (/(golf|tennis|football|soccer|basketball|yoga|training|gym|run|runner|running|adizero|ultraboost|supernova)/i.test(text)) {
    if (/golf/i.test(text)) return "Golf";
    if (/tennis/i.test(text)) return "Tennis";
    if (/football|soccer/i.test(text)) return "Bóng đá";
    if (/basketball/i.test(text)) return "Bóng rổ";
    if (/yoga|training|gym/i.test(text)) return "Training";
    return "Running";
  }
  return "Lifestyle";
}

const SPECIALIZED_SPORTS = new Set(["Tennis", "Golf", "Bóng đá", "Bóng rổ"]);

/** Court shoes and pitch shoes. "court" alone does NOT count: VL Court / Grand Court are everyday sneakers. */
function isSpecializedSportProduct(item: CatalogItem): boolean {
  if (SPECIALIZED_SPORTS.has(inferProductSport(item))) return true;
  const name = normaliseWords(`${item.name} ${item.category}`);
  return /(pickleball|pickeball|padel|tennis|golf|bong da|bong ro|barricade|gel resolution|gel dedicate|gel game|gel challenger|solution speed|court lite|vapor pro|zoom gp|gp challenge|defiant|ubersonic|courtjam)/.test(name);
}

// v95 (08/09, "Shop co giay bong ro khong?"): store names never contain "bong ro" — the sport lives
// in category/division.
const REQUESTED_SPORT_RULES: { re: RegExp; sport: string }[] = [
  { re: /(bong ro|bongro|basketball|\bbball\b)/, sport: "Bóng rổ" },
  { re: /(bong da|bongda|da banh|football|soccer|futsal)/, sport: "Bóng đá" },
  // 13/09 ("quan short gol adidas"): "gol" is golf too.
  { re: /\bgolf?\b/, sport: "Golf" }
];
const SPORT_WORD_RE = /^(bong|ro|da|banh|bongro|bongda|basketball|bball|football|soccer|futsal|golf|gol)$/;

function detectRequestedSport(text: unknown): string {
  const normalized = ` ${normaliseWords(text)} `;
  if (!normalized.trim()) return "";
  for (const rule of REQUESTED_SPORT_RULES) if (rule.re.test(normalized)) return rule.sport;
  return "";
}

const RACE_RE = /(adios|takumi|boston|evo sl|prime x|alphafly|vaporfly|metaspeed|superblast|\bpro\b|streakfly|endorphin pro|rocket x|magic speed)/;
const DAILY_RUN_RE = /(duramo|galaxy|runfalcon|response|supernova|ultraboost|switch|pegasus|revolution|winflo|vomero|cumulus|nimbus|gel contend|gel excite|gel kayano|novablast|clifton|zocker|infinity|velocity|electrify|ride\b|880)/;
const NOT_SHOE_RE = /(\bao\b|\bquan\b|\btat\b|\bvo\b|\bmu\b|\bnon\b|balo|\btui\b|jacket|\btee\b|\bshort|\bpant|\bsock|\bsck\b|\bank\b|ankle|crew|no show|\bcap\b|\bbag\b|backpack|hoodie|sweat|\btank\b|\bbra\b|legging|\bdep\b|slide|sandal|adilette|mule|\bkt:|bang do|gang tay|taekwondo|wrestling|boxing|judo|karate|climbing|cycling|\bspd\b|bowling|skate\s*board)/;

function isShoeProduct(item: CatalogItem): boolean {
  if (item.productKind && item.productKind !== "shoe") return false;
  return !NOT_SHOE_RE.test(` ${normaliseWords(item.name)} `);
}

function everydayGroup(item: CatalogItem): Group | null {
  if (isSpecializedSportProduct(item)) return null;
  const name = normaliseWords(item.name);
  if (NOT_SHOE_RE.test(` ${name} `)) return null;
  if (RACE_RE.test(name)) return null;
  if (DAILY_RUN_RE.test(name)) return "running_daily";
  if (/(trainer|dropset|everyset|rapidmove|metcon|free metcon|training)/.test(name)) return "training";
  const sport = inferProductSport(item);
  if (sport === "Lifestyle") return "lifestyle";
  if (sport === "Training") return "training";
  if (sport === "Running") return "running_daily";
  return null;
}

function productGenderTag(item: CatalogItem): "nu" | "nam" | "" {
  const gender = normaliseWords(item.gender);
  if (/^(nu|wo|women|w)$/.test(gender)) return "nu";
  if (/^(nam|me|men|m)$/.test(gender)) return "nam";
  if (/^(unisex|un|u)$/.test(gender)) return "";
  const name = ` ${normaliseWords(item.name)} `;
  if (/( w | nu | women | woman )/.test(name) || / w$/.test(name.trimEnd())) return "nu";
  if (/( m | nam | men )/.test(name) || / m$/.test(name.trimEnd())) return "nam";
  return "";
}

function genderCompatible(item: CatalogItem, wantGender: string): boolean {
  const want = normaliseWords(wantGender);
  if (!want) return true;
  const tag = productGenderTag(item);
  return !tag || want.startsWith(tag);
}

// ---- sizes -------------------------------------------------------------------------------------

/** 13/09: adidas apparel sizes — "A88" = "A/88" = "88"; "A/XL" = "XL"; XXL = 2XL. */
export function apparelSizeKey(value: unknown): string {
  return String(value ?? "").trim().toUpperCase()
    .replace(/^A\s*\/?\s*/, "")
    .replace(/\s+/g, "")
    .replace(/^(X{2,5})([SL])$/, (_all, xs: string, letter: string) => `${xs.length}X${letter}`);
}

/** v84: adidas EU (thirds) -> UK. UK 3 = 35 1/3; each UK 0.5 = 2/3 EU. */
export function adidasEuToUk(label: unknown): string {
  const t = String(label ?? "").trim().replace(",", ".");
  const m = t.match(/^(\d{2})(?:\s+([12])\/3|\.5)?$/);
  if (!m) return "";
  const thirds = Number(m[1]) * 3 + (m[2] ? Number(m[2]) : (/\.5$/.test(t) ? 2 : 0));
  const uk = 3 + (thirds - (35 * 3 + 1)) / 4;
  if (!Number.isFinite(uk) || uk < 2 || uk > 15 || Math.round(uk * 2) !== uk * 2) return "";
  return String(uk);
}

interface SizeRow { size: string; price: number; ready: boolean }

/** v90/v91: several warehouses repeat one size label — merge; the price is the LOWEST (the web shows that one). */
function mergeSizeRows(item: CatalogItem): SizeRow[] {
  const byLabel = new Map<string, SizeRow>();
  for (const line of item.sizes) {
    const label = String(line.size ?? "").trim();
    // 13/09: a bare "A" label is data-entry rubbish from a partner file.
    if (!line.available || label === "" || label.toUpperCase() === "A") continue;
    const price = Number(line.salePrice || line.price || 0);
    const ready = line.stockMode === "ready";
    const current = byLabel.get(label);
    if (!current) { byLabel.set(label, { size: label, price, ready }); continue; }
    if (ready) current.ready = true;
    if (price > 0 && (!current.price || price < current.price)) current.price = price;
  }
  return [...byLabel.values()];
}

function pickSize(rows: SizeRow[], wanted: string): SizeRow[] {
  const want = wanted.replace(",", ".");
  const candidates = [want];
  // v84 (06/09, "size 42,5"): adidas has thirds only -> 42.5 ≈ 42 2/3, then the neighbours.
  const half = want.match(/^(\d{2})\.5$/);
  if (half) candidates.push(`${half[1]} 2/3`, `${Number(half[1]) + 1} 1/3`, half[1]!);
  // Partner warehouses label UK sizes.
  for (const eu of [...candidates]) {
    const uk = adidasEuToUk(eu);
    if (uk) candidates.push(`UK ${uk}`, uk);
  }
  for (const c of candidates) {
    const hit = rows.filter((row) => row.size === c || row.size.startsWith(`${c} `) || (!/^uk/i.test(row.size) && !/^uk/i.test(c) && row.size.startsWith(c)));
    if (hit.length > 0) return hit;
  }
  // 13/09 ("size A88"): compare normalised apparel keys.
  const key = apparelSizeKey(want);
  return key ? rows.filter((row) => apparelSizeKey(row.size) === key) : [];
}

// ---- the finder --------------------------------------------------------------------------------

const VI_SYNONYM: Record<string, string[]> = {
  ao: ["tee", "t-shirt", "tshirt", "top", "jersey", "polo", "tank", "jkt", "jacket", "hoodie", "sweat", "ao"],
  thun: ["tee", "t-shirt", "tshirt", "top", "jersey", "tank", "thun"],
  phong: ["tee", "t-shirt", "tshirt", "phong"],
  khoac: ["jkt", "jacket", "windbreaker", "hoodie", "khoac"],
  quan: ["short", "shorts", "pant", "pants", "tight", "tights", "legging", "tp", "quan"],
  short: ["short", "shorts"],
  tat: ["sock", "socks", "tat"], vo: ["sock", "socks", "vo"],
  mu: ["cap", "hat", "visor", "mu"], non: ["cap", "hat", "visor", "non"],
  balo: ["backpack", "bp", "balo"], tui: ["bag", "tote", "duffel", "tui"],
  dep: ["slide", "slides", "sandal", "adilette", "dep"]
};
const SIZE_TOKEN_RE = /^(\d{1,2}(\.\d)?|\d\/\d|size|sz|cm|us|uk|eu|jp|a\/?\d{2,3}|a\/?\d?x{0,3}[sml]|\d?x{1,3}[sml]|[sml])$/;
const STOP_WORDS = ["adidas", "nike", "asics", "giay", "babolat", "mizuno", "the", "shoes", "nu", "nam", "sneaker", "chay", "bo", "mau", "doi", "cai", "hang"];
// v96: Vietnamese describing words never appear in English store names.
const DESCRIPTOR_WORDS = ["dai", "ngan", "soc", "sooc", "thao", "tap", "luyen", "thoi", "trang"];
const LONG_BOTTOM_RE = /pant|tight|legging|jogger|\btp\b/;
const SHORT_RE = /short/;
const APPAREL_TOP_RE = /\btee\b|sleeve|\bjsy\b|jersey|\bset\b|shirt|polo|hoodie/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

function tokenMatches(haystack: string, token: string): boolean {
  return (VI_SYNONYM[token] ?? [token]).some((alt) => /^\d/.test(alt)
    ? new RegExp(`(^|[^0-9])${escapeRegExp(alt)}([^0-9]|$)`).test(haystack)
    : haystack.includes(alt));
}

function productLink(siteUrl: string, item: CatalogItem): string {
  const origin = siteUrl.replace(/\/+$/, "");
  if (!origin) return "";
  return item.slug ? `${origin}/product/${item.slug}` : `${origin}/product.html?p=${encodeURIComponent(item.code)}`;
}

/** Finds in-stock items the way Sales Desk's `tra_kho` does. At most 8 items (9 for everyday groups). */
export function findInCatalog(items: readonly CatalogItem[], input: FindInput, siteUrl: string): FindResult {
  const name = stripAccents(input.ten ?? "");
  const code = String(input.ma ?? "").trim().toUpperCase();
  let size = String(input.size ?? "").trim();
  // 13/09: the agent put the size inside "ten" ("quan short golf adidas size A88").
  if (!size) {
    const inName = name.match(/\ba\/?([6-9]\d)\b/) ?? name.match(/\ba\/(\d?x{0,3}[sml])\b/);
    if (inName) size = inName[0].startsWith("a/") && !/\d{2}/.test(inName[1]!) ? inName[1]!.toUpperCase() : `A/${inName[1]}`;
  }
  const onlyReady = input.chi_hang_san === true;
  const purpose = String(input.muc_dich ?? "").trim().toLowerCase();
  const everyday = /di_hoc|di_choi|da_nang|di_lam|hang_ngay|pho_thong/.test(purpose);
  const wantCourt = /tennis|pickleball|padel/.test(purpose);
  const sport = detectRequestedSport(purpose.replace(/_/g, " ")) || detectRequestedSport(input.ten ?? "");
  const sportShoesOnly = sport !== "" && /(^|\s)(giay|dep)(\s|$)/.test(` ${stripAccents(input.ten ?? "")} `);
  const gender = String(input.gioi_tinh ?? "");

  const dropSportWords = (list: string[]) => sport ? list.filter((t) => !SPORT_WORD_RE.test(t)) : list;
  const dropDescriptors = (list: string[]) => list.filter((t) => !DESCRIPTOR_WORDS.includes(t));
  const spaced = ` ${name} `;
  const wantLongBottom = /\squan\s+dai\s|\s(pant|pants|tight|tights|legging|leggings|jogger|joggers)\s/.test(spaced);
  const wantShortBottom = !wantLongBottom && /\squan\s+(ngan|soc|sooc|short|shorts)\s|\s(short|shorts)\s/.test(spaced);
  const words = name.split(/\s+/).filter(Boolean);
  const tokensLoose = dropDescriptors(dropSportWords(words.filter((t) => !SIZE_TOKEN_RE.test(t) && !STOP_WORDS.includes(t))));
  const tokensFull = dropDescriptors(dropSportWords(words.filter((t) => !/^(size|sz|cm|us|uk|eu|jp)$/.test(t) && !STOP_WORDS.includes(t))));
  // v96: only describing words left = do not treat it as "no name" (that returned 8 random items).
  if (name && tokensLoose.length === 0 && !code && !sport && !everyday && !wantLongBottom && !wantShortBottom) return TOO_VAGUE;

  const visible = items.filter((item) => item.status !== "hidden");
  // v90: pass 1 KEEPS numbers in the name (Boston 13, Pegasus 41); nothing found -> pass 2 drops them.
  const passes = tokensFull.join(" ") !== tokensLoose.join(" ") ? [tokensFull, tokensLoose] : [tokensLoose];
  for (const nameTokens of passes) {
    const byCheapHouseFirst = (a: CatalogItem, b: CatalogItem) =>
      ((a.source === "own" ? 0 : 1) - (b.source === "own" ? 0 : 1)) || (Number(a.price || 0) - Number(b.price || 0));
    const ordered = everyday && nameTokens.length === 0 && !code
      ? [...visible].sort((a, b) =>
        ((a.source === "own" ? 0 : 1) - (b.source === "own" ? 0 : 1))
        || ((GROUP_RANK[everydayGroup(a) ?? "training"] ?? 9) - (GROUP_RANK[everydayGroup(b) ?? "training"] ?? 9))
        || (Number(a.price || 0) - Number(b.price || 0)))
      : sport && nameTokens.length === 0 && !code ? [...visible].sort(byCheapHouseFirst) : visible;

    const perGroup: Record<Group, number> = { lifestyle: 0, running_daily: 0, training: 0 };
    const out: FoundItem[] = [];
    for (const item of ordered) {
      const group = everyday ? everydayGroup(item) : null;
      if (everyday) {
        if (!group) continue;
        if (!genderCompatible(item, gender)) continue;
        if (nameTokens.length === 0 && !code && perGroup[group] >= 3) continue;
      }
      if (wantCourt && !isSpecializedSportProduct(item)) continue;
      if (sport && inferProductSport(item) !== sport) continue;
      if (sportShoesOnly && !isShoeProduct(item)) continue;
      if (wantLongBottom || wantShortBottom) {
        const productName = stripAccents(item.name);
        if (APPAREL_TOP_RE.test(productName)) continue;
        if (wantLongBottom && (!LONG_BOTTOM_RE.test(productName) || SHORT_RE.test(productName))) continue;
        if (wantShortBottom && !SHORT_RE.test(productName)) continue;
      }
      const codeHit = code !== "" && String(item.code).toUpperCase() === code;
      if (code && !codeHit && nameTokens.length === 0) continue;
      if (!codeHit && nameTokens.length > 0) {
        const haystack = stripAccents(`${item.name} ${item.code} ${item.brand} ${item.sourceName}`);
        if (!nameTokens.every((t) => tokenMatches(haystack, t))) continue;
      }
      let rows = mergeSizeRows(item);
      if (onlyReady) rows = rows.filter((row) => row.ready);
      if (size) rows = pickSize(rows, size);
      if (rows.length === 0) continue;

      const kinds = new Set(rows.map((row) => row.ready ? READY : ORDER));
      const found: FoundItem = {
        ma: item.code,
        ten: item.name,
        // v90: one kind for the whole item = say it once, not forty times.
        ...(kinds.size === 1 ? { loai: [...kinds][0]! } : {}),
        cac_size: rows.slice(0, 40).map((row) => ({ size: row.size, gia: row.price, ...(kinds.size === 1 ? {} : { loai: row.ready ? READY : ORDER }) })),
        anh: item.highImage || item.thumbnailImage || "",
        link: productLink(siteUrl, item),
        ...(group ? { nhom: GROUP_NAMES[group] } : {})
      };
      if (codeHit) out.unshift(found); else out.push(found);
      if (group) perGroup[group] += 1;
      if (out.length >= (everyday ? 9 : 8)) break;
    }
    if (out.length > 0) return out;
  }
  return NOT_FOUND;
}
