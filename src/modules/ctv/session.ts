/**
 * @file The two cookies a collaborator carries: the login session and the device id.
 *
 * Both are self-signed cookies (`SessionCookie`), but they mean different things and live
 * different lengths:
 *   - the SESSION cookie (`toprun_ctv_phien`) carries a session id whose hash is a row in
 *     `ctv_phien`; every call re-checks that row, so switching an account off ends the session
 *     at the next call (rule 4 of the module);
 *   - the DEVICE cookie (`toprun_ctv_may`) carries a device id whose hash is a row in
 *     `ctv_thiet_bi`; it lives about a year so the shop owner approves a device once, not on
 *     every login (rule 2).
 *
 * Cookie names are wire format shared with the collaborator page: they stay as they were.
 */

import type { Clock, Headers } from "../../contract";
import { SessionCookie } from "../../shared/session-cookie";

/** Name of the login-session cookie. */
export const SESSION_COOKIE = "toprun_ctv_phien";
/** Name of the device-id cookie. */
export const DEVICE_COOKIE = "toprun_ctv_may";

/** Default session life when the config says nothing: 30 days. */
export const DEFAULT_SESSION_HOURS = 24 * 30;
/** Default device-cookie life when the config says nothing: one year. */
export const DEFAULT_DEVICE_HOURS = 24 * 365;

export interface CollaboratorCookieOptions {
  secret: string;
  clock: Clock;
  sessionHours?: number | undefined;
  deviceHours?: number | undefined;
  https?: boolean | undefined;
}

/** What the session cookie remembers: the plain session id (its hash is what the table holds). */
export interface SessionPayload { maPhien: string }
/** What the device cookie remembers: the plain device id. */
export interface DevicePayload { maMay: string }

/** Builds, reads and clears the session and device cookies of one request/response. */
export class CollaboratorCookies {
  private readonly session: SessionCookie;
  private readonly device: SessionCookie;

  constructor(options: CollaboratorCookieOptions) {
    const https = options.https === true;
    this.session = new SessionCookie({
      name: SESSION_COOKIE, secret: options.secret, clock: options.clock,
      lifetimeHours: Number(options.sessionHours) || DEFAULT_SESSION_HOURS, https
    });
    this.device = new SessionCookie({
      name: DEVICE_COOKIE, secret: options.secret, clock: options.clock,
      lifetimeHours: Number(options.deviceHours) || DEFAULT_DEVICE_HOURS, https
    });
  }

  /** The plain session id in the request, or `""` when the cookie is absent, tampered with or expired. */
  readSessionId(headers: Headers): string {
    const data = this.session.read(headers);
    return data ? String(data["maPhien"] ?? "") : "";
  }

  /** The plain device id in the request, or `""`. */
  readDeviceId(headers: Headers): string {
    const data = this.device.read(headers);
    return data ? String(data["maMay"] ?? "") : "";
  }

  /** `Set-Cookie` header installing the session. */
  setSessionHeaders(payload: SessionPayload): Record<string, string> {
    return this.session.setHeaders({ ...payload });
  }

  /** `Set-Cookie` header removing the session. */
  clearSessionHeaders(): Record<string, string> {
    return this.session.clearHeaders();
  }

  /** `Set-Cookie` header installing the device id (returned even when the device still awaits approval). */
  setDeviceHeaders(payload: DevicePayload): Record<string, string> {
    return this.device.setHeaders({ ...payload });
  }
}
