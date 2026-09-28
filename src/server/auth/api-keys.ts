import { AppError } from '#lib/errors'
import { hashToken, randomToken } from '#server/auth/crypto'
import { API_KEY_BYTES, API_KEY_PREFIX } from '#server/config'
import { getPrisma } from '#server/db/prisma'

/**
 * API key issuance and verification.
 *
 * A key is 32 random bytes rendered base64url behind a fixed `s2j_` prefix, so a
 * key found in a leaked config is self-identifying: whoever reads it can tell
 * what it is and where it belongs.
 *
 * Only the SHA-256 digest is stored. Verifying a presented key is therefore one
 * indexed lookup on that unique digest - never a scan over every key - and the
 * comparison itself is constant-time.
 */

const INVALID_KEY_MESSAGE =
  'That API key is not valid. Check the key in /settings, and create a new one if it was revoked.'

/** A key as stored, minus the secret. Safe to render in the key list. */
export interface ApiKeySummary {
  id: string
  name: string
  /** Public head of the key, enough to tell two keys apart in a list. */
  prefix: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

/** A newly created key. `key` is present exactly once, at creation. */
export interface CreatedApiKey extends ApiKeySummary {
  key: string
}

function summary(record: {
  id: string
  name: string
  prefix: string
  createdAt: Date
  lastUsedAt: Date | null
  revokedAt: Date | null
}): ApiKeySummary {
  return {
    id: record.id,
    name: record.name,
    prefix: record.prefix,
    createdAt: record.createdAt.toISOString(),
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    revokedAt: record.revokedAt?.toISOString() ?? null,
  }
}

/**
 * Mints a key for a user.
 *
 * The plaintext key is returned here and never again - it is not recoverable
 * from the digest, and not stored.
 */
export async function createApiKey(
  userId: string,
  name: string,
): Promise<CreatedApiKey> {
  const secret = randomToken(API_KEY_BYTES)
  const key = `${API_KEY_PREFIX}${secret}`

  const record = await getPrisma().apiKey.create({
    data: {
      userId,
      name,
      // The first characters of the random part, so the key is identifiable in a
      // list without revealing anything useful.
      prefix: key.slice(0, API_KEY_PREFIX.length + 6),
      keyHash: hashToken(key),
    },
    select: {
      id: true,
      name: true,
      prefix: true,
      createdAt: true,
      lastUsedAt: true,
      revokedAt: true,
    },
  })

  return { ...summary(record), key }
}

/** A user's keys, newest first. Revoked keys are included so they can be shown
 *  as revoked rather than silently disappearing. */
export async function listApiKeys(userId: string): Promise<ApiKeySummary[]> {
  const records = await getPrisma().apiKey.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      prefix: true,
      createdAt: true,
      lastUsedAt: true,
      revokedAt: true,
    },
  })

  return records.map(summary)
}

/**
 * Revokes a key.
 *
 * Sets `revokedAt` rather than deleting the row: the record is what lets a user
 * tell "I revoked this on Tuesday" from "I never made this". Scoped to the owner
 * so one user cannot revoke another's key even with a valid id.
 *
 * Returns whether a live key was actually revoked.
 */
export async function revokeApiKey(
  userId: string,
  keyId: string,
): Promise<boolean> {
  const { count } = await getPrisma().apiKey.updateMany({
    where: { id: keyId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  return count > 0
}

/** The owner of a verified, unrevoked key. */
export interface ApiKeyOwner {
  keyId: string
  userId: string
  email: string
  name: string | null
}

/**
 * Verifies a presented key and resolves its owner.
 *
 * Throws `UNAUTHENTICATED` for anything unusable - malformed, unknown, revoked -
 * with a single message for all three. Distinguishing them would confirm that a
 * guessed key exists, which is exactly the information an attacker is probing
 * for.
 */
export async function verifyApiKey(presented: string): Promise<ApiKeyOwner> {
  if (!presented.startsWith(API_KEY_PREFIX) || presented.length < 32) {
    throw new AppError('UNAUTHENTICATED', INVALID_KEY_MESSAGE)
  }

  // One indexed lookup on the unique digest. The stored `prefix` is not needed
  // to find the row, since the full key already hashes to a unique value;
  // comparing it as well would only narrow an already-single result.
  const record = await getPrisma().apiKey.findUnique({
    where: { keyHash: hashToken(presented) },
    select: {
      id: true,
      userId: true,
      revokedAt: true,
      user: { select: { email: true, name: true } },
    },
  })

  // A revoked key and an unknown key fail identically, with the same message.
  // Reporting them differently would confirm to a prober that a guessed key
  // exists, which is exactly the thing being probed for.
  if (!record || record.revokedAt !== null) {
    throw new AppError('UNAUTHENTICATED', INVALID_KEY_MESSAGE)
  }

  return {
    keyId: record.id,
    userId: record.userId,
    email: record.user.email,
    name: record.user.name,
  }
}

/**
 * Stamps `lastUsedAt` on a key that just authenticated a request.
 *
 * Best effort by design: this is bookkeeping for the key list, and failing the
 * caller's request because the timestamp did not write would be a poor trade.
 */
export async function markApiKeyUsed(keyId: string): Promise<void> {
  try {
    await getPrisma().apiKey.updateMany({
      where: { id: keyId, revokedAt: null },
      data: { lastUsedAt: new Date() },
    })
  } catch (error) {
    console.warn('[api-keys] could not update lastUsedAt', error)
  }
}
