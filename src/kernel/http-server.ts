/**
 * @file The HTTP adapter: the only file that touches Node's `request`/`response`.
 *
 * It turns an `IncomingMessage` into the kernel's plain request (body read lazily, with a limit
 * the kernel can raise per route) and writes the kernel's plain reply back. HEAD is handled here,
 * once, so no module has to know it exists.
 */

import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { BodyError, ERROR_CODES, type Headers, type IncomingRequest, type Reply } from "../contract";
import type { Kernel } from "./kernel";

/** 1 MB unless a route declares its own `bodyLimit`. */
export const DEFAULT_BODY_LIMIT = 1024 * 1024;

export interface HttpAdapterOptions {
  bodyLimit?: number;
}

function securityHeaders(contentType = "application/json; charset=utf-8"): Record<string, string> {
  return {
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY"
  };
}

/** Reads the body up to `limit` bytes; rejects with a `BodyError` past it, WITHOUT closing the socket yet. */
function readBody(request: IncomingMessage, limit: () => number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let stopped = false;
    request.on("data", (chunk: Buffer) => {
      if (stopped) return;
      size += chunk.length;
      if (size > limit()) {
        // Do not destroy the connection here: the caller would only see "fetch failed" and not
        // know it sent too much. Answer 413 first; the listener closes the socket afterwards.
        stopped = true;
        request.pause();
        reject(new BodyError("too-large", "request body too large", limit()));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => { if (!stopped) resolve(Buffer.concat(chunks)); });
    request.on("error", (e) => { if (!stopped) reject(e); });
  });
}

function flattenHeaders(raw: http.IncomingHttpHeaders): Headers {
  const out: Headers = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    out[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

/** Builds the kernel request. The body is read only when a handler asks for it. */
export function buildRequest(request: IncomingMessage, url: URL, options: HttpAdapterOptions = {}): IncomingRequest {
  // The limit sits in a box: the kernel learns the matched route AFTER the request object exists,
  // and the body is read only when the handler calls `json()`, so raising it then is in time.
  const limit = { bytes: options.bodyLimit ?? DEFAULT_BODY_LIMIT };
  let cached: Promise<Buffer> | null = null;
  const raw = () => (cached ??= readBody(request, () => limit.bytes));
  return {
    method: request.method ?? "GET",
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    headers: flattenHeaders(request.headers),
    ip: request.socket?.remoteAddress ?? "",
    setBodyLimit: (bytes) => { if (Number.isInteger(bytes) && bytes > 0) limit.bytes = bytes; },
    raw,
    json: async () => {
      const buffer = await raw();
      if (buffer.length === 0) return {};
      try { return JSON.parse(buffer.toString("utf8")) as unknown; }
      catch { throw new BodyError("not-json", "request body is not JSON"); }
    }
  };
}

/** Writes a kernel reply. `headOnly` sends GET's headers with no body. */
export function writeReply(response: ServerResponse, reply: Reply, { headOnly = false } = {}): void {
  if (headOnly) {
    const body = reply.redirect ? "" : (reply.file ? reply.file.data : JSON.stringify(reply.body ?? null));
    const type = reply.redirect ? "text/plain; charset=utf-8" : (reply.file ? (reply.file.type ?? "application/octet-stream") : undefined);
    response.writeHead(reply.status, {
      ...securityHeaders(type),
      ...(reply.redirect ? { Location: reply.redirect, "Cache-Control": "no-store" } : {}),
      ...(reply.headers ?? {}),
      "Content-Length": String(Buffer.byteLength(body))
    });
    response.end();
    return;
  }
  if (reply.redirect) {
    response.writeHead(reply.status, { ...securityHeaders("text/plain; charset=utf-8"), Location: reply.redirect, "Cache-Control": "no-store", ...(reply.headers ?? {}) });
    response.end();
    return;
  }
  if (reply.file) {
    response.writeHead(reply.status, { ...securityHeaders(reply.file.type ?? "application/octet-stream"), ...(reply.headers ?? {}) });
    response.end(reply.file.data);
    return;
  }
  response.writeHead(reply.status, { ...securityHeaders(), ...(reply.headers ?? {}) });
  response.end(JSON.stringify(reply.body ?? null));
}

/** Drops whatever body is still arriving and closes — called AFTER a 413 was written. */
function closeEarly(request: IncomingMessage): void {
  try { request.resume(); request.destroy(); } catch { /* already closing */ }
}

/** A `requestListener` for `http.createServer` (or for tests that fake the two Node objects). */
export function createRequestListener(kernel: Kernel, options: HttpAdapterOptions = {}) {
  return async function listener(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let url: URL;
    try {
      url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    } catch {
      writeReply(response, { status: 400, body: { ok: false, error: ERROR_CODES.badRequest } });
      return;
    }
    const isHead = request.method === "HEAD";
    try {
      const incoming = buildRequest(request, url, options);
      if (isHead) incoming.method = "GET";
      const reply = await kernel.handle(incoming);
      writeReply(response, reply, { headOnly: isHead });
      // The caller may still be sending an oversized body: once 413 is out, stop receiving.
      if (reply.status === 413) closeEarly(request);
    } catch (e) {
      if (e instanceof BodyError && e.kind === "too-large") {
        writeReply(response, { status: 413, body: { ok: false, error: ERROR_CODES.badRequest, message: "Yêu cầu quá lớn." } });
        closeEarly(request);
        return;
      }
      if (e instanceof BodyError) {
        writeReply(response, { status: 400, body: { ok: false, error: ERROR_CODES.badRequest, message: "Thân yêu cầu không phải JSON." } });
        return;
      }
      writeReply(response, { status: 500, body: { ok: false, error: ERROR_CODES.internal } });
    }
  };
}

export function createHttpServer(kernel: Kernel, options: HttpAdapterOptions = {}): http.Server {
  return http.createServer(createRequestListener(kernel, options));
}
