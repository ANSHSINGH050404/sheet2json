/**
 * Types shared by client and server code.
 *
 * This module must stay free of server-only imports (Prisma, `process.env`, ...)
 * so it can safely be bundled into the browser.
 */

/** A validated pointer to a Google Sheet. */
export interface GoogleSheetReference {
  spreadsheetId: string
  gid: string | null
}

/** A single parsed spreadsheet row, keyed by (de-duplicated) header name. */
export type SheetRow = Record<string, string>

/** The result of turning raw CSV text into rows of JSON. */
export interface ParsedSheet {
  headers: string[]
  rows: SheetRow[]
  /** Number of data rows, excluding the header row and blank rows. */
  rowCount: number
  /** Number of columns, i.e. the width of the header row. */
  columnCount: number
}

/** Fields needed to render the history list. Never includes `data`. */
export interface ExtractionSummary {
  id: string
  spreadsheetId: string
  gid: string | null
  title: string | null
  sourceUrl: string
  rowCount: number
  columnCount: number
  createdAt: string
  /**
   * Whether this sheet was read with the owner's Google grant rather than
   * anonymously. Only set for a signed-in extraction; drives the "private" badge.
   */
  isPrivate: boolean
}

/** A single extraction, including the full stored JSON payload. */
export interface ExtractionDetail extends ExtractionSummary {
  data: SheetRow[]
}

/** Numeric operations supported by the read-only sheet assistant. */
export type SheetAgentAggregateOperation =
  'sum' | 'average' | 'minimum' | 'maximum' | 'count'

/** A bounded action plan returned by the server-side TypeSafe router. */
export type SheetAgentPlan =
  | { action: 'summarize' }
  | { action: 'search'; column: string | null }
  | {
      action: 'aggregate'
      column: string
      operation: SheetAgentAggregateOperation
    }
  | { action: 'export' }
  | { action: 'clarify'; message: string }

/** User-safe error codes surfaced to the UI. */
export type AppErrorCode =
  | 'URL_REQUIRED'
  | 'INVALID_URL'
  | 'SHEET_NOT_ACCESSIBLE'
  | 'SHEET_NEEDS_AUTH'
  | 'GOOGLE_REAUTH_REQUIRED'
  | 'SHEET_EMPTY'
  | 'SHEET_TOO_LARGE'
  | 'PARSE_FAILED'
  | 'FETCH_FAILED'
  | 'NOT_FOUND'
  | 'DATABASE_UNAVAILABLE'
  | 'INTERNAL_ERROR'
  | 'AI_NOT_CONFIGURED'
  | 'AI_REQUEST_FAILED'
  // Auth and API. These only ever reach a signed-in caller or an API consumer.
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'OAUTH_FAILED'
  | 'OAUTH_STATE_INVALID'

/** The wire-safe shape of an error: no stack trace, no upstream detail. */
export interface AppErrorPayload {
  code: AppErrorCode
  /** Safe to render directly in the UI. Never contains a stack trace. */
  message: string
}

/**
 * Server functions are serialised over the wire, so every handler returns a
 * discriminated result instead of throwing. This guarantees the UI always has a
 * clean, user-safe message to show.
 */
export type Result<T> =
  { ok: true; data: T } | { ok: false; error: AppErrorPayload }

/** A stored API key as the settings page sees it. Never includes the secret. */
export interface ApiKeySummary {
  id: string
  name: string
  /** Public head of the key, enough to tell two keys apart in a list. */
  prefix: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

/** A newly created key. `key` is present exactly once, at creation. */
export interface CreatedApiKey extends ApiKeySummary {
  key: string
}

/** The signed-in user, as the shell and settings page need them. */
export interface SessionUser {
  id: string
  email: string
  name: string | null
  avatarUrl: string | null
  /** Whether a Google grant is connected, i.e. private sheets can be read. */
  googleConnected: boolean
}
