/**
 * @file Session cookies for modules with real people logging in (partner portal, collaborators).
 *
 * A session is a SELF-SIGNED string (HMAC-SHA256), not a row in a table:
 *   <base64url body>.<base64url signature>
 * The server keeps no session table, and a restart logs nobody out. Changing the secret kills
 * every live session at once — that is how "log everyone out" works.
 *
 * Same shape as the old site: HttpOnly, SameSite=Lax, and Secure on HTTPS.
 */

import crypto from "node:crypto";
import type { Clock, Headers } from "../contract";

function sign(body: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64url");
}

function constantTimeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** One cookie value out of the request's `cookie` header. */
export function readCookie(headers: Headers, name: string): string {
  const raw = String(headers?.["cookie"] ?? "");
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    if (part.slice(0, i).trim() !== name) continue;
    const value = part.slice(i + 1).trim();
    try { return decodeURIComponent(value); } catch { return value; }
  }
  return "";
}

export interface SessionCookieOptions {
  name: string;
  secret: string;
  clock: Clock;
  lifetimeHours?: number;
  https?: boolean;
}

export type SessionData = Record<string, unknown> & { hetLuc: number };

export class SessionCookie {
  private readonly name: string;
  private readonly secret: string;
  private readonly clock: Clock;
  private readonly lifetimeMs: number;
  private readonly secureSuffix: string;

  constructor(options: SessionCookieOptions) {
    if (!options.name) throw new Error("Phiên cookie cần `name`.");
    if (!options.secret || String(options.secret).length < 16) throw new Error("Bí mật ký phiên phải dài ít nhất 16 ký tự.");
    this.name = options.name;
    this.secret = String(options.secret);
    this.clock = options.clock;
    this.lifetimeMs = Math.max(1, Number(options.lifetimeHours) || 12) * 60 * 60 * 1000;
    this.secureSuffix = options.https ? "; Secure" : "";
  }

  /** The cookie value for `Set-Cookie`. `data` is whatever the session must remember. */
  create(data: Record<string, unknown> = {}): string {
    const body = Buffer.from(JSON.stringify({ ...data, hetLuc: this.clock.now().getTime() + this.lifetimeMs })).toString("base64url");
    return `${body}.${sign(body, this.secret)}`;
  }

  /** The session in the request: `null` when absent, tampered with, or expired. */
  read(headers: Headers): SessionData | null {
    const value = readCookie(headers, this.name);
    const dot = value.lastIndexOf(".");
    if (dot <= 0) return null;
    const body = value.slice(0, dot);
    if (!constantTimeEqual(value.slice(dot + 1), sign(body, this.secret))) return null;
    let data: SessionData;
    try { data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionData; } catch { return null; }
    if (!data?.hetLuc || Number(data.hetLuc) <= this.clock.now().getTime()) return null;
    return data;
  }

  /** Response headers that set the session on login. */
  setHeaders(data: Record<string, unknown>): Record<string, string> {
    return {
      "Set-Cookie": `${this.name}=${encodeURIComponent(this.create(data))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.round(this.lifetimeMs / 1000)}${this.secureSuffix}`
    };
  }

  /** Response headers that clear the session on logout. */
  clearHeaders(): Record<string, string> {
    return { "Set-Cookie": `${this.name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${this.secureSuffix}` };
  }
}
