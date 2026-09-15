/**
 * @file Collaborator passwords — hashing and verification.
 *
 * The hash SHAPE IS KEPT EXACTLY as on the running site: `pbkdf2$<iterations>$<salt>$<key>`,
 * PBKDF2-SHA256, 210,000 iterations, 16-byte salt, 32-byte key, base64url. That is why the six
 * real collaborator accounts imported into the split build log in AT ONCE with their old
 * passwords — nobody has to reset anything.
 *
 * Changing this shape = every collaborator resets their password. If it must change one day
 * (say, to scrypt), BOTH shapes must be readable for a while, and a hash is upgraded when its
 * owner logs in successfully.
 *
 * TWO THINGS NOT TO BREAK:
 *
 * 1. COMPARE WITH `timingSafeEqual`. Comparing with `===` lets a password be measured byte by byte
 *    from the response time. A little slower, but nothing to measure.
 * 2. VERIFY NEVER THROWS. A stored hash may be garbage (typed by hand, corrupted file); throwing
 *    here turns the login route into a 500 and nobody knows why. Garbage = does not match, done.
 */

import crypto from "node:crypto";

/** PBKDF2 iteration count of the running site. Changing it invalidates every imported account. */
export const PBKDF2_ITERATIONS = 210000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

/** Hashes a password into the `pbkdf2$…` shape. A fresh salt every call: two hashes of one password differ. */
export function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(SALT_BYTES).toString("base64url");
    crypto.pbkdf2(String(password), salt, PBKDF2_ITERATIONS, KEY_BYTES, "sha256", (error, key) => {
      if (error) return reject(error);
      resolve(`pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${key.toString("base64url")}`);
    });
  });
}

/** `true` when `password` matches `stored`. Garbage or a foreign shape is `false`, never an exception. */
export function verifyPassword(password: string, stored: unknown): Promise<boolean> {
  return new Promise((resolve) => {
    const [scheme, iterationsText, salt, keyText] = String(stored ?? "").split("$");
    const iterations = Number(iterationsText);
    if (scheme !== "pbkdf2" || !Number.isFinite(iterations) || iterations <= 0 || !salt || !keyText) return resolve(false);
    let expected: Buffer;
    try { expected = Buffer.from(keyText, "base64url"); } catch { return resolve(false); }
    crypto.pbkdf2(String(password), salt, iterations, expected.length, "sha256", (error, key) => {
      if (error) return resolve(false);
      resolve(expected.length === key.length && crypto.timingSafeEqual(expected, key));
    });
  });
}

/** SHA-256 hex of a token (device id, session id) so the plain token is NEVER stored in a table. */
export function hashToken(token: unknown): string {
  return crypto.createHash("sha256").update(String(token ?? "")).digest("hex");
}
