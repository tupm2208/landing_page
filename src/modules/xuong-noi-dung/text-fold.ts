/** Lower case, no Vietnamese marks, `đ` → `d`, one space between words — for matching, never for showing. */
export function fold(value: unknown): string {
  return String(value ?? "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ").trim();
}
