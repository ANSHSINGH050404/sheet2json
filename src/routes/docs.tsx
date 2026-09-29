import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

import { CodeBlock } from '#components/code-block'
import { useSessionUser } from '#hooks/use-session'
import { isGoogleAuthConfigured } from '#server/config'

/**
 * `/docs` - the API reference.
 *
 * Written as a page rather than a generated OpenAPI document because the thing a
 * new user needs is a copy-pasteable `curl`, not a schema. `GET /api/v1` returns
 * the same information as JSON for tools that want to read it programmatically.
 */
export const Route = createFileRoute('/docs')({ component: DocsPage })

function DocsPage() {
  const session = useSessionUser()
  const isSignedIn = Boolean(session.data)

  return (
    <div className="mx-auto max-w-3xl space-y-10 px-6 py-10 sm:py-14">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-ink">API</h1>
        <p className="mt-2 text-base text-ink-muted">
          Read any Google Sheet you can access as JSON, CSV or NDJSON. One
          request, no SDK.
        </p>
      </header>

      <QuickStart isSignedIn={isSignedIn} />
      <Authentication isSignedIn={isSignedIn} />
      <ExtractEndpoint />
      <QuerySection />
      <OtherEndpoints />
      <PrivateSheets isSignedIn={isSignedIn} />
      <Limits />
      <Errors />
    </div>
  )
}

function QuickStart({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <section aria-labelledby="quickstart">
      <h2
        id="quickstart"
        className="text-lg font-semibold tracking-tight text-ink"
      >
        Quick start
      </h2>
      <p className="mt-2 text-sm text-ink-muted">
        This works immediately, with no account:
      </p>
      <CodeBlock
        className="mt-3"
        code={`curl "https://sheet2json.app/api/v1/extract?url=https://docs.google.com/spreadsheets/d/SHEET_ID/edit"`}
      />
      <p className="mt-3 text-sm text-ink-muted">
        With a key, you get a much higher rate limit and can read private
        sheets:
      </p>
      <CodeBlock
        className="mt-3"
        code={`curl "https://sheet2json.app/api/v1/extract?url=https://docs.google.com/spreadsheets/d/SHEET_ID/edit" \\
  -H "Authorization: Bearer s2j_your_key_here"`}
      />
      {!isSignedIn ? (
        <p className="mt-3 text-sm text-ink-muted">
          <a
            href="/auth/google?redirect=/settings"
            className="font-medium text-ink-strong underline-offset-2 hover:underline"
          >
            Sign in with Google
          </a>{' '}
          to create a key in Settings.
        </p>
      ) : null}
    </section>
  )
}

function Authentication({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <section aria-labelledby="auth">
      <h2 id="auth" className="text-lg font-semibold tracking-tight text-ink">
        Authentication
      </h2>
      <p className="mt-2 text-sm text-ink-muted">
        Pass your key as a bearer token. Keys are created in{' '}
        {isSignedIn ? (
          <a
            href="/settings"
            className="font-medium text-ink-strong underline-offset-2 hover:underline"
          >
            Settings
          </a>
        ) : (
          'Settings'
        )}{' '}
        and shown exactly once, when created.
      </p>
      <CodeBlock
        className="mt-3"
        code={`Authorization: Bearer s2j_xxxxxxxxxxxxxxxxxxxxxxxx`}
      />
      <p className="mt-3 text-sm text-ink-muted">
        A key can be revoked at any time, which takes effect immediately.
        Requests with no key are still served, under a much smaller per-IP
        limit, so try the API before signing up for anything.
      </p>
    </section>
  )
}

function ExtractEndpoint() {
  const [format, setFormat] = useState<'json' | 'csv' | 'ndjson'>('json')

  const suffix = format === 'json' ? '' : `&format=${format}`

  return (
    <section aria-labelledby="extract">
      <h2
        id="extract"
        className="text-lg font-semibold tracking-tight text-ink"
      >
        <code className="font-mono text-base">GET /api/v1/extract</code>
      </h2>
      <p className="mt-2 text-sm text-ink-muted">
        Extracts one sheet tab into JSON rows keyed by the header row.
      </p>

      <div className="mt-3 overflow-hidden rounded-lg border border-line">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-surface-muted">
            <tr>
              <th
                scope="col"
                className="border-b border-line px-3 py-2 text-left text-xs font-semibold tracking-wide text-ink-muted uppercase"
              >
                Parameter
              </th>
              <th
                scope="col"
                className="border-b border-line px-3 py-2 text-left text-xs font-semibold tracking-wide text-ink-muted uppercase"
              >
                Required
              </th>
              <th
                scope="col"
                className="border-b border-line px-3 py-2 text-left text-xs font-semibold tracking-wide text-ink-muted uppercase"
              >
                Description
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-line/60">
              <td className="px-3 py-2 font-mono text-xs text-ink-strong">
                url
              </td>
              <td className="px-3 py-2 text-xs text-ink-muted">yes</td>
              <td className="px-3 py-2 text-xs text-ink-muted">
                The Google Sheets URL. A{' '}
                <code className="font-mono">#gid=</code> fragment selects one
                tab.
              </td>
            </tr>
            <tr>
              <td className="px-3 py-2 font-mono text-xs text-ink-strong">
                format
              </td>
              <td className="px-3 py-2 text-xs text-ink-muted">no</td>
              <td className="px-3 py-2 text-xs text-ink-muted">
                <code className="font-mono">json</code> (default),{' '}
                <code className="font-mono">csv</code> or{' '}
                <code className="font-mono">ndjson</code>.
              </td>
            </tr>
            <tr className="border-b border-line/60">
              <td className="px-3 py-2 font-mono text-xs text-ink-strong">
                select
              </td>
              <td className="px-3 py-2 text-xs text-ink-muted">no</td>
              <td className="px-3 py-2 text-xs text-ink-muted">
                Comma-separated columns to keep, in that order.{' '}
                <a href="#query" className="underline underline-offset-2">
                  See below.
                </a>
              </td>
            </tr>
            <tr className="border-b border-line/60">
              <td className="px-3 py-2 font-mono text-xs text-ink-strong">
                where
              </td>
              <td className="px-3 py-2 text-xs text-ink-muted">no</td>
              <td className="px-3 py-2 text-xs text-ink-muted">
                One filter, e.g.{' '}
                <code className="font-mono">where=role=Developer</code>. Repeat
                it to AND several together.
              </td>
            </tr>
            <tr className="border-b border-line/60">
              <td className="px-3 py-2 font-mono text-xs text-ink-strong">
                sort
              </td>
              <td className="px-3 py-2 text-xs text-ink-muted">no</td>
              <td className="px-3 py-2 text-xs text-ink-muted">
                Columns to order by. A leading{' '}
                <code className="font-mono">-</code> sorts descending.
              </td>
            </tr>
            <tr>
              <td className="px-3 py-2 font-mono text-xs text-ink-strong">
                limit
              </td>
              <td className="px-3 py-2 text-xs text-ink-muted">no</td>
              <td className="px-3 py-2 text-xs text-ink-muted">
                Most rows to return, applied after filtering and sorting.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div
        role="tablist"
        aria-label="Response format"
        className="mt-4 inline-flex rounded-lg border border-line bg-surface-muted p-0.5"
      >
        {(['json', 'csv', 'ndjson'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={format === option}
            onClick={() => setFormat(option)}
            className={`rounded-md px-3 py-1.5 font-mono text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ink-subtle ${
              format === option
                ? 'bg-surface text-ink shadow-sm'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      <CodeBlock
        className="mt-3"
        code={`curl "https://sheet2json.app/api/v1/extract?url=${'https://docs.google.com/spreadsheets/d/SHEET_ID/edit'}${suffix}" \\
  -H "Authorization: Bearer s2j_your_key_here"`}
      />

      {format === 'json' ? (
        <>
          <p className="mt-3 text-sm text-ink-muted">Response:</p>
          <CodeBlock
            className="mt-3"
            language="json"
            code={`{
  "spreadsheetId": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
  "gid": "0",
  "title": "Leads",
  "sourceUrl": "https://docs.google.com/spreadsheets/d/1Bxi.../edit#gid=0",
  "rowCount": 2,
  "columnCount": 3,
  "extractedAt": "2026-09-28T16:00:00.000Z",
  "data": [
    { "name": "Ansh", "email": "ansh@example.com", "role": "Developer" },
    { "name": "Rahul", "email": "rahul@example.com", "role": "Designer" }
  ]
}`}
          />
        </>
      ) : (
        <p className="mt-3 text-sm text-ink-muted">
          {format === 'csv'
            ? 'CSV output re-quotes any value containing a comma, quote or newline, and prefixes values that spreadsheet software would otherwise treat as a formula.'
            : 'NDJSON is one JSON object per line, which pipes cleanly into jq or a line-by-line reader.'}
        </p>
      )}
    </section>
  )
}

function QuerySection() {
  const [example, setExample] = useState<string>(EXAMPLES[0].id)

  const active = EXAMPLES.find((entry) => entry.id === example) ?? EXAMPLES[0]

  return (
    <section aria-labelledby="query" className="border-t border-line pt-8">
      <h2 id="query" className="text-lg font-semibold tracking-tight text-ink">
        Narrowing the rows
      </h2>
      <p className="mt-2 text-sm text-ink-muted">
        The point of an endpoint rather than a CSV download: filter, order and
        cap the rows server-side, so pulling five rows out of nine hundred does
        not mean transferring all nine hundred. Parameters are applied in a
        fixed order &mdash; <code className="font-mono">where</code>, then{' '}
        <code className="font-mono">sort</code>, then{' '}
        <code className="font-mono">limit</code>, then{' '}
        <code className="font-mono">select</code>.
      </p>

      <div
        role="tablist"
        aria-label="Query example"
        className="mt-4 inline-flex flex-wrap rounded-lg border border-line bg-surface-muted p-0.5"
      >
        {EXAMPLES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={example === entry.id}
            onClick={() => setExample(entry.id)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ink-subtle ${
              example === entry.id
                ? 'bg-surface text-ink shadow-sm'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <CodeBlock className="mt-3" code={active.code} />
      <p className="mt-2 text-sm text-ink-muted">{active.note}</p>

      <div className="mt-6 overflow-hidden rounded-lg border border-line">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-surface-muted">
            <tr>
              <th
                scope="col"
                className="border-b border-line px-3 py-2 text-left text-xs font-semibold tracking-wide text-ink-muted uppercase"
              >
                Operator
              </th>
              <th
                scope="col"
                className="border-b border-line px-3 py-2 text-left text-xs font-semibold tracking-wide text-ink-muted uppercase"
              >
                Matches when
              </th>
            </tr>
          </thead>
          <tbody>
            {OPERATOR_HELP.map((row) => (
              <tr
                key={row.operator}
                className="border-b border-line/60 last:border-0"
              >
                <td className="px-3 py-2 font-mono text-xs text-ink-strong">
                  {row.operator}
                </td>
                <td className="px-3 py-2 text-xs text-ink-muted">
                  {row.description}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-sm text-ink-muted">
        A column that is not in the sheet is an error, not an empty result, so a
        typo is reported instead of looking like a sheet with no matching rows.
        Numbers are compared as numbers, so{' '}
        <code className="font-mono">where=amount&gt;100</code> does what it
        looks like rather than sorting{' '}
        <code className="font-mono">&quot;9&quot;</code> after{' '}
        <code className="font-mono">&quot;100&quot;</code>.
      </p>
    </section>
  )
}

/** Worked examples for the query parameters, shown one at a time. */
const EXAMPLES = [
  {
    id: 'filter',
    label: 'Filter',
    code: `curl "https://sheet2json.app/api/v1/extract?url=${'${SHEET_URL}'}&where=role=Developer" \\
  -H "Authorization: Bearer $S2J_KEY"`,
    note: 'Repeat where to AND filters together, so this one returns only developers named Ansh.',
  },
  {
    id: 'order',
    label: 'Top N',
    code: `curl "https://sheet2json.app/api/v1/extract?url=${'${SHEET_URL}'}&sort=-amount&limit=5" \\
  -H "Authorization: Bearer $S2J_KEY"`,
    note: 'Sorting runs before limiting, so this is the five largest rows rather than five arbitrary ones.',
  },
  {
    id: 'project',
    label: 'Only some columns',
    code: `curl "https://sheet2json.app/api/v1/extract?url=${'${SHEET_URL}'}&select=name,email" \\
  -H "Authorization: Bearer $S2J_KEY"`,
    note: 'The response carries only the columns you asked for, in the order you asked for them.',
  },
  {
    id: 'all',
    label: 'All together',
    code: `curl "https://sheet2json.app/api/v1/extract?url=${'${SHEET_URL}'} \\
  &where=status=Shipped&where=amount>=100 \\
  &sort=-amount&limit=10&select=name,amount" \\
  -H "Authorization: Bearer $S2J_KEY"`,
    note: 'The usual shape: narrow hard, then take only the fields you need.',
  },
] as const

const OPERATOR_HELP = [
  { operator: '=', description: 'the value is exactly this' },
  { operator: '!=', description: 'the value is anything but this' },
  { operator: '~', description: 'the value contains this, ignoring case' },
  {
    operator: '>',
    description: 'the value is greater (numbers compared as numbers)',
  },
  { operator: '>=', description: 'the value is greater or equal' },
  { operator: '<', description: 'the value is less' },
  { operator: '<=', description: 'the value is less or equal' },
]

function OtherEndpoints() {
  return (
    <section aria-labelledby="other">
      <h2 id="other" className="text-lg font-semibold tracking-tight text-ink">
        Other endpoints
      </h2>
      <dl className="mt-3 space-y-4">
        {[
          {
            method: 'GET',
            path: '/api/v1/me',
            description:
              'Confirms a key works and reports the remaining quota. The first call to make when integrating.',
          },
          {
            method: 'GET',
            path: '/api/v1/extractions',
            description:
              'Lists the extractions saved from the web UI. Accepts an optional limit, 1 to 200.',
          },
          {
            method: 'GET',
            path: '/api/v1/extractions/{id}',
            description: 'Reads one saved extraction, including its rows.',
          },
          {
            method: 'DELETE',
            path: '/api/v1/extractions/{id}',
            description: 'Deletes one of your saved extractions.',
          },
        ].map((endpoint) => (
          <div key={endpoint.path}>
            <dt className="font-mono text-sm text-ink-strong">
              <span className="mr-2 rounded bg-surface-raised px-1.5 py-0.5 text-xs font-semibold text-ink-muted">
                {endpoint.method}
              </span>
              {endpoint.path}
            </dt>
            <dd className="mt-1 pl-1 text-sm text-ink-muted">
              {endpoint.description}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-sm text-ink-muted">
        All four require an API key. A resource belonging to another account
        reads as <code className="font-mono">404</code>, never{' '}
        <code className="font-mono">403</code>.
      </p>
    </section>
  )
}

function PrivateSheets({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <section aria-labelledby="private">
      <h2
        id="private"
        className="text-lg font-semibold tracking-tight text-ink"
      >
        Private sheets
      </h2>
      <p className="mt-2 text-sm text-ink-muted">
        A key on its own cannot read a private sheet. Google only returns a
        sheet to an account that has permission to open it, so reading your own
        private data requires connecting your Google account with read-only
        access.
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-muted">
        <li>
          Access tokens are stored encrypted and are never exposed to the API.
        </li>
        <li>
          The app requests{' '}
          <code className="font-mono">spreadsheets.readonly</code> and nothing
          else &mdash; no Drive access.
        </li>
        <li>Nothing is ever written to your spreadsheet.</li>
        <li>
          Disconnecting, in Settings, deletes the stored tokens immediately.
        </li>
      </ul>
      {!isSignedIn ? (
        <p className="mt-3 text-sm text-ink-muted">
          <a
            href="/auth/google?redirect=/settings"
            className="font-medium text-ink-strong underline-offset-2 hover:underline"
          >
            Connect your Google account
          </a>{' '}
          to enable this.
        </p>
      ) : null}
      {!isGoogleAuthConfigured() ? (
        <p className="mt-3 rounded-lg border border-warning-line bg-warning-soft px-4 py-3 text-sm text-warning">
          Google sign-in is not configured on this deployment, so private sheets
          cannot be read here.
        </p>
      ) : null}
    </section>
  )
}

function Limits() {
  return (
    <section aria-labelledby="limits">
      <h2 id="limits" className="text-lg font-semibold tracking-tight text-ink">
        Rate limits
      </h2>
      <p className="mt-2 text-sm text-ink-muted">
        Limits are per hour, per credential. Every response carries{' '}
        <code className="font-mono">RateLimit-Limit</code>,{' '}
        <code className="font-mono">RateLimit-Remaining</code> and{' '}
        <code className="font-mono">RateLimit-Reset</code>, so a client can slow
        down before it is rejected rather than after. A{' '}
        <code className="font-mono">429</code> also carries{' '}
        <code className="font-mono">Retry-After</code>.
      </p>
      <p className="mt-2 text-sm text-ink-muted">
        Successful extractions are cached briefly, so polling is cheaper than it
        looks and will not be double-charged against your limit.
      </p>
    </section>
  )
}

function Errors() {
  return (
    <section aria-labelledby="errors">
      <h2 id="errors" className="text-lg font-semibold tracking-tight text-ink">
        Errors
      </h2>
      <p className="mt-2 text-sm text-ink-muted">
        Errors come back as JSON with a stable code, so you can branch on them:
      </p>
      <CodeBlock
        className="mt-3"
        language="json"
        code={`{
  "error": {
    "code": "SHEET_NOT_ACCESSIBLE",
    "message": "This Google Sheet could not be accessed. ..."
  }
}`}
      />
      <ul className="mt-3 space-y-1 text-sm text-ink-muted">
        <li>
          <code className="font-mono">400</code> &mdash; a missing or malformed
          parameter, including an unknown column in a query
        </li>
        <li>
          <code className="font-mono">401</code> &mdash; no key, or an unknown
          or revoked one
        </li>
        <li>
          <code className="font-mono">403</code> &mdash; the sheet is private
          and the account cannot open it
        </li>
        <li>
          <code className="font-mono">404</code> &mdash; no such extraction
        </li>
        <li>
          <code className="font-mono">413</code> &mdash; the sheet exceeds the
          row limit
        </li>
        <li>
          <code className="font-mono">429</code> &mdash; rate limited
        </li>
      </ul>
    </section>
  )
}
