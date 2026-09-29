import { z } from 'zod'

import {
  SHEET_AGENT_MAX_COLUMNS,
  SHEET_AGENT_MAX_COLUMN_NAME_LENGTH,
  SHEET_AGENT_MAX_PROMPT_LENGTH,
} from './constants'

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

export const sheetAgentInputSchema = z.object({
  request: z
    .string({ error: 'Please enter a request for the sheet assistant.' })
    .trim()
    .min(3, 'Please enter at least 3 characters.')
    .max(
      SHEET_AGENT_MAX_PROMPT_LENGTH,
      `Please use ${SHEET_AGENT_MAX_PROMPT_LENGTH} characters or fewer.`,
    ),
  columns: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(
          SHEET_AGENT_MAX_COLUMN_NAME_LENGTH,
          'A column name is too long for the sheet assistant.',
        ),
    )
    .min(1, 'This sheet has no columns to analyze.')
    .max(
      SHEET_AGENT_MAX_COLUMNS,
      `The sheet assistant supports up to ${SHEET_AGENT_MAX_COLUMNS} columns.`,
    ),
})

export const extractionIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'That extraction id is not valid.')

/** Ids are cuid-generated, so this bounds a lookup without being the real check. */
export const apiKeyIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'That key id is not valid.')

/**
 * The name a user gives a key, shown in the settings list.
 *
 * Bounded at 80 characters because it is rendered in a table and in a
 * `Content-Disposition` header on nothing - but a name is user text, so the
 * length is capped rather than trusted.
 */
export const apiKeyNameSchema = z.object({
  name: z
    .string({ error: 'Please name this key.' })
    .trim()
    .min(1, 'Please name this key.')
    .max(80, 'Please use 80 characters or fewer.'),
})

/**
 * The configuration saved for a live endpoint. The Google URL is validated by
 * the extraction pipeline before it is persisted; these bounds keep user input
 * compact and safe to carry through server functions.
 */
export const savedEndpointInputSchema = z.object({
  name: z
    .string({ error: 'Please name this endpoint.' })
    .trim()
    .min(1, 'Please name this endpoint.')
    .max(80, 'Please use 80 characters or fewer.'),
  sourceUrl: z
    .string({ error: 'Please enter a Google Sheets URL.' })
    .trim()
    .min(1, 'Please enter a Google Sheets URL.')
    .max(2048, 'The Google Sheets URL is too long.'),
  query: z.string().max(4096, 'The endpoint query is too long.').default(''),
})

/** Endpoint ids are cuid-generated; this bounds a lookup without being the real check. */
export const savedEndpointIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'That endpoint id is not valid.')

export type ExtractInput = z.infer<typeof extractInputSchema>
export type ApiKeyNameInput = z.infer<typeof apiKeyNameSchema>
export type SheetAgentInput = z.infer<typeof sheetAgentInputSchema>
export type SavedEndpointInput = z.infer<typeof savedEndpointInputSchema>
