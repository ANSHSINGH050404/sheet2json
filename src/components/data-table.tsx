import { useMemo, useState } from 'react'

import { TABLE_PAGE_INCREMENT, TABLE_PAGE_SIZE } from '#lib/constants'
import { formatCount } from '#lib/format'
import type { SheetRow } from '#lib/types'

export interface DataTableProps {
  rows: SheetRow[]
  /** Column order. Falls back to the keys of the first row. */
  columns?: string[]
  caption?: string
  isLoading?: boolean
}

/**
 * A plain, dependency-free table.
 *
 * Sheet values are rendered as text children - never as HTML - so a cell
 * containing markup is displayed literally instead of being executed.
 *
 * Rendering is capped at `TABLE_PAGE_SIZE` rows and grows on demand. Spreadsheets
 * routinely hold 10k+ rows and the MVP does not need a virtualised grid; a
 * bounded DOM plus "show more" keeps scrolling smooth on modest hardware.
 */
export function DataTable({
  rows,
  columns,
  caption,
  isLoading = false,
}: DataTableProps) {
  const [visible, setVisible] = useState(TABLE_PAGE_SIZE)

  const headers = useMemo(() => {
    if (columns && columns.length > 0) return columns
    const first = rows[0]
    return first ? Object.keys(first) : []
  }, [columns, rows])

  const shown = rows.slice(0, visible)
  const remaining = rows.length - shown.length

  if (headers.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line-strong px-4 py-8 text-center text-sm text-ink-subtle">
        No data rows found in this sheet.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="overflow-auto rounded-lg border border-line bg-surface">
        <table className="w-full border-collapse text-sm">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead className="sticky top-0 z-10">
            <tr>
              <th
                scope="col"
                className="w-12 border-b border-line bg-surface-muted px-3 py-2.5 text-right text-xs font-semibold tracking-wide text-ink-subtle"
              >
                #
              </th>
              {headers.map((header) => (
                <th
                  key={header}
                  scope="col"
                  title={header}
                  className="border-b border-line bg-surface-muted px-3 py-2.5 text-left text-xs font-semibold tracking-wide whitespace-nowrap text-ink-muted"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className="border-b border-line/60 last:border-b-0 hover:bg-surface-muted/70"
              >
                <td className="px-3 py-2 text-right align-top text-xs tabular-nums text-ink-faint">
                  {formatCount(rowIndex + 1)}
                </td>
                {headers.map((header) => {
                  const value = row[header] ?? ''
                  const isEmpty = value === ''
                  return (
                    <td
                      key={header}
                      className="max-w-[22rem] truncate px-3 py-2 align-top text-ink-strong"
                    >
                      {isEmpty ? (
                        <span
                          aria-label="empty"
                          className="select-none text-ink-faint"
                        >
                          &mdash;
                        </span>
                      ) : (
                        <span title={value}>{value}</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-ink-subtle">
        <p aria-live="polite">
          {isLoading
            ? 'Loading...'
            : `Showing ${formatCount(shown.length)} of ${formatCount(rows.length)} rows`}
        </p>
        {remaining > 0 ? (
          <button
            type="button"
            onClick={() =>
              setVisible((current) => current + TABLE_PAGE_INCREMENT)
            }
            className="rounded-md border border-line-strong bg-surface px-3 py-1.5 font-medium text-ink-strong transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
          >
            Show {formatCount(Math.min(remaining, TABLE_PAGE_INCREMENT))} more
          </button>
        ) : null}
      </div>
    </div>
  )
}
