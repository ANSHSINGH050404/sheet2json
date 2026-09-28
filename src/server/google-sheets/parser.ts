import { AppError } from '#lib/errors'
import {
  GID_PATTERN,
  GOOGLE_SHEETS_HOSTNAME,
  SPREADSHEET_ID_PATTERN,
  SPREADSHEET_PATH_PREFIX,
} from '#lib/validation'
import type { GoogleSheetReference } from '#lib/types'

const INVALID_URL_MESSAGE =
  "This doesn't appear to be a valid Google Sheets URL."

function invalid(cause?: unknown): AppError {
  return new AppError('INVALID_URL', INVALID_URL_MESSAGE, cause)
}

/**
 * Extracts the spreadsheet id and optional tab (`gid`) from a Google Sheets URL.
 *
 * Accepted, e.g.:
 *   https://docs.google.com/spreadsheets/d/ID/edit
 *   https://docs.google.com/spreadsheets/d/ID/edit#gid=123
 *   https://docs.google.com/spreadsheets/d/ID/view#gid=123
 *
 * Rejected: any other host, any other path, and malformed URLs.
 *
 * Throws `AppError('INVALID_URL')` with a user-safe message.
 */
export function parseGoogleSheetUrl(url: string): GoogleSheetReference {
  if (typeof url !== 'string' || url.trim() === '') {
    throw invalid('empty url')
  }

  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch (cause) {
    throw invalid(cause)
  }

  // HTTPS only - a plaintext or `javascript:` URL is never acceptable.
  if (parsed.protocol !== 'https:') {
    throw invalid(`protocol: ${parsed.protocol}`)
  }

  // Host allow-list. Comparing against `hostname` (not `host`) also rejects an
  // attempt to smuggle a port or userinfo such as `docs.google.com@evil.test`.
  if (parsed.hostname !== GOOGLE_SHEETS_HOSTNAME) {
    throw invalid(`hostname: ${parsed.hostname}`)
  }

  const match = parsed.pathname.match(
    /^\/spreadsheets\/d\/([A-Za-z0-9_-]+)\b/,
  )
  if (!match) {
    throw invalid(`pathname: ${parsed.pathname}`)
  }

  const spreadsheetId = match[1] as string
  if (!SPREADSHEET_ID_PATTERN.test(spreadsheetId)) {
    throw invalid(`spreadsheetId: ${spreadsheetId}`)
  }

  return { spreadsheetId, gid: readGid(parsed.hash) }
}

/**
 * Reads the tab id from the URL fragment, e.g. `#gid=123&range=A1:C9`.
 * The `range` param is deliberately ignored: gviz already scopes to a tab.
 */
function readGid(hash: string): string | null {
  if (!hash || hash.length < 2) return null
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const gid = params.get('gid')
  if (!gid || !GID_PATTERN.test(gid)) return null
  return gid
}

/**
 * Best-effort human label for a sheet, used in the history list.
 *
 * Google appends the tab name to the share/edit link (`#gid=0&title=Orders`),
 * so it is the only title the public endpoints expose.
 */
export function extractSheetTitle(url: string): string | null {
  try {
    const hash = new URL(url.trim()).hash
    if (!hash) return null
    const title = new URLSearchParams(hash.replace(/^#/, '')).get('title')
    if (!title) return null
    const trimmed = title.trim()
    if (trimmed === '' || trimmed.length > 200) return null
    return trimmed
  } catch {
    return null
  }
}

/** Short, readable fallback label for a spreadsheet id. */
export function describeSpreadsheet(
  reference: GoogleSheetReference,
  title: string | null,
): string {
  if (title) return title
  const suffix = reference.gid ? ` · tab ${reference.gid}` : ''
  return `${reference.spreadsheetId.slice(0, 8)}…${suffix}`
}

export { SPREADSHEET_PATH_PREFIX }
