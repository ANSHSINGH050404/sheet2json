import { createServerFn } from '@tanstack/react-start'

import { toAppError } from '#lib/errors'
import type { ExtractionDetail, ExtractionSummary, Result } from '#lib/types'
import { extractInputSchema, extractionIdSchema } from '#lib/validation'
import {
  extractSheet,
  getExtraction,
  getExtractions,
} from '#server/services/extraction'

/**
 * The only entry point the browser uses. Google Sheets and the database are
 * touched exclusively inside these handlers, which the Start compiler strips
 * from the client bundle.
 *
 * Handlers return a `Result` union rather than throwing, so the UI always
 * receives a message that is safe to display. The original error (with its
 * stack and upstream detail) is logged server-side and never serialised.
 */

async function guarded<T>(label: string, run: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await run() }
  } catch (error) {
    const appError = toAppError(error)
    if (appError.code === 'INTERNAL_ERROR') {
      console.error(`[sheet2json] ${label} failed`, error)
    } else {
      console.warn(`[sheet2json] ${label} rejected`, appError.code, appError.message)
    }
    return { ok: false, error: appError }
  }
}

export const extractSheetFn = createServerFn({ method: 'POST' })
  .validator(extractInputSchema)
  .handler(async ({ data }): Promise<Result<ExtractionDetail>> =>
    guarded('extractSheet', () => extractSheet(data.url)),
  )

export const listExtractionsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Result<ExtractionSummary[]>> =>
    guarded('getExtractions', () => getExtractions()),
)

export const getExtractionFn = createServerFn({ method: 'GET' })
  .validator(extractionIdSchema)
  .handler(async ({ data }): Promise<Result<ExtractionDetail>> =>
    guarded('getExtraction', () => getExtraction(data)),
  )
