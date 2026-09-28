import { createFileRoute } from '@tanstack/react-router'

import { HistoryList } from '#components/history-list'
import { useExtractionsQuery } from '#hooks/use-extractions'

export const Route = createFileRoute('/history/')({ component: HistoryIndex })

function HistoryIndex() {
  const history = useExtractionsQuery()

  return (
    <HistoryList
      extractions={history.data ?? []}
      isLoading={history.isPending}
      error={history.isError ? history.error.message : null}
    />
  )
}
