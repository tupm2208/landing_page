/**
 * @file The request a module receives and the reply it returns.
 *
 * Modules never see Node's `IncomingMessage`/`ServerResponse`. They get a small, plain request
 * and return a plain reply, so a test calls a handler directly and the HTTP layer stays a thin
 * adapter that could be swapped (Express, serverless) without touching a module.
 */

import type { AuthPort, Clock, DataStore, HttpClient, Logger, ModuleBus, StaticFilePort } from "./ports";

/** Headers as the kernel presents them: lower-cased names, one string per header. */
export type Headers = Record<string, string | undefined>;

/**
 * What arrives at `Kernel.handle()`. Tests build these by hand, so the body readers and the
 * address are optional; the kernel fills the gaps before a handler sees the request.
 */
export interface IncomingRequest {
  method: string;
  path: string;
  query?: Record<string, string>;
  headers?: Headers;
  ip?: string;
  /** Parses the body as JSON. Throws a `BodyError` on bad JSON or an oversized body. */
  json?: () => Promise<unknown>;
  /** The raw body bytes (webhook signatures are computed over these). */
  raw?: () => Promise<Buffer>;
  /** Set by the HTTP adapter; the kernel calls it when the matched route declares `bodyLimit`. */
  setBodyLimit?: (bytes: number) => void;
}

/** The request a route handler receives: everything present, plus the path parameters. */
export interface KernelRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Headers;
  ip: string;
  json(): Promise<unknown>;
  raw(): Promise<Buffer>;
}

/** Error thrown by the body readers. `kind` lets the kernel answer 413 or 400 instead of 500. */
export class BodyError extends Error {
  constructor(public readonly kind: "too-large" | "not-json", message: string, public readonly limitBytes = 0) {
    super(message);
    this.name = "BodyError";
  }
}

export interface FileBody {
  data: Buffer | string;
  type?: string;
}

/**
 * What a handler returns. Three shapes share one type so tests read `reply.body` without
 * narrowing: JSON (`body`), a file (`file`), or a redirect (`redirect`).
 */
export interface ReplyDraft {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  file?: FileBody;
  redirect?: string;
}

/** A reply after the kernel filled in the default status. */
export interface Reply extends ReplyDraft {
  status: number;
}

/** The ports a module can be handed. The kernel installs only the declared ones (see `Kernel`). */
export interface ModulePorts {
  store: DataStore;
  logger: Logger;
  clock: Clock;
  http: HttpClient;
  auth: AuthPort;
  staticFiles: StaticFilePort;
}

/** Services other modules provide, keyed by module id then service name (`ctx.services["hang-kho"].reserve`). */
export type ServiceMap = Record<string, Record<string, (...args: never[]) => unknown> | undefined>;

/**
 * What a module receives on every call: its id, its ports, its bus, the services it asked for
 * and its slice of the configuration. Modules get NOTHING else.
 */
export interface ModuleContext<TConfig = Record<string, unknown>, TServices = ServiceMap> {
  id: string;
  ports: ModulePorts;
  bus: ModuleBus;
  services: TServices;
  config: TConfig;
}

export type RouteHandler<TConfig = Record<string, unknown>, TServices = ServiceMap> =
  (ctx: ModuleContext<TConfig, TServices>, request: KernelRequest) => Promise<ReplyDraft> | ReplyDraft;

/** Small helpers so handlers read as prose. */
export const reply = {
  json(body: unknown, status = 200, headers?: Record<string, string>): ReplyDraft {
    return headers ? { status, body, headers } : { status, body };
  },
  file(data: Buffer | string, type: string, status = 200, headers?: Record<string, string>): ReplyDraft {
    return headers ? { status, file: { data, type }, headers } : { status, file: { data, type } };
  },
  redirect(location: string, status = 302): ReplyDraft {
    return { status, redirect: location };
  }
};
