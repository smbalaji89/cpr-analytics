import { NextResponse } from "next/server";

/**
 * Uniform API envelope.
 *
 * Every route returns `{ ok: true, data, meta }` or `{ ok: false, error }`, so
 * the client has exactly one success check and one error shape to handle.
 */

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNKNOWN_INSTRUMENT"
  | "OUT_OF_RANGE"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "PROVIDER_ERROR"
  | "INTERNAL_ERROR";

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; details?: unknown };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  UNKNOWN_INSTRUMENT: 404,
  OUT_OF_RANGE: 400,
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  PROVIDER_ERROR: 503,
  INTERNAL_ERROR: 500,
};

export const CACHE = {
  /** Settled sessions never change. */
  historical: "public, s-maxage=3600, stale-while-revalidate=86400",
  /** Forward-looking CPR changes when a new session completes. */
  forward: "public, s-maxage=300, stale-while-revalidate=600",
  /** Static registry data. */
  static: "public, s-maxage=86400, stale-while-revalidate=604800",
  none: "no-store",
  /**
   * For a response whose CONTENT depends on the access cookie.
   *
   * The CPR routes are served `public, s-maxage=300` and their Vary header
   * does not include Cookie, so a shared CDN would happily cache a privileged
   * response and hand it to the next anonymous caller. Privileged responses
   * are therefore never stored, which keeps the shared cache holding only
   * redacted content — the failure direction that matters.
   */
  privileged: "private, no-store",
} as const;

/** Pick the cache policy, downgrading to uncacheable when privileged. */
export function cacheFor(privileged: boolean, policy: string): string {
  return privileged ? CACHE.privileged : policy;
}

export function apiSuccess<T>(
  data: T,
  options: { meta?: Record<string, unknown>; cache?: string } = {},
): NextResponse<ApiSuccess<T>> {
  return NextResponse.json(
    { ok: true as const, data, ...(options.meta ? { meta: options.meta } : {}) },
    {
      headers: { "Cache-Control": options.cache ?? CACHE.none },
    },
  );
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): NextResponse<ApiFailure> {
  return NextResponse.json(
    { ok: false as const, error: { code, message, details } },
    {
      status: STATUS_BY_CODE[code],
      headers: { "Cache-Control": CACHE.none },
    },
  );
}

/**
 * Last-resort handler.
 *
 * Logs the real error server-side and returns the PRD §27 wording to the client
 * — internal messages must never leak, and the user must never be shown a
 * fabricated value in place of an error.
 */
export function apiUnexpected(context: string, error: unknown) {
  console.error(`[api] ${context}`, error);
  return apiError(
    "INTERNAL_ERROR",
    "Market data temporarily unavailable. Please try again later.",
  );
}
