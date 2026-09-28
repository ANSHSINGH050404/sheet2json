import { Link } from '@tanstack/react-router'

import {
  ArrowRightIcon,
  BracesIcon,
  TerminalIcon,
} from '#components/landing/icons'

/** Columns shown in the hero's table preview, mirrored by the JSON pane. */
const PREVIEW_COLUMNS = ['name', 'email'] as const

/** The rows behind the two preview panes. Small, real-shaped, and consistent. */
const PREVIEW_ROWS = [
  { name: 'Ansh', email: 'ansh@example.com' },
  { name: 'Rahul', email: 'rahul@example.com' },
  { name: 'Priya', email: 'priya@example.com' },
] as const

/**
 * The landing hero: a promise, two actions, and a preview of the actual
 * response shape.
 *
 * The preview is deliberately a real table and real JSON rather than a mockup -
 * the sheet header row becoming object keys is the entire product, so showing it
 * is more convincing than any illustration of it.
 */
export function Hero() {
  return (
    <section className="relative isolate overflow-hidden border-b border-line">
      <div aria-hidden="true" className="glow absolute inset-0 -z-20" />
      <div aria-hidden="true" className="grid-lines absolute inset-0 -z-10" />

      <div className="mx-auto max-w-6xl px-6 pt-16 pb-20 sm:pt-24 sm:pb-28">
        <div className="mx-auto max-w-3xl text-center">
          <p
            className="animate-fade inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs text-ink-muted"
            style={{ animationDelay: '60ms' }}
          >
            <span className="size-1.5 rounded-full bg-ink" />
            Public sheets need no account
          </p>

          <h1
            className="animate-rise mt-6 text-4xl font-semibold tracking-[-0.03em] text-balance text-ink sm:text-6xl lg:text-7xl"
            style={{ animationDelay: '120ms' }}
          >
            Turn a spreadsheet into an endpoint.
          </h1>

          <p
            className="animate-rise mx-auto mt-6 max-w-2xl text-lg text-pretty text-ink-muted"
            style={{ animationDelay: '200ms' }}
          >
            Paste a link and get structured JSON. Or call one REST endpoint from
            a script, a webhook or a cron job &mdash; no SDK, no scraping, no
            OAuth plumbing.
          </p>

          <div
            className="animate-rise mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
            style={{ animationDelay: '280ms' }}
          >
            <Link
              to="/extract"
              search={{ auth: undefined, signedOut: undefined }}
              className="group inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-ink px-5 text-sm font-medium text-surface transition-colors hover:bg-ink-hover focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:outline-none sm:w-auto"
            >
              Start extracting
              <ArrowRightIcon className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
            <Link
              to="/docs"
              className="inline-flex h-11 w-full items-center justify-center rounded-md border border-line bg-surface px-5 text-sm font-medium text-ink transition-colors hover:border-line-strong hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:outline-none sm:w-auto"
            >
              Read the API docs
            </Link>
          </div>
        </div>

        <div
          className="animate-rise mt-16 overflow-hidden rounded-lg border border-line bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:mt-20"
          style={{ animationDelay: '380ms' }}
        >
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
            <span className="flex min-w-0 items-center gap-2 font-mono text-xs text-ink-subtle">
              <TerminalIcon className="size-4 shrink-0 text-ink-faint" />
              <span className="truncate">
                <span className="text-ink">GET</span>
                <span className="mx-2 text-ink-faint">/api/v1/extract</span>
                <span className="hidden sm:inline">?url=â€¦</span>
              </span>
            </span>
            <span className="shrink-0 font-mono text-xs text-ink-faint">
              200 &middot; 214ms
            </span>
          </div>

          <div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-y-0 sm:divide-x">
            <div className="overflow-hidden">
              <p className="border-b border-line px-4 py-2 text-[11px] font-medium tracking-[0.12em] text-ink-faint uppercase">
                Table
              </p>
              <table className="w-full text-left font-mono text-xs">
                <caption className="sr-only">
                  Extracted rows, keyed by the sheet header row
                </caption>
                <thead>
                  <tr className="border-b border-line">
                    {PREVIEW_COLUMNS.map((column) => (
                      <th
                        key={column}
                        scope="col"
                        className="px-4 py-2 font-medium text-ink-subtle"
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {PREVIEW_ROWS.map((row) => (
                    <tr key={row.email}>
                      <td className="px-4 py-2 text-ink">{row.name}</td>
                      <td className="px-4 py-2 text-ink-subtle">{row.email}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="overflow-hidden">
              <p className="border-b border-line px-4 py-2 text-[11px] font-medium tracking-[0.12em] text-ink-faint uppercase">
                JSON
              </p>
              <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-ink-strong">
                <span className="text-ink-faint">[</span>
                {'\n'}
                {PREVIEW_ROWS.map((row, index) => (
                  <span key={row.email} className="block pl-4">
                    <span className="text-ink-faint">{'{'}</span>
                    <span className="text-ink-subtle"> &quot;name&quot;</span>
                    <span className="text-ink-faint">: </span>
                    <span className="text-ink">&quot;{row.name}&quot;</span>
                    <span className="text-ink-subtle">, </span>
                    <span className="text-ink-subtle">&quot;email&quot;</span>
                    <span className="text-ink-faint">: </span>
                    <span className="text-ink">&quot;{row.email}&quot;</span>
                    <span className="text-ink-faint">
                      {'}'}
                      {index < PREVIEW_ROWS.length - 1 ? ',' : ''}
                    </span>
                  </span>
                ))}
                <span className="text-ink-faint">{']'}</span>
              </pre>
            </div>
          </div>

          <p className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-xs text-ink-subtle">
            <BracesIcon className="size-4 shrink-0 text-ink-faint" />
            The header row becomes the keys. Nothing to map, nothing to
            maintain.
          </p>
        </div>
      </div>
    </section>
  )
}

/** Clients worth naming. The API is plain HTTP, so the list is deliberately dull. */
const CLIENTS = [
  'curl',
  'wget',
  'fetch',
  'axios',
  'requests',
  'httpx',
  'net/http',
  'RestKit',
] as const

/** A hairline strip under the hero: what the API speaks to. */
export function ClientStrip() {
  return (
    <div className="border-b border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-5 sm:flex-row sm:items-center sm:gap-6">
        <p className="shrink-0 text-xs font-medium tracking-[0.12em] text-ink-faint uppercase">
          Anything that speaks HTTP
        </p>
        <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-xs text-ink-faint">
          {CLIENTS.map((client) => (
            <li key={client}>{client}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
