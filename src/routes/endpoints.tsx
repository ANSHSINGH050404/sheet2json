import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { LoadingState } from '#components/loading-state'
import {
  useSavedEndpointsQuery,
  savedEndpointsQueryKey,
} from '#hooks/use-saved-endpoints'
import { useSessionUser } from '#hooks/use-session'
import { CLIPBOARD_COPY_ERROR, copyTextToClipboard } from '#lib/clipboard'
import { buildSavedEndpointExamples } from '#lib/endpoint-examples'
import { formatAbsolute, unwrap } from '#lib/format'
import type { SavedEndpointSummary } from '#lib/types'
import { deleteSavedEndpointFn } from '#server/api/endpoints'

export const Route = createFileRoute('/endpoints')({
  component: SavedEndpointsPage,
})

function SavedEndpointsPage() {
  const session = useSessionUser()
  const queryClient = useQueryClient()
  const endpoints = useSavedEndpointsQuery({ enabled: Boolean(session.data) })
  const [origin, setOrigin] = useState('')
  const [copyMessage, setCopyMessage] = useState<string | null>(null)

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  const remove = useMutation({
    mutationFn: (id: string) =>
      deleteSavedEndpointFn({ data: id }).then(unwrap),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: savedEndpointsQueryKey })
    },
  })

  async function copy(value: string) {
    const copied = await copyTextToClipboard(value)
    setCopyMessage(copied ? 'Copied to clipboard.' : CLIPBOARD_COPY_ERROR)
  }

  if (session.isPending) {
    return (
      <PageFrame>
        <LoadingState stages={['Checking your session...']} />
      </PageFrame>
    )
  }

  if (!session.data) return <SignInPrompt />

  return (
    <PageFrame>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            Saved endpoints
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-muted">
            Reusable URLs that fetch live data from your saved sheet recipes.
            Every request requires your API key and can read only your
            endpoints.
          </p>
        </div>
        <Link
          to="/docs"
          className="text-sm font-medium text-ink-strong underline underline-offset-4"
        >
          API documentation
        </Link>
      </header>

      {endpoints.isPending ? (
        <div className="rounded-lg border border-line bg-surface p-6">
          <LoadingState stages={['Loading endpoints...']} />
        </div>
      ) : endpoints.isError ? (
        <p
          role="alert"
          className="rounded-lg border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger-muted"
        >
          {endpoints.error.message}
        </p>
      ) : endpoints.data.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-ink-strong">
            No saved endpoints yet
          </p>
          <p className="mt-1 text-sm text-ink-subtle">
            Extract a sheet, preview a query, then save it as a reusable API
            endpoint.
          </p>
          <Link
            to="/extract"
            search={{ auth: undefined, signedOut: undefined }}
            className="mt-4 inline-block rounded-md bg-ink px-4 py-2 text-sm font-semibold text-surface transition-colors hover:bg-ink-hover focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
          >
            Extract a sheet
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {endpoints.data.map((endpoint) => (
            <EndpointCard
              key={endpoint.id}
              endpoint={endpoint}
              origin={origin}
              copy={copy}
              isDeleting={remove.isPending && remove.variables === endpoint.id}
              onDelete={() => remove.mutate(endpoint.id)}
            />
          ))}
        </div>
      )}

      {remove.isError ? (
        <p
          role="alert"
          className="rounded-lg border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger-muted"
        >
          {remove.error.message}
        </p>
      ) : null}
      {copyMessage ? (
        <p role="status" className="text-xs text-ink-subtle">
          {copyMessage}
        </p>
      ) : null}
    </PageFrame>
  )
}

function EndpointCard({
  endpoint,
  origin,
  copy,
  isDeleting,
  onDelete,
}: {
  endpoint: SavedEndpointSummary
  origin: string
  copy: (value: string) => Promise<void>
  isDeleting: boolean
  onDelete: () => void
}) {
  const examples = buildSavedEndpointExamples(endpoint.id, origin)
  const params = new URLSearchParams(endpoint.query)
  const description = [
    params.get('select') ? `columns: ${params.get('select')}` : null,
    ...params.getAll('where').map((condition) => `where ${condition}`),
    params.get('sort') ? `sort: ${params.get('sort')}` : null,
    params.get('limit') ? `limit: ${params.get('limit')}` : null,
  ].filter((part): part is string => part !== null)

  return (
    <article className="rounded-xl border border-line bg-surface p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-ink">
            {endpoint.name}
          </h2>
          <p className="mt-1 text-xs text-ink-subtle">
            Created{' '}
            <time dateTime={endpoint.createdAt} suppressHydrationWarning>
              {formatAbsolute(endpoint.createdAt)}
            </time>
          </p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          disabled={isDeleting}
          className="shrink-0 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink-strong transition-colors hover:bg-danger-soft hover:text-danger disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
        >
          {isDeleting ? 'Deleting...' : 'Delete endpoint'}
        </button>
      </div>

      <p
        className="mt-4 truncate text-xs text-ink-subtle"
        title={endpoint.sourceUrl}
      >
        Source: <span className="font-mono">{endpoint.sourceUrl}</span>
      </p>
      <p className="mt-2 text-xs text-ink-subtle">
        {description.length > 0
          ? description.join(' · ')
          : 'All rows and columns'}
      </p>

      <code className="mt-4 block overflow-x-auto rounded-lg border border-line bg-surface-muted px-3 py-2.5 font-mono text-xs text-ink-strong">
        {examples.url || examples.path}
      </code>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void copy(examples.url)}
          className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink-strong transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
        >
          Copy URL
        </button>
        <button
          type="button"
          onClick={() => void copy(examples.curl)}
          className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink-strong transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
        >
          Copy cURL example
        </button>
        <button
          type="button"
          onClick={() => void copy(examples.javascript)}
          className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink-strong transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
        >
          Copy server-side JavaScript
        </button>
      </div>
    </article>
  )
}

function SignInPrompt() {
  return (
    <PageFrame>
      <div className="mx-auto max-w-lg space-y-4 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          Sign in to manage saved endpoints
        </h1>
        <p className="text-sm text-ink-muted">
          Endpoints are private to your account and require your API key to
          call.
        </p>
        <a
          href="/auth/google?redirect=/endpoints"
          className="inline-block rounded-md bg-ink px-4 py-2 text-sm font-semibold text-surface transition-colors hover:bg-ink-hover focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
        >
          Sign in with Google
        </a>
      </div>
    </PageFrame>
  )
}

function PageFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10 sm:py-14">
      {children}
    </div>
  )
}
