import { useQuery } from '@tanstack/react-query'

import { unwrap } from '#lib/format'
import { useSessionUser } from '#hooks/use-session'
import { getExtractionFn } from '#server/api/extractions'

/**
 * One extraction, read by id.
 *
 * Disabled until someone is signed in: the endpoint requires a session, and a
 * request that can only fail is a request that should not be made.
 */
export function useExtraction(extractionId: string) {
  const session = useSessionUser()

  return useQuery({
    queryKey: ['extractions', extractionId],
    queryFn: () => getExtractionFn({ data: extractionId }).then(unwrap),
    enabled: Boolean(session.data) && extractionId !== '',
    retry: false,
  })
}
