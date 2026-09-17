/**
 * @file The auth port: ONE place that answers "who is calling, and may they do this".
 *
 * The old site sprinkled `isLandingAdminAuthorized(request, url)` across `server.js`; add a route,
 * forget the call, and a door is open. Here modules never check: the route declares `access` (and
 * `feature`) and the kernel refuses before the module runs (decided 12/09/2026).
 *
 * THREE WAYS IN (decided 14/09/2026 — the 15-minute ticket and machine pairing are gone; the third 16/09):
 *   1. A MACHINE TICKET signed by Xeon (`VM1.…`). The owner's console carries role "quan-tri";
 *      the brain carries "dich-vu". The landing verifies with Xeon's PUBLIC key (received at
 *      registration) and never calls Xeon. The ticket names the shop (must be this one) and the
 *      features the shop bought (the kernel gates routes on them).
 *   2. A LONG-LIVED NAMED KEY (Sales Desk, Image Tool of TopRun). Not feature-gated: internal tools.
 *   3. A PERSON'S SESSION COOKIE (the web admin, `/admin`). Looked up in a table through the
 *      `PersonSessionResolver` the composition root plugs in, so it can be revoked at once. Only
 *      read when the request carries no token: a token always decides.
 *
 * Three ways to present a credential, exactly as Desk and Image Tool do today:
 *   Authorization: Bearer <token>  |  x-landing-token: <token>  |  ?token=<token>
 */

import crypto from "node:crypto";
import {
  ACCESS, ROLE, type Access, type AuthPort, type Caller, type Clock, type CredentialSource, type Logger, type PersonSessionResolver, type Role,
  type XeonPublicKey
} from "../../contract";
import { isTicket, verifyTicket } from "../../shared/ticket-kit";

export interface NamedKey {
  token: string;
  name: string;
  role: Role;
}

export interface TokenAuthOptions {
  keys?: { token: string | undefined; name: string; role: Role }[];
  /** Xeon's public key, if the landing already registered. Without it every ticket is refused. */
  xeon?: XeonPublicKey | null;
  clock?: Clock;
  logger?: Logger;
}

/** Compares two secrets in constant time. */
export function constantTimeEqual(a: unknown, b: unknown): boolean {
  const x = Buffer.from(String(a ?? ""), "utf8");
  const y = Buffer.from(String(b ?? ""), "utf8");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** The credential presented, from any of the three accepted places. */
export function tokenFromRequest(request: CredentialSource): string {
  const headers = request?.headers ?? {};
  const bearer = String(headers["authorization"] ?? "").trim();
  if (/^Bearer\s+/i.test(bearer)) return bearer.replace(/^Bearer\s+/i, "").trim();
  const own = String(headers["x-landing-token"] ?? "").trim();
  if (own) return own;
  return String(request?.query?.["token"] ?? "").trim();
}

const ANONYMOUS = (via: string): Caller => ({ role: ROLE.anonymous, name: "", via });

/**
 * Keys + Xeon tickets. NO key configured and NO Xeon registration = refuse everything (fail closed).
 */
export class TokenAuth implements AuthPort {
  private readonly keys: NamedKey[];
  /** Xeon may rotate: several public keys can be valid at once, looked up by key id. */
  private readonly xeonKeys = new Map<string, string>();
  private myShop = "";
  private readonly clock: Clock;
  private readonly logger: Logger;
  private personSessions: PersonSessionResolver | null = null;

  constructor(options: TokenAuthOptions = {}) {
    this.clock = options.clock ?? { now: () => new Date() };
    this.logger = options.logger ?? { info: () => undefined, warn: () => undefined };
    this.keys = (options.keys ?? [])
      .map((k) => ({ token: String(k.token ?? "").trim(), name: String(k.name || "khong-ten"), role: k.role }))
      .filter((k) => k.token !== "" && (k.role === ROLE.admin || k.role === ROLE.service));
    if (options.xeon) this.setXeon(options.xeon);
  }

  setXeon(key: XeonPublicKey): void {
    if (!key?.keyId || !key?.publicKeyPem || !key?.shop) throw new Error("setXeon needs { keyId, publicKeyPem, shop }.");
    this.xeonKeys.set(String(key.keyId), String(key.publicKeyPem));
    this.myShop = String(key.shop);
    this.logger.info(`[quyen] nhận khoá công Xeon ${key.keyId} cho shop "${key.shop}"`);
  }

  hasXeon(): boolean { return this.xeonKeys.size > 0; }
  shop(): string { return this.myShop; }
  isConfigured(): boolean { return this.keys.length > 0 || this.xeonKeys.size > 0; }
  keyNames(): { name: string; role: Role }[] { return this.keys.map((k) => ({ name: k.name, role: k.role })); }

  identify(request: CredentialSource): Caller {
    const token = tokenFromRequest(request);
    if (!token) return ANONYMOUS("khong-co-ma");

    if (isTicket(token)) {
      if (this.xeonKeys.size === 0) return ANONYMOUS("chua-dang-ky-xeon");
      const verdict = verifyTicket(token, { publicKeyForKeyId: (id) => this.xeonKeys.get(id) ?? null, now: this.clock.now() });
      if (!verdict.hopLe) return ANONYMOUS(`ve-${verdict.viSao}`);
      const body = verdict.than;
      if (body.shop !== this.myShop) return ANONYMOUS("ve-shop-khac");
      return {
        role: body.vai,
        name: `${body.shop}:${body.tenMay || body.maMay || "?"}`,
        via: "ve-xeon",
        shop: body.shop,
        machineId: body.maMay,
        features: body.manh,
        onDuty: body.truc === true,
        expiresAt: body.hetLuc
      };
    }

    for (const key of this.keys) {
      if (constantTimeEqual(token, key.token)) return { role: key.role, name: key.name, via: "khoa-dai-han" };
    }
    return ANONYMOUS("ma-la");
  }

  usePersonSessions(resolver: PersonSessionResolver): void {
    this.personSessions = resolver;
  }

  async resolve(request: CredentialSource): Promise<Caller> {
    const byToken = this.identify(request);
    if (byToken.via !== "khong-co-ma" || !this.personSessions) return byToken;
    try {
      return (await this.personSessions.resolve(request)) ?? byToken;
    } catch (e) {
      // A broken lookup must fail CLOSED, and loudly: nobody gets in on a database hiccup.
      this.logger.warn(`[quyen] không tra được phiên người: ${e instanceof Error ? e.message : String(e)}`);
      return ANONYMOUS("loi-tra-phien");
    }
  }

  callerAllows(caller: Caller, access: Access): boolean {
    if (access === ACCESS.public) return true;
    if (access === ACCESS.admin) return caller.role === ROLE.admin;
    if (access === ACCESS.service) return caller.role === ROLE.service || caller.role === ROLE.admin;
    return false;
  }

  allows(request: CredentialSource, access: Access): boolean {
    return this.callerAllows(this.identify(request), access);
  }

  /** Only ticket callers are feature-gated; keys, persons and anonymous callers are not. */
  callerLacksFeature(caller: Caller, feature: string): boolean {
    if (caller.via !== "ve-xeon") return false;
    return !(Array.isArray(caller.features) && caller.features.includes(feature));
  }

  lacksFeature(request: CredentialSource, feature: string): boolean {
    return this.callerLacksFeature(this.identify(request), feature);
  }

  isAdmin(request: CredentialSource): boolean { return this.identify(request).role === ROLE.admin; }
}
