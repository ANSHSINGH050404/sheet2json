import { createServerFn } from '@tanstack/react-start'

import { AppError, toAppError } from '#lib/errors'
import type { Result, SheetAgentPlan } from '#lib/types'
import { sheetAgentInputSchema } from '#lib/validation'
import { bucketForIp, clientIp } from '#server/api/authenticate'
import { checkRateLimit } from '#server/api/rate-limit'
import { planSheetAction } from '#server/typesafe'

/** Server endpoint for planning one bounded action over an extracted sheet. */
export const planSheetAgentFn = createServerFn({ method: 'POST' })
  .validator(sheetAgentInputSchema)
  .handler(async ({ data }): Promise<Result<SheetAgentPlan>> => {
    try {
      const ip = bucketForIp(clientIp())
      if (!ip) {
        throw new AppError(
          'RATE_LIMITED',
          'The sheet assistant could not verify this request. Please try again.',
        )
      }

      const rateLimit = await checkRateLimit({ ip })
      if (!rateLimit.allowed) {
        throw new AppError(
          'RATE_LIMITED',
          'The sheet assistant request limit has been reached. Please try again later.',
        )
      }

      return {
        ok: true,
        data: await planSheetAction(data.request, data.columns),
      }
    } catch (error) {
      return { ok: false, error: toAppError(error) }
    }
  })
