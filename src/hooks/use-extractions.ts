import { useQuery } from '@tanstack/react-query'

import { unwrap } from '#lib/format'
import { listExtractionsFn } from '#server/api/extractions'

/**
 * Query keys live here so the home page and the history page cannot drift
 * apart and invalidate different caches.
 */
export const extractionsQueryKey = ['extractions'] as const

export function useExtractionsQuery() {
  return useQuery({
    queryKey: extractionsQueryKey,
    queryFn: () => listExtractionsFn().then(unwrap),
  })
}
