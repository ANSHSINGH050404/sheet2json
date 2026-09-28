import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { LoadingState } from '#components/loading-state'
import { ResultPanel } from '#components/result-panel'
import { unwrap } from '#lib/format'
import { getExtractionFn } from '#server/api/extractions'

export const Route = createFileRoute('/history/$extractionId')({
  component: ExtractionDetailPage,
})

function ExtractionDetailPage() {
  const { extractionId } = Route.useParams()

  const extraction = useQuery({
    queryKey: ['extractions', extractionId],
    queryFn: () => getExtractionFn({ data: extractionId }).then(unwrap),
  })

  if (extraction.isPending) {
    return <LoadingState stages={['Loading extraction...']} />
  }

  if (extraction.isError) {
    return (
      <div className="space-y-4">
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {extraction.error.message}
        </p>
        <Link
          to="/history"
          className="inline-block rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        >
          Back to history
        </Link>
      </div>
    )
  }

  return (
    <ResultPanel
      extraction={extraction.data}
      action={
        <Link
          to="/history"
          className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        >
          Back to history
        </Link>
      }
    />
  )
}
