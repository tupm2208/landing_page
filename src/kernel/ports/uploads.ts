/**
 * @file The upload port: the only way a module keeps a file someone sent (a product photo, an
 * invoice image to send a customer).
 *
 * Modules may not open `fs`. Three rules make a place strangers can write into safe to serve:
 *   1. IMAGES ONLY, recognised by their first bytes — not by a name or a content type the caller
 *      chose. A "photo" that is really HTML never lands on disk.
 *   2. THE SERVER NAMES THE FILE (random, extension from the bytes). No caller-chosen path, so no
 *      overwriting, no `../`, no `.php`.
 *   3. OUTSIDE THE CODE: under the data directory, never inside a module's `goc/` or the repo — a
 *      deploy never wipes what shops uploaded, and uploads never reach git.
 * Reading back uses the static-file rules (`parseRequestPath`): allowed extensions only, no dot-segments.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { StaticFile, StaticZone, UploadPort, UploadedFile } from "../../contract";
import { ALLOWED_EXTENSIONS, cacheControlFor, parseRequestPath } from "./static-files";

/** The largest upload accepted — the running site's 8 MB. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** The image kind behind these bytes, or `null`. */
export function sniffImage(data: Buffer): { extension: string; type: string } | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { extension: ".png", type: "image/png" };
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { extension: ".jpg", type: "image/jpeg" };
  if (data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") return { extension: ".webp", type: "image/webp" };
  if (data.length >= 6 && /^GIF8[79]a$/.test(data.subarray(0, 6).toString("ascii"))) return { extension: ".gif", type: "image/gif" };
  return null;
}

function checkedZone(zone: string): string[] {
  const parts = String(zone ?? "").split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((p) => !/^[a-z0-9-]+$/.test(p))) throw new Error(`Upload zone "${zone}" must be lower-case words separated by "/".`);
  return parts;
}

function freshName(extension: string, hint: string): string {
  const stem = hint.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `${stem ? `${stem}-` : ""}${Date.now().toString(36)}${crypto.randomBytes(6).toString("hex")}${extension}`;
}

export class DiskUploadPort implements UploadPort {
  private readonly root: string;

  constructor(root: string) {
    if (!root) throw new Error("DiskUploadPort needs a root directory");
    this.root = path.resolve(root);
  }

  async saveImage(zone: string, data: Buffer, hint = ""): Promise<UploadedFile> {
    if (data.length > MAX_UPLOAD_BYTES) throw new UploadRefused("qua_lon", `Ảnh lớn hơn ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
    const kind = sniffImage(data);
    if (!kind) throw new UploadRefused("khong_phai_anh", "Tệp không phải ảnh PNG, JPEG, WEBP hay GIF.");
    const dir = path.join(this.root, ...checkedZone(zone));
    await fs.promises.mkdir(dir, { recursive: true });
    const name = freshName(kind.extension, hint);
    await fs.promises.writeFile(path.join(dir, name), data, { flag: "wx" });
    return { name, type: kind.type, bytes: data.length };
  }

  open(zone: string): StaticZone {
    const zoneRoot = path.join(this.root, ...checkedZone(zone));
    const resolve = (requested: unknown): string | null => {
      const segments = parseRequestPath(requested);
      if (segments === null) return null;
      const full = path.resolve(zoneRoot, ...segments);
      return full.startsWith(zoneRoot + path.sep) ? full : null;
    };
    return {
      root: zoneRoot,
      read: async (requested): Promise<StaticFile | null> => {
        const full = resolve(requested);
        if (!full) return null;
        try {
          const data = await fs.promises.readFile(full);
          const extension = path.extname(full).toLowerCase();
          return { data, type: ALLOWED_EXTENSIONS[extension]!, cacheControl: cacheControlFor(extension), path: path.basename(full) };
        } catch {
          return null;
        }
      },
      exists: async (requested) => {
        const full = resolve(requested);
        if (!full) return false;
        try { return (await fs.promises.stat(full)).isFile(); } catch { return false; }
      }
    };
  }
}

/** In memory, for tests. */
export class MemoryUploadPort implements UploadPort {
  readonly files = new Map<string, Buffer>();

  async saveImage(zone: string, data: Buffer, hint = ""): Promise<UploadedFile> {
    if (data.length > MAX_UPLOAD_BYTES) throw new UploadRefused("qua_lon", "Ảnh quá lớn.");
    const kind = sniffImage(data);
    if (!kind) throw new UploadRefused("khong_phai_anh", "Tệp không phải ảnh.");
    const name = freshName(kind.extension, hint);
    this.files.set(`${checkedZone(zone).join("/")}/${name}`, data);
    return { name, type: kind.type, bytes: data.length };
  }

  open(zone: string): StaticZone {
    const prefix = checkedZone(zone).join("/");
    return {
      root: prefix,
      read: async (requested) => {
        const segments = parseRequestPath(requested);
        const data = segments ? this.files.get(`${prefix}/${segments.join("/")}`) : undefined;
        if (!segments || !data) return null;
        const extension = path.extname(segments[segments.length - 1]!).toLowerCase();
        return { data, type: ALLOWED_EXTENSIONS[extension]!, cacheControl: cacheControlFor(extension), path: segments.join("/") };
      },
      exists: async (requested) => {
        const segments = parseRequestPath(requested);
        return !!segments && this.files.has(`${prefix}/${segments.join("/")}`);
      }
    };
  }
}

/** A refusal the caller made (not a server fault): `code` goes back on the wire. */
export class UploadRefused extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "UploadRefused";
  }
}
