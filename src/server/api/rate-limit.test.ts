import { describe, expect, it } from 'bun:test'

import { AppError } from '#lib/errors'
import { checkRateLimit, pruneRateLimitBuckets } from '#server/api/rate-limit'
import { RATE_LIMIT_PER_IP, RATE_LIMIT_PER_KEY } from '#server/config'
import { getPrisma } from '#server/db/prisma'

/**
 * Rate limiting against a real database.
 *
 * Skipped when DATABASE_URL is not set. Limits are read from the environment at
 * import time, so the exhaustion test plants a counter at the limit directly
 * rather than driving thousands of real requests.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL)

/** A key unique to this run, so repeated runs do not share a counter. */
function unique(): string {
  return `test-${crypto.randomUUID()}`
}

/** The stored row id for a scope, matching what `checkRateLimit` builds. */
function storedId(scope: 'key' | 'user' | 'ip', key: string): string {
  return `${scope}:${key}`
}

/** Start of the current fixed window, as `checkRateLimit` computes it. */
function currentWindowStart(): Date {
  return new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000)
}

async function clear(...ids: string[]): Promise<void> {
  await getPrisma().rateLimitBucket.deleteMany({ where: { id: { in: ids } } })
}

describe.skipIf(!hasDatabase)('checkRateLimit', () => {
  it('allows a first request and reports the quota less that one', async () => {
    const keyId = unique()
    try {
      const result = await checkRateLimit({ keyId })

      expect(result.allowed).toBe(true)
      expect(result.scope).toBe('key')
      expect(result.limit).toBe(RATE_LIMIT_PER_KEY)
      expect(result.remaining).toBe(RATE_LIMIT_PER_KEY - 1)
      expect(result.retryAfterSeconds).toBeGreaterThan(0)
    } finally {
      await clear(storedId('key', keyId))
    }
  })

  it('decrements the remaining quota on each request', async () => {
    const keyId = unique()
    try {
      const first = await checkRateLimit({ keyId })
      const second = await checkRateLimit({ keyId })
      const third = await checkRateLimit({ keyId })

      expect(second.remaining).toBe(first.remaining - 1)
      expect(third.remaining).toBe(second.remaining - 1)
    } finally {
      await clear(storedId('key', keyId))
    }
  })

  it('enforces the tightest applicable limit', async () => {
    const key = unique()
    const user = unique()
    const ip = unique()
    try {
      const result = await checkRateLimit({ keyId: key, userId: user, ip })

      // The per-IP default sits far below the per-key one, so IP decides. It
      // reports the tightest tier's numbers, not whichever was checked last.
      expect(result.scope).toBe('ip')
      expect(result.limit).toBe(RATE_LIMIT_PER_IP)
      expect(result.remaining).toBe(RATE_LIMIT_PER_IP - 1)
    } finally {
      await clear(
        storedId('key', key),
        storedId('user', user),
        storedId('ip', ip),
      )
    }
  })

  it('counts every applicable tier, not just the one it reports', async () => {
    const key = unique()
    const ip = unique()
    try {
      await checkRateLimit({ keyId: key, ip })
      await checkRateLimit({ keyId: key, ip })

      // Both requests hit both buckets, so both are at two. A caller cannot dodge
      // a quota by spreading traffic across tiers.
      const rows = await getPrisma().rateLimitBucket.findMany({
        where: { id: { in: [storedId('key', key), storedId('ip', ip)] } },
        select: { id: true, count: true },
      })
      expect(rows).toHaveLength(2)
      expect(rows.every((row) => row.count === 2)).toBe(true)
    } finally {
      await clear(storedId('key', key), storedId('ip', ip))
    }
  })

  it('keeps different keys on independent counters', async () => {
    const a = unique()
    const b = unique()
    try {
      const first = await checkRateLimit({ keyId: a })
      const second = await checkRateLimit({ keyId: b })

      // One key's spending must not be charged to another.
      expect(second.remaining).toBe(first.remaining)
    } finally {
      await clear(storedId('key', a), storedId('key', b))
    }
  })

  it('refuses a request with no credential and no IP to attribute', async () => {
    // Nothing to meter against, so it cannot be let through unmetered.
    await expect(checkRateLimit({})).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    })
  })

  it('throws an AppError so a route can map it to a 429', async () => {
    try {
      await checkRateLimit({})
      throw new Error('expected a rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('RATE_LIMITED')
    }
  })

  it('reports the request as refused once the quota is exhausted', async () => {
    const keyId = unique()
    try {
      // Planted at the limit, so the very next request goes over.
      await getPrisma().rateLimitBucket.create({
        data: {
          id: storedId('key', keyId),
          windowStart: currentWindowStart(),
          count: RATE_LIMIT_PER_KEY,
        },
      })

      // `checkRateLimit` reports rather than throws; turning a refusal into a 429
      // is the route's job, because only it knows the response shape.
      const result = await checkRateLimit({ keyId })
      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
    } finally {
      await clear(storedId('key', keyId))
    }
  })

  it('allows the request that lands exactly on the limit', async () => {
    const keyId = unique()
    try {
      await getPrisma().rateLimitBucket.create({
        data: {
          id: storedId('key', keyId),
          windowStart: currentWindowStart(),
          count: RATE_LIMIT_PER_KEY - 1,
        },
      })

      const result = await checkRateLimit({ keyId })
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(0)
    } finally {
      await clear(storedId('key', keyId))
    }
  })

  it('starts a fresh window instead of carrying an old count over', async () => {
    const keyId = unique()
    try {
      // A window that closed an hour ago must not count against today.
      await getPrisma().rateLimitBucket.create({
        data: {
          id: storedId('key', keyId),
          windowStart: new Date(Date.now() - 7_200_000),
          count: 99_999,
        },
      })

      const result = await checkRateLimit({ keyId })
      expect(result.allowed).toBe(true)
    } finally {
      await clear(storedId('key', keyId))
    }
  })

  it('prunes closed windows but keeps the current one', async () => {
    const stale = unique()
    const current = unique()
    try {
      await getPrisma().rateLimitBucket.createMany({
        data: [
          {
            id: storedId('key', stale),
            windowStart: new Date(Date.now() - 7_200_000),
            count: 5,
          },
          {
            id: storedId('key', current),
            windowStart: currentWindowStart(),
            count: 5,
          },
        ],
      })

      await pruneRateLimitBuckets()

      const remaining = await getPrisma().rateLimitBucket.findMany({
        where: {
          id: { in: [storedId('key', stale), storedId('key', current)] },
        },
        select: { id: true },
      })
      expect(remaining.map((row) => row.id)).toEqual([storedId('key', current)])
    } finally {
      await clear(storedId('key', stale), storedId('key', current))
    }
  })
})
