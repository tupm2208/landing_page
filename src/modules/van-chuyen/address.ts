/**
 * @file Converts a three-tier address (old system) to the two-tier system of 2025.
 *
 * From 2025 Vietnam dropped the district level: 63 three-tier provinces became 34 two-tier ones.
 * SPX accepts both systems but must be told which via `address_version` (0 = old, 2 = new; the
 * value 1 IS REFUSED). The conversion table is `du-lieu/address-merge-map-2025.json` — public
 * REFERENCE data (vietmap source), not shop data, so it ships with the code and is imported here
 * rather than read through the store port. The lookup index is built lazily on the first
 * question so start-up does not pay for it.
 */

import mergeMap from "./du-lieu/address-merge-map-2025.json";

/** One new-system destination of an old ward. */
export interface MergeTarget {
  province: string;
  ward: string;
}

interface MergeEntry {
  oldProvince: string;
  oldDistrict: string;
  oldWard: string;
  targets: MergeTarget[];
}

interface MergeMap {
  version?: string;
  entries?: MergeEntry[];
}

/**
 * Result of a conversion. `ambiguous` = the old ward was SPLIT into several new wards and the
 * first is being returned: a person should confirm; sending is still possible, not blocked.
 */
export type TwoTierConversion =
  | { ok: true; province: string; ward: string; ambiguous: boolean; options: MergeTarget[]; oldWard: string; version: string }
  | { ok: false; viSao: "khong_co_trong_bang" };

let index: Map<string, MergeEntry> | null = null;
let version = "";

/** Lower-cases, strips diacritics (đ -> d) and collapses everything non-alphanumeric to one space. */
export function normaliseText(value: unknown = ""): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")   // combining marks left by NFD
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Drops the administrative prefix ("tinh", "thanh pho", "quan", "phuong"...) of a normalised name. */
export function stripPrefix(normalised: string = ""): string {
  return String(normalised || "")
    .replace(/^(tinh|thanh pho|tp|quan|huyen|thi xa|phuong|xa|thi tran|dac khu)\s+/, "")
    .trim();
}

const ALIASES: Record<string, string> = { "thua thien hue": "hue" };

/** Every key a name may be looked up under: as written, without prefix, and any alias. */
export function keysFor(value: unknown = ""): string[] {
  const base = normaliseText(value);
  if (!base) return [""];
  const keys = [base];
  const stripped = stripPrefix(base);
  if (stripped && stripped !== base) keys.push(stripped);
  for (const k of keys.slice()) {
    const alias = ALIASES[k];
    if (alias && !keys.includes(alias)) keys.push(alias);
  }
  return keys;
}

// District 2 and District 9 were merged into Thu Duc; Cua Lo into Vinh. The table has no row
// under the old names, so they are renamed before the lookup.
const DISTRICT_ALIASES: Record<string, string> = {
  "quan 2": "thu duc",
  "quan 9": "thu duc",
  "quan thu duc": "thu duc",
  "thi xa cua lo": "vinh",
  "cua lo": "vinh"
};

function loadIndex(): Map<string, MergeEntry> {
  if (index) return index;
  const raw = mergeMap as MergeMap;
  const m = new Map<string, MergeEntry>();
  for (const entry of Array.isArray(raw.entries) ? raw.entries : []) {
    for (const kProvince of keysFor(entry.oldProvince)) {
      for (const kDistrict of keysFor(entry.oldDistrict)) {
        for (const kWard of keysFor(entry.oldWard)) {
          const key = `${stripPrefix(kProvince)}|${stripPrefix(kDistrict)}|${kWard}`;
          if (!m.has(key)) m.set(key, entry);
        }
      }
    }
  }
  version = String(raw.version || "");
  index = m;
  return index;
}

/** Looks the old (province, district, ward) up in the merge table. */
export function convertToTwoTier(parts: { tinh?: unknown; huyen?: unknown; xa?: unknown } = {}): TwoTierConversion {
  const m = loadIndex();

  const kProvince = keysFor(parts.tinh).map(stripPrefix);
  const kDistrict = keysFor(parts.huyen).map(stripPrefix);
  for (const k of keysFor(parts.huyen)) {
    const alias = DISTRICT_ALIASES[k];
    if (alias && !kDistrict.includes(alias)) kDistrict.push(alias);
  }
  const kWard = keysFor(parts.xa);

  let entry: MergeEntry | undefined;
  for (const a of kProvince) {
    for (const b of kDistrict) {
      for (const c of kWard) { entry = m.get(`${a}|${b}|${c}`); if (entry) break; }
      if (entry) break;
    }
    if (entry) break;
  }
  const first = entry?.targets?.[0];
  if (!entry || !first) return { ok: false, viSao: "khong_co_trong_bang" };
  return {
    ok: true,
    province: first.province,
    ward: first.ward,
    ambiguous: entry.targets.length > 1,
    options: entry.targets,
    oldWard: entry.oldWard,
    version
  };
}

/** An address with a replacement character (U+FFFD) makes SPX answer "location not found" — very confusing. */
export function hasBrokenFont(...parts: unknown[]): boolean {
  return parts.some((p) => String(p || "").includes("�"));
}
