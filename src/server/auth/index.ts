/**
 * Session, key and token primitives, re-exported from one place.
 *
 * Server code that needs more than one of these gets a single import, and the
 * modules themselves stay independently importable by their tests.
 */
export {
  createApiKey,
  listApiKeys,
  markApiKeyUsed,
  revokeApiKey,
  verifyApiKey,
} from '#server/auth/api-keys'
export {
  decryptToken,
  encryptToken,
  hashToken,
  randomToken,
  safeEqual,
} from '#server/auth/crypto'
export { startCookies } from '#server/auth/cookies'
export { disconnectGoogle } from '#server/auth/oauth-callback'
export { consumeState, startAuth } from '#server/auth/oauth-start'
export {
  createSession,
  destroySession,
  getSessionUser,
  pruneExpiredSessions,
  requireSessionUser,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
} from '#server/auth/session'

export type {
  ApiKeyOwner,
  ApiKeySummary,
  CreatedApiKey,
} from '#server/auth/api-keys'
export type { CookieAdapter, SessionUser } from '#server/auth/session'
