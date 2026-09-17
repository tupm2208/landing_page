/**
 * @file What the content workshop receives from the kernel: its config, the services it may call, and
 * the small helpers every file of the module shares (documents, catalogue shape, Xeon call).
 */

import type { ModuleContext } from "../../contract";
import type { PlatformServices } from "../khung-nen-tang/module";
import type { PublishingServices } from "../dang-bai/module";
import type { PlannableProduct } from "./batch";
import type { ProductForPost } from "./studio-rules";
import { callXeon as sharedCallXeon, type XeonAnswer } from "../../shared/xeon-call";

/** `ctx.config` as `app.ts` builds it. */
export interface Config {
  /** The shop's own site — links in the first comment must point there. */
  siteUrl?: string;
}

/** What the catalogue answers (`hang-kho.search`), narrowed to what the workshop needs. */
export interface CatalogItem {
  code: string;
  name?: string;
  brand?: string;
  category?: string;
  sizes?: { size?: string; qty?: number }[];
  galleryImages?: string[];
  thumbnailImage?: string;
  highImage?: string;
  salePrice?: number;
  price?: number;
  listPrice?: number;
  discountPercent?: number;
}

export interface Services {
  "hang-kho": { search(input: { query?: string; limit?: number }): Promise<CatalogItem[]> };
  /** Which Xeon holds the brain, and with which private token. Absent = no brain, and it says so. */
  "khung-nen-tang"?: Pick<PlatformServices, "xeon">;
  /** Đ8: real publishing on Meta, pictures, and the jobs (for "last posted" and engagement). */
  "dang-bai"?: PublishingServices;
  /** Đ8: sales of the last 30 days for the priority score. */
  "don-khach"?: { search(filter?: { since?: string | null; limit?: number | string | null }): Promise<{ status: string; items: { productCode: string; quantity: number; qty: number }[] }[]> };
}

export type Ctx = ModuleContext<Config, Services>;

export const text = (v: unknown, n = 100000): string => String(v ?? "").trim().slice(0, n);

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The catalogue as the planner and the rules see it: one shape, built once per request. */
export function toPlannable(items: CatalogItem[]): PlannableProduct[] {
  return items.map((item) => ({
    code: text(item.code),
    name: text(item.name),
    brand: text(item.brand),
    sizes: (item.sizes ?? []).map((s) => ({ size: text(s.size), qty: Number(s.qty ?? 0) })),
    images: (item.galleryImages ?? []).length + (text(item.thumbnailImage) === "" ? 0 : 1)
  }));
}

export function byCode(products: PlannableProduct[]): Map<string, ProductForPost> {
  return new Map(products.map((p) => [p.code, p]));
}

/** One call to the shop's Xeon with the private inbox token. Never throws. */
export async function callXeon(ctx: Ctx, route: string, body: unknown, timeoutMs = 150_000): Promise<XeonAnswer> {
  return sharedCallXeon(ctx, "POST", route, body, { timeoutMs, unregistered: "Landing chưa đăng ký với Xeon nên chưa hỏi được bộ não. Soạn tay vẫn chạy bình thường." });
}
