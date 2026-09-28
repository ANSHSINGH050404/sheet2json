import {
  deleteCookie as removeCookie,
  getCookie as readCookie,
  setCookie as writeCookie,
} from '@tanstack/react-start/server'

import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from '#server/auth/session'
import type { CookieAdapter } from '#server/auth/session'

/**
 * Binds the session module's `CookieAdapter` to the running Start server.
 *
 * Kept separate so `session.ts` itself never imports the server runtime, which
 * is what lets the session tests run without one. All the Start request helpers
 * resolve the current event from AsyncLocalStorage, so these calls are only valid
 * during a request.
 */
export const startCookies: CookieAdapter = {
  get: (name) => readCookie(name),
  set: (name, value, options) => writeCookie(name, value, options),
  delete: (name) =>
    removeCookie(name, { ...SESSION_COOKIE_OPTIONS, maxAge: 0 }),
}

export { SESSION_COOKIE }
