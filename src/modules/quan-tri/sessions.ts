/**
 * @file The web admin's session: cookie in, person out — and the owner's first account.
 *
 * `AdminSessionResolver` is what the composition root plugs into the auth port
 * (`auth.usePersonSessions`). It is the only thing here the kernel ever calls, and it only READS.
 */

import { ROLE, type Caller, type Clock, type CredentialSource, type DataStore, type Logger, type PersonSessionResolver } from "../../contract";
import { hashPassword } from "../../shared/password";
import { readCookie } from "../../shared/session-cookie";
import { OWNER, PeopleRepository, normaliseLogin } from "./people-repository";

/** The running site's cookie name, kept: an old cookie simply finds no session and asks to log in. */
export const ADMIN_COOKIE = "toprun_admin_session";

/** How a person caller is named in logs and order history: `nguoi:<login>`. */
export function personCallerName(login: string): string {
  return `nguoi:${login}`;
}

export class AdminSessionResolver implements PersonSessionResolver {
  constructor(private readonly store: DataStore, private readonly clock: Clock) {}

  async resolve(request: CredentialSource): Promise<Caller | null> {
    const token = readCookie(request.headers ?? {}, ADMIN_COOKIE);
    if (!token || token.length > 200) return null;
    const person = await new PeopleRepository(this.store).personBySession(token, this.clock.now());
    if (!person) return null;
    return {
      role: ROLE.admin,
      name: personCallerName(person.login),
      via: "phien-nguoi",
      personId: person.id,
      login: person.login,
      personRole: person.role
    };
  }
}

/** Set-Cookie for a new session. */
export function sessionCookieHeaders(token: string, maxAgeSeconds: number, https: boolean): Record<string, string> {
  return {
    "Set-Cookie": `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.round(maxAgeSeconds))}${https ? "; Secure" : ""}`
  };
}

/**
 * THE FIRST OWNER, from the environment — once, when nobody exists yet.
 *
 * The running site kept its single admin account in `.env` (`ADMIN_LOGIN` / `ADMIN_USERNAME`,
 * `ADMIN_PASSWORD_HASH` or `ADMIN_PASSWORD`). The same variables create the first owner here, so a
 * shop moved from the old site logs in with the password it already has, and a cPanel account
 * without a terminal needs no command. Once one person exists, the variables are ignored: people
 * are managed on the admin screen, not in a file.
 */
export async function seedOwnerFromEnv(store: DataStore, env: Record<string, string | undefined>, clock: Clock, logger: Logger): Promise<void> {
  const repo = new PeopleRepository(store);
  if ((await repo.countPeople()) > 0) return;
  const login = normaliseLogin(env["ADMIN_LOGIN"] || env["ADMIN_USERNAME"] || "");
  const presetHash = String(env["ADMIN_PASSWORD_HASH"] || "").trim();
  const password = String(env["ADMIN_PASSWORD"] || "");
  if (!login || (!presetHash.startsWith("pbkdf2$") && password.length < 8)) {
    logger.warn("[quan-tri] chưa có ai đăng nhập được màn quản trị web: đặt ADMIN_LOGIN + ADMIN_PASSWORD (>= 8 ký tự) hoặc ADMIN_PASSWORD_HASH trong .env rồi khởi động lại");
    return;
  }
  const passwordHash = presetHash.startsWith("pbkdf2$") ? presetHash : await hashPassword(password);
  await repo.create({ login, name: login, role: OWNER, passwordHash, now: clock.now() });
  logger.info(`[quan-tri] tạo chủ shop đầu tiên "${login}" từ .env — từ giờ quản lý người trên màn quản trị`);
}
