/**
 * Server-side configuration and safety limits.
 *
 * Every value can be overridden with an environment variable so the MVP limits
 * can be tuned per deployment without a code change. Defaults are deliberately
 * conservative.
 */

function readInt(name: string, fallback: number, min: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < min) {
    console.warn(
      `[config] Ignoring invalid ${name}=${JSON.stringify(raw)}, using ${fallback}`,
    )
    return fallback
  }
  return parsed
}

/** Maximum number of data rows stored per extraction. */
export const MAX_ROWS = readInt('MAX_ROWS', 10_000, 1)

/** Maximum size of the CSV document we will read from Google, in bytes. */
export const MAX_RESPONSE_BYTES = readInt(
  'MAX_RESPONSE_BYTES',
  10 * 1024 * 1024,
  1024,
)

/** Time budget for a single request to the Google CSV endpoint. */
export const FETCH_TIMEOUT_MS = readInt('FETCH_TIMEOUT_MS', 20_000, 1_000)

/** How many history rows the list requests. */
export const HISTORY_PAGE_SIZE = readInt('HISTORY_PAGE_SIZE', 50, 1)

/** The Google Sheets public CSV (gviz) endpoint. */
export const GOOGLE_CSV_ENDPOINT =
  'https://docs.google.com/spreadsheets/d/{spreadsheetId}/gviz/tq?tqx=out:csv'
