import { createServerFn } from '@tanstack/react-start'

import { createApiKey, listApiKeys, revokeApiKey } from '#server/auth/api-keys'
import { startCookies } from '#server/auth/cookies'
import { requireSessionUser } from '#server/auth/session'
import { toAppError } from '#lib/errors'
import { apiKeyIdSchema, apiKeyNameSchema } from '#lib/validation'
import type { ApiKeySummary, CreatedApiKey, Result } from '#lib/types'

/**
 * API key management for the settings page.
 *
 * Server functions, not API routes: these act on the browser session and are
 * never meant to be called with an API key, since a key that can mint more keys
 * is a privilege escalation waiting to happen.
 *
 * Every handler re-derives the user from the session cookie rather than
 * accepting a user id, so a caller cannot act on someone else's keys.
 */

/** A user's keys. Revoked keys are included so the UI can show them as revoked. */
export const listApiKeysFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Result<ApiKeySummary[]>> => {
    try {
      const user = await requireSessionUser(startCookies)
      return { ok: true, data: await listApiKeys(user.id) }
    } catch (error) {
      return { ok: false, error: toAppError(error) }
    }
  },
)

/**
 * Mints a key. The plaintext key is in the response and nowhere else - it cannot
 * be recovered afterwards, only replaced.
 */
export const createApiKeyFn = createServerFn({ method: 'POST' })
  .validator(apiKeyNameSchema)
  .handler(async ({ data }): Promise<Result<CreatedApiKey>> => {
    try {
      const user = await requireSessionUser(startCookies)
      return { ok: true, data: await createApiKey(user.id, data.name) }
    } catch (error) {
      return { ok: false, error: toAppError(error) }
    }
  })

/** Revokes a key. Scoped to the owner, so another user's key id is a no-op. */
export const revokeApiKeyFn = createServerFn({ method: 'POST' })
  .validator(apiKeyIdSchema)
  .handler(async ({ data }): Promise<Result<{ revoked: boolean }>> => {
    try {
      const user = await requireSessionUser(startCookies)
      return { ok: true, data: { revoked: await revokeApiKey(user.id, data) } }
    } catch (error) {
      return { ok: false, error: toAppError(error) }
    }
  })
