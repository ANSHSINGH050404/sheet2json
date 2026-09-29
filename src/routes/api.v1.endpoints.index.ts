import { createFileRoute } from '@tanstack/react-router'

import { AppError } from '#lib/errors'
import {
  authenticate,
  quotaHeaders,
  retryAfterHeader,
} from '#server/api/authenticate'
import { CORS_HEADERS, corsPreflight, methodNotAllowed } from '#server/api/cors'
import { apiError, apiJson } from '#server/api/response'
import { listSavedEndpoints } from '#server/services/endpoints'

/** `GET /api/v1/endpoints` lists the caller's saved live endpoints. */
export const Route = createFileRoute('/api/v1/endpoints/')({
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
          const userId = requireUser(auth.caller.userId)
          const endpoints = await listSavedEndpoints(userId)

          return apiJson(
            {
              endpoints: endpoints.map((endpoint) => ({
                ...endpoint,
                endpointPath: `/api/v1/endpoints/${endpoint.id}`,
              })),
            },
            { headers: { ...CORS_HEADERS, ...quotaHeaders(auth.rateLimit) } },
          )
        } catch (error) {
          return apiError(error, corsOrRetry(error, limit))
        }
      },

      POST: () => methodNotAllowed('GET, OPTIONS'),
      DELETE: () => methodNotAllowed('GET, OPTIONS'),
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
