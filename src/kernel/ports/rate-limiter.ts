/**
 * @file Rate limiting: one caller may not hit one route too often in one window.
 *
 * The old site had this (`rateLimitFor` + `consumeRateLimit`); the first split LOST it while
 * cutting modules out. Losing a safety feature is a bug, not a later concern — so it is back,
 * and one notch stricter: a PUBLIC route must declare a limit or the module does not load.
 *
 * Counted per IP: a public route has no token to recognise a caller; the IP is all there is.
 * It is imperfect (a whole company behind one IP), so limits are generous — the goal is to stop
 * floods, not real customers.
 *
 * In-memory, for ONE process. Several processes each count on their own, so the effective limit
 * multiplies by the process count — said here so nobody is surprised later.
 */

import type { Clock, RateLimitPort, RateLimitVerdict } from "../../contract";

interface Bucket {
  count: number;
  resetsAt: number;
}

/**
 * Fixed window: the count restarts when the window ends. Simple and enough for flood control
 * (a sliding window is more exact but costs several times the memory for a tiny gain).
 */
export class FixedWindowRateLimiter implements RateLimitPort {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly clock: Clock, private readonly maxKeys = 20000) {}

  hit(key: string, limit: number, windowMs: number): RateLimitVerdict {
    const now = this.clock.now().getTime();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetsAt <= now) {
      this.buckets.set(key, { count: 1, resetsAt: now + windowMs });
      this.evict(now);
      return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterMs: windowMs };
    }
    bucket.count += 1;
    return { allowed: bucket.count <= limit, remaining: Math.max(0, limit - bucket.count), retryAfterMs: Math.max(0, bucket.resetsAt - now) };
  }

  /** Keeps memory bounded: expired keys go first; if still full, the oldest tenth goes. */
  private evict(now: number): void {
    if (this.buckets.size < this.maxKeys) return;
    for (const [k, b] of this.buckets) if (b.resetsAt <= now) this.buckets.delete(k);
    if (this.buckets.size >= this.maxKeys) {
      const drop = Math.ceil(this.maxKeys * 0.1);
      let i = 0;
      for (const k of this.buckets.keys()) { this.buckets.delete(k); i += 1; if (i >= drop) break; }
    }
  }

  size(): number { return this.buckets.size; }
  clear(): void { this.buckets.clear(); }
}

/**
 * The caller's real address. On hosting behind Cloudflare, `remoteAddress` is the proxy: everyone
 * shares one IP and blocking one blocks the village.
 *
 * Proxy headers are trusted ONLY with `trustProxy`. Trusting them without a proxy lets anyone
 * claim an IP and dodge the limit.
 */
export function callerAddress(request: { ip?: string; headers?: Record<string, string | undefined> }, { trustProxy = false } = {}): string {
  const headers = request?.headers ?? {};
  if (trustProxy) {
    const candidates = [
      headers["cf-connecting-ip"], headers["true-client-ip"], headers["x-real-ip"], headers["x-client-ip"],
      String(headers["x-forwarded-for"] ?? "").split(",")[0]
    ];
    for (const c of candidates) {
      const s = String(c ?? "").trim();
      if (s) return s;
    }
  }
  return String(request?.ip ?? "").trim() || "khong-ro";
}
