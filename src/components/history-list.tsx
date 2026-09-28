import { Link } from '@tanstack/react-router'

import { LoadingState } from '#components/loading-state'
import { describeExtraction, formatCount, formatRelative } from '#lib/format'
import type { ExtractionSummary } from '#lib/types'

export interface HistoryListProps {
  extractions: ExtractionSummary[]
  isLoading: boolean
  error: string | null
}

/**
 * Global extraction history.
 *
 * The MVP has no accounts, so every row belongs to the application rather than
 * to a user, and every visitor can open every entry. That is a deliberate
 * limitation, not an oversight - see the README.
 */
export function HistoryList({
  extractions,
  isLoading,
  error,
}: HistoryListProps) {
  if (isLoading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <LoadingState stages={['Loading history...']} />
      </div>
    )
  }

  if (error) {
    return (
      <p
        role="alert"
        className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
      >
        {error}
      </p>
    )
  }

  if (extractions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 px-6 py-12 text-center">
        <p className="text-sm font-medium text-slate-700">No extractions yet</p>
        <p className="mt-1 text-sm text-slate-500">
          Extract a public Google Sheet to start building history.
        </p>
        <Link
          to="/"
          className="mt-4 inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        >
          Extract a sheet
        </Link>
      </div>
    )
  }

  return (
    <div className="overflow-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Recent extractions of public Google Sheets</caption>
        <thead className="sticky top-0 z-10">
          <tr>
            {[
              { label: 'Google Sheet', align: 'left' },
              { label: 'Rows', align: 'right' },
              { label: 'Columns', align: 'right' },
              { label: 'Created', align: 'right' },
            ].map((column) => (
              <th
                key={column.label}
                scope="col"
                className={`border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold tracking-wide whitespace-nowrap text-slate-600 ${
                  column.align === 'right' ? 'text-right' : 'text-left'
                }`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {extractions.map((extraction) => (
            <tr
              key={extraction.id}
              className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/70"
            >
              <td className="px-4 py-3">
                <Link
                  to="/history/$extractionId"
                  params={{ extractionId: extraction.id }}
                  className="font-medium text-indigo-700 underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                >
                  {describeExtraction(extraction.spreadsheetId, extraction.title)}
                </Link>
                <p className="mt-0.5 font-mono text-xs text-slate-400">
                  {extraction.spreadsheetId.slice(0, 16)}...
                  {extraction.gid ? ` · gid ${extraction.gid}` : ''}
                </p>
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                {formatCount(extraction.rowCount)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                {formatCount(extraction.columnCount)}
              </td>
              <td
                className="px-4 py-3 text-right whitespace-nowrap text-slate-500"
                // Relative time depends on the current clock, which can differ
                // between the server render and hydration.
                suppressHydrationWarning
              >
                <time dateTime={extraction.createdAt}>
                  {formatRelative(extraction.createdAt)}
                </time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
