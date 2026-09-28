import { useQuery } from '@tanstack/react-query'

import { unwrap } from '#lib/format'
import { listExtractionsFn } from '#server/api/extractions'

/**
 * Query keys live here so the home page and the history page cannot drift apart
 * and invalidate different caches.
 */
export const extractionsQueryKey = ['extractions'] as const

/**
 * The signed-in user's extractions.
 *
 * Disabled unless someone is signed in, because the endpoint requires a session
 * and an anonymous caller would only ever get an error. A short `staleTime` is
 * right here: the list changes when the user extracts, which the mutation
 * invalidates explicitly.
 */
export function useExtractionsQuery(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: extractionsQueryKey,
    queryFn: () => listExtractionsFn().then(unwrap),
    enabled: options.enabled ?? true,
    staleTime: 15_000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}
