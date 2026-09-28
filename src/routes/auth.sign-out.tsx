import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { LoadingState } from '#components/loading-state'
import { sessionQueryKey } from '#hooks/use-session'
import { unwrap } from '#lib/format'
import { signOutFn } from '#server/api/auth'

/**
 * `POST /auth/sign-out`, reached by a form submit rather than a link.
 *
 * Deliberately not a GET navigation. A GET that destroys a session is CSRF-able:
 * any page could drop an image tag pointing here and sign the user out, which is
 * a nuisance at best and a way to knock someone off a session at worst. A POST
 * passes the same-origin check that guards server functions.
 *
 * The page renders only in the window between the submit and the redirect, and
 * exists so a failed sign-out still leaves the user somewhere useful.
 */
export const Route = createFileRoute('/auth/sign-out')({
  component: SignOutPage,
})

function SignOutPage() {
  const queryClient = useQueryClient()
  const navigate = Route.useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    signOutFn()
      .then(unwrap)
      .then(() => {
        if (cancelled) return
        // Clear rather than invalidate: the history belonged to the account that
        // just left, and a refetch would only produce a permission error.
        queryClient.setQueryData(sessionQueryKey, null)
        queryClient.removeQueries({ queryKey: ['extractions'] })
        void navigate({
          to: '/extract',
          search: { auth: undefined, signedOut: '1' },
        })
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : 'Could not sign out.',
          )
        }
      })

    return () => {
      cancelled = true
    }
  }, [navigate, queryClient])

  if (error) {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-6 py-16 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          Could not sign out
        </h1>
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
        <a
          href="/"
          className="inline-block rounded-md bg-ink px-4 py-2 text-sm font-semibold text-surface transition-colors hover:bg-ink-hover focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
        >
          Back to Sheet2JSON
        </a>
      </div>
    )
  }

  return (
    <div className="px-6 py-16">
      <LoadingState stages={['Signing you out...']} />
    </div>
  )
}
