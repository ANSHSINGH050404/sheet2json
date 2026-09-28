/**
 * Constants that are safe to use in the browser.
 *
 * Server-only, environment-driven limits live in `src/server/config.ts` and are
 * never imported from client code.
 */

/** Rows rendered in the table before the "Show more" button appears. */
export const TABLE_PAGE_SIZE = 200

/** How many extra rows each "Show more" click reveals. */
export const TABLE_PAGE_INCREMENT = 200

/** TypeSafe Choice supports at most 255 options; leave room for a no-column option. */
export const SHEET_AGENT_MAX_COLUMNS = 250

/** Bound column-name text sent to TypeSafe as part of the request metadata. */
export const SHEET_AGENT_MAX_COLUMN_NAME_LENGTH = 160

/** Keep natural-language agent requests bounded before sending them to TypeSafe. */
export const SHEET_AGENT_MAX_PROMPT_LENGTH = 500

/** Staged hints shown while an extraction is running. Not a fake progress bar. */
export const EXTRACTION_STAGES = [
  'Extracting spreadsheet...',
  'Parsing data...',
  'Saving extraction...',
] as const
