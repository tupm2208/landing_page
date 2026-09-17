/**
 * @file FOOT MEASUREMENT → BRAND SIZE (Đ9, ported from Sales Desk `size_chart.js`, rules Dũng fixed 31/08–06/09/2026).
 *
 * Pure arithmetic, no knowledge of any product line: this is the landing half of Fit Finder. Line
 * knowledge (which model runs narrow, what fits a pace) is Xeon's (`/kien-thuc/*`).
 *
 * TWO TABLES, NOT ONE:
 *   - the BRAND table (`brand-charts.ts`): which size label is how many cm on the TAG;
 *   - the FOOT table below: from a measured foot, which row of the brand table.
 *   The shared link is the tag length in cm (JP). Other brands: tag cm first, then that brand's own table.
 *
 * THREE SYSTEMS THAT MUST NOT BORROW FROM EACH OTHER:
 *   - RUNNING: tag = foot + 1.5 cm (round UP to 0.5); length and width checked side by side, the higher
 *     size wins; girth only judges thick/thin; long runs ≥ 10 km add half a size last.
 *   - LIFESTYLE: tag = foot + 0.5 cm, rounded up.
 *   - COURT (tennis / pickleball / padel): tag = foot + 0.5 to 1.0 cm — a RANGE, never the running +1.5.
 * A number read off the TAG ("tem 26,5", "265") maps straight to a size: adding 1.5 cm to it was the
 * 01/09 bug that turned a 42 into a 44.
 */

import { BRAND_SHOE_CHARTS } from "./brand-charts";

/** [adidas size, tag cm, foot length cm, width min, width max]. */
export const FOOT_TABLE: readonly (readonly [string, number, number, number, number])[] = [
  ["36", 22.0, 20.5, 7.4, 7.7], ["36 2/3", 22.5, 21.0, 7.7, 8.0], ["37 1/3", 23.0, 21.5, 8.0, 8.3],
  ["38", 23.5, 22.0, 8.3, 8.6], ["38 2/3", 24.0, 22.5, 8.6, 8.9], ["39 1/3", 24.5, 23.0, 8.9, 9.2],
  ["40", 25.0, 23.5, 9.2, 9.5], ["40 2/3", 25.5, 24.0, 9.5, 9.8], ["41 1/3", 26.0, 24.5, 9.8, 10.2],
  ["42", 26.5, 25.0, 10.2, 10.5], ["42 2/3", 27.0, 25.5, 10.5, 10.7], ["43 1/3", 27.5, 26.0, 10.7, 11.0],
  ["44", 28.0, 26.5, 11.0, 11.2], ["44 2/3", 28.5, 27.0, 11.2, 11.4], ["45 1/3", 29.0, 27.5, 11.4, 11.6],
  ["46", 29.5, 28.0, 11.6, 11.8]
];

export const SOCK_TABLE = [
  { letter: "XS", from: 31, to: 34 }, { letter: "S", from: 35, to: 38 }, { letter: "M", from: 39, to: 42 },
  { letter: "L", from: 43, to: 46 }, { letter: "XL", from: 47, to: 50 }
] as const;

export type ShoeType = "running" | "lifestyle" | "court";

export interface SizeAdvice {
  shoeType: ShoeType;
  footLength: number;
  tem: number;
  temLow?: number;
  size: string;
  sizeLow?: string;
  sizeAdidas: string;
  brand: string;
  thickness?: string;
  reasons: string[];
  label: string;
  note: string;
}

export function brandKey(brand: unknown): string {
  const t = String(brand ?? "").toLowerCase();
  if (/adidas|\bdas\b/.test(t)) return "adidas";
  if (/nike|jordan/.test(t)) return "nike";
  if (/asics/.test(t)) return "asics";
  if (/hoka/.test(t)) return "hoka";
  if (/mizuno/.test(t)) return "mizuno";
  if (/puma/.test(t)) return "puma";
  return "";
}

const rowByTem = (tem: number) => FOOT_TABLE.find((r) => Math.abs(r[1] - tem) < 0.26);
const indexOfSize = (size: string) => FOOT_TABLE.findIndex((r) => r[0] === size);
const roundUpHalf = (v: number) => Math.ceil(v * 2 - 0.0001) / 2;
const labelNorm = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ").replace(/(\d)\s*\/\s*(\d)/, "$1/$2");

/** Tag cm → the brand's size label (US 7 = tag 25.0 cm is the link between tables). ASICS labels in cm. */
export function labelForTem(tem: number, brand: unknown = ""): string {
  const key = brandKey(brand);
  if (key === "asics") return `${Number(tem).toFixed(1).replace(/\.0$/, "")}cm`;
  const rows = BRAND_SHOE_CHARTS[key]?.rows;
  if (!rows) return rowByTem(tem)?.[0] ?? "";
  const us = 7 + (Number(tem) - 25);
  let best: { us: number; eu: string } | null = null;
  for (const row of rows) {
    if (row.us === null) continue;
    if (best === null || Math.abs(row.us - us) < Math.abs(best.us - us)) best = { us: row.us, eu: row.eu };
  }
  return best?.eu ?? "";
}

/** A brand's size label → tag cm (reverse direction). */
export function temFromSizeLabel(sizeLabel: unknown, brand: unknown = ""): number | null {
  const label = labelNorm(sizeLabel);
  if (!label) return null;
  const cm = /^(\d{2}(?:[.,]\d)?)\s*cm$/i.exec(label);
  if (cm) return Number(cm[1]!.replace(",", "."));
  const key = brandKey(brand);
  if (!key || key === "adidas") {
    const row = FOOT_TABLE.find((r) => labelNorm(r[0]) === label);
    if (row) return row[1];
  }
  const rows = BRAND_SHOE_CHARTS[key]?.rows;
  const hit = rows?.find((r) => labelNorm(r.eu) === label);
  if (hit && hit.us !== null) return 25 + (hit.us - 7);
  const row = FOOT_TABLE.find((r) => labelNorm(r[0]) === label);
  if (row) return row[1];
  for (const chart of Object.values(BRAND_SHOE_CHARTS)) {
    const h = chart.rows.find((r) => labelNorm(r.eu) === label);
    if (h && h.us !== null) return 25 + (h.us - 7);
  }
  return null;
}

export function convertSizeBetweenBrands(sizeLabel: unknown, fromBrand: unknown, toBrand: unknown): { tem: number; from: { brand: string; size: string }; to: { brand: string; size: string }; label: string } | null {
  const tem = temFromSizeLabel(sizeLabel, fromBrand);
  if (!tem) return null;
  const target = labelForTem(tem, toBrand);
  if (!target) return null;
  const from = brandKey(fromBrand);
  const to = brandKey(toBrand) || "adidas";
  return { tem, from: { brand: from, size: String(sizeLabel).trim() }, to: { brand: to, size: target }, label: `${from || "size"} ${String(sizeLabel).trim()} = tem ${tem}cm = ${to} ${target}` };
}

/** Advice from a measured foot. `footGirth` in mm (or cm, detected). */
export function sizeFromFootMeasure(input: { footLength: unknown; footWidth?: unknown; footGirth?: unknown; shoeType?: unknown; longRun?: unknown; brand?: unknown }): SizeAdvice | null {
  const footLength = Number(input.footLength);
  if (!Number.isFinite(footLength) || footLength < 15 || footLength > 35) return null;
  const brand = brandKey(input.brand);
  const shoeType = String(input.shoeType ?? "running").toLowerCase();

  if (shoeType === "lifestyle") {
    const tem = roundUpHalf(footLength + 0.5);
    const size = labelForTem(tem, brand);
    return {
      shoeType: "lifestyle", footLength, tem, size, sizeAdidas: rowByTem(tem)?.[0] ?? "", brand,
      reasons: [`giày phố: dài ${footLength}cm + 0,5cm → tem ${tem}cm → size ${size || "?"}`],
      label: `dài chân ${footLength}cm → giày phố: tem ${tem}cm → size ${size || "?"}`,
      note: "giày phổ thông: tem = dài chân + 0,5cm (làm tròn lên); mẫu form rộng lùi nửa size, form ôm lên nửa size — tuỳ mẫu"
    };
  }

  if (shoeType === "court") {
    const temLow = roundUpHalf(footLength + 0.5);
    const tem = roundUpHalf(footLength + 1.0);
    const size = labelForTem(tem, brand);
    const sizeLow = labelForTem(temLow, brand);
    const range = sizeLow && sizeLow !== size ? `${sizeLow}–${size}` : size || "?";
    return {
      shoeType: "court", footLength, tem, temLow, size, sizeLow, sizeAdidas: rowByTem(tem)?.[0] ?? "", brand,
      reasons: [`giày sân: dài ${footLength}cm + 0,5→1,0cm → tem ${temLow}–${tem}cm → size ${range}`],
      label: `dài chân ${footLength}cm → giày tennis/pickleball: tem ${temLow}–${tem}cm → size ${range} (chân bè/thích dư mũi thì lấy ${size || "?"})`,
      note: "giày sân KHÔNG cần dư mũi nhiều như giày chạy (cấm áp +1,5cm): tem = dài chân + 0,5 đến 1,0cm; đang đi giày chạy size X thì tennis ≈ X"
    };
  }

  const byLengthTem = roundUpHalf(footLength + 1.5);
  let lengthRow = FOOT_TABLE[0]!;
  for (const r of FOOT_TABLE) if (Math.abs(r[1] - byLengthTem) < Math.abs(lengthRow[1] - byLengthTem)) lengthRow = r;
  let row = lengthRow;
  const reasons = [`dài ${footLength}cm → tem ${byLengthTem}cm → ${lengthRow[0]}`];

  const width = Number(input.footWidth);
  if (Number.isFinite(width) && width > 0) {
    let byWidth: (typeof FOOT_TABLE)[number] | null = FOOT_TABLE.find((r) => width >= r[3] && width <= r[4]) ?? null;
    if (!byWidth && width >= FOOT_TABLE[FOOT_TABLE.length - 1]![4]) byWidth = FOOT_TABLE[FOOT_TABLE.length - 1]!;
    if (byWidth && indexOfSize(byWidth[0]) > indexOfSize(row[0])) {
      reasons.push(`rộng ${width}cm chạm ${byWidth[0]} → lấy size cao hơn (điều kiện đến trước)`);
      row = byWidth;
    }
  }

  let girthMm = Number(input.footGirth);
  if (Number.isFinite(girthMm) && girthMm > 0 && girthMm < 40) girthMm *= 10;
  const widthMm = Number.isFinite(width) && width > 0 ? width * 10 : 0;
  let thickness = "";
  if (Number.isFinite(girthMm) && girthMm > 0 && widthMm > 0) {
    const diff = Math.round(girthMm - widthMm);
    if (diff > 152) {
      thickness = diff > 158 ? "chân dày nhiều — ưu tiên bản wide nếu có" : "chân dày";
      reasons.push(`chu vi − rộng = ${diff}mm > 152 → chân dày, +nửa size`);
      row = FOOT_TABLE[Math.min(FOOT_TABLE.length - 1, indexOfSize(row[0]) + 1)]!;
    } else if (diff < 140) {
      thickness = "chân mỏng";
      if (indexOfSize(row[0]) > indexOfSize(lengthRow[0])) {
        reasons.push(`chu vi − rộng = ${diff}mm < 140 → chân mỏng, lùi về size theo dài (${lengthRow[0]})`);
        row = lengthRow;
      }
    } else {
      thickness = "chân chuẩn";
      reasons.push(`chu vi − rộng = ${diff}mm (140-152) → chân chuẩn, giữ size`);
    }
  }

  if (input.longRun === true || input.longRun === "1" || input.longRun === "true") {
    reasons.push("chạy dài ≥10km → +nửa size");
    row = FOOT_TABLE[Math.min(FOOT_TABLE.length - 1, indexOfSize(row[0]) + 1)]!;
  }

  const size = labelForTem(row[1], brand) || row[0];
  return {
    shoeType: "running", footLength, tem: row[1], size, sizeAdidas: row[0], brand, thickness, reasons,
    label: `dài chân ${footLength}cm${width > 0 ? ` · rộng ${width}cm` : ""} → giày chạy: tem ${row[1]}cm → size ${size}${brand && brand !== "adidas" ? ` (${brand})` : ""}`,
    note: "giày chạy: tem = dài chân + 1,5cm; dài & rộng tra song song lấy size cao hơn; chu vi chỉ ướm dày/mỏng"
  };
}

/** A number read off the tag: straight to a size, never +1.5 cm. Accepts mm ("265"). */
export function sizeFromTem(temInput: unknown, brand: unknown = ""): { tem: number; size: string; sizeAdidas: string; footLength: number | null; brand: string; label: string } | null {
  let tem = Number(String(temInput ?? "").replace(",", "."));
  if (!Number.isFinite(tem)) return null;
  if (tem >= 200 && tem <= 330) tem /= 10;
  if (tem < 21 || tem > 32) return null;
  const row = rowByTem(tem);
  const key = brandKey(brand);
  const size = labelForTem(tem, brand) || (row?.[0] ?? "");
  return { tem, size, sizeAdidas: row?.[0] ?? "", footLength: row?.[2] ?? null, brand: key, label: `tem ${tem}cm → size ${size || "?"}${key && key !== "adidas" ? ` (${key})` : ""}` };
}

/** Any sock label → its band: "M", "3942", "39-42", "42". Kids' sizes (K…) are not in this table. */
export function sockBand(value: unknown): (typeof SOCK_TABLE)[number] | null {
  const raw = String(value ?? "").trim().toUpperCase().replace(/^A\//, "").replace(/\s+/g, "");
  if (!raw || /^K/.test(raw)) return null;
  const letter = SOCK_TABLE.find((r) => r.letter === raw);
  if (letter) return letter;
  const glued = /^(\d{2})[-–]?(\d{2})$/.exec(raw);
  if (glued) {
    const from = Number(glued[1]);
    const to = Number(glued[2]);
    return SOCK_TABLE.find((r) => r.from <= from && to <= r.to) ?? null;
  }
  const single = /^(\d{2})(?:[.,]5|[12]\/3)?$/.exec(raw);
  if (single) {
    const size = Number(single[1]);
    return SOCK_TABLE.find((r) => size >= r.from && size <= r.to) ?? null;
  }
  return null;
}

/** The brand chart for the size table screen. */
export function chartRows(brand: unknown): { brand: string; label: string; rows: { us: number | null; uk: number | null; eu: string; tem: number | null }[] } {
  const key = brandKey(brand) || "adidas";
  const chart = BRAND_SHOE_CHARTS[key] ?? BRAND_SHOE_CHARTS["adidas"]!;
  return { brand: key, label: chart.label, rows: chart.rows.map((r) => ({ ...r, tem: r.us === null ? null : 25 + (r.us - 7) })) };
}
