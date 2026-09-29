import { describe, expect, it } from 'bun:test'

import { AppError } from '#lib/errors'
import { corsOrRetry, requireApiUserId } from '#server/api/route-helpers'
import type { RateLimitResult } from '#server/api/rate-limit'

const exhaustedLimit: RateLimitResult = {
  allowed: false,
  scope: 'key',
  limit: 1000,
  remaining: 0,
  retryAfterSeconds: 37,
}

describe('requireApiUserId', () => {
  it('returns the authenticated owner id', () => {
    expect(requireApiUserId('owner-id')).toBe('owner-id')
  })

  it('rejects callers without an API key owner', () => {
    expect(() => requireApiUserId(null)).toThrow(
      'This endpoint requires an API key. Create one in Settings.',
    )
  })
})

describe('corsOrRetry', () => {
  it('adds Retry-After only for a rate limit error', () => {
    expect(
      corsOrRetry(new AppError('RATE_LIMITED', 'rate limited'), exhaustedLimit),
    ).toMatchObject({
      'access-control-allow-origin': '*',
      'Retry-After': '37',
    })

    expect(corsOrRetry(new Error('other error'), exhaustedLimit)).toEqual({
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-max-age': '600',
    })
  })
})
