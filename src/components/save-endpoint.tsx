import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useMemo, useState } from 'react'

import { DataTable } from '#components/data-table'
import { useSessionUser } from '#hooks/use-session'
import { savedEndpointsQueryKey } from '#hooks/use-saved-endpoints'
import { describeSelectedSheetTab, prepareEndpointQuery } from '#lib/endpoints'
import type { EndpointQueryDraft } from '#lib/endpoints'
import { formatCount, unwrap } from '#lib/format'
import type { SheetRow } from '#lib/types'
import { createSavedEndpointFn } from '#server/api/endpoints'

export interface SaveEndpointProps {
  sourceUrl: string
  rows: SheetRow[]
  suggestedName: string
}

const EMPTY_DRAFT: EndpointQueryDraft = {
  columns: '',
  where: '',
  sort: '',
  limit: '',
}

/** A form to preview and save a live, owner-protected API recipe. */
export function SaveEndpoint({
  sourceUrl,
  rows,
  suggestedName,
}: SaveEndpointProps) {
  const session = useSessionUser()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(suggestedName.slice(0, 80))
  const [draft, setDraft] = useState<EndpointQueryDraft>(EMPTY_DRAFT)
  const [origin, setOrigin] = useState('')
  const [copiedMessage, setCopiedMessage] = useState<string | null>(null)
  const nameId = useId()
  const columnsId = useId()
  const whereId = useId()
  const sortId = useId()
  const limitId = useId()
  const formId = useId()
  const selectedTab = describeSelectedSheetTab(sourceUrl)

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  const preview = useMemo(() => {
    try {
      return { data: prepareEndpointQuery(rows, draft), error: null }
    } catch (error) {
      return {
        data: null,
        error:
          error instanceof Error
            ? error.message
            : 'This endpoint recipe could not be previewed.',
      }
    }
  }, [draft, rows])

  const create = useMutation({
    mutationFn: () => {
      if (!preview.data) {
        throw new Error(preview.error)
      }
      return createSavedEndpointFn({
        data: {
          name,
          sourceUrl,
          query: preview.data.query,
        },
      }).then(unwrap)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: savedEndpointsQueryKey })
    },
  })

  async function copy(value: string, message: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedMessage(message)
    } catch {
      setCopiedMessage(
        'Could not copy. Check your browser clipboard permissions.',
      )
    }
  }

  const savedEndpoint = create.data
  const endpointPath = savedEndpoint
    ? `/api/v1/endpoints/${savedEndpoint.id}`
    : ''
  const endpointUrl = endpointPath ? `${origin}${endpointPath}` : ''
  const curlExample = endpointUrl
    ? `curl "${endpointUrl}" -H "Authorization: Bearer YOUR_API_KEY"`
    : ''
  const javascriptExample = endpointUrl
    ? [
        `const response = await fetch("${endpointUrl}", {`,
        '  headers: { Authorization: "Bearer " + process.env.S2J_KEY },',
        '});',
        'const data = await response.json();',
      ].join('\n')
    : ''

  return (
    <section className="mt-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">
            Save as a live API endpoint
          </h3>
          <p className="mt-1 text-xs text-ink-subtle">
            Reuse this sheet and its filters at a stable URL. Requests require
            your API key.
          </p>
          <p className="mt-1 text-xs text-ink-subtle">
            Tab: {selectedTab}. To use another tab, select it in Google Sheets,
            copy its link, and extract that tab first.
          </p>
        </div>

        {session.data ? (
          savedEndpoint ? null : (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={formId}
              onClick={() => setOpen((current) => !current)}
              className="shrink-0 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink-strong transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
            >
              {open ? 'Close' : 'Create endpoint'}
            </button>
          )
        ) : session.isPending ? null : (
          <a
            href="/auth/google?redirect=/extract"
            className="shrink-0 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink-strong transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
          >
            Sign in to save
          </a>
        )}
      </div>

      {open && session.data && !savedEndpoint ? (
        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault()
            create.mutate()
          }}
          className="mt-4 space-y-4 rounded-lg border border-line bg-surface-muted p-4"
        >
          <div>
            <label
              htmlFor={nameId}
              className="block text-xs font-medium text-ink-strong"
            >
              Endpoint name
            </label>
            <input
              id={nameId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              required
              className="mt-1 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-ink/10"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              id={columnsId}
              label="Columns to keep"
              hint="Optional; comma-separated. Example: name,email"
              value={draft.columns}
              onChange={(columns) =>
                setDraft((current) => ({ ...current, columns }))
              }
              placeholder="name, email"
            />
            <Field
              id={sortId}
              label="Sort by"
              hint="Optional; prefix a column with - for descending."
              value={draft.sort}
              onChange={(sort) => setDraft((current) => ({ ...current, sort }))}
              placeholder="-amount, name"
            />
            <div className="sm:col-span-2">
              <label
                htmlFor={whereId}
                className="block text-xs font-medium text-ink-strong"
              >
                Filters
              </label>
              <textarea
                id={whereId}
                value={draft.where}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    where: event.target.value,
                  }))
                }
                rows={2}
                placeholder={'One per line, e.g. status=Ready\namount>=100'}
                className="mt-1 w-full resize-y rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-ink/10"
              />
              <p className="mt-1 text-[11px] text-ink-subtle">
                Conditions are ANDed. Supported operators: =, !=, ~, &gt;,
                &gt;=, &lt;, &lt;=.
              </p>
            </div>
            <Field
              id={limitId}
              label="Maximum rows"
              hint="Optional; 1 to 10,000."
              value={draft.limit}
              onChange={(limit) =>
                setDraft((current) => ({ ...current, limit }))
              }
              placeholder="100"
              inputMode="numeric"
            />
          </div>

          {preview.error ? (
            <p
              role="alert"
              className="rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-xs text-danger-muted"
            >
              {preview.error}
            </p>
          ) : preview.data ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-ink-strong">
                Preview: {formatCount(preview.data.rows.length)} rows,{' '}
                {formatCount(preview.data.columns.length)} columns
              </p>
              <DataTable
                rows={preview.data.rows.slice(0, 5)}
                columns={preview.data.columns}
                caption="Preview of the saved endpoint query"
              />
            </div>
          ) : null}

          {create.isError ? (
            <p
              role="alert"
              className="rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-xs text-danger-muted"
            >
              {create.error.message}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11px] text-ink-subtle">
              The API returns JSON by default; add{' '}
              <code className="font-mono">?format=csv</code> or{' '}
              <code className="font-mono">?format=ndjson</code> for other
              formats.
            </p>
            <button
              type="submit"
              disabled={
                create.isPending || name.trim() === '' || preview.data === null
              }
              className="rounded-md bg-ink px-4 py-2 text-xs font-semibold text-surface transition-colors hover:bg-ink-hover focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {create.isPending ? 'Checking and saving...' : 'Save endpoint'}
            </button>
          </div>
        </form>
      ) : null}

      {savedEndpoint ? (
        <div className="mt-4 space-y-3 rounded-lg border border-line bg-success-soft p-4">
          <p role="status" className="text-sm font-semibold text-success">
            “{savedEndpoint.name}” is ready. It reads the latest sheet data when
            requested; short-lived caching avoids repeated upstream reads.
          </p>
          <code className="block overflow-x-auto rounded bg-surface px-3 py-2 font-mono text-xs text-ink-strong">
            {endpointUrl || endpointPath}
          </code>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copy(endpointUrl, 'Endpoint URL copied.')}
              className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink-strong transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
            >
              Copy endpoint URL
            </button>
            <button
              type="button"
              onClick={() => void copy(curlExample, 'cURL example copied.')}
              className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink-strong transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
            >
              Copy cURL example
            </button>
            <button
              type="button"
              onClick={() =>
                void copy(javascriptExample, 'JavaScript example copied.')
              }
              className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink-strong transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
            >
              Copy server-side JavaScript
            </button>
            <a
              href="/settings"
              className="self-center text-xs font-medium text-ink-strong underline underline-offset-2"
            >
              Manage API keys
            </a>
          </div>
          {copiedMessage ? (
            <p role="status" className="text-xs text-ink-subtle">
              {copiedMessage}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function Field({
  id,
  label,
  hint,
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  id: string
  label: string
  hint: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  inputMode?: 'numeric'
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-ink-strong">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className="mt-1 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-ink/10"
      />
      <p className="mt-1 text-[11px] text-ink-subtle">{hint}</p>
    </div>
  )
}
