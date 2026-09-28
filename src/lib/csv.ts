import type { SheetRow } from './types'

/** Serialises flat sheet rows as CSV with spreadsheet-formula injection guarded. */
export function rowsToCsv(rows: SheetRow[]): string {
  if (rows.length === 0) return ''

  const headers = Object.keys(rows[0] as SheetRow)
  const lines = [headers.map((header) => escapeCsvField(header)).join(',')]

  for (const row of rows) {
    lines.push(
      headers.map((header) => escapeCsvField(row[header] ?? '')).join(','),
    )
  }

  return lines.join('\n')
}

function escapeCsvField(value: string): string {
  // A leading =, +, - or @ makes spreadsheet software treat the cell as a
  // formula. Prefixing with a tab defuses it without changing the value for a
  // parser that does not care.
  const guarded = /^[=+\-@\t\r]/.test(value) ? `\t${value}` : value

  if (!/[",\n\r]/.test(guarded)) return guarded
  return `"${guarded.replace(/"/g, '""')}"`
}
