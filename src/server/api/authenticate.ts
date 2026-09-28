import { createHash } from 'node:crypto'

import { getRequestIP } from '@tanstack/react-start/server'

import { AppError } from '#lib/errors'
import { markApiKeyUsed, verifyApiKey } from '#server/auth/api-keys'
import { checkRateLimit } from '#server/api/rate-limit'
import type { RateLimitResult } from '#server/api/rate-limit'
import { RATE_LIMIT_PER_IP } from '#server/config'

/**
 * Authenticating an API request.
 *
 * The API is authenticated by key, not by session cookie. A key in an
 * `Authorization` header is what a script, a webhook, or a Zapier step can
 * actually send, and it keeps the API working identically from a server, a
 * browser, or a cron job.
 *
 * A request with no key is allowed through, under a much smaller per-IP budget.
 * That keeps the read-only extraction endpoint usable for an unauthenticated
 * `curl` - the fastest way for a new user to see the thing work - while making
 * abuse expensive. Anything that touches stored data requires a key.
 */

/** Headers returned on every API response, so clients can see their usage. */
export type QuotaHeaders = Record<string, string>

export interface ApiCaller {
  /** The authenticated user, or null for an unauthenticated request. */
  userId: string | null
  keyId: string | null
  email: string | null
}

export interface AuthenticatedRequest {
  caller: ApiCaller
  /** Null when unauthenticated, in which case only the IP tier applies. */
  rateLimit: RateLimitResult | null
}

/**
 * Reads the caller's IP.
 *
 * `xForwardedFor` is enabled because the app is expected to sit behind a proxy
 * (Vercel, any CDN) that sets it - without it every request would share the
 * proxy's address and the per-IP limit would be a global limit.
 */
export function clientIp(): string | undefined {
  return getRequestIP({ xForwardedFor: true })
}

/**
 * Normalises a forwarded address.
 *
 * `X-Forwarded-For` is a comma-separated chain, client first. An attacker can put
 * anything in it, so the value is only ever used as an opaque bucket key - never
 * parsed for meaning, and never trusted to be a real address.
 */
export function bucketForIp(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const first = raw.split(',')[0]?.trim()
  if (!first) return undefined
  return createHash('sha256').update(first, 'utf8').digest('hex').slice(0, 32)
}

/** Pulls the key out of an `Authorization: Bearer <key>` header. */
export function readBearerKey(header: string | null): string | null {
  if (!header) return null
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  return match?.[1] ?? null
}

/**
 * Authenticates a request and applies the rate limit.
 *
 * A present-but-invalid key is a hard failure. Falling back to the anonymous
 * budget would let a revoked key keep working, just more slowly.
 */
export async function authenticate(
  authorization: string | null,
): Promise<AuthenticatedRequest> {
  const presented = readBearerKey(authorization)
  const ip = bucketForIp(clientIp())

  if (presented === null) {
    const rateLimit = await checkRateLimit({ ...(ip ? { ip } : {}) })
    if (!rateLimit.allowed) {
      throw new AppError(
        'RATE_LIMITED',
        'Rate limit exceeded. Try again later.',
      )
    }
    return { caller: { userId: null, keyId: null, email: null }, rateLimit }
  }

  const owner = await verifyApiKey(presented)

  const rateLimit = await checkRateLimit({
    keyId: owner.keyId,
    userId: owner.userId,
    ...(ip ? { ip } : {}),
  })
  if (!rateLimit.allowed) {
    throw new AppError('RATE_LIMITED', 'Rate limit exceeded. Try again later.')
  }

  // Bookkeeping, deliberately after the limit check so a rejected request does
  // not make a key look used.
  await markApiKeyUsed(owner.keyId)

  return {
    caller: { userId: owner.userId, keyId: owner.keyId, email: owner.email },
    rateLimit,
  }
}

/**
 * Requires an authenticated caller.
 *
 * Used by every endpoint that reads or writes stored data. The extraction
 * endpoint is the only one that tolerates anonymous callers.
 */
export function requireApiCaller(request: AuthenticatedRequest): ApiCaller {
  if (!request.caller.userId || !request.caller.keyId) {
    throw new AppError(
      'UNAUTHENTICATED',
      'This endpoint requires an API key. Create one in Settings.',
    )
  }
  return request.caller
}

/**
 * Rate-limit headers for a response.
 *
 * The standard `RateLimit-*` names are used, with the legacy `X-RateLimit-*`
 * spellings alongside them, because plenty of HTTP clients still read the older
 * ones and a client that cannot see its remaining quota is a client that
 * discovers the limit the hard way.
 */
export function quotaHeaders(limit: RateLimitResult | null): QuotaHeaders {
  if (!limit) return {}

  const limitValue = String(limit.limit)
  const remaining = String(limit.remaining)

  return {
    'RateLimit-Limit': limitValue,
    'RateLimit-Remaining': remaining,
    'RateLimit-Reset': String(
      Math.floor(Date.now() / 1000) + limit.retryAfterSeconds,
    ),
    'X-RateLimit-Limit': limitValue,
    'X-RateLimit-Remaining': remaining,
    // `Retry-After` is only meaningful on a 429, so it is added there.
  }
}

/** The `Retry-After` header for a rejected request. */
export function retryAfterHeader(limit: RateLimitResult | null): QuotaHeaders {
  if (!limit) return {}
  return { 'Retry-After': String(limit.retryAfterSeconds) }
}

/** The unauthenticated budget, for the API documentation page. */
export const ANONYMOUS_HOURLY_LIMIT = RATE_LIMIT_PER_IP
