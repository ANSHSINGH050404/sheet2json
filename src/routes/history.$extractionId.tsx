import { Link, createFileRoute } from '@tanstack/react-router'

import { LoadingState } from '#components/loading-state'
import { ResultPanel } from '#components/result-panel'
import { useExtraction } from '#hooks/use-extraction'
import { useSessionUser } from '#hooks/use-session'

/**
 * One stored extraction, readable only by the account that owns it.
 */
export const Route = createFileRoute('/history/$extractionId')({
  component: ExtractionDetailPage,
})

function ExtractionDetailPage() {
  const { extractionId } = Route.useParams()
  const session = useSessionUser()
  const extraction = useExtraction(extractionId)

  // No account means no history to read: history belongs to an account, so
  // sending an anonymous visitor here could only ever produce an error page.
  if (session.isPending) {
    return (
      <Frame>
        <LoadingState stages={['Checking your session...']} />
      </Frame>
    )
  }

  if (!session.data) {
    return <NotSignedIn />
  }

  if (extraction.isPending) {
    return (
      <Frame>
        <LoadingState stages={['Loading extraction...']} />
      </Frame>
    )
  }

  if (extraction.isError) {
    return (
      <Frame>
        <div className="space-y-4">
          <p
            role="alert"
            className="rounded-lg border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger-muted"
          >
            {extraction.error.message}
          </p>
          <Link
            to="/history"
            className="inline-block rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm font-semibold text-ink-strong transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
          >
            Back to history
          </Link>
        </div>
      </Frame>
    )
  }

  return (
    <Frame>
      <ResultPanel
        extraction={extraction.data}
        action={
          <Link
            to="/history"
            className="shrink-0 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink-strong transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
          >
            Back to history
          </Link>
        }
      />
    </Frame>
  )
}

/** The page gutter. The shell deliberately does not provide one. */
function Frame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-4xl px-6 py-10 sm:py-14">{children}</div>
}

function NotSignedIn() {
  return (
    <div className="mx-auto max-w-lg space-y-4 px-6 py-16 text-center">
      <h1 className="text-2xl font-bold tracking-tight text-ink">
        Sign in to see your history
      </h1>
      <p className="text-sm text-ink-muted">
        Extractions are saved to your account, so they are only visible once you
        are signed in.
      </p>
      <a
        href="/auth/google?redirect=/history"
        className="inline-block rounded-md bg-ink px-4 py-2 text-sm font-semibold text-surface transition-colors hover:bg-ink-hover focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
      >
        Sign in with Google
      </a>
    </div>
  )
}
