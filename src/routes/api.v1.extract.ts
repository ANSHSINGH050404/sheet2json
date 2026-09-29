import { createFileRoute } from '@tanstack/react-router'

import { AppError } from '#lib/errors'
import { authenticate, quotaHeaders } from '#server/api/authenticate'
import { CORS_HEADERS, corsPreflight } from '#server/api/cors'
import { apiError, apiJson, toCsv, toNdjson } from '#server/api/response'
import { readApiOutputFormat } from '#server/api/output-format'
import { corsOrRetry } from '#server/api/route-helpers'
import { parseRowQuery } from '#lib/query'
import { extractSheet } from '#server/services/extraction'
import { API_CACHE_TTL_SECONDS } from '#server/config'

/**
 * `GET /api/v1/extract` - the endpoint the API exists for.
 *
 *   curl "https://example.com/api/v1/extract?url=<sheet-url>" \
 *        -H "Authorization: Bearer s2j_..."
 *
 * JSON by default; `?format=csv` and `?format=ndjson` return the rows in those
 * shapes for callers that are piping them somewhere rather than parsing JSON.
 *
 * `?select`, `?where`, `?sort` and `?limit` narrow the rows server-side, so a
 * caller who wants five of nine hundred rows does not have to download all of
 * them. See /docs.
 *
 * A request with no API key is still served, under a much smaller per-IP budget.
 * That keeps a first-time `curl` working without an account while making bulk
 * abuse expensive. Every other endpoint requires a key.
 */
export const Route = createFileRoute('/api/v1/extract')({
  server: {
    handlers: {
      OPTIONS: () => corsPreflight(),

      GET: async ({ request }) => {
        let rateLimit = null as Awaited<
          ReturnType<typeof authenticate>
        >['rateLimit']

        try {
          const auth = await authenticate(request.headers.get('authorization'))
          rateLimit = auth.rateLimit

          const query = new URL(request.url).searchParams
          const format = readApiOutputFormat(query.get('format'))
          // Syntax is validated before the fetch, so a typo'd `where` fails
          // without spending a request on Google's CSV endpoint.
          const rowQuery = parseRowQuery(query)

          const result = await extractSheet(requireUrl(query.get('url')), {
            userId: auth.caller.userId ?? undefined,
            // A polled read should not write a history row on every call.
            persist: false,
            query: rowQuery,
          })

          // A short cache window absorbs polling without ever serving something
          // meaningfully stale. `private` because the rows depend on the caller's
          // own credentials: a private sheet must not land in a shared cache.
          const headers: Record<string, string> = {
            ...CORS_HEADERS,
            ...quotaHeaders(auth.rateLimit),
            ...(API_CACHE_TTL_SECONDS > 0
              ? { 'cache-control': `private, max-age=${API_CACHE_TTL_SECONDS}` }
              : {}),
          }

          if (format === 'json') {
            return apiJson(
              {
                spreadsheetId: result.spreadsheetId,
                gid: result.gid,
                title: result.title,
                sourceUrl: result.sourceUrl,
                rowCount: result.rowCount,
                columnCount: result.columnCount,
                extractedAt: result.createdAt,
                data: result.data,
              },
              { headers },
            )
          }

          return new Response(
            format === 'csv' ? toCsv(result.data) : toNdjson(result.data),
            {
              headers: {
                ...headers,
                'content-type':
                  format === 'csv'
                    ? 'text/csv; charset=utf-8'
                    : 'application/x-ndjson; charset=utf-8',
              },
            },
          )
        } catch (error) {
          // A 429 is the one failure a client can act on, so it carries
          // `Retry-After` instead of leaving the caller to guess.
          return apiError(error, corsOrRetry(error, rateLimit))
        }
      },
    },
  },
})

function requireUrl(value: string | null): string {
  if (value === null || value.trim() === '') {
    throw new AppError(
      'INVALID_URL',
      'Missing required query parameter: url. See /docs for the full reference.',
    )
  }
  return value
}
