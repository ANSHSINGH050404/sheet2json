import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useId, useMemo, useState } from 'react'
import type { SheetRow } from '#lib/types'

import { DataTable } from '#components/data-table'
import { LoadingState } from '#components/loading-state'
import { SheetAssistant } from '#components/sheet-assistant'
import { formatCount } from '#lib/format'

interface PublicSheetResponse {
  spreadsheetId: string
  gid: string | null
  title: string | null
  sourceUrl: string
  rowCount: number
  columnCount: number
  extractedAt: string
  data: SheetRow[]
}

const REFRESH_INTERVAL_MS = 5 * 60 * 1000

export const Route = createFileRoute('/view')({
  head: () => ({
    meta: [
      { title: 'Live table | Sheet2JSON' },
      { name: 'robots', content: 'noindex, nofollow' },
      {
        name: 'description',
        content: 'A searchable live table published from a Google Sheet.',
      },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    url: typeof search.url === 'string' ? search.url : undefined,
    embed: search.embed === '1',
  }),
  component: SharedSheetPage,
})

function SharedSheetPage() {
  const { url, embed } = Route.useSearch()
  const sheet = useQuery({
    queryKey: ['shared-sheet', url ?? ''],
    queryFn: () => fetchPublicSheet(url ?? ''),
    enabled: Boolean(url?.trim()),
    staleTime: 60_000,
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  })
  const [search, setSearch] = useState('')
  const searchId = useId()

  const rows = sheet.data?.data ?? []
  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return rows

    return rows.filter((row) =>
      Object.entries(row).some(
        ([column, value]) =>
          column.toLowerCase().includes(query) ||
          value.toLowerCase().includes(query),
      ),
    )
  }, [rows, search])

  if (!url?.trim()) {
    return (
      <PageFrame embed={embed}>
        <MessagePanel
          title="No sheet was specified"
          message="Open a shared table link or create one from the extractor."
          embed={embed}
        />
      </PageFrame>
    )
  }

  if (sheet.isPending) {
    return (
      <PageFrame embed={embed}>
        <LoadingState stages={['Loading live sheet...']} />
      </PageFrame>
    )
  }

  if (!sheet.data) {
    return (
      <PageFrame embed={embed}>
        <MessagePanel
          title="This sheet could not be loaded"
          message={sheet.error.message}
          embed={embed}
        />
      </PageFrame>
    )
  }

  const headers = Object.keys(sheet.data.data[0] ?? {})
  const title = sheet.data.title?.trim() || 'Shared Google Sheet'

  return (
    <PageFrame embed={embed}>
      <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
        <header className="border-b border-line px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold tracking-tight text-ink">
                {title}
              </h1>
              {!embed ? (
                <a
                  href={sheet.data.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-1 inline-block max-w-full truncate font-mono text-xs text-ink-subtle underline-offset-2 hover:text-ink hover:underline"
                >
                  Open source sheet
                </a>
              ) : null}
            </div>
            <div className="text-right text-xs text-ink-subtle">
              <p>
                {formatCount(sheet.data.rowCount)} rows ·{' '}
                {formatCount(sheet.data.columnCount)} columns
              </p>
              <p className="mt-1">
                Updated{' '}
                <time dateTime={sheet.data.extractedAt}>
                  {new Date(sheet.data.extractedAt).toLocaleString()}
                </time>
              </p>
            </div>
          </div>
        </header>

        <div className="space-y-4 px-4 py-4 sm:px-5">
          {sheet.isError ? (
            <p
              role="alert"
              className="rounded-lg border border-warning-line bg-warning-soft px-3 py-2 text-xs text-warning"
            >
              Could not refresh the sheet. Showing the last loaded data.
            </p>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="w-full sm:max-w-sm">
              <label
                htmlFor={searchId}
                className="mb-1.5 block text-xs font-medium text-ink-muted"
              >
                Search all columns
              </label>
              <input
                id={searchId}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Type to filter rows..."
                className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-ink/10"
              />
            </div>
            <button
              type="button"
              onClick={() => void sheet.refetch()}
              disabled={sheet.isFetching}
              className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-ink-strong transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
            >
              {sheet.isFetching ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          {filteredRows.length > 0 ? (
            <DataTable
              rows={filteredRows}
              columns={headers}
              caption={`Live Google Sheet with ${filteredRows.length} matching rows`}
            />
          ) : (
            <p className="rounded-lg border border-dashed border-line-strong px-4 py-8 text-center text-sm text-ink-subtle">
              No rows match “{search.trim()}”.
            </p>
          )}
        </div>
      </section>

      <div className="mt-5">
        <SheetAssistant
          rows={sheet.data.data}
          title={title}
          dataVersion={sheet.data.extractedAt}
        />
      </div>

      <p className="mt-3 text-right text-xs text-ink-faint">
        <a
          href="/"
          target={embed ? '_blank' : undefined}
          rel={embed ? 'noreferrer' : undefined}
          className="underline decoration-line-strong underline-offset-2 hover:text-ink-muted"
        >
          Powered by Sheet2JSON
        </a>
        {' · '}Refreshes automatically every 5 minutes
      </p>
    </PageFrame>
  )
}

function PageFrame({
  embed,
  children,
}: {
  embed: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={
        embed
          ? 'w-full p-2 sm:p-3'
          : 'mx-auto w-full max-w-6xl px-6 py-10 sm:py-14'
      }
    >
      {children}
    </div>
  )
}

function MessagePanel({
  title,
  message,
  embed,
}: {
  title: string
  message: string
  embed: boolean
}) {
  return (
    <section className="rounded-xl border border-line bg-surface px-5 py-8 text-center shadow-sm">
      <h1 className="text-lg font-semibold text-ink">{title}</h1>
      <p role="alert" className="mx-auto mt-2 max-w-xl text-sm text-ink-muted">
        {message}
      </p>
      <Link
        to="/extract"
        search={{ auth: undefined, signedOut: undefined }}
        target={embed ? '_blank' : undefined}
        className="mt-5 inline-flex rounded-md bg-ink px-4 py-2 text-sm font-semibold text-surface transition-colors hover:bg-ink-hover focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
      >
        Create a live table
      </Link>
    </section>
  )
}

async function fetchPublicSheet(url: string): Promise<PublicSheetResponse> {
  const query = new URLSearchParams({ url: url.trim() })
  const response = await fetch(`/api/v1/extract?${query.toString()}`, {
    cache: 'no-store',
  })

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new Error('The sheet service returned an invalid response.')
  }

  if (!response.ok) {
    const message = getErrorMessage(body)
    if (response.status === 403) {
      throw new Error(
        'This table works only with sheets shared as “Anyone with the link” with Viewer access.',
      )
    }
    throw new Error(message ?? 'Could not load this Google Sheet.')
  }

  return body as PublicSheetResponse
}

function getErrorMessage(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const error = (body as { error?: unknown }).error
  if (typeof error !== 'object' || error === null) return null
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' ? message : null
}
