/**
 * @file The static-file port: the only way a module serves a file from disk (HTML, CSS, images).
 *
 * A module may not import `fs` (the architecture rule breaks the build). But a storefront must
 * read files. So the kernel opens a port; a module asks for `staticFiles` and sees ONLY its own
 * directory.
 *
 * Serving files is where the files that must never leak (server code, `.env`, data) leak. The old
 * site blocked a DENY LIST (".env", "data/", "server.js"...). This port does the opposite, like
 * trial mode: ALLOW BY LIST.
 *   1. An extension not in `ALLOWED_EXTENSIONS` is never served, even from the web directory.
 *      A new file type nobody declared does not come out — instead of leaking and being noticed later.
 *   2. The path must stay inside the module's zone. Every "..", absolute path and dot-segment is
 *      refused before the disk is touched.
 *   3. A deny list of NAMES remains (server.js, module.js...): `.js` is an allowed extension, so
 *      server code dropped into the web directory must still be refused.
 */

import fs from "node:fs";
import path from "node:path";
import type { Logger, StaticFile, StaticFilePort, StaticZone } from "../../contract";

/** Extensions allowed out to the Internet, with their content type. Not here = not served. */
export const ALLOWED_EXTENSIONS: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp4": "video/mp4"
};

/** File names never served even though their extension is allowed. */
export const BLOCKED_NAMES: ReadonlySet<string> = new Set([
  "server.js", "ctv-server.js", "chay.js", "module.js", "main.js", "package.json", "package-lock.json", "render.yaml"
]);

/** Directory names never entered. */
export const BLOCKED_DIRECTORIES: ReadonlySet<string> = new Set(["data", "logs", "tmp", "node_modules", "test", "loi", "kernel", "src", "dist"]);

const LONG_CACHE = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".mp4"]);

/** How long a browser may keep the file. Same as the old site. */
export function cacheControlFor(extension: string): string {
  if (extension === ".html") return "no-cache";
  if (LONG_CACHE.has(extension)) return "public, max-age=604800, stale-while-revalidate=2592000";
  return "public, max-age=3600, stale-while-revalidate=86400";
}

/**
 * Normalises a requested path into decoded segments, or `null` when it is not allowed. The
 * segments are not yet joined with any root.
 */
export function parseRequestPath(requested: unknown): string[] | null {
  const raw = String(requested ?? "").split("\\").join("/");
  if (raw.includes("\0")) return null;
  const segments: string[] = [];
  for (const part of raw.split("/")) {
    if (part === "") continue;
    let decoded: string;
    try { decoded = decodeURIComponent(part); } catch { return null; }
    if (decoded === "" || decoded === ".") continue;
    if (decoded.includes("/") || decoded.includes("\\") || decoded.includes("\0")) return null;
    if (decoded.startsWith(".")) return null;                    // ".." and every hidden file
    if (BLOCKED_DIRECTORIES.has(decoded.toLowerCase())) return null;
    segments.push(decoded);
  }
  if (segments.length === 0) return null;
  const name = segments[segments.length - 1]!.toLowerCase();
  if (BLOCKED_NAMES.has(name)) return null;
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_EXTENSIONS, path.extname(name))) return null;
  return segments;
}

/** Serves files under `root`; each module opens a zone (`<id>/goc`) and sees only that. */
export class DiskStaticFilePort implements StaticFilePort {
  private readonly root: string;
  private readonly logger: Logger;

  constructor(root: string, logger?: Logger) {
    if (!root) throw new Error("DiskStaticFilePort needs a root directory");
    this.root = path.resolve(root);
    this.logger = logger ?? { info: () => undefined, warn: () => undefined };
  }

  open(zone: string): StaticZone {
    const zoneRoot = path.resolve(this.root, String(zone ?? ""));
    if (zoneRoot !== this.root && !zoneRoot.startsWith(this.root + path.sep)) {
      throw new Error(`Static zone "${zone}" lies outside the root directory.`);
    }
    const resolve = (requested: unknown): { segments: string[]; full: string } | null => {
      const segments = parseRequestPath(requested);
      if (segments === null) return null;
      const full = path.resolve(zoneRoot, ...segments);
      if (!full.startsWith(zoneRoot + path.sep)) return null;   // last line of defence
      return { segments, full };
    };
    return {
      root: zoneRoot,
      read: async (requested): Promise<StaticFile | null> => {
        const target = resolve(requested);
        if (target === null) {
          this.logger.info(`[tepTinh] từ chối đường: ${String(requested).slice(0, 120)}`);
          return null;
        }
        try {
          const data = await fs.promises.readFile(target.full);
          const extension = path.extname(target.full).toLowerCase();
          return { data, type: ALLOWED_EXTENSIONS[extension]!, cacheControl: cacheControlFor(extension), path: target.segments.join("/") };
        } catch {
          return null;
        }
      },
      exists: async (requested) => {
        const target = resolve(requested);
        if (target === null) return false;
        try { return (await fs.promises.stat(target.full)).isFile(); } catch { return false; }
      }
    };
  }
}

/** An in-memory zone map for tests: `{ "gian-hang/goc/index.html": "<html>" }` — no disk. */
export class FakeStaticFilePort implements StaticFilePort {
  readonly files: Map<string, Buffer>;

  constructor(files: Record<string, string | Buffer> = {}) {
    this.files = new Map(Object.entries(files).map(([k, v]) => [k.replace(/^\/+/, ""), Buffer.isBuffer(v) ? v : Buffer.from(String(v))]));
  }

  open(zone: string): StaticZone {
    const prefix = String(zone ?? "").replace(/^\/+|\/+$/g, "");
    const keyOf = (segments: string[]) => [prefix, ...segments].filter(Boolean).join("/");
    return {
      root: prefix,
      read: async (requested) => {
        const segments = parseRequestPath(requested);
        if (segments === null) return null;
        const key = keyOf(segments);
        const data = this.files.get(key);
        if (!data) return null;
        const extension = path.extname(key).toLowerCase();
        return { data, type: ALLOWED_EXTENSIONS[extension]!, cacheControl: cacheControlFor(extension), path: key };
      },
      exists: async (requested) => {
        const segments = parseRequestPath(requested);
        return segments !== null && this.files.has(keyOf(segments));
      }
    };
  }
}
