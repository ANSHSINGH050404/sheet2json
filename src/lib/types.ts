/**
 * Types shared by client and server code.
 *
 * This module must stay free of server-only imports (Prisma, `process.env`, ...)
 * so it can safely be bundled into the browser.
 */

/** A validated pointer to a public Google Sheet. */
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
}

/** A single extraction, including the full stored JSON payload. */
export interface ExtractionDetail extends ExtractionSummary {
  data: SheetRow[]
}

/** User-safe error codes surfaced to the UI. */
export type AppErrorCode =
  | 'URL_REQUIRED'
  | 'INVALID_URL'
  | 'SHEET_NOT_ACCESSIBLE'
  | 'SHEET_EMPTY'
  | 'SHEET_TOO_LARGE'
  | 'PARSE_FAILED'
  | 'FETCH_FAILED'
  | 'NOT_FOUND'
  | 'DATABASE_UNAVAILABLE'
  | 'INTERNAL_ERROR'

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
  | { ok: true; data: T }
  | { ok: false; error: AppErrorPayload }
