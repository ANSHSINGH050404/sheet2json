import { z } from 'zod'

/**
 * The only host we will ever talk to. Requests to any other host are rejected
 * before a network call is made, which is the SSRF guard for this app.
 */
export const GOOGLE_SHEETS_HOSTNAME = 'docs.google.com'

/** Path every Google Sheets link must contain: /spreadsheets/d/{id} */
export const SPREADSHEET_PATH_PREFIX = '/spreadsheets/d/'

/**
 * Google spreadsheet ids are URL-safe base64 (`A-Za-z0-9-_`). Validating the id
 * against this pattern means the value can be concatenated into the outbound
 * CSV URL without any chance of injecting a different path, host or query.
 */
export const SPREADSHEET_ID_PATTERN = /^[A-Za-z0-9_-]{10,128}$/

/** Tab ids are non-negative integers. */
export const GID_PATTERN = /^\d{1,19}$/

export const extractInputSchema = z.object({
  url: z
    .string({ error: 'Please enter a Google Sheets URL.' })
    .trim()
    .min(1, 'Please enter a Google Sheets URL.'),
})

export const extractionIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'That extraction id is not valid.')

export type ExtractInput = z.infer<typeof extractInputSchema>
