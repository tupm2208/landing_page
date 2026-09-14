/**
 * @file Error codes every door of the merchant server answers with.
 *
 * The CODE VALUES are wire format: OMI, Sales Desk, Image Tool and the storefront read
 * `body.error` and branch on these exact strings. Add a new code here, never invent one inline.
 */

export const ERROR_CODES = {
  notFound: "khong_thay",
  badRequest: "sai_yeu_cau",
  unauthenticated: "chua_dang_nhap",
  forbidden: "khong_du_quyen",
  tooManyRequests: "qua_nhieu",
  featureNotBought: "chua_mua_manh",
  internal: "loi_he_thong",
  portMissing: "cong_khong_co"
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** The standard JSON body of a refused request. `message` is Vietnamese for the person reading it. */
export interface ErrorBody {
  ok: false;
  error: ErrorCode | string;
  message?: string;
  [extra: string]: unknown;
}

/** Builds the standard error body. */
export function errorBody(error: ErrorCode | string, message?: string, extra: Record<string, unknown> = {}): ErrorBody {
  return message === undefined ? { ok: false, error, ...extra } : { ok: false, error, message, ...extra };
}
