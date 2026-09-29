import { createFileRoute } from '@tanstack/react-router'

import { parseEndpointQuery } from '#lib/endpoints'
import { authenticate, quotaHeaders } from '#server/api/authenticate'
import { CORS_HEADERS, corsPreflight, methodNotAllowed } from '#server/api/cors'
import { apiError, apiRowsResponse } from '#server/api/response'
import { readApiOutputFormat } from '#server/api/output-format'
import { corsOrRetry, requireApiUserId } from '#server/api/route-helpers'
import { getSavedEndpoint } from '#server/services/endpoints'
import { extractSheet } from '#server/services/extraction'
import { API_CACHE_TTL_SECONDS } from '#server/config'

/** A saved endpoint reads live rows and applies the query recipe saved by its owner. */
export const Route = createFileRoute('/api/v1/endpoints/$endpointId')({
  server: {
    handlers: {
      OPTIONS: () => corsPreflight(),

      GET: async ({ request, params }) => {
        let rateLimit = null as Awaited<
          ReturnType<typeof authenticate>
        >['rateLimit']

        try {
          const auth = await authenticate(request.headers.get('authorization'))
          rateLimit = auth.rateLimit
          const userId = requireApiUserId(auth.caller.userId)
          const format = readApiOutputFormat(
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

          return apiRowsResponse({
            format,
            rows: result.data,
            jsonBody: {
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
            headers,
          })
        } catch (error) {
          return apiError(error, corsOrRetry(error, rateLimit))
        }
      },

      POST: () => methodNotAllowed('GET, OPTIONS'),
      DELETE: () => methodNotAllowed('GET, OPTIONS'),
    },
  },
})
