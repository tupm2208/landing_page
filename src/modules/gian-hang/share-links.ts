/**
 * @file FILTER SHARE LINKS — `/l/<token>`.
 *
 * A customer filters "Nike, size 42, under 2 million" and taps share. Sending the real query
 * string gets it cut after the "?" by Messenger/Zalo, so the filter is packed into a pure-ASCII
 * base64url token. The server unpacks the token and 302s to the full filter link.
 *
 * This takes text from a stranger and puts it into a `Location` header, so it is a door. Three
 * layers hold it:
 *   1. The token must be base64url and not too long.
 *   2. Only DECLARED filter keys pass — adding a key means editing this file.
 *   3. Any control character, angle bracket or quote drops the whole token — back to "/".
 * Whatever goes wrong the answer is "/", never an absolute URL to another site.
 */

/** Filter keys allowed through a share link. Not listed = dropped. */
export const ALLOWED_FILTER_KEYS: ReadonlySet<string> = new Set([
  "q", "query", "size", "gender", "sport", "category", "type", "division",
  "brand", "warehouse", "price_min", "price_max", "sale", "ban", "sort", "ref"
]);

/** The site-relative redirect target for a share token; `"/"` for anything suspicious. */
export function decodeShareToken(token: unknown = ""): string {
  const text = String(token || "").trim();
  // base64url alphabet only, 1..700 chars: a longer token is not a filter anyone typed.
  if (!/^[A-Za-z0-9_-]{1,700}$/.test(text)) return "/";

  let decoded = "";
  try {
    decoded = Buffer.from(text.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return "/";
  }
  // Control characters, angle brackets, quotes and backslashes have no place in a filter.
  if (!decoded || /[\u0000-\u001f<>"'\\]/.test(decoded)) return "/";

  let params: URLSearchParams;
  try { params = new URLSearchParams(decoded); } catch { return "/"; }

  const clean = new URLSearchParams();
  for (const [key, value] of params) {
    if (!ALLOWED_FILTER_KEYS.has(key)) continue;
    const text = String(value || "").trim();
    if (!text || text.length > 200 || clean.has(key)) continue;
    clean.set(key, text);
  }
  const query = clean.toString();
  return query ? `/?${query}` : "/";
}
