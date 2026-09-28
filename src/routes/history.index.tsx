import { createFileRoute } from '@tanstack/react-router'

import { HistoryList } from '#components/history-list'
import { useExtractionsQuery } from '#hooks/use-extractions'
import { useSessionUser } from '#hooks/use-session'

/**
 * The signed-in user's extractions.
 *
 * There is no global history any more: rows belong to the account that made
 * them, so an anonymous visitor gets an explanation instead of a list.
 */
export const Route = createFileRoute('/history/')({ component: HistoryIndex })

function HistoryIndex() {
  const session = useSessionUser()
  const history = useExtractionsQuery({ enabled: Boolean(session.data) })

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 sm:py-14">
      <HistoryList
        extractions={history.data ?? []}
        isLoading={Boolean(session.data) && history.isPending}
        error={history.isError ? history.error.message : null}
        isSignedIn={Boolean(session.data)}
      />
    </div>
  )
}
