import { createFileRoute } from '@tanstack/react-router'

import { AppError } from '#lib/errors'
import { parseEndpointQuery } from '#lib/endpoints'
import {
  authenticate,
  quotaHeaders,
  retryAfterHeader,
} from '#server/api/authenticate'
import { CORS_HEADERS, corsPreflight, methodNotAllowed } from '#server/api/cors'
import { apiError, apiJson, toCsv, toNdjson } from '#server/api/response'
import {
  deleteSavedEndpoint,
  getSavedEndpoint,
} from '#server/services/endpoints'
import { extractSheet } from '#server/services/extraction'
import { API_CACHE_TTL_SECONDS } from '#server/config'

/** A saved endpoint reads live rows and applies the query recipe saved by its owner. */
export const Route = createFileRoute('/api/v1/endpoints/$endpointId')({
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
          const format = readFormat(
            new URL(request.url).searchParams.get('format'),
          )
          const endpoint = await getSavedEndpoint(params.endpointId, userId)
          const result = await extractSheet(endpoint.sourceUrl, {
            userId,
            persist: false,
            query: parseEndpointQuery(endpoint.query),
          })

          const headers: Record<string, string> = {
            ...CORS_HEADERS,
            ...quotaHeaders(auth.rateLimit),
            'cache-control': 'no-store',
            vary: 'Authorization',
            ...(API_CACHE_TTL_SECONDS > 0
              ? { 'cache-control': `private, max-age=${API_CACHE_TTL_SECONDS}` }
              : {}),
          }

          if (format === 'json') {
            return apiJson(
              {
                endpoint: { id: endpoint.id, name: endpoint.name },
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
          const deleted = await deleteSavedEndpoint(params.endpointId, userId)
          if (!deleted) {
            throw new AppError(
              'NOT_FOUND',
              'That saved endpoint could not be found.',
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

type OutputFormat = 'json' | 'csv' | 'ndjson'

function readFormat(value: string | null): OutputFormat {
  if (value === null || value === '') return 'json'
  if (value === 'json' || value === 'csv' || value === 'ndjson') return value
  throw new AppError(
    'INVALID_URL',
    'Unsupported format. Use one of: json, csv, ndjson.',
  )
}

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
