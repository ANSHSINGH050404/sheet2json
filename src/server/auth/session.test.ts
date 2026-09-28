import { describe, expect, it } from 'bun:test'

import { AppError } from '#lib/errors'
import { hashToken } from '#server/auth/crypto'
import {
  createSession,
  destroySession,
  getSessionUser,
  pruneExpiredSessions,
  requireSessionUser,
  SESSION_COOKIE,
} from '#server/auth/session'
import type { CookieAdapter } from '#server/auth/session'
import { getPrisma } from '#server/db/prisma'

/**
 * Prisma/PostgreSQL integration tests. Skipped when DATABASE_URL is not set, so
 * `bun test` still passes on a fresh clone.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL)

/**
 * A cookie jar in memory.
 *
 * `session.ts` takes its cookie access as an argument precisely so these rules
 * can be tested without a running server.
 */
function memoryCookies(initial: Record<string, string> = {}) {
  const jar = new Map(Object.entries(initial))
  const adapter: CookieAdapter = {
    get: (name) => jar.get(name),
    set: (name, value) => {
      jar.set(name, value)
    },
    delete: (name) => {
      jar.delete(name)
    },
  }
  return { adapter, jar }
}

/**
 * A throwaway user per test.
 *
 * Not a shared one, because `createSession` deliberately only replaces the
 * session in the caller's own cookie - signing in on one device must not sign you
 * out on another. Sessions therefore accumulate per user, and a shared user would
 * make the counts in these tests depend on test order.
 */
async function freshUser(): Promise<string> {
  const user = await getPrisma().user.create({
    data: {
      email: `session-${crypto.randomUUID()}@example.test`,
      googleAccount: { create: { sub: `session-${crypto.randomUUID()}` } },
    },
    select: { id: true },
  })
  return user.id
}

/** Creates a user, runs the body, then deletes the user (sessions cascade). */
async function withUser<T>(body: (userId: string) => Promise<T>): Promise<T> {
  const userId = await freshUser()
  try {
    return await body(userId)
  } finally {
    await getPrisma().user.deleteMany({ where: { id: userId } })
  }
}

describe.skipIf(!hasDatabase)('sessions', () => {
  it('issues a cookie and resolves the user from it', async () => {
    await withUser(async (userId) => {
      const { adapter, jar } = memoryCookies()

      await createSession(userId, adapter)
      expect(jar.get(SESSION_COOKIE)).toBeDefined()

      const user = await getSessionUser(adapter)
      expect(user?.id).toBe(userId)
      expect(user?.email).toContain('@example.test')
    })
  })

  it('never stores the raw token, only its digest', async () => {
    await withUser(async (userId) => {
      const { adapter, jar } = memoryCookies()
      await createSession(userId, adapter)
      const token = jar.get(SESSION_COOKIE) as string

      const rows = await getPrisma().session.findMany({ where: { userId } })
      // A database leak must not yield a usable session.
      expect(rows).toHaveLength(1)
      expect(rows[0]?.tokenHash).toBe(hashToken(token))
      expect(rows[0]?.tokenHash).not.toBe(token)
    })
  })

  it('resolves to null with no cookie', async () => {
    const { adapter } = memoryCookies()
    expect(await getSessionUser(adapter)).toBeNull()
  })

  it('resolves to null for a token that matches no session', async () => {
    const { adapter } = memoryCookies({
      [SESSION_COOKIE]: 'not-a-real-session-token',
    })
    expect(await getSessionUser(adapter)).toBeNull()
  })

  it('deletes an expired session on sight', async () => {
    await withUser(async (userId) => {
      const { adapter } = memoryCookies()
      await createSession(userId, adapter)

      await getPrisma().session.updateMany({
        where: { userId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      })

      expect(await getSessionUser(adapter)).toBeNull()

      // And the row is gone, so the stale cookie cannot be replayed.
      expect(await getPrisma().session.count({ where: { userId } })).toBe(0)
    })
  })

  it('replaces only the current session when signing in again', async () => {
    await withUser(async (userId) => {
      // Two browsers, two cookies, one account.
      const phone = memoryCookies()
      const laptop = memoryCookies()
      await createSession(userId, phone.adapter)
      await createSession(userId, laptop.adapter)

      const phoneToken = phone.jar.get(SESSION_COOKIE)
      const laptopToken = laptop.jar.get(SESSION_COOKIE)
      expect(phoneToken).not.toBe(laptopToken)

      // Signing in again on the phone rotates that session only.
      await createSession(userId, phone.adapter)
      const newPhoneToken = phone.jar.get(SESSION_COOKIE)
      expect(newPhoneToken).not.toBe(phoneToken)

      // The laptop session is untouched - signing in somewhere must not sign you
      // out everywhere.
      expect(await getSessionUser(laptop.adapter)).not.toBeNull()
      expect(await getSessionUser(phone.adapter)).not.toBeNull()
      expect(await getPrisma().session.count({ where: { userId } })).toBe(2)
    })
  })

  it('destroys the session and clears the cookie on sign out', async () => {
    await withUser(async (userId) => {
      const { adapter, jar } = memoryCookies()
      await createSession(userId, adapter)

      await destroySession(adapter)

      expect(jar.has(SESSION_COOKIE)).toBe(false)
      expect(await getSessionUser(adapter)).toBeNull()
      expect(await getPrisma().session.count({ where: { userId } })).toBe(0)
    })
  })

  it('is a no-op to sign out without a session', async () => {
    const { adapter } = memoryCookies()
    await destroySession(adapter)
    expect(await getSessionUser(adapter)).toBeNull()
  })

  it('throws UNAUTHENTICATED from requireSessionUser when anonymous', async () => {
    const { adapter } = memoryCookies()
    try {
      await requireSessionUser(adapter)
      throw new Error('expected a rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('UNAUTHENTICATED')
    }
  })

  it('reports googleConnected false when no grant exists', async () => {
    const user = await getPrisma().user.create({
      data: { email: `nogrant-${crypto.randomUUID()}@example.test` },
      select: { id: true },
    })

    try {
      const { adapter } = memoryCookies()
      await createSession(user.id, adapter)
      expect((await getSessionUser(adapter))?.googleConnected).toBe(false)
    } finally {
      await getPrisma().user.deleteMany({ where: { id: user.id } })
    }
  })

  it('prunes expired sessions', async () => {
    await withUser(async (userId) => {
      const { adapter } = memoryCookies()
      await createSession(userId, adapter)
      await getPrisma().session.updateMany({
        where: { userId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      })

      expect(await pruneExpiredSessions()).toBeGreaterThanOrEqual(1)
      expect(await getPrisma().session.count({ where: { userId } })).toBe(0)
    })
  })

  it('cascades sessions when the user is deleted', async () => {
    const userId = await freshUser()
    const { adapter } = memoryCookies()
    await createSession(userId, adapter)
    expect(await getPrisma().session.count({ where: { userId } })).toBe(1)

    await getPrisma().user.deleteMany({ where: { id: userId } })
    expect(await getPrisma().session.count({ where: { userId } })).toBe(0)
  })
})
