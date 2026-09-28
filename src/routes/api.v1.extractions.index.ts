import { createFileRoute } from '@tanstack/react-router'

import { AppError } from '#lib/errors'
import {
  authenticate,
  quotaHeaders,
  retryAfterHeader,
} from '#server/api/authenticate'
import { CORS_HEADERS, corsPreflight, methodNotAllowed } from '#server/api/cors'
import { apiError, apiJson } from '#server/api/response'
import { getExtractions } from '#server/services/extraction'
import { HISTORY_PAGE_SIZE } from '#server/config'

/**
 * `GET /api/v1/extractions` - the caller's own history.
 *
 * Requires an API key. Every row is scoped to the key's owner, so one account's
 * history is never visible to another, and the JSON payload is left out of the
 * list: a sheet with thousands of rows would otherwise be re-sent on every page
 * load. Fetch a single extraction to get its rows.
 *
 * `GET /api/v1/extractions/{id}` reads one back in full.
 */
export const Route = createFileRoute('/api/v1/extractions/')({
  server: {
    handlers: {
      OPTIONS: () => corsPreflight(),

      GET: async ({ request }) => {
        let limit = null as Awaited<
          ReturnType<typeof authenticate>
        >['rateLimit']

        try {
          const auth = await authenticate(request.headers.get('authorization'))
          limit = auth.rateLimit

          if (!auth.caller.userId) {
            throw new AppError(
              'UNAUTHENTICATED',
              'This endpoint requires an API key. Create one in Settings.',
            )
          }

          const extractions = await getExtractions(
            auth.caller.userId,
            readLimit(new URL(request.url).searchParams.get('limit')),
          )

          return apiJson(
            { extractions },
            { headers: { ...CORS_HEADERS, ...quotaHeaders(auth.rateLimit) } },
          )
        } catch (error) {
          const extra =
            error instanceof AppError && error.code === 'RATE_LIMITED'
              ? { ...CORS_HEADERS, ...retryAfterHeader(limit) }
              : CORS_HEADERS
          return apiError(error, extra)
        }
      },

      DELETE: () => methodNotAllowed('GET, OPTIONS'),
    },
  },
})

/** Clamped to a sane range so a caller cannot ask for the whole table. */
function readLimit(value: string | null): number {
  if (value === null) return HISTORY_PAGE_SIZE
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return HISTORY_PAGE_SIZE
  return Math.min(parsed, 200)
}
