import type { ComponentType, ReactNode, SVGProps } from 'react'

import { CodeBlock } from '#components/code-block'
import {
  ArrowRightIcon,
  BracesIcon,
  CheckIcon,
  GaugeIcon,
  KeyIcon,
  LayersIcon,
  LockIcon,
  TerminalIcon,
} from '#components/landing/icons'

/** The API surface worth showing before anyone reads the reference. */
const QUICKSTART = `curl "https://sheet2json.app/api/v1/extract?url=$SHEET_URL" \\
  -H "Authorization: Bearer $S2J_KEY"`

const RATE_LIMIT_HEADERS = [
  { name: 'RateLimit-Limit', value: '1000' },
  { name: 'RateLimit-Remaining', value: '984' },
  { name: 'RateLimit-Reset', value: '1756492800' },
] as const

interface BentoCardProps {
  icon: ComponentType<SVGProps<SVGSVGElement>>
  title: string
  body: string
  className?: string
  children?: ReactNode
}

/** One cell of the grid: a bordered panel with a glyph, a claim, and a proof. */
function BentoCard({
  icon: Icon,
  title,
  body,
  className = '',
  children,
}: BentoCardProps) {
  return (
    <div
      className={`group flex flex-col rounded-lg border border-line bg-surface p-6 transition-[border-color,box-shadow] duration-200 hover:border-line-strong hover:shadow-[0_1px_3px_rgba(0,0,0,0.05)] ${className}`}
    >
      <span className="flex size-8 items-center justify-center rounded-md border border-line bg-surface-muted text-ink-muted transition-colors duration-200 group-hover:border-ink group-hover:bg-ink group-hover:text-surface">
        <Icon className="size-4" />
      </span>

      <h3 className="mt-5 text-base font-medium text-ink">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-pretty text-ink-muted">
        {body}
      </p>

      {children ? <div className="mt-auto pt-6">{children}</div> : null}
    </div>
  )
}

/** The feature grid: uneven spans, uniform cards, one proof per claim. */
export function BentoGrid() {
  return (
    <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:mt-16 lg:grid-cols-12">
      <BentoCard
        className="lg:col-span-7"
        icon={BracesIcon}
        title="Paste a link. Get rows."
        body="The first row of the sheet is treated as the header, so every extraction comes back keyed by column name &mdash; the same shape in the browser, in the API and in your history."
      >
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          <span className="min-w-0 truncate rounded-md border border-line bg-surface-muted px-3 py-2 text-ink-subtle">
            docs.google.com/spreadsheets/d/1Bxi&hellip;/edit
          </span>
          <ArrowRightIcon className="size-4 shrink-0 text-ink-faint" />
          <span className="rounded-md border border-line px-3 py-2 text-ink">
            {'[{ "name": "Ansh" }]'}
          </span>
        </div>
      </BentoCard>

      <BentoCard
        className="lg:col-span-5"
        icon={TerminalIcon}
        title="An endpoint, not a client library"
        body="No dependency to install, no SDK to keep in step with. One GET, and the sheet is data in your program."
      >
        <CodeBlock className="mt-0" code={QUICKSTART} />
      </BentoCard>

      <BentoCard
        className="lg:col-span-4"
        icon={LockIcon}
        title="Private sheets, read-only"
        body="Connect Google and your own private sheets come back too, read with your own permission and visible to nobody else."
      >
        <ul className="space-y-2 text-sm text-ink-muted">
          {[
            'spreadsheets.readonly, nothing else',
            'No Drive access, ever requested',
            'Never writes to your sheet',
          ].map((line) => (
            <li key={line} className="flex items-start gap-2">
              <CheckIcon className="mt-0.5 size-4 shrink-0 text-ink-faint" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </BentoCard>

      <BentoCard
        className="lg:col-span-4"
        icon={LayersIcon}
        title="JSON, CSV or NDJSON"
        body="One parameter picks the shape. CSV is re-quoted where it has to be, and NDJSON pipes straight into jq."
      >
        <div className="flex flex-wrap gap-1.5">
          {['json', 'csv', 'ndjson'].map((format) => (
            <span
              key={format}
              className="rounded-md border border-line bg-surface-muted px-2.5 py-1 font-mono text-xs text-ink-strong transition-colors duration-200 group-hover:border-line-strong"
            >
              {format}
            </span>
          ))}
        </div>
      </BentoCard>

      <BentoCard
        className="lg:col-span-4"
        icon={KeyIcon}
        title="Keys you can revoke"
        body="Keys are shown once, at creation, and kept only as a SHA-256 digest. Revoke one and it stops working on the next request."
      >
        <span className="inline-block rounded-md border border-line bg-surface-muted px-3 py-2 font-mono text-xs text-ink-strong">
          s2j_9f3c&hellip;a71d
        </span>
      </BentoCard>

      <BentoCard
        className="lg:col-span-12"
        icon={GaugeIcon}
        title="Limits you can see coming"
        body="Counters are per key, per hour and held in the database rather than in one server instance's memory. Every response tells you where you stand, so a client can slow down before it is turned away &mdash; and a 429 carries Retry-After when it is."
      >
        <dl className="grid gap-px overflow-hidden rounded-md border border-line bg-surface-sunken sm:grid-cols-3">
          {RATE_LIMIT_HEADERS.map((header) => (
            <div key={header.name} className="bg-surface px-4 py-3">
              <dt className="font-mono text-[11px] text-ink-faint">
                {header.name}
              </dt>
              <dd className="mt-1 font-mono text-sm text-ink tabular-nums">
                {header.value}
              </dd>
            </div>
          ))}
        </dl>
      </BentoCard>
    </div>
  )
}
