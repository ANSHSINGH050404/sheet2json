import { createServerFn } from '@tanstack/react-start'

import { z } from 'zod'

import {
  SEMANTIC_SEARCH_MAX_ROWS,
  SHEET_AGENT_MAX_PROMPT_LENGTH,
} from '#lib/constants'
import { AppError, toAppError } from '#lib/errors'
import type { Result, SheetRow } from '#lib/types'
import { bucketForIp, clientIp } from '#server/api/authenticate'
import { checkRateLimit } from '#server/api/rate-limit'
import {
  rankRowsByMeaning,
  SemanticSearchUnavailable,
} from '#server/semantic-search'
import { readTypeSafeApiKey } from '#server/typesafe-client'

/**
 * Row values, bounded.
 *
 * This endpoint is the one place sheet *contents* leave the browser, which is the
 * opposite of every other assistant call. The bounds are what keep that affordable
 * and deliberate rather than a blanket upload: a capped number of rows, capped
 * cells per row, and capped characters per cell. See the matching constants in
 * `src/lib/constants.ts`.
 */
const inputSchema = z.object({
  request: z
    .string({ error: 'Please enter what you are looking for.' })
    .trim()
    .min(3, 'Please use at least 3 characters.')
    .max(
      SHEET_AGENT_MAX_PROMPT_LENGTH,
      `Please use ${SHEET_AGENT_MAX_PROMPT_LENGTH} characters or fewer.`,
    ),
  rows: z
    .array(z.record(z.string(), z.string()))
    .min(1, 'There are no rows to search.')
    .max(
      SEMANTIC_SEARCH_MAX_ROWS,
      `Semantic search reads at most ${SEMANTIC_SEARCH_MAX_ROWS} rows.`,
    ),
})

/**
 * Whether semantic search is available at all.
 *
 * The UI hides the affordance when this is false, rather than rendering a button
 * that would fail: a data-sending feature is worse when it is offered and broken
 * than when it is simply absent.
 */
export const getSemanticSearchConfigFn = createServerFn({
  method: 'GET',
}).handler(async (): Promise<Result<{ available: boolean }>> => {
  try {
    return { ok: true, data: { available: readTypeSafeApiKey() !== null } }
  } catch (error) {
    return { ok: false, error: toAppError(error) }
  }
})

export type SemanticSearchResult = {
  /** Row indexes into the submitted `rows`, best match first. */
  matches: number[]
  /** Rows submitted but not scored, because the sheet was larger than the cap. */
  skippedRows: number
  /** Rows scored, which is `rows.length`. */
  scoredRows: number
}

/**
 * Ranks rows by how well they answer a plain-language question.
 *
 * The endpoint is separate from `planSheetAction` on purpose. That one sends the
 * request and the column *names*, never the data, which is what lets the UI say
 * "row values stay in this app". This one sends row values, so it is a different
 * consent decision and a different cost, and mixing the two would make that
 * distinction invisible at the call site.
 *
 * It is also not automatic. The browser only calls this after a literal search
 * has already returned nothing, and only when the user asks for it by name, so
 * nobody pays for a semantic pass or sends their data by accident.
 */
export const rankSheetRowsFn = createServerFn({ method: 'POST' })
  .validator(inputSchema)
  .handler(async ({ data }): Promise<Result<SemanticSearchResult>> => {
    try {
      const ip = bucketForIp(clientIp())
      if (!ip) {
        throw new AppError(
          'RATE_LIMITED',
          'Could not verify this search. Please try again.',
        )
      }

      const rateLimit = await checkRateLimit({ ip })
      if (!rateLimit.allowed) {
        throw new AppError(
          'RATE_LIMITED',
          'The search limit has been reached. Please try again later.',
        )
      }

      const rows: SheetRow[] = data.rows
      const { scores } = await rankRowsByMeaning(data.request, rows)

      return {
        ok: true,
        data: {
          matches: scores,
          skippedRows: 0,
          scoredRows: rows.length,
        },
      }
    } catch (error) {
      if (error instanceof SemanticSearchUnavailable) {
        return {
          ok: false,
          error: {
            code: 'AI_NOT_CONFIGURED',
            message: error.message,
          },
        }
      }
      return { ok: false, error: toAppError(error) }
    }
  })
