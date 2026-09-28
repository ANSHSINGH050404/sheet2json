import { createFileRoute } from '@tanstack/react-router'

import { AppError } from '#lib/errors'
import { authenticate, quotaHeaders } from '#server/api/authenticate'
import { CORS_HEADERS, corsPreflight } from '#server/api/cors'
import { apiError, apiJson } from '#server/api/response'
import { getPrisma } from '#server/db/prisma'
import {
  RATE_LIMIT_PER_IP,
  RATE_LIMIT_PER_KEY,
  RATE_LIMIT_PER_USER,
} from '#server/config'

/**
 * `GET /api/v1/me` - confirms a key works and reports the caller's quota.
 *
 * The first call anyone should make when integrating: it is the cheapest way to
 * tell "my key is wrong" from "the endpoint is wrong", and it reports how much of
 * the rate limit is left so a client can back off before it gets a 429.
 */
export const Route = createFileRoute('/api/v1/me')({
  server: {
    handlers: {
      OPTIONS: () => corsPreflight(),

      GET: async ({ request }) => {
        try {
          const auth = await authenticate(request.headers.get('authorization'))

          if (!auth.caller.userId) {
            throw new AppError(
              'UNAUTHENTICATED',
              'This endpoint requires an API key. Create one in Settings.',
            )
          }

          // Whether a Google grant is connected decides whether this account can
          // read private sheets, which is the single most useful thing to report
          // alongside a working key.
          const googleAccount = await getPrisma().googleAccount.findUnique({
            where: { userId: auth.caller.userId },
            select: { sub: true },
          })

          return apiJson(
            {
              user: { email: auth.caller.email },
              keyId: auth.caller.keyId,
              googleConnected: googleAccount !== null,
              limits: {
                perHour: auth.rateLimit?.limit ?? RATE_LIMIT_PER_KEY,
                remaining: auth.rateLimit?.remaining ?? null,
                scope: auth.rateLimit?.scope ?? 'key',
                accountPerHour: RATE_LIMIT_PER_USER,
                anonymousPerHour: RATE_LIMIT_PER_IP,
              },
            },
            { headers: { ...CORS_HEADERS, ...quotaHeaders(auth.rateLimit) } },
          )
        } catch (error) {
          return apiError(error, CORS_HEADERS)
        }
      },
    },
  },
})
