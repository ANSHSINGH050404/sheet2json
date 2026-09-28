import { createServerFn } from '@tanstack/react-start'

import { startCookies } from '#server/auth/cookies'
import { disconnectGoogle } from '#server/auth/oauth-callback'
import { destroySession, getSessionUser } from '#server/auth/session'
import { toAppError } from '#lib/errors'
import { isGoogleAuthConfigured } from '#server/config'
import type { Result, SessionUser } from '#lib/types'

/**
 * Session and Google-account operations the UI needs.
 *
 * Server functions rather than API routes, because they act on the browser's own
 * cookie. That also means they inherit TanStack Start's CSRF protection, which
 * does not apply to raw route handlers - signing out is a POST for the same
 * reason.
 */

/** The signed-in user, or null. Used by the shell to render the header. */
export const getSessionUserFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Result<SessionUser | null>> => {
    try {
      return { ok: true, data: await getSessionUser(startCookies) }
    } catch (error) {
      return { ok: false, error: toAppError(error) }
    }
  },
)

/** Whether this deployment offers Google sign-in at all. */
export const getAuthConfigFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Result<{ googleAuthEnabled: boolean }>> => {
    try {
      return { ok: true, data: { googleAuthEnabled: isGoogleAuthConfigured() } }
    } catch (error) {
      return { ok: false, error: toAppError(error) }
    }
  },
)

/**
 * Signs the user out.
 *
 * A POST, so a stray link or an image tag cannot log someone out and so the
 * request passes the same-origin check that guards the other server functions.
 */
export const signOutFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<Result<{ signedOut: true }>> => {
    try {
      await destroySession(startCookies)
      return { ok: true, data: { signedOut: true } }
    } catch (error) {
      return { ok: false, error: toAppError(error) }
    }
  },
)

/**
 * Disconnects the Google grant without signing out.
 *
 * The account and its history are untouched; only the permission to read the
 * user's spreadsheets goes away. Private-sheet extraction stops working until
 * they connect again.
 */
export const disconnectGoogleFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<Result<{ disconnected: true }>> => {
    try {
      const user = await getSessionUser(startCookies)
      if (!user) {
        return {
          ok: false,
          error: {
            code: 'UNAUTHENTICATED',
            message: 'Please sign in to continue.',
          },
        }
      }
      await disconnectGoogle(user.id)
      return { ok: true, data: { disconnected: true } }
    } catch (error) {
      return { ok: false, error: toAppError(error) }
    }
  },
)
