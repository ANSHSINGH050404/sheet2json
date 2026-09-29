import { AppError } from '#lib/errors'
import { retryAfterHeader } from '#server/api/authenticate'
import { CORS_HEADERS } from '#server/api/cors'
import type { RateLimitResult } from '#server/api/rate-limit'

/** Returns the owner id or rejects an API request without a valid key. */
export function requireApiUserId(userId: string | null): string {
  if (!userId) {
    throw new AppError(
      'UNAUTHENTICATED',
      'This endpoint requires an API key. Create one in Settings.',
    )
  }
  return userId
}

/** CORS headers for normal errors, plus Retry-After for a rate-limit response. */
export function corsOrRetry(
  error: unknown,
  rateLimit: RateLimitResult | null,
): Record<string, string> {
  return error instanceof AppError && error.code === 'RATE_LIMITED'
    ? { ...CORS_HEADERS, ...retryAfterHeader(rateLimit) }
    : CORS_HEADERS
}
