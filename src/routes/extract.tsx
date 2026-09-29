import { Link, createFileRoute } from '@tanstack/react-router'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { LoadingState } from '#components/loading-state'
import { ResultPanel } from '#components/result-panel'
import { SheetInput } from '#components/sheet-input'
import {
  extractionsQueryKey,
  useExtractionsQuery,
} from '#hooks/use-extractions'
import { useSessionUser } from '#hooks/use-session'
import { unwrap } from '#lib/format'
import { trackAnalytics } from '#lib/analytics'
import { extractSheetFn } from '#server/api/extractions'

export const Route = createFileRoute('/extract')({
  component: ExtractPage,
  validateSearch: (search: Record<string, unknown>) => ({
    // Only these two are carried through. Anything else in the query string is
    // dropped rather than forwarded, so the search type stays honest.
    auth: typeof search.auth === 'string' ? search.auth : undefined,
    signedOut:
      typeof search.signedOut === 'string' ? search.signedOut : undefined,
  }),
})

/** Messages for the `?auth=` outcomes the callback can redirect with. */
const AUTH_NOTICES: Record<string, string> = {
  declined: 'Sign-in was cancelled. Nothing has changed.',
  failed: 'Google sign-in could not be completed. Please try again.',
  missing_code:
    'Google did not return an authorization code. Please try again.',
  invalid_state: 'That sign-in link has expired. Please try again.',
}

function ExtractPage() {
  const queryClient = useQueryClient()
  const { auth, signedOut } = Route.useSearch()
  const session = useSessionUser()
  const navigate = Route.useNavigate()

  // A sign-in notice is a one-time thing. It is cleared from the URL immediately
  // so a refresh does not show it again, and so it does not survive a share.
  const notice =
    auth !== undefined
      ? (AUTH_NOTICES[auth] ?? null)
      : signedOut !== undefined
        ? 'You have been signed out.'
        : null

  useEffect(() => {
    if (auth === undefined && signedOut === undefined) return
    void navigate({
      to: '/extract',
      // Explicitly blank both params: `{}` is not the same thing, because the
      // search type marks them required-but-possibly-undefined.
      search: { auth: undefined, signedOut: undefined },
      replace: true,
    })
  }, [auth, navigate, signedOut])

  const extract = useMutation({
    mutationFn: (url: string) => extractSheetFn({ data: { url } }).then(unwrap),
    onSuccess: (extraction) => {
      trackAnalytics({
        event: 'sheet_extracted',
        row_count: extraction.rowCount,
        column_count: extraction.columnCount,
      })
      // A new row landed in this user's history; refresh it when they go there.
      void queryClient.invalidateQueries({ queryKey: extractionsQueryKey })
    },
  })

  const result = extract.data

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-6 py-10 sm:py-14">
      <section className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Extract a sheet
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          Paste a Google Sheets link and get structured JSON, CSV or NDJSON. The
          same thing is available over the{' '}
          <Link
            to="/docs"
            className="text-ink underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-ink"
          >
            REST API
          </Link>
          .
        </p>
      </section>

      {notice ? (
        <p
          role="status"
          className="mx-auto max-w-2xl rounded-lg border border-warning-line bg-warning-soft px-4 py-3 text-sm text-warning"
        >
          {notice}
        </p>
      ) : null}

      <section
        aria-label="Extract a Google Sheet"
        className="mx-auto max-w-2xl rounded-xl border border-line bg-surface p-5 shadow-sm sm:p-6"
      >
        <SheetInput
          onSubmit={(url) => extract.mutate(url)}
          isPending={extract.isPending}
          error={extract.isError ? extract.error.message : null}
          googleConnected={session.data?.googleConnected ?? false}
          isSignedIn={Boolean(session.data)}
        />
      </section>

      {extract.isPending ? (
        <div className="mx-auto max-w-2xl">
          <LoadingState />
        </div>
      ) : null}

      {result ? (
        <ResultPanel
          extraction={result}
          action={
            result.id !== '' ? (
              <Link
                to="/history/$extractionId"
                params={{ extractionId: result.id }}
                className="shrink-0 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink-strong transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
              >
                View in history
              </Link>
            ) : null
          }
        />
      ) : null}

      <RecentExtractions />
    </div>
  )
}

/**
 * A teaser of the signed-in user's history.
 *
 * Hidden entirely when anonymous: the list belongs to an account now, so there is
 * nothing to show, and an empty "Recent extractions" heading would only invite
 * confusion.
 */
function RecentExtractions() {
  const session = useSessionUser()
  const history = useExtractionsQuery({ enabled: Boolean(session.data) })

  if (!session.data) return null
  if (
    history.isPending ||
    history.data === undefined ||
    history.data.length === 0
  ) {
    return null
  }

  return (
    <section aria-label="Recent extractions" className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold tracking-wide text-ink-subtle uppercase">
          Recent extractions
        </h2>
        <Link
          to="/history"
          className="text-sm font-medium text-ink-strong underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
        >
          View all
        </Link>
      </div>
      <ul className="mt-3 divide-y divide-line/60 rounded-lg border border-line bg-surface">
        {history.data.slice(0, 5).map((extraction) => (
          <li key={extraction.id}>
            <Link
              to="/history/$extractionId"
              params={{ extractionId: extraction.id }}
              className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-inset focus:ring-ink-subtle"
            >
              <span className="truncate text-ink-strong">
                {extraction.title ??
                  `${extraction.spreadsheetId.slice(0, 12)}...`}
              </span>
              <span className="shrink-0 tabular-nums text-ink-subtle">
                {extraction.rowCount} rows
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
