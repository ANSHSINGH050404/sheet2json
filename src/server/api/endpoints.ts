import { createServerFn } from '@tanstack/react-start'

import { toAppError } from '#lib/errors'
import {
  savedEndpointIdSchema,
  savedEndpointInputSchema,
} from '#lib/validation'
import type { Result, SavedEndpointSummary } from '#lib/types'
import { startCookies } from '#server/auth/cookies'
import { requireSessionUser } from '#server/auth/session'
import {
  createSavedEndpoint,
  deleteSavedEndpoint,
  listSavedEndpoints,
} from '#server/services/endpoints'

/** Browser-session endpoints for creating and managing live API recipes. */

export const createSavedEndpointFn = createServerFn({ method: 'POST' })
  .validator(savedEndpointInputSchema)
  .handler(async ({ data }): Promise<Result<SavedEndpointSummary>> => {
    try {
      const user = await requireSessionUser(startCookies)
      return {
        ok: true,
        data: await createSavedEndpoint(user.id, data),
      }
    } catch (error) {
      return { ok: false, error: toAppError(error) }
    }
  })

export const listSavedEndpointsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Result<SavedEndpointSummary[]>> => {
    try {
      const user = await requireSessionUser(startCookies)
      return { ok: true, data: await listSavedEndpoints(user.id) }
    } catch (error) {
      return { ok: false, error: toAppError(error) }
    }
  },
)

export const deleteSavedEndpointFn = createServerFn({ method: 'POST' })
  .validator(savedEndpointIdSchema)
  .handler(async ({ data }): Promise<Result<{ deleted: boolean }>> => {
    try {
      const user = await requireSessionUser(startCookies)
      return {
        ok: true,
        data: { deleted: await deleteSavedEndpoint(data, user.id) },
      }
    } catch (error) {
      return { ok: false, error: toAppError(error) }
    }
  })
