import { Link } from '@tanstack/react-router'

import { LoadingState } from '#components/loading-state'
import { describeExtraction, formatCount, formatRelative } from '#lib/format'
import type { ExtractionSummary } from '#lib/types'

export interface HistoryListProps {
  extractions: ExtractionSummary[]
  isLoading: boolean
  error: string | null
  /** Whether a visitor is signed in. Drives the signed-out empty state. */
  isSignedIn?: boolean
}

/**
 * A user's own extraction history.
 *
 * Every row belongs to the signed-in account - the list is scoped by user id, not
 * filtered here - so there is no permission state to render. Rows read with the
 * owner's Google grant are badged, because "you can see this but a link to it
 * would not work for anyone else" is worth saying out loud.
 */
export function HistoryList({
  extractions,
  isLoading,
  error,
  isSignedIn = true,
}: HistoryListProps) {
  if (isLoading) {
    return (
      <div className="rounded-lg border border-line bg-surface p-6">
        <LoadingState stages={['Loading history...']} />
      </div>
    )
  }

  if (error) {
    return (
      <p
        role="alert"
        className="rounded-lg border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger-muted"
      >
        {error}
      </p>
    )
  }

  if (extractions.length === 0) {
    return <EmptyState isSignedIn={isSignedIn} />
  }

  return (
    <div className="overflow-auto rounded-lg border border-line bg-surface">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Your recent sheet extractions</caption>
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
                className={`border-b border-line bg-surface-muted px-4 py-3 text-xs font-semibold tracking-wide whitespace-nowrap text-ink-muted ${
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
              className="border-b border-line/60 last:border-b-0 hover:bg-surface-muted/70"
            >
              <td className="px-4 py-3">
                <Link
                  to="/history/$extractionId"
                  params={{ extractionId: extraction.id }}
                  className="font-medium text-ink-strong underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
                >
                  {describeExtraction(
                    extraction.spreadsheetId,
                    extraction.title,
                  )}
                </Link>
                <p className="mt-0.5 flex items-center gap-2 font-mono text-xs text-ink-faint">
                  <span className="truncate">
                    {extraction.spreadsheetId.slice(0, 16)}...
                    {extraction.gid ? ` Â· gid ${extraction.gid}` : ''}
                  </span>
                  {extraction.isPrivate ? (
                    <span
                      title="Read with your Google permission. Not accessible to anyone without access to the sheet."
                      className="shrink-0 rounded bg-surface-raised px-1.5 py-0.5 font-sans text-[10px] font-semibold tracking-wide text-ink-strong uppercase"
                    >
                      Private
                    </span>
                  ) : null}
                </p>
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-ink-strong">
                {formatCount(extraction.rowCount)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-ink-strong">
                {formatCount(extraction.columnCount)}
              </td>
              <td
                className="px-4 py-3 text-right whitespace-nowrap text-ink-subtle"
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

function EmptyState({ isSignedIn }: { isSignedIn: boolean }) {
  if (!isSignedIn) {
    return (
      <div className="rounded-lg border border-dashed border-line-strong px-6 py-12 text-center">
        <p className="text-sm font-medium text-ink-strong">
          Sign in to see your history
        </p>
        <p className="mt-1 text-sm text-ink-subtle">
          Extractions are saved to your Google account, so each person only ever
          sees their own.
        </p>
        <a
          href="/auth/google?redirect=/history"
          className="mt-4 inline-block rounded-md bg-ink px-4 py-2 text-sm font-semibold text-surface transition-colors hover:bg-ink-hover focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
        >
          Sign in with Google
        </a>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-dashed border-line-strong px-6 py-12 text-center">
      <p className="text-sm font-medium text-ink-strong">No extractions yet</p>
      <p className="mt-1 text-sm text-ink-subtle">
        Extract a Google Sheet to start building your history.
      </p>
      <Link
        to="/extract"
        search={{ auth: undefined, signedOut: undefined }}
        className="mt-4 inline-block rounded-md bg-ink px-4 py-2 text-sm font-semibold text-surface transition-colors hover:bg-ink-hover focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
      >
        Extract a sheet
      </Link>
    </div>
  )
}
