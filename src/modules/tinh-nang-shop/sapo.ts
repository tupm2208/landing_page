/**
 * @file SAPO REALTIME STOCK — Desk `sapo_realtime_stock.js`, through the shop's own Sapo keys.
 *
 * Desk read Dasbui's Sapo by driving a logged-in Chrome over the debugging port — one machine, one shop,
 * a browser that must stay open. A landing has no browser: it calls Sapo's admin API with the private-app
 * key and secret the shop typed in OMI (`sapo_dia_chi`, `sapo_api_key`, `sapo_api_secret`), Basic auth,
 * the same `variants/search.json` door Desk's page called. The answer is normalised exactly as Desk did
 * (available = sum over locations, adidas "42 2/3" sizes kept readable).
 */

import type { HttpClient } from "../../contract";

export interface SapoVariant {
  productCode: string;
  productName: string;
  variantName: string;
  sku: string;
  barcode: string;
  size: string;
  available: number;
  onHand: number;
  committed: number;
  price: number;
  imageUrl: string;
}

const text = (v: unknown): string => String(v ?? "").trim();
const asObject = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function displaySize(value: unknown): string {
  const raw = text(value);
  const adidas = raw.match(/^(\d{2})([12])\/3$/);
  return adidas ? `${adidas[1]} ${adidas[2]}/3` : raw;
}

export function normaliseSapoVariant(raw: unknown): SapoVariant {
  const v = asObject(raw);
  const inventories = (Array.isArray(v["inventories"]) ? v["inventories"] : []).map(asObject);
  const sum = (k: string) => inventories.reduce((s, i) => s + (Number(i[k]) || 0), 0);
  const images = Array.isArray(v["images"]) ? v["images"].map(asObject) : [];
  return {
    productCode: text(v["product_name"]), productName: text(v["product_name"]), variantName: text(v["name"]),
    sku: text(v["sku"]), barcode: text(v["barcode"]), size: displaySize(v["opt1"] ?? v["option1"] ?? v["name"]),
    available: sum("available"), onHand: sum("on_hand"), committed: sum("committed"),
    price: Number(v["variant_retail_price"] ?? v["price"] ?? 0) || 0, imageUrl: text(images[0]?.["full_path"] ?? images[0]?.["src"])
  };
}

export interface SapoSettings { address: string; key: string; secret: string; name: string }

export function sapoSettingsOf(settings: Record<string, string>): SapoSettings | null {
  const address = text(settings["sapo_dia_chi"]).replace(/\/+$/, "");
  const key = text(settings["sapo_api_key"]);
  const secret = text(settings["sapo_api_secret"]);
  if (!/^https:\/\/[^\s/]+$/i.test(address) || !key || !secret) return null;
  return { address, key, secret, name: text(settings["sapo_ten"]) || "Sapo" };
}

/** One page of variants matching a query. Never throws: a refusal says why in Vietnamese. */
export async function lookupSapo(http: HttpClient, sapo: SapoSettings, query: string, limit = 80): Promise<{ ok: true; variants: SapoVariant[] } | { ok: false; message: string }> {
  const url = `${sapo.address}/admin/variants/search.json?page=1&limit=${Math.max(1, Math.min(limit, 250))}${query ? `&query=${encodeURIComponent(query)}` : ""}`;
  try {
    const r = await http.fetch(url, {
      method: "GET", timeoutMs: 20_000,
      headers: { Accept: "application/json", Authorization: `Basic ${Buffer.from(`${sapo.key}:${sapo.secret}`).toString("base64")}` }
    });
    if (r.status === 401 || r.status === 403) return { ok: false, message: "Sapo từ chối khoá ứng dụng — kiểm lại API key / secret ở màn Kết nối." };
    if (!r.ok) return { ok: false, message: `Sapo trả HTTP ${r.status}.` };
    const body = asObject(await r.json());
    return { ok: true, variants: (Array.isArray(body["variants"]) ? body["variants"] : []).map(normaliseSapoVariant) };
  } catch (e) {
    return { ok: false, message: `Không gọi được Sapo: ${e instanceof Error ? e.message : String(e)}` };
  }
}
