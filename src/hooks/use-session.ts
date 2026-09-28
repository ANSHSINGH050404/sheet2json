import { useQuery } from '@tanstack/react-query'

import { unwrap } from '#lib/format'
import { getSessionUserFn } from '#server/api/extractions'

/**
 * The signed-in user, or null.
 *
 * Lives in one place so the shell, the home page and the settings page cannot
 * disagree about who is signed in - and therefore cannot disagree about what
 * navigation to render.
 *
 * `staleTime` is generous: the answer only changes when this user signs in or
 * out, which is a navigation, not a background event.
 */
export const sessionQueryKey = ['session'] as const

export function useSessionUser() {
  return useQuery({
    queryKey: sessionQueryKey,
    queryFn: () => getSessionUserFn().then(unwrap),
    staleTime: 60_000,
  })
}
