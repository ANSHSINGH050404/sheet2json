import { AppError } from '#lib/errors'

/**
 * CORS for the public API.
 *
 * The API is designed to be called from other people's pages and scripts, so it
 * has to be reachable cross-origin. `*` is the correct answer for a credential
 * that lives in a header rather than a cookie: the browser will not attach a
 * session cookie to a cross-origin request unless the response opts in with
 * `Access-Control-Allow-Credentials`, and it does not, so there is no ambient
 * authority for a hostile page to spend.
 *
 * Keeping it that way is the reason to be careful here. If a session cookie were
 * ever allowed cross-origin, any site could make a signed-in visitor's browser
 * read their private sheets and post them elsewhere.
 */

/** Headers sent with every API response, so browser callers can read it. */
export const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  // Ten minutes, so a page can cache a response and a deploy does not require a
  // hard reload to pick up header changes.
  'access-control-max-age': '600',
}

/**
 * Answers a CORS preflight.
 *
 * `Authorization` is listed explicitly, because a request with a custom header is
 * not a "simple" request and would otherwise be blocked before the real call.
 */
export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

/** Rejects a method the endpoint does not implement, with the CORS headers. */
export function methodNotAllowed(allowed: string): Response {
  return new Response('Method not allowed', {
    status: 405,
    headers: { ...CORS_HEADERS, allow: allowed, 'content-type': 'text/plain' },
  })
}

/** A malformed request body, as a 400 in the API's own error shape. */
export function badRequest(message: string): Response {
  return new Response(
    JSON.stringify({ error: { code: 'INVALID_URL', message } }),
    {
      status: 400,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  )
}

/** Throws for a request whose parameters are outside what the app accepts. */
export function requireParam(value: string | null, name: string): string {
  if (value === null || value.trim() === '') {
    throw new AppError(
      'INVALID_URL',
      `Missing required query parameter: ${name}. See /docs.`,
    )
  }
  return value
}
