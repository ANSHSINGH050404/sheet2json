import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { LoadingState } from '#components/loading-state'
import { sessionQueryKey, useSessionUser } from '#hooks/use-session'
import { formatAbsolute, unwrap } from '#lib/format'
import {
  createApiKeyFn,
  listApiKeysFn,
  revokeApiKeyFn,
} from '#server/api/api-keys'
import { disconnectGoogleFn } from '#server/api/auth'
import type { ApiKeySummary, CreatedApiKey } from '#lib/types'

/**
 * `/settings` - the account page: the Google connection and API keys.
 *
 * A key is shown exactly once, here, right after it is created. It is not
 * recoverable afterwards, which is the point of storing only its digest.
 */
export const Route = createFileRoute('/settings')({ component: SettingsPage })

function SettingsPage() {
  const session = useSessionUser()

  if (session.isPending) {
    return <LoadingState stages={['Checking your session...']} />
  }

  if (!session.data) {
    return <SignInPrompt />
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 py-10 sm:py-14">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Settings</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Signed in as {session.data.email}
        </p>
      </header>

      <GoogleConnection />
      <ApiKeys />
    </div>
  )
}

function SignInPrompt() {
  return (
    <div className="mx-auto max-w-lg space-y-4 text-center">
      <h1 className="text-2xl font-bold tracking-tight text-ink">
        Sign in to manage your account
      </h1>
      <p className="text-sm text-ink-muted">
        API keys and private-sheet access are tied to your Google account.
      </p>
      <a
        href="/auth/google?redirect=/settings"
        className="inline-block rounded-md bg-ink px-4 py-2 text-sm font-semibold text-surface transition-colors hover:bg-ink-hover focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
      >
        Sign in with Google
      </a>
    </div>
  )
}

/**
 * The Google connection, which is what unlocks private sheets.
 *
 * Disconnecting is reversible - reconnecting is a fresh consent - so it is
 * presented as an ordinary option rather than a destructive one.
 */
function GoogleConnection() {
  const session = useSessionUser()
  const queryClient = useQueryClient()

  const disconnect = useMutation({
    mutationFn: () => disconnectGoogleFn().then(unwrap),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionQueryKey })
    },
  })

  const connected = session.data?.googleConnected ?? false

  return (
    <section
      aria-label="Google account"
      className="rounded-xl border border-line bg-surface p-5 shadow-sm sm:p-6"
    >
      <h2 className="text-base font-semibold text-ink">Google account</h2>

      <p className="mt-2 text-sm text-ink-muted">
        {connected
          ? 'Connected. Sheet2JSON can read private spreadsheets you have access to, using read-only permission. Nothing is ever written to your sheets.'
          : 'Not connected. Only public spreadsheets can be read. Connect to read your own private ones.'}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {connected ? (
          <>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-xs font-semibold text-success">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-success-dot"
              />
              Connected
            </span>
            <button
              type="button"
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
              className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink-strong transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
            >
              {disconnect.isPending ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </>
        ) : (
          <a
            href="/auth/google?redirect=/settings"
            className="rounded-md bg-ink px-3 py-1.5 text-sm font-semibold text-surface transition-colors hover:bg-ink-hover focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
          >
            Connect Google account
          </a>
        )}
      </div>

      {disconnect.isError ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {disconnect.error.message}
        </p>
      ) : null}
    </section>
  )
}

/** API key management. */
function ApiKeys() {
  const [name, setName] = useState('')
  const [created, setCreated] = useState<CreatedApiKey | null>(null)
  const [copied, setCopied] = useState(false)
  const queryClient = useQueryClient()
  const session = useSessionUser()

  const keys = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => listApiKeysFn().then(unwrap),
    enabled: Boolean(session.data),
  })

  const create = useMutation({
    mutationFn: (label: string) =>
      createApiKeyFn({ data: { name: label } }).then(unwrap),
    onSuccess: (result) => {
      setCreated(result)
      setName('')
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] })
    },
  })

  const revoke = useMutation({
    // The validator is the bare id, so it is the whole argument - not `{ data: }`.
    mutationFn: (id: string) => revokeApiKeyFn({ data: id }).then(unwrap),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] })
    },
  })

  async function copyKey() {
    if (created === null) return
    try {
      await navigator.clipboard.writeText(created.key)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be denied in an insecure context. The key is on
      // screen and selectable either way, so this is not worth an error state.
    }
  }

  return (
    <section
      aria-label="API keys"
      className="rounded-xl border border-line bg-surface p-5 shadow-sm sm:p-6"
    >
      <h2 className="text-base font-semibold text-ink">API keys</h2>
      <p className="mt-2 text-sm text-ink-muted">
        Use a key to call the API from your own code. Give each integration its
        own key, so you can revoke them independently.
      </p>

      {created !== null ? (
        <div className="mt-4 rounded-lg border border-warning-line bg-warning-soft p-4">
          <p className="text-sm font-semibold text-warning">
            Copy this key now. It is not shown again.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded bg-surface px-3 py-2 font-mono text-xs text-ink-strong">
              {created.key}
            </code>
            <button
              type="button"
              onClick={copyKey}
              className="shrink-0 rounded-md bg-ink px-3 py-2 text-xs font-semibold text-surface transition-colors hover:bg-ink-hover focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate(name)
        }}
        className="mt-4 flex flex-col gap-3 sm:flex-row"
      >
        <label htmlFor="key-name" className="sr-only">
          Key name
        </label>
        <input
          id="key-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Production server"
          maxLength={80}
          className="flex-1 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink shadow-sm placeholder:text-ink-faint focus:border-line-strong focus:outline-none focus:ring-2 focus:ring-ink/10"
        />
        <button
          type="submit"
          disabled={create.isPending || name.trim() === ''}
          className="shrink-0 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-surface transition-colors hover:bg-ink-hover disabled:cursor-not-allowed disabled:bg-ink disabled:text-surface/50 focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
        >
          {create.isPending ? 'Creating...' : 'Create key'}
        </button>
      </form>

      {create.isError ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {create.error.message}
        </p>
      ) : null}

      <div className="mt-6">
        {keys.isPending ? (
          <LoadingState stages={['Loading keys...']} />
        ) : keys.data === undefined || keys.data.length === 0 ? (
          <p className="text-sm text-ink-subtle">No keys yet.</p>
        ) : (
          <ul className="divide-y divide-line/60 rounded-lg border border-line">
            {keys.data.map((apiKey) => (
              <KeyRow
                key={apiKey.id}
                apiKey={apiKey}
                isRevoking={revoke.isPending && revoke.variables === apiKey.id}
                onRevoke={() => revoke.mutate(apiKey.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {revoke.isError ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {revoke.error.message}
        </p>
      ) : null}
    </section>
  )
}

function KeyRow({
  apiKey,
  isRevoking,
  onRevoke,
}: {
  apiKey: ApiKeySummary
  isRevoking: boolean
  onRevoke: () => void
}) {
  const revoked = apiKey.revokedAt !== null

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink-strong">
          {apiKey.name}
          {revoked ? (
            <span className="ml-2 rounded bg-surface-raised px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-ink-subtle uppercase">
              Revoked
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 text-xs text-ink-subtle">
          <code className="font-mono">{apiKey.prefix}...</code>
          {' Â· created '}
          {formatAbsolute(apiKey.createdAt)}
          {apiKey.lastUsedAt
            ? ` Â· last used ${formatAbsolute(apiKey.lastUsedAt)}`
            : ' Â· never used'}
        </p>
      </div>

      {revoked ? null : (
        <button
          type="button"
          onClick={onRevoke}
          disabled={isRevoking}
          className="shrink-0 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink-strong transition-colors hover:bg-danger-soft hover:text-danger disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
        >
          {isRevoking ? 'Revoking...' : 'Revoke'}
        </button>
      )}
    </li>
  )
}
