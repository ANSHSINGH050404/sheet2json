import { createFileRoute } from '@tanstack/react-router'

import { AppError } from '#lib/errors'
import {
  authenticate,
  quotaHeaders,
  retryAfterHeader,
} from '#server/api/authenticate'
import { CORS_HEADERS, corsPreflight, methodNotAllowed } from '#server/api/cors'
import { apiError, apiJson } from '#server/api/response'
import { deleteExtraction, getExtraction } from '#server/services/extraction'

/**
 * `GET /api/v1/extractions/{id}` and `DELETE /api/v1/extractions/{id}`.
 *
 * Reads back an extraction stored by the web UI, or removes one.
 *
 * A row belonging to someone else reads as `404`, not `403`. Distinguishing them
 * would confirm that an id exists, which leaks the shape of other people's
 * history.
 */
export const Route = createFileRoute('/api/v1/extractions/$extractionId')({
  server: {
    handlers: {
      OPTIONS: () => corsPreflight(),

      GET: async ({ request, params }) => {
        let limit = null as Awaited<
          ReturnType<typeof authenticate>
        >['rateLimit']

        try {
          const auth = await authenticate(request.headers.get('authorization'))
          limit = auth.rateLimit
          const userId = requireUser(auth.caller.userId)

          const extraction = await getExtraction(params.extractionId, userId)

          return apiJson(
            { extraction },
            {
              headers: { ...CORS_HEADERS, ...quotaHeaders(auth.rateLimit) },
            },
          )
        } catch (error) {
          return apiError(error, corsOrRetry(error, limit))
        }
      },

      DELETE: async ({ request, params }) => {
        let limit = null as Awaited<
          ReturnType<typeof authenticate>
        >['rateLimit']

        try {
          const auth = await authenticate(request.headers.get('authorization'))
          limit = auth.rateLimit
          const userId = requireUser(auth.caller.userId)

          const removed = await deleteExtraction(params.extractionId, userId)
          if (!removed) {
            throw new AppError(
              'NOT_FOUND',
              'That extraction could not be found.',
            )
          }

          return new Response(null, {
            status: 204,
            headers: { ...CORS_HEADERS, ...quotaHeaders(auth.rateLimit) },
          })
        } catch (error) {
          return apiError(error, corsOrRetry(error, limit))
        }
      },

      POST: () => methodNotAllowed('GET, DELETE, OPTIONS'),
    },
  },
})

function requireUser(userId: string | null): string {
  if (!userId) {
    throw new AppError(
      'UNAUTHENTICATED',
      'This endpoint requires an API key. Create one in Settings.',
    )
  }
  return userId
}

function corsOrRetry(
  error: unknown,
  limit: Awaited<ReturnType<typeof authenticate>>['rateLimit'],
): Record<string, string> {
  return error instanceof AppError && error.code === 'RATE_LIMITED'
    ? { ...CORS_HEADERS, ...retryAfterHeader(limit) }
    : CORS_HEADERS
}
