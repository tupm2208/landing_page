/**
 * @file Route matching: exactly one handler for a (method, path).
 *
 * No Express: the old site ran on Node's bare `http`, and the split keeps it that way so no new
 * library has to be patched later. Patterns:
 *   "/api/orders"           exact
 *   "/api/products/:code"   one segment, into `params.code`
 *   "/api/media/*"          everything after, into `params.rest`
 *
 * RULE: two routes with the same method + path throw at registration. Which module wins must
 * never depend on load order.
 */

import type { Access, RateLimitSpec, HttpMethod, KernelRequest, ReplyDraft } from "../contract";

export interface RouteEntry {
  method: HttpMethod;
  path: string;
  moduleId: string;
  access: Access;
  feature: string | null;
  rateLimit?: RateLimitSpec;
  bodyLimit?: number;
  handle: (request: KernelRequest) => Promise<ReplyDraft> | ReplyDraft;
}

/** A row of the route table as shown to operators and tests (no handler). */
export type RouteRow = Omit<RouteEntry, "handle">;

export type RouteMatch =
  | { kind: "found"; route: RouteEntry; params: Record<string, string> }
  | { kind: "wrong-method" }
  | { kind: "none" };

interface CompiledRoute {
  entry: RouteEntry;
  segments: string[];
}

function splitPath(path: string): string[] {
  return path.split("/").filter((s) => s !== "");
}

/** Matches a pattern against concrete segments; returns the captured params or `null`. */
function matchSegments(pattern: string[], actual: string[]): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i += 1) {
    const p = pattern[i]!;
    if (p === "*") {
      params["rest"] = actual.slice(i).join("/");
      return params;
    }
    const a = actual[i];
    if (a === undefined) return null;
    if (p.startsWith(":")) {
      try { params[p.slice(1)] = decodeURIComponent(a); } catch { params[p.slice(1)] = a; }
      continue;
    }
    if (p !== a) return null;
  }
  return pattern.length === actual.length ? params : null;
}

export class Router {
  private readonly all: RouteEntry[] = [];
  /** Routes without a wildcard: tried first. */
  private readonly exact: CompiledRoute[] = [];
  /** Wildcard routes: tried last, most specific (longest) first. */
  private readonly wildcard: CompiledRoute[] = [];
  private readonly seen = new Set<string>();

  add(entry: RouteEntry): void {
    const key = `${entry.method} ${entry.path}`;
    if (this.seen.has(key)) {
      throw new Error(`Route "${key}" declared twice — module "${entry.moduleId}" collides with an earlier module.`);
    }
    this.seen.add(key);
    this.all.push(entry);
    const compiled = { entry, segments: splitPath(entry.path) };
    // A storefront's "GET /*" must never swallow the API routes of a module loaded after it, so
    // wildcards go last and, among themselves, the one with more fixed segments goes first.
    if (compiled.segments.includes("*")) {
      this.wildcard.push(compiled);
      this.wildcard.sort((a, b) => b.segments.length - a.segments.length);
    } else {
      this.exact.push(compiled);
    }
  }

  match(method: string, pathname: string): RouteMatch {
    const actual = splitPath(pathname);
    let wrongMethod = false;
    for (const r of [...this.exact, ...this.wildcard]) {
      const params = matchSegments(r.segments, actual);
      if (params === null) continue;
      if (r.entry.method !== method) { wrongMethod = true; continue; }
      return { kind: "found", route: r.entry, params };
    }
    return wrongMethod ? { kind: "wrong-method" } : { kind: "none" };
  }

  /** The route table in registration order — tests compare it with the old site's doors. */
  list(): RouteRow[] {
    return this.all.map(({ handle: _handle, ...row }) => row);
  }
}
