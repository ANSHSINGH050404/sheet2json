import { toAppError } from '#lib/errors'
import { rowsToCsv } from '#lib/csv'
import type { AppError } from '#lib/errors'

/**
 * The shared response helpers for the public REST API.
 *
 * These routes are consumed by scripts rather than by our own UI, so the shape
 * here is a deliberate contract: a JSON body with a stable `error.code`, and
 * standard HTTP status codes. Anything the UI relies on (`Result<T>`) does not
 * apply, because a script cannot destructure a discriminated union usefully.
 */

export interface ApiErrorBody {
  error: {
    code: string
    message: string
  }
}

/** Maps an app error to the HTTP status a client should expect. */
function statusFor(code: AppError['code']): number {
  switch (code) {
    case 'UNAUTHENTICATED':
      return 401
    case 'FORBIDDEN':
      return 403
    case 'RATE_LIMITED':
      return 429
    case 'NOT_FOUND':
      return 404
    case 'INVALID_URL':
    case 'URL_REQUIRED':
    case 'OAUTH_STATE_INVALID':
      return 400
    case 'SHEET_NOT_ACCESSIBLE':
    case 'SHEET_NEEDS_AUTH':
    case 'GOOGLE_REAUTH_REQUIRED':
      return 403
    case 'SHEET_TOO_LARGE':
      return 413
    default:
      // 500: the client did nothing wrong.
      return 500
  }
}

/**
 * A JSON success response.
 *
 * `Cache-Control` is set on every response. The extraction endpoint overrides it
 * with a short `max-age`; everything else is explicitly uncacheable, so an
 * authenticated response can never be stored by a shared proxy on the way back.
 */
export function apiJson(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...init.headers,
    },
  })
}

/**
 * A JSON error response.
 *
 * Only `code` and the already-safe `message` are sent. The original error, with
 * its cause and any upstream response body, stays in the server log.
 */
export function apiError(
  error: unknown,
  headers: Record<string, string> = {},
): Response {
  const appError = toAppError(error)
  const status = statusFor(appError.code)

  if (appError.code === 'INTERNAL_ERROR') {
    console.error('[api] request failed', error)
  }

  const body: ApiErrorBody = { error: appError }

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  })
}

/**
 * A plain-text error response, for the non-JSON output formats.
 *
 * A caller who asked for CSV should get a CSV-shaped failure - an HTML error page
 * or a JSON blob would be something their parser has to special-case.
 */
export function apiTextError(
  error: unknown,
  headers: Record<string, string> = {},
): Response {
  const appError = toAppError(error)
  return new Response(appError.message, {
    status: statusFor(appError.code),
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  })
}

/** Shared CSV serializer for the API response and browser downloads. */
export const toCsv = rowsToCsv

/**
 * Serialises rows as newline-delimited JSON, one object per line.
 *
 * The format a streaming consumer actually wants: it can be piped through `jq`,
 * `while read`, or read object-by-object, without parsing the whole document.
 */
export function toNdjson(rows: Record<string, string>[]): string {
  return rows.map((row) => JSON.stringify(row)).join('\n')
}
