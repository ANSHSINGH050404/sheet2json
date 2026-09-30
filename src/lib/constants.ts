/**
 * Constants that are safe to use in the browser.
 *
 * Server-only, environment-driven limits live in `src/server/config.ts` and are
 * never imported from client code.
 */

/**
 * How many rows one semantic-search request may score.
 *
 * Each row becomes a Noul question, so this bounds both the token cost and the
 * size of the outgoing payload. A sheet with more rows than this is searched
 * only in part, and the result says so: a search that quietly ignored most of the
 * sheet would be worse than one that admits its bound.
 */
export const SEMANTIC_SEARCH_MAX_ROWS = 100

/**
 * Per-cell and per-row bounds for the semantic-search payload.
 *
 * These exist because this is the one request that sends sheet *values*. A cell
 * can hold a paragraph; a relevance judgment does not need all of it, so cells
 * are truncated before they are sent rather than after they arrive.
 */
export const SEMANTIC_SEARCH_MAX_CELL_CHARS = 120
export const SEMANTIC_SEARCH_MAX_CELLS = 12

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

/**
 * Ceiling on `?limit=`, whatever the sheet actually holds.
 *
 * The sheet is already capped at `MAX_ROWS`, so this is not a safety limit - it
 * stops `limit=99999999` reading as a promise the endpoint cannot keep.
 */
export const QUERY_MAX_LIMIT = 10_000

/** Staged hints shown while an extraction is running. Not a fake progress bar. */
export const EXTRACTION_STAGES = [
  'Extracting spreadsheet...',
  'Parsing data...',
  'Saving extraction...',
] as const
