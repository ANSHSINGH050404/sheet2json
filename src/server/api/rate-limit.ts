import { AppError } from '#lib/errors'
import {
  RATE_LIMIT_PER_IP,
  RATE_LIMIT_PER_KEY,
  RATE_LIMIT_PER_USER,
} from '#server/config'
import { getPrisma } from '#server/db/prisma'

/**
 * Rate limiting.
 *
 * Counters live in the database rather than in process memory, because a
 * serverless deployment has many short-lived instances and a limit held in one
 * instance's memory is not a limit. The cost is one upsert per request.
 *
 * The model is a fixed window: simple, and accurate enough for abuse control.
 * Its known weakness is a burst across a window boundary, up to 2x the limit in a
 * few seconds, which is an acceptable trade for the complexity a sliding window
 * would add.
 */

/** The tiers, in the order they are checked. */
export interface RateLimitResult {
  /** Whether this request is allowed. */
  allowed: boolean
  /** The tier that decided the outcome. */
  scope: 'key' | 'user' | 'ip'
  /** Requests allowed in the current window. */
  limit: number
  /** Requests already used in the current window, including this one. */
  remaining: number
  /** Seconds until the current window rolls over. */
  retryAfterSeconds: number
}

const WINDOW_MS = 60 * 60 * 1000

/** Buckets older than this are swept opportunistically. */
const STALE_BUCKET_MS = 2 * WINDOW_MS

/**
 * Increments a bucket and reports the running total.
 *
 * A plain upsert would be wrong here. Its update clause cannot reset `count`
 * conditionally on `windowStart`, so once a bucket had been used its count would
 * carry across window boundaries and the caller would stay permanently limited.
 * Instead the increment is scoped to the current window, and a row that is
 * missing or stale is replaced:
 *
 *   1. Increment, but only where the row is already in this window.
 *   2. If that touched nothing, delete whatever is there and insert a fresh row.
 *
 * The one race this leaves is two requests both finding a stale row and both
 * inserting, where one create loses to the other's delete. The result is a count
 * that is briefly off by one, which is a far better failure than a limit that
 * never resets.
 */
async function hit(bucketId: string, limit: number): Promise<RateLimitResult> {
  const now = Date.now()
  const windowStart = new Date(Math.floor(now / WINDOW_MS) * WINDOW_MS)
  const scope = bucketId.split(':')[0] as RateLimitResult['scope']

  const incremented = await getPrisma().rateLimitBucket.updateMany({
    where: { id: bucketId, windowStart },
    data: { count: { increment: 1 } },
  })

  let count: number

  if (incremented.count > 0) {
    const row = await getPrisma().rateLimitBucket.findUnique({
      where: { id: bucketId },
      select: { count: true },
    })
    count = row?.count ?? 1
  } else {
    // Either the bucket is new or its window has rolled over. Either way the
    // previous count is meaningless now.
    await getPrisma().rateLimitBucket.deleteMany({ where: { id: bucketId } })
    await getPrisma().rateLimitBucket.create({
      data: { id: bucketId, windowStart, count: 1 },
    })
    count = 1
  }

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((windowStart.getTime() + WINDOW_MS - now) / 1000),
  )

  return {
    allowed: count <= limit,
    scope,
    limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds,
  }
}

/**
 * Applies every tier that applies to this request and enforces the strictest.
 *
 * All matching tiers are counted, not just the first, so a caller cannot dodge a
 * quota by spreading traffic across several of their own keys.
 */
export async function checkRateLimit(input: {
  keyId?: string
  userId?: string
  ip?: string
}): Promise<RateLimitResult> {
  const results: RateLimitResult[] = []

  if (input.keyId)
    results.push(await hit(`key:${input.keyId}`, RATE_LIMIT_PER_KEY))
  if (input.userId)
    results.push(await hit(`user:${input.userId}`, RATE_LIMIT_PER_USER))
  if (input.ip) results.push(await hit(`ip:${input.ip}`, RATE_LIMIT_PER_IP))

  // No credential and no IP to fall back on: the request is not one we can
  // account for, so it is refused rather than let through unmetered.
  if (results.length === 0) {
    throw new AppError('RATE_LIMITED', 'Too many requests. Try again shortly.')
  }

  // The tightest limit wins, and when several are exhausted the first one
  // reported is the most specific one - a per-key limit is more actionable to
  // the caller than a per-IP limit they do not control.
  const denied = results.find((result) => !result.allowed)
  if (denied) return denied

  return results.reduce((tightest, current) =>
    current.remaining < tightest.remaining ? current : tightest,
  )
}

/** Drops counters from windows that have already closed. */
export async function pruneRateLimitBuckets(): Promise<number> {
  const { count } = await getPrisma().rateLimitBucket.deleteMany({
    where: { windowStart: { lt: new Date(Date.now() - STALE_BUCKET_MS) } },
  })
  return count
}
