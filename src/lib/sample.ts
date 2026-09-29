import {
  GOOGLE_SHEETS_HOSTNAME,
  SPREADSHEET_ID_PATTERN,
  SPREADSHEET_PATH_PREFIX,
} from './validation'

/**
 * The one-click demo sheet.
 *
 * A visitor who lands from a launch link almost certainly has no public sheet
 * open, and an empty input box is where a first-time visitor bounces. This puts a
 * real result one click away.
 *
 * Overridable with `VITE_SAMPLE_SHEET_URL` so the demo can point at a sheet that
 * shows off the query parameters rather than at whatever is published. The
 * fallback is Google's own published sample sheet, which has been publicly
 * readable for years.
 */
const FALLBACK_SAMPLE_SHEET_URL = `https://${GOOGLE_SHEETS_HOSTNAME}${SPREADSHEET_PATH_PREFIX}1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0`

/**
 * The demo URL for the browser.
 *
 * A malformed `VITE_SAMPLE_SHEET_URL` falls back to the built-in sheet rather
 * than shipping a button that fails: on a launch day, a dead "try it" button is
 * worse than none, because it spends the visitor's first impression on an error.
 */
export function sampleSheetUrl(): string {
  return resolveSampleSheetUrl(import.meta.env.VITE_SAMPLE_SHEET_URL)
}

/**
 * Picks the demo URL, preferring a valid override over the fallback.
 *
 * Exported for the tests, which need to drive the override without rebuilding
 * the bundle under a different environment.
 */
export function resolveSampleSheetUrl(override: unknown): string {
  const candidate =
    typeof override === 'string' && override.trim() !== ''
      ? override.trim()
      : FALLBACK_SAMPLE_SHEET_URL

  if (!isUsableSheetUrl(candidate)) {
    console.warn(
      '[sample] Ignoring an unusable VITE_SAMPLE_SHEET_URL, using the default demo sheet.',
    )
    return FALLBACK_SAMPLE_SHEET_URL
  }

  return candidate
}

/**
 * A cheap structural check, not a security control.
 *
 * The host, path and id are all checked against the same patterns the server
 * uses, so a value that passes here is one the server will accept. That is the
 * point: the alternative is a demo button that renders fine and then fails.
 */
function isUsableSheetUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }

  if (url.protocol !== 'https:' || url.hostname !== GOOGLE_SHEETS_HOSTNAME) {
    return false
  }
  if (!url.pathname.startsWith(SPREADSHEET_PATH_PREFIX)) return false

  const rest = url.pathname.slice(SPREADSHEET_PATH_PREFIX.length)
  const id = rest.split('/')[0] ?? ''

  return SPREADSHEET_ID_PATTERN.test(id)
}
