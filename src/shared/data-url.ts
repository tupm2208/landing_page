/**
 * @file Bytes out of a `data:image/...;base64,` URL (or bare base64) — what a browser sends when a
 * page uploads a canvas or a picked photo as JSON.
 */

/** The decoded bytes, or `null` when the value is neither a data URL nor base64. */
export function bytesFromDataUrl(value: unknown): Buffer | null {
  const text = String(value ?? "").trim();
  const match = /^data:[a-z0-9.+/-]+;base64,(.*)$/is.exec(text);
  const base64 = (match ? match[1]! : text).replace(/\s+/g, "");
  if (!base64 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(base64)) return null;
  const data = Buffer.from(base64, "base64");
  return data.length > 0 ? data : null;
}
