export interface WarehousePricingRule {
  mode: "image_tool" | "percent" | "fixed" | "file";
  upliftPercent: number;
  fixedMarkup: number;
  rounding: 10000 | 50000 | 100000;
  groups?: Partial<Record<"shoe" | "apparel" | "accessory", { upliftPercent: number; fixedMarkup: number }>>;
}

const number = (value: unknown): number => Math.max(0, Number(value) || 0);
const text = (value: unknown): string => String(value ?? "").trim().toLowerCase();

function kindOf(item: Record<string, unknown>): "shoe" | "apparel" | "accessory" {
  const joined = [item["productKind"], item["division"], item["category"], item["name"]].map(text).join(" ");
  if (/quần|áo|apparel|shirt|short|pant|jacket/.test(joined)) return "apparel";
  if (/phụ kiện|accessor|tất|vớ|sock|mũ|hat|nón|bag|túi/.test(joined)) return "accessory";
  return "shoe";
}

function psychological(value: number, kind: string): number {
  if (value <= 0) return 0;
  if ((kind === "apparel" || kind === "accessory") && value < 1_000_000) {
    let rounded = Math.round(value / 50_000) * 50_000;
    if (rounded >= 200_000 && rounded % 100_000 === 0) rounded -= 10_000;
    return Math.max(10_000, rounded);
  }
  return Math.max(10_000, Math.floor((value + 50_000) / 100_000) * 100_000 - 10_000);
}

function ceilPsychological(value: number, kind: string): number {
  if (value <= 0) return 0;
  if ((kind === "apparel" || kind === "accessory") && value < 1_000_000) return Math.max(10_000, Math.ceil(value / 50_000) * 50_000);
  const base = Math.floor(value / 100_000) * 100_000;
  for (const offset of [50_000, 90_000]) if (base + offset >= value) return base + offset;
  return base + 150_000;
}

function ceilStep(value: number, step: number): number { return value <= 0 ? 0 : Math.ceil(value / step) * step; }

/** Port of Image Tool's base rule; warehouse-specific uplift/fixed adjustments run afterwards. */
export function imageToolBasePrice(item: Record<string, unknown>, saleFilePrice: number, listPrice: number): number {
  const base = number(saleFilePrice); if (base <= 0) return 0;
  const kind = kindOf(item); const joined = text(item["name"]);
  let margin: number;
  if (/tất|vớ|sock/.test(joined)) margin = 100_000;
  else if (/mũ|nón|hat/.test(joined)) margin = base < 1_000_000 ? 100_000 : 150_000;
  else if (/túi|bag/.test(joined)) margin = base < 1_000_000 ? 130_000 : 180_000;
  else if (kind !== "shoe") margin = base < 1_000_000 ? 150_000 : 200_000;
  else {
    const ratio = listPrice > base ? 1 - base / listPrice : 0;
    if (ratio >= .70) margin = 300_000;
    else if (ratio >= .60) margin = 250_000;
    else if (ratio >= .50) margin = base >= 2_500_000 ? 250_000 : 200_000;
    else if (base >= 2_500_000) margin = 300_000;
    else if (base >= 1_500_000) margin = 250_000;
    else margin = 200_000;
  }
  if (base > 300_000) margin = Math.max(margin, base * .10);
  if (kind === "shoe" && base > 1_000_000) margin = Math.max(margin, 200_000);
  let price = psychological(base + margin, kind);
  const minimum = kind === "shoe" && base > 1_000_000 ? base + 200_000 : 0;
  if (minimum > 0 && price < minimum) price = ceilPsychological(minimum, kind);
  return price;
}

export function warehouseWebPrice(item: Record<string, unknown>, saleFilePrice: number, listPrice: number, rule: WarehousePricingRule): number {
  const base = number(saleFilePrice); if (base <= 0) return 0;
  const group = kindOf(item); const adjustment = rule.groups?.[group];
  const upliftPercent = adjustment ? number(adjustment.upliftPercent) : number(rule.upliftPercent);
  const fixedMarkup = adjustment ? number(adjustment.fixedMarkup) : number(rule.fixedMarkup);
  let price: number;
  if (rule.mode === "image_tool") {
    const rulePrice = imageToolBasePrice(item, base, listPrice);
    const target = (rulePrice + fixedMarkup) * (1 + upliftPercent / 100);
    price = psychological(target, group);
    if (price < rulePrice) price = ceilPsychological(target, group);
  } else price = rule.mode === "percent" ? base * (1 + upliftPercent / 100)
    : rule.mode === "fixed" ? base + fixedMarkup : base;
  return ceilStep(price, rule.rounding || 10_000);
}

export function priceImportedItems(items: Record<string, unknown>[], rule: WarehousePricingRule): Record<string, unknown>[] {
  return items.map((item) => ({ ...item, sizes: (Array.isArray(item["sizes"]) ? item["sizes"] as Record<string, unknown>[] : []).map((size) => {
    const saleFilePrice = number(size["saleFilePrice"] ?? size["sourcePrice"] ?? size["price"] ?? item["saleFilePrice"] ?? item["price"]);
    const listPrice = number(size["listPrice"] ?? item["listPrice"]);
    return { ...size, saleFilePrice, sourcePrice: saleFilePrice, suggestedPrice: warehouseWebPrice(item, saleFilePrice, listPrice, rule), priceFormula: rule.mode };
  }) }));
}
