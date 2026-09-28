import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { LoadingState } from '#components/loading-state'
import { ResultPanel } from '#components/result-panel'
import { SheetInput } from '#components/sheet-input'
import { extractionsQueryKey, useExtractionsQuery } from '#hooks/use-extractions'
import { unwrap } from '#lib/format'
import { extractSheetFn } from '#server/api/extractions'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const queryClient = useQueryClient()

  const extract = useMutation({
    mutationFn: (url: string) => extractSheetFn({ data: { url } }).then(unwrap),
    onSuccess: () => {
      // A new row landed in the global history; refresh it when the user goes there.
      void queryClient.invalidateQueries({ queryKey: extractionsQueryKey })
    },
  })

  const result = extract.data

  return (
    <div className="space-y-8">
      <section className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Sheet2JSON
        </h1>
        <p className="mt-3 text-base text-slate-600">
          Extract public Google Sheets into structured JSON.
        </p>
      </section>

      <section
        aria-label="Extract a Google Sheet"
        className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
      >
        <SheetInput
          onSubmit={(url) => extract.mutate(url)}
          isPending={extract.isPending}
          error={extract.isError ? extract.error.message : null}
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
            <Link
              to="/history/$extractionId"
              params={{ extractionId: result.id }}
              className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              View in history
            </Link>
          }
        />
      ) : null}

      <RecentExtractions />
    </div>
  )
}

/** A small teaser of the global history, so the home page is not a dead end. */
function RecentExtractions() {
  const history = useExtractionsQuery()

  if (history.isPending || history.data === undefined || history.data.length === 0) {
    return null
  }

  return (
    <section aria-label="Recent extractions" className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
          Recent extractions
        </h2>
        <Link
          to="/history"
          className="text-sm font-medium text-indigo-700 underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        >
          View all
        </Link>
      </div>
      <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {history.data.slice(0, 5).map((extraction) => (
          <li key={extraction.id}>
            <Link
              to="/history/$extractionId"
              params={{ extractionId: extraction.id }}
              className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500"
            >
              <span className="truncate text-slate-700">
                {extraction.title ?? `${extraction.spreadsheetId.slice(0, 12)}...`}
              </span>
              <span className="shrink-0 tabular-nums text-slate-500">
                {extraction.rowCount} rows
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
