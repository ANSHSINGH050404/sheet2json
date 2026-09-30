import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/history')({ component: HistoryLayout })

/** Shared chrome for the history list and a single extraction. */
function HistoryLayout() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          Recent Extractions
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          Every extraction you have run while signed in. History belongs to your
          account and is only visible to you &mdash; a row owned by another
          account reads as not found rather than forbidden.
        </p>
      </header>

      <Outlet />
    </div>
  )
}
