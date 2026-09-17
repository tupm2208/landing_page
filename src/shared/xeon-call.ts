/**
 * @file The ONE way a landing module talks to the shop's Xeon.
 *
 * Before 17/09/2026 four modules each carried their own copy of this call, with four slightly
 * different error texts. When Xeon ran an older build than the landing, a missing route came back
 * as a bare `khong_thay` and OMI could only say "không tìm thấy" — nobody could tell WHICH server
 * was out of date. Here every answer is shaped once:
 *
 * - Xeon answers 404 with no message → `xeon_ban_cu`: Xeon lacks this route, update and restart it.
 * - Xeon unreachable → `xeon_khong_noi_duoc`, with the network reason.
 * - Landing not registered with Xeon → 503 with the caller's own sentence (what stays usable).
 *
 * Never throws. Takes the module context loosely typed, so every module can use it.
 */

import { reply } from "../contract";

export interface XeonAnswer { ok: boolean; status: number; body: Record<string, unknown>; viSao: string }

export interface XeonCallOptions {
  timeoutMs?: number;
  /** What the seller reads when the landing has no Xeon registration (say what still works). */
  unregistered?: string;
}

/** Just what this file needs from a module context. */
interface XeonCtx {
  services: object;
  ports: { http: { fetch(url: string, init: { method: string; timeoutMs?: number; headers?: Record<string, string>; body?: string }): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }> } };
}

const NO_STORE = { "Cache-Control": "no-store" };
const asRecord = (x: unknown): Record<string, unknown> => (x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});

/** The text for a Xeon that does not know this route: it runs an older build than the landing. */
export function xeonOutdated(route: string): string {
  return `Xeon chưa có chức năng này (${route.split("?")[0]}) — Xeon đang chạy bản cũ hơn landing. Cập nhật mã Xeon, build lại và bật lại Xeon.`;
}

export async function callXeon(ctx: XeonCtx, method: string, route: string, body?: unknown, options: XeonCallOptions = {}): Promise<XeonAnswer> {
  const platform = asRecord((ctx.services as Record<string, unknown>)["khung-nen-tang"]) as { xeon?: () => Promise<{ diaChiXeon?: string; maNhanTin?: string } | null> };
  const registration = platform.xeon ? await platform.xeon() : null;
  if (!registration?.diaChiXeon || !registration.maNhanTin) {
    return { ok: false, status: 503, body: { error: "chua_dang_ky_xeon" }, viSao: options.unregistered ?? "Landing chưa đăng ký với Xeon nên chưa dùng được việc này." };
  }
  try {
    const response = await ctx.ports.http.fetch(`${String(registration.diaChiXeon).replace(/\/+$/, "")}${route}`, {
      method, timeoutMs: options.timeoutMs ?? 60_000,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${registration.maNhanTin}` },
      ...(body === undefined || method === "GET" ? {} : { body: JSON.stringify(body) })
    });
    const answer = asRecord(await response.json().catch(() => ({})));
    const ok = response.ok && answer["ok"] !== false;
    if (ok) return { ok, status: response.status, body: answer, viSao: "" };
    const message = typeof answer["message"] === "string" && answer["khongCoDuong"] !== true ? answer["message"].trim() : "";
    // New Xeon marks an unknown route (`khongCoDuong`); an old one answers exactly {ok:false, error:"khong_thay"}.
    const bareOldNotFound = message === "" && answer["error"] === "khong_thay" && Object.keys(answer).every((k) => k === "ok" || k === "error");
    if (response.status === 404 && (answer["khongCoDuong"] === true || bareOldNotFound)) {
      return { ok: false, status: 502, body: { ...answer, error: "xeon_ban_cu" }, viSao: xeonOutdated(route) };
    }
    return { ok: false, status: response.status, body: answer, viSao: message || String(answer["error"] ?? `Xeon trả HTTP ${response.status}`) };
  } catch (e) {
    return { ok: false, status: 502, body: { error: "xeon_khong_noi_duoc" }, viSao: `Không gọi được Xeon: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Passes a Xeon answer on as this landing's reply: success as-is, refusal with a readable message. */
export function relayXeon(r: XeonAnswer) {
  if (r.ok) return reply.json(r.body, 200, NO_STORE);
  const status = [400, 403, 404, 409, 503].includes(r.status) ? r.status : 502;
  return reply.json({ ok: false, error: String(r.body["error"] ?? "xeon_tu_choi"), message: r.viSao }, status, NO_STORE);
}
