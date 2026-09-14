/**
 * @file Three small ports — logger, clock, outbound HTTP — each with a real and a fake adapter.
 *
 * The fakes exist so tests run to completion without printing, waiting or touching the network.
 */

import type { Clock, HttpClient, HttpRequestInit, HttpResponse, Logger } from "../../contract";

// ---- logger ----------------------------------------------------------------------------------

export type LogLevel = "info" | "warn" | "silent";

/** Writes to the console. Levels: `info` prints all, `warn` only warnings, `silent` nothing. */
export class ConsoleLogger implements Logger {
  constructor(private readonly level: LogLevel = "info", private readonly out: Pick<Console, "log" | "warn"> = console) {}
  info(...parts: unknown[]): void { if (this.level === "info") this.out.log(...parts); }
  warn(...parts: unknown[]): void { if (this.level !== "silent") this.out.warn(...parts); }
}

export interface LogLine {
  level: "info" | "warn";
  text: string;
}

/** Keeps every line so a test can assert on what was logged. */
export class MemoryLogger implements Logger {
  readonly lines: LogLine[] = [];
  info(...parts: unknown[]): void { this.lines.push({ level: "info", text: parts.map(String).join(" ") }); }
  warn(...parts: unknown[]): void { this.lines.push({ level: "warn", text: parts.map(String).join(" ") }); }
  get warnings(): string[] { return this.lines.filter((l) => l.level === "warn").map((l) => l.text); }
  has(pattern: RegExp): boolean { return this.lines.some((l) => pattern.test(l.text)); }
}

// ---- clock -----------------------------------------------------------------------------------

export class SystemClock implements Clock {
  now(): Date { return new Date(); }
}

/** A clock a test moves by hand — nothing ever waits on real time. */
export class ManualClock implements Clock {
  private current: Date;
  constructor(start: Date | string = "2026-09-12T00:00:00.000Z") { this.current = new Date(start); }
  now(): Date { return new Date(this.current); }
  set(to: Date | string | number): void { this.current = new Date(to); }
  advance(ms: number): void { this.current = new Date(this.current.getTime() + ms); }
}

// ---- outbound HTTP ---------------------------------------------------------------------------

/**
 * The real client over global `fetch`. Every call has a deadline: without one, a partner that
 * hangs hangs the whole server (learned from the SPX line on the old site).
 */
export class FetchHttpClient implements HttpClient {
  constructor(
    private readonly options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
  ) {}

  async fetch(url: string, init: HttpRequestInit = {}): Promise<HttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? this.options.timeoutMs ?? 15000);
    try {
      // Resolved at call time so a test may swap `globalThis.fetch` after construction.
      const impl = this.options.fetchImpl ?? globalThis.fetch;
      const requestInit: RequestInit = { signal: controller.signal };
      if (init.method) requestInit.method = init.method;
      if (init.headers) requestInit.headers = init.headers;
      if (init.body !== undefined) requestInit.body = init.body;
      return await impl(url, requestInit);
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface RecordedCall {
  url: string;
  init: HttpRequestInit;
}

export type FakeResponder = (url: string, init: HttpRequestInit) => HttpResponse | Promise<HttpResponse> | undefined;

/** Answers from a table (url -> response) or a function, and records every call. Unknown URLs throw. */
export class FakeHttpClient implements HttpClient {
  readonly calls: RecordedCall[] = [];
  constructor(private readonly answers: Record<string, HttpResponse> | FakeResponder = {}) {}

  async fetch(url: string, init: HttpRequestInit = {}): Promise<HttpResponse> {
    this.calls.push({ url: String(url), init });
    const answer = typeof this.answers === "function" ? await this.answers(String(url), init) : this.answers[String(url)];
    if (!answer) throw new Error(`FakeHttpClient: no answer prepared for ${url}`);
    return answer;
  }
}

/** Builds a fake response with a JSON body — the shape every module reads. */
export function jsonResponse(body: unknown, status = 200): HttpResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}
