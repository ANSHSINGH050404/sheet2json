import { createServerFn } from '@tanstack/react-start'

import { startCookies } from '#server/auth/cookies'
import type { SessionUser } from '#server/auth/session'
import {
  getSessionUser as readSessionUser,
  requireSessionUser,
} from '#server/auth/session'
import { toAppError } from '#lib/errors'
import {
  deleteExtraction,
  extractSheet,
  getExtraction,
  getExtractions,
} from '#server/services/extraction'
import { extractionIdSchema, extractInputSchema } from '#lib/validation'
import type { ExtractionDetail, ExtractionSummary, Result } from '#lib/types'

/**
 * The extraction endpoints the browser UI uses.
 *
 * Google Sheets and the database are touched exclusively inside these handlers,
 * which the Start compiler strips from the client bundle.
 *
 * Handlers return a `Result` union rather than throwing, so the UI always has a
 * message that is safe to display. The original error - stack, upstream response
 * body, and anything Google returned - is logged server-side and never
 * serialised.
 */

/** The signed-in user, or null. Read by the shell and the settings page. */
export const getSessionUserFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Result<SessionUser | null>> => {
    try {
      return { ok: true, data: await readSessionUser(startCookies) }
    } catch (error) {
      return { ok: false, error: toAppError(error) }
    }
  },
)

/**
 * Extracts a sheet.
 *
 * A signed-in user is attributed, and their Google grant is used when connected,
 * which is what makes a private sheet readable. An anonymous visitor can still
 * extract a public sheet - the result is simply not stored anywhere.
 */
export const extractSheetFn = createServerFn({ method: 'POST' })
  .validator(extractInputSchema)
  .handler(async ({ data }): Promise<Result<ExtractionDetail>> => {
    try {
      const user = await readSessionUser(startCookies)
      const extraction = await extractSheet(data.url, {
        ...(user ? { userId: user.id } : {}),
        // No account means nowhere to file the result, so nothing is written.
        persist: Boolean(user),
      })
      return { ok: true, data: extraction }
    } catch (error) {
      return { ok: false, error: toAppError(error) }
    }
  })

/**
 * The signed-in user's own extractions, newest first.
 *
 * Requires a session: history is per-user now, so there is no anonymous answer to
 * give. The UI hides the history links until someone is signed in.
 */
export const listExtractionsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Result<ExtractionSummary[]>> => {
    try {
      const user = await requireSessionUser(startCookies)
      return { ok: true, data: await getExtractions(user.id) }
    } catch (error) {
      return { ok: false, error: toAppError(error) }
    }
  },
)

/** A single extraction, readable only by its owner. */
export const getExtractionFn = createServerFn({ method: 'GET' })
  .validator(extractionIdSchema)
  .handler(async ({ data }): Promise<Result<ExtractionDetail>> => {
    try {
      const user = await requireSessionUser(startCookies)
      return { ok: true, data: await getExtraction(data, user.id) }
    } catch (error) {
      return { ok: false, error: toAppError(error) }
    }
  })

/** Deletes one of the signed-in user's extractions. */
export const deleteExtractionFn = createServerFn({ method: 'POST' })
  .validator(extractionIdSchema)
  .handler(async ({ data }): Promise<Result<{ deleted: boolean }>> => {
    try {
      const user = await requireSessionUser(startCookies)
      return {
        ok: true,
        data: { deleted: await deleteExtraction(data, user.id) },
      }
    } catch (error) {
      return { ok: false, error: toAppError(error) }
    }
  })
