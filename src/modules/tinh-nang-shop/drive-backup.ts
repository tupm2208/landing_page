/**
 * @file GOOGLE DRIVE BACKUP — Desk `googleBackupPayload` + `forwardGoogleDriveBackup`.
 *
 * Desk kept the Apps Script address and token in the browser's localStorage and built the payload in
 * the page. Here both are the shop's settings (`google_sao_luu_url`, secret `google_sao_luu_token`) and
 * the LANDING builds the payload from its own tables: the data is on the server, so is the backup.
 *
 * Sheets and column names are Desk's (the shop's Apps Script was written against them): `orderFullRows`,
 * `orders`, `orderItems`, `customers`, `shippingFees`. Finance entries are not included yet (see plan).
 */

import type { HttpClient } from "../../contract";

const text = (v: unknown): string => String(v ?? "").trim();
const num = (v: unknown): number => Number(v) || 0;
const asObject = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Order as `don-khach.search` returns it — only what the backup reads. */
export interface BackupOrder {
  id: string; createdAt?: string; updatedAt?: string; status?: string; customerName?: string; phone?: string; address?: string; note?: string;
  total?: number; paymentAmount?: number; shippingFee?: number; trackingCode?: string; shippingProvider?: string; shippingPayer?: string;
  customerProfileId?: string; site?: string; daXoa?: boolean; conPhaiTra?: number;
  items?: { productCode?: string; productName?: string; size?: string; qty?: number; quantity?: number; price?: number; costPrice?: number; sourceName?: string; partnerId?: string }[];
}

export interface ShipmentLike { maDon?: string; hang?: string; maVanDon?: string; cod?: number; codDaThu?: number | null; phi?: number | null; trangThaiGiao?: string }

export function backupPayload(orders: BackupOrder[], shipments: Record<string, ShipmentLike>, now: Date) {
  const live = orders.filter((o) => o.daXoa !== true);
  const qty = (i: { qty?: number; quantity?: number }) => Math.max(1, num(i.qty ?? i.quantity ?? 1));
  const remaining = (o: BackupOrder) => Math.max(0, num(o.conPhaiTra ?? (num(o.total) - num(o.paymentAmount))));
  const customers = new Map<string, Record<string, unknown>>();
  for (const o of live) {
    const key = text(o.customerProfileId) || text(o.phone);
    if (key && !customers.has(key)) customers.set(key, { id: text(o.customerProfileId), name: text(o.customerName), phone: text(o.phone), address: text(o.address), channel: text(o.site) || "web", updatedAt: text(o.updatedAt) });
  }
  return {
    generatedAt: now.toISOString(),
    orderFullRows: live.map((o) => ({
      orderId: o.id, createdAt: text(o.createdAt), updatedAt: text(o.updatedAt), source: text(o.site) || "web", status: text(o.status),
      customerName: text(o.customerName), phone: text(o.phone), address: text(o.address),
      products: (o.items ?? []).map((i) => `${text(i.productName) || text(i.productCode) || "Sản phẩm"}${i.productCode ? ` [${text(i.productCode)}]` : ""}${i.size ? ` size ${text(i.size)}` : ""} x${qty(i)}`).join(" | "),
      goodsAmount: (o.items ?? []).reduce((s, i) => s + num(i.price) * qty(i), 0),
      shippingFeeChargedToCustomer: num(o.shippingFee), orderTotal: num(o.total), customerPaid: num(o.paymentAmount), codOrNeedToCollect: remaining(o),
      trackingCode: text(o.trackingCode), carrier: text(o.shippingProvider), shippingPayer: text(o.shippingPayer), note: text(o.note)
    })),
    orders: live.map((o) => ({
      id: o.id, createdAt: text(o.createdAt), updatedAt: text(o.updatedAt), customerName: text(o.customerName), phone: text(o.phone), address: text(o.address),
      status: text(o.status), channel: text(o.site) || "web", total: num(o.total), paidAmount: num(o.paymentAmount), remainingAmount: remaining(o),
      shippingFee: num(o.shippingFee), trackingCode: text(o.trackingCode)
    })),
    orderItems: live.flatMap((o) => (o.items ?? []).map((i, index) => ({
      orderId: o.id, lineIndex: index + 1, productCode: text(i.productCode), productName: text(i.productName), size: text(i.size), quantity: qty(i),
      salePrice: num(i.price), actualCostPrice: num(i.costPrice), partnerIds: text(i.partnerId), sourceName: text(i.sourceName)
    }))),
    customers: [...customers.values()],
    shippingFees: Object.entries(shipments).map(([ref, s]) => ({
      orderId: text(s.maDon) || ref, trackingCode: text(s.maVanDon), carrier: text(s.hang), shippingCodAmount: num(s.cod),
      codCollectedAmount: num(s.codDaThu), shippingFeeActualPaidToCarrier: num(s.phi), source: text(s.trangThaiGiao)
    }))
  };
}

/** Desk's rule: only an Apps Script web app (`https://script.google.com/macros/s/…/exec`). */
export function validBackupUrl(value: unknown): string {
  try {
    const u = new URL(text(value));
    return u.protocol === "https:" && u.hostname === "script.google.com" && u.pathname.startsWith("/macros/s/") && u.pathname.endsWith("/exec") ? u.toString() : "";
  } catch {
    return "";
  }
}

/** Sends the backup. Never throws; a refusal carries the Apps Script's own words. */
export async function forwardBackup(http: HttpClient, input: { url: string; token: string; reason: string; note: string; payload: unknown }): Promise<Record<string, unknown>> {
  const url = validBackupUrl(input.url);
  if (!url) return { ok: false, error: "unsupported_google_backup_url", message: "Chỉ cho phép backup qua Google Apps Script Web app URL dạng /macros/s/.../exec." };
  if (!text(input.token)) return { ok: false, error: "missing_google_backup_token", message: "Cần nhập Secret token đã đặt trong Apps Script." };
  try {
    const upstream = await http.fetch(url, {
      method: "POST", timeoutMs: 120_000, headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ token: input.token, reason: input.reason || "manual", note: input.note, payload: input.payload })
    });
    const raw = await upstream.text();
    let result: Record<string, unknown>;
    try { result = asObject(raw ? JSON.parse(raw) : {}); } catch { result = { ok: false, error: "invalid_google_backup_response", message: raw.slice(0, 500) || "Google Apps Script trả về dữ liệu không phải JSON." }; }
    if (!upstream.ok) return { ok: false, error: text(result["error"]) || "google_backup_http_error", message: text(result["message"]) || `Google Apps Script trả HTTP ${upstream.status}.`, status: upstream.status, responsePreview: raw.slice(0, 500) };
    if (result["ok"] !== true) return { ok: false, error: text(result["error"]) || "google_backup_rejected", message: text(result["message"] ?? result["error"]) || "Apps Script đã nhận request nhưng trả về ok:false hoặc phản hồi rỗng.", status: upstream.status, responsePreview: raw.slice(0, 500) };
    return result;
  } catch (e) {
    return { ok: false, error: "google_backup_fetch_failed", message: e instanceof Error ? e.message : "Không gửi được backup sang Google Apps Script." };
  }
}
