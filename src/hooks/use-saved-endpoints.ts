import { useQuery } from '@tanstack/react-query'

import { unwrap } from '#lib/format'
import { listSavedEndpointsFn } from '#server/api/endpoints'

export const savedEndpointsQueryKey = ['saved-endpoints'] as const

/** The signed-in user's saved live endpoints. */
export function useSavedEndpointsQuery(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: savedEndpointsQueryKey,
    queryFn: () => listSavedEndpointsFn().then(unwrap),
    enabled: options.enabled ?? true,
  })
}
