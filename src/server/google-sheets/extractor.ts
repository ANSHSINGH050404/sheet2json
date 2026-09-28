import { parse } from 'csv-parse'

import { AppError } from '#lib/errors'
import type { ParsedSheet, SheetRow } from '#lib/types'
import { MAX_ROWS } from '../config'

const EMPTY_MESSAGE = 'The Google Sheet returned no data.'
const TOO_LARGE_MESSAGE =
  'This spreadsheet is too large for the MVP limit. Try a smaller tab or range.'
const PARSE_FAILED_MESSAGE =
  "We couldn't parse the spreadsheet data. Make sure the tab is a plain grid of values, not a pivot table."

export interface ParseCsvOptions {
  maxRows?: number
}

/**
 * Turns raw CSV text into an array of JSON objects keyed by header name.
 *
 * The first non-empty line is the header. Blank header cells get a positional
 * name (`column_3`) and duplicate headers are suffixed (`email`, `email_2`) so
 * no data is ever silently overwritten. Values are always strings - the sheet is
 * the source of truth and we do not guess at types.
 */
export async function parseSheetCsv(
  csv: string,
  options: ParseCsvOptions = {},
): Promise<ParsedSheet> {
  const maxRows = options.maxRows ?? MAX_ROWS

  assertLooksLikeCsv(csv)

  let headers: string[] = []
  const rows: SheetRow[] = []

  // `to: maxRows + 1` lets csv-parse stop reading as soon as the limit is passed
  // instead of materialising an unbounded sheet in memory.
  const parser = parse(csv, {
    bom: true,
    columns: (header: string[]) => {
      headers = normalizeHeaders(header)
      return headers
    },
    // `relax_*` stops a single stray quote or ragged row from failing the whole
    // extraction; a best-effort row beats a hard failure for an MVP tool.
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
    trim: true,
    to: maxRows + 1,
  })

  try {
    for await (const record of parser) {
      const row = normalizeRow(record as Record<string, unknown>, headers)
      if (row === null) continue
      rows.push(row)
      if (rows.length > maxRows) {
        parser.destroy()
        throw new AppError('SHEET_TOO_LARGE', TOO_LARGE_MESSAGE)
      }
    }
  } catch (cause) {
    if (cause instanceof AppError) throw cause
    throw new AppError('PARSE_FAILED', PARSE_FAILED_MESSAGE, cause)
  }

  if (rows.length === 0) {
    throw new AppError('SHEET_EMPTY', EMPTY_MESSAGE)
  }

  return {
    headers,
    rows,
    rowCount: rows.length,
    columnCount: headers.length,
  }
}

/**
 * Google answers some failures with a 200 and an HTML sign-in page. Catching
 * that here means the user gets "not accessible" instead of a parse error.
 */
function assertLooksLikeCsv(csv: string): void {
  const head = csv.slice(0, 512).trimStart()
  if (head === '') {
    throw new AppError('SHEET_EMPTY', EMPTY_MESSAGE)
  }
  if (head.startsWith('<')) {
    throw new AppError(
      'SHEET_NOT_ACCESSIBLE',
      'This Google Sheet could not be accessed. Make sure the sheet is publicly accessible.',
    )
  }
}

function normalizeRow(
  record: Record<string, unknown>,
  headers: string[],
): SheetRow | null {
  const row: SheetRow = {}
  let hasValue = false

  for (const header of headers) {
    const value = record[header]
    const text = value === null || value === undefined ? '' : String(value)
    if (text !== '') hasValue = true
    row[header] = text
  }

  // Rows like `,,,` are dropped: they carry no information.
  return hasValue ? row : null
}

function normalizeHeaders(header: string[]): string[] {
  const seen = new Map<string, number>()
  return header.map((raw, index) => {
    const base = raw.trim() || `column_${index + 1}`
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base}_${count + 1}`
  })
}
