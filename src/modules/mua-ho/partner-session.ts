/**
 * @file The partner portal's session: a self-signed cookie carrying the partner's portal code.
 *
 * Partners have no accounts; they open a private link (their portal code). Login turns that code
 * into a signed cookie so later requests need not carry the link. The cookie holds only the code
 * (`maCong`); on every request it is checked AGAINST THE TABLE again, so switching a partner off
 * revokes a live session at once (see `module.ts`).
 *
 * The cookie name and the `maCong` key inside are live-session format: changing either logs
 * every partner out on deploy.
 */

import type { Clock, Headers } from "../../contract";
import { SessionCookie } from "../../shared/session-cookie";

export const PARTNER_COOKIE = "toprun_partner_session";

export interface PartnerSessionConfig {
  sessionSecret?: string;
  sessionHours?: number;
  https?: boolean;
}

export class PartnerSession {
  private readonly cookie: SessionCookie;

  /** Throws (a developer/config error) when the secret is missing or shorter than 16 characters. */
  constructor(config: PartnerSessionConfig, clock: Clock) {
    this.cookie = new SessionCookie({
      name: PARTNER_COOKIE,
      secret: String(config.sessionSecret || ""),
      clock,
      lifetimeHours: Number(config.sessionHours || 12),
      https: config.https === true
    });
  }

  /** The portal code in a valid session, or `null` (absent, tampered, expired). */
  portalCode(headers: Headers): string | null {
    const session = this.cookie.read(headers);
    const code = session?.["maCong"];
    return code ? String(code) : null;
  }

  /** Response headers that log the partner in. */
  loginHeaders(portalCode: string): Record<string, string> {
    return this.cookie.setHeaders({ maCong: portalCode });
  }

  /** Response headers that log the partner out. */
  logoutHeaders(): Record<string, string> {
    return this.cookie.clearHeaders();
  }
}
