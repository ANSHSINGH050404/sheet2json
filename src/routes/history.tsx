import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/history')({ component: HistoryLayout })

/** Shared chrome for the history list and a single extraction. */
function HistoryLayout() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Recent Extractions
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Every extraction run on this instance. There are no user accounts in the
          MVP, so this history is shared by all visitors &mdash; entries are not
          private to whoever created them.
        </p>
      </header>

      <Outlet />
    </div>
  )
}
