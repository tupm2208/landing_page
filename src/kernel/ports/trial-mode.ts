/**
 * @file Trial mode: wraps the outbound HTTP port so a trial run does NOTHING real outside.
 *
 * Decided 12/09/2026: run the trial on real data, read Graph API live, BUT "do not answer
 * customers — it would affect the running system". So trial mode does one thing: BLOCK EVERY
 * CALL WITH A REAL SIDE EFFECT. Three principles:
 *
 * 1. BLOCK BY DEFAULT. Not "block a list of bad calls" but "let through a declared list". A new
 *    partner nobody declared is blocked — instead of leaking out and being noticed afterwards.
 * 2. NEVER SILENT. A blocked call THROWS a clear error, never returns "ok". Returning ok makes
 *    the brain believe it messaged the customer, and the log becomes a lie.
 * 3. RECORD WHAT WAS BLOCKED. On the real build exactly these calls would have happened; reading
 *    them back tells whether the trial is on the right track.
 */

import type { HttpClient, HttpRequestInit, HttpResponse, Logger } from "../../contract";

export interface TrafficRule {
  label: string;
  matches: (url: string, init: HttpRequestInit) => boolean;
}

/** Calls allowed to go out in trial mode. READ only, never write. */
export const ALLOWED_IN_TRIAL: TrafficRule[] = [
  {
    label: "chỉ đọc dữ liệu từ Meta",
    matches: (url, init) => /^https:\/\/graph\.facebook\.com\//.test(url) && (init.method ?? "GET").toUpperCase() === "GET"
  }
];

/** Known side-effecting calls, with a label the operator understands in the log. */
export const BLOCKED_IN_TRIAL: TrafficRule[] = [
  { label: "gửi tin cho khách qua Graph API", matches: (url) => /graph\.facebook\.com\/.*\/me\/messages/.test(url) },
  { label: "gửi tin Telegram cho người bán hàng", matches: (url) => /api\.telegram\.org/.test(url) },
  { label: "tạo vận đơn SPX thật", matches: (url) => /spx\.vn/.test(url) },
  { label: "tạo vận đơn Viettel Post thật", matches: (url) => /viettelpost\.vn/.test(url) }
];

export class TrialModeBlockedError extends Error {
  readonly trialMode = true;
  constructor(public readonly action: string, public readonly target: string) {
    super(`Chế độ thử: chặn "${action}". Bản thử không được làm việc này ra ngoài.`);
    this.name = "TrialModeBlockedError";
  }
}

export interface BlockedCall {
  action: string;
  target: string;
  at: string;
  body: string;
}

export interface TrialModeOptions {
  real: HttpClient;
  logger?: Logger;
  /** Extra destinations allowed through — e.g. our own Xeon (brain inbox, licence registration): our machine, not a partner. */
  allowAlso?: TrafficRule[];
}

export class TrialModeHttpClient implements HttpClient {
  readonly blocked: BlockedCall[] = [];
  private readonly allowed: TrafficRule[];
  private readonly logger: Logger;

  constructor(private readonly options: TrialModeOptions) {
    this.allowed = [...ALLOWED_IN_TRIAL, ...(options.allowAlso ?? [])];
    this.logger = options.logger ?? { info: () => undefined, warn: () => undefined };
  }

  async fetch(url: string, init: HttpRequestInit = {}): Promise<HttpResponse> {
    const u = String(url);
    const pass = this.allowed.find((rule) => rule.matches(u, init));
    if (pass) {
      this.logger.info(`[thu] cho qua (${pass.label}): ${u.split("?")[0]}`);
      return this.options.real.fetch(url, init);
    }
    // Principle 1: not on the allow list means blocked, whether or not it is on the known list.
    const known = BLOCKED_IN_TRIAL.find((rule) => rule.matches(u, init));
    const action = known ? known.label : `gọi ra ngoài tới ${u.split("/")[2] || u}`;
    this.blocked.push({ action, target: u.split("?")[0] ?? u, at: new Date().toISOString(), body: init.body ? String(init.body).slice(0, 500) : "" });
    this.logger.warn(`[thu] CHẶN: ${action} -> ${u.split("?")[0]}`);
    // Principle 2: throw, never return ok.
    throw new TrialModeBlockedError(action, u);
  }
}
