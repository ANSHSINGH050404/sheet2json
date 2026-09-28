import { describe, expect, it } from 'bun:test'

import { AppError } from '#lib/errors'
import { hashToken, randomToken } from '#server/auth/crypto'
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  verifyApiKey,
} from '#server/auth/api-keys'
import { API_KEY_PREFIX } from '#server/config'
import { getPrisma } from '#server/db/prisma'

/**
 * Prisma/PostgreSQL integration tests. Skipped when DATABASE_URL is not set.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL)

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return 'NO_THROW'
  } catch (error) {
    return error instanceof AppError ? error.code : 'NOT_APP_ERROR'
  }
}

async function freshUser(): Promise<string> {
  const user = await getPrisma().user.create({
    data: { email: `keys-${crypto.randomUUID()}@example.test` },
    select: { id: true },
  })
  return user.id
}

describe.skipIf(!hasDatabase)('api keys', () => {
  it('creates a key that starts with the documented prefix', async () => {
    const userId = await freshUser()
    try {
      const created = await createApiKey(userId, 'Production')

      expect(created.key.startsWith(API_KEY_PREFIX)).toBe(true)
      // base64url of 32 bytes, unpadded.
      expect(created.key.length).toBe(API_KEY_PREFIX.length + 43)
      expect(created.name).toBe('Production')
      expect(created.revokedAt).toBeNull()
      expect(created.lastUsedAt).toBeNull()
    } finally {
      await getPrisma().user.deleteMany({ where: { id: userId } })
    }
  })

  it('stores only the digest, never the key', async () => {
    const userId = await freshUser()
    try {
      const created = await createApiKey(userId, 'Production')

      const row = await getPrisma().apiKey.findUnique({
        where: { id: created.id },
      })

      // A database leak must not yield a usable API key.
      expect(row?.keyHash).toBe(hashToken(created.key))
      expect(JSON.stringify(row)).not.toContain(created.key)
    } finally {
      await getPrisma().user.deleteMany({ where: { id: userId } })
    }
  })

  it("lists a user's keys newest first, without the secret", async () => {
    const userId = await freshUser()
    try {
      await createApiKey(userId, 'First')
      await createApiKey(userId, 'Second')

      const list = await listApiKeys(userId)

      expect(list.map((k) => k.name)).toEqual(['Second', 'First'])
      // The list must not carry the secret, or it would leak to anyone who can
      // read the page.
      expect(list.every((k) => !('key' in k))).toBe(true)
    } finally {
      await getPrisma().user.deleteMany({ where: { id: userId } })
    }
  })

  it("does not list another user's keys", async () => {
    const mine = await freshUser()
    const theirs = await freshUser()
    try {
      await createApiKey(mine, 'Mine')
      const theirKey = await createApiKey(theirs, 'Theirs')

      const list = await listApiKeys(mine)
      expect(list).toHaveLength(1)
      expect(list[0]?.name).toBe('Mine')
      void theirKey
    } finally {
      await getPrisma().user.deleteMany({
        where: { id: { in: [mine, theirs] } },
      })
    }
  })

  it('verifies a live key and resolves its owner', async () => {
    const userId = await freshUser()
    try {
      const created = await createApiKey(userId, 'Production')
      const owner = await verifyApiKey(created.key)

      expect(owner.userId).toBe(userId)
      expect(owner.keyId).toBe(created.id)
      expect(owner.email).toContain('@example.test')
    } finally {
      await getPrisma().user.deleteMany({ where: { id: userId } })
    }
  })

  it('never returns the same key twice', async () => {
    const userId = await freshUser()
    try {
      const keys = await Promise.all(
        Array.from({ length: 25 }, () => createApiKey(userId, 'bulk')),
      )
      expect(new Set(keys.map((k) => k.key)).size).toBe(25)
    } finally {
      await getPrisma().user.deleteMany({ where: { id: userId } })
    }
  })

  it('rejects a key that was never issued', async () => {
    expect(
      await code(verifyApiKey(`${API_KEY_PREFIX}${randomToken(32)}`)),
    ).toBe('UNAUTHENTICATED')
  })

  it('rejects a malformed key', async () => {
    expect(await code(verifyApiKey(''))).toBe('UNAUTHENTICATED')
    expect(await code(verifyApiKey('nope'))).toBe('UNAUTHENTICATED')
    expect(await code(verifyApiKey(`${API_KEY_PREFIX}short`))).toBe(
      'UNAUTHENTICATED',
    )
  })

  it('gives the same message for a revoked key and an unknown one', async () => {
    const userId = await freshUser()
    try {
      const created = await createApiKey(userId, 'Production')
      await revokeApiKey(userId, created.id)

      // Distinguishing the two would confirm that a guessed key exists.
      const revokedMessage = await message(verifyApiKey(created.key))
      const unknownMessage = await message(
        verifyApiKey(`${API_KEY_PREFIX}${randomToken(32)}`),
      )
      expect(revokedMessage).toBe(unknownMessage)
      expect(revokedMessage).not.toBe('')
    } finally {
      await getPrisma().user.deleteMany({ where: { id: userId } })
    }
  })

  it('stops verifying a key after it is revoked', async () => {
    const userId = await freshUser()
    try {
      const created = await createApiKey(userId, 'Production')
      expect(await code(verifyApiKey(created.key))).toBe('NO_THROW')

      expect(await revokeApiKey(userId, created.id)).toBe(true)
      expect(await code(verifyApiKey(created.key))).toBe('UNAUTHENTICATED')
    } finally {
      await getPrisma().user.deleteMany({ where: { id: userId } })
    }
  })

  it('keeps a revoked key in the list, marked as revoked', async () => {
    const userId = await freshUser()
    try {
      const created = await createApiKey(userId, 'Production')
      await revokeApiKey(userId, created.id)

      const list = await listApiKeys(userId)
      // Deleting the row would make "I revoked this" and "I never made this"
      // indistinguishable.
      expect(list).toHaveLength(1)
      expect(list[0]?.revokedAt).not.toBeNull()
    } finally {
      await getPrisma().user.deleteMany({ where: { id: userId } })
    }
  })

  it('reports whether a revocation actually did anything', async () => {
    const userId = await freshUser()
    try {
      const created = await createApiKey(userId, 'Production')

      expect(await revokeApiKey(userId, created.id)).toBe(true)
      // Revoking twice is a no-op, not an error.
      expect(await revokeApiKey(userId, created.id)).toBe(false)
    } finally {
      await getPrisma().user.deleteMany({ where: { id: userId } })
    }
  })

  it("does not let one user revoke another user's key", async () => {
    const mine = await freshUser()
    const theirs = await freshUser()
    try {
      const theirKey = await createApiKey(theirs, 'Theirs')

      expect(await revokeApiKey(mine, theirKey.id)).toBe(false)
      // Still usable by its real owner.
      expect(await code(verifyApiKey(theirKey.key))).toBe('NO_THROW')
    } finally {
      await getPrisma().user.deleteMany({
        where: { id: { in: [mine, theirs] } },
      })
    }
  })

  it('cascades keys when the user is deleted', async () => {
    const userId = await freshUser()
    const created = await createApiKey(userId, 'Production')

    await getPrisma().user.deleteMany({ where: { id: userId } })

    expect(await getPrisma().apiKey.count({ where: { id: created.id } })).toBe(
      0,
    )
  })
})

async function message(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return 'NO_THROW'
  } catch (error) {
    return error instanceof AppError ? error.message : 'NOT_APP_ERROR'
  }
}
