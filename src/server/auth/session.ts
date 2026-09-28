import { AppError } from '#lib/errors'
import { hashToken, randomToken } from '#server/auth/crypto'
import { SESSION_TTL_DAYS } from '#server/config'
import { getPrisma } from '#server/db/prisma'

/**
 * Server-side session handling.
 *
 * The browser holds a random 256-bit token in an httpOnly cookie; the database
 * holds only its SHA-256 digest. A database leak therefore yields nothing
 * replayable, and the raw token never exists anywhere except the caller's
 * cookie jar.
 *
 * Cookie access is injected rather than imported from the Start server helpers.
 * That keeps this module testable without a live server, and it means the cookie
 * attributes are decided in exactly one place.
 */

export const SESSION_COOKIE = 's2j_session'

/**
 * Attributes for the session cookie: readable only by the server, sent on
 * same-site navigations, scoped to the whole app.
 *
 * `secure` follows the environment. Production traffic is always HTTPS, and
 * marking a cookie secure on a plain-http dev server would silently break
 * sign-in locally.
 */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
} as const

/** The subset of a signed-in user the UI needs. Never includes tokens. */
export interface SessionUser {
  id: string
  email: string
  name: string | null
  avatarUrl: string | null
  /** Whether this account holds a Google grant for reading private sheets. */
  googleConnected: boolean
}

/** The cookie operations this module needs, so tests can supply their own. */
export interface CookieAdapter {
  get: (name: string) => string | undefined
  set: (
    name: string,
    value: string,
    options: typeof SESSION_COOKIE_OPTIONS,
  ) => void
  delete: (name: string) => void
}

function sessionExpiry(): Date {
  return new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)
}

/**
 * Signs a user in with a fresh session.
 *
 * Any existing session is destroyed first: signing in as someone else must not
 * leave the previous user's session valid in the same browser.
 */
export async function createSession(
  userId: string,
  cookies: CookieAdapter,
): Promise<void> {
  await destroySession(cookies)

  const token = randomToken()
  await getPrisma().session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt: sessionExpiry() },
  })

  cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS)
}

/** Signs the current user out. A no-op when there is no session. */
export async function destroySession(cookies: CookieAdapter): Promise<void> {
  const token = cookies.get(SESSION_COOKIE)
  if (token) {
    // Deleted by digest rather than by the cookie's own expiry: a token that
    // matches no row is simply a no-op, which keeps this free of error cases.
    await getPrisma().session.deleteMany({
      where: { tokenHash: hashToken(token) },
    })
  }
  cookies.delete(SESSION_COOKIE)
}

/**
 * Resolves the signed-in user from the session cookie, or null when anonymous.
 *
 * An expired row is deleted on sight, so a stale cookie cannot be reused and the
 * table does not accumulate dead rows.
 */
export async function getSessionUser(
  cookies: CookieAdapter,
): Promise<SessionUser | null> {
  const token = cookies.get(SESSION_COOKIE)
  if (!token) return null

  const record = await getPrisma().session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      expiresAt: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          avatarUrl: true,
          googleAccount: { select: { sub: true } },
        },
      },
    },
  })

  if (!record) return null

  if (record.expiresAt.getTime() <= Date.now()) {
    await getPrisma().session.deleteMany({ where: { id: record.id } })
    return null
  }

  return {
    id: record.user.id,
    email: record.user.email,
    name: record.user.name,
    avatarUrl: record.user.avatarUrl,
    googleConnected: record.user.googleAccount !== null,
  }
}

/**
 * Like `getSessionUser`, but throws instead of returning null.
 *
 * For anything that must not silently fall back to anonymous access.
 */
export async function requireSessionUser(
  cookies: CookieAdapter,
): Promise<SessionUser> {
  const user = await getSessionUser(cookies)
  if (!user) {
    throw new AppError('UNAUTHENTICATED', 'Please sign in to continue.')
  }
  return user
}

/** Deletes every expired session. Suitable for a daily cron. */
export async function pruneExpiredSessions(): Promise<number> {
  const { count } = await getPrisma().session.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  })
  return count
}
