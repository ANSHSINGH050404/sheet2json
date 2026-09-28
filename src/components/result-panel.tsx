import { useId, useState } from 'react'
import type { KeyboardEvent } from 'react'

import { DataTable } from '#components/data-table'
import { JsonViewer } from '#components/json-viewer'
import { describeExtraction, formatCount } from '#lib/format'
import type { ExtractionDetail } from '#lib/types'

export interface ResultPanelProps {
  extraction: ExtractionDetail
  /** Rendered on the right of the header, e.g. a "View in history" link. */
  action?: React.ReactNode
}

type TabId = 'table' | 'json'

/**
 * The extraction result: summary stats plus a Table / JSON tab switch.
 *
 * Shared by the home page (fresh extraction) and the history detail page so
 * both render stored data identically.
 */
export function ResultPanel({ extraction, action }: ResultPanelProps) {
  const tabs: ReadonlyArray<{ id: TabId; label: string }> = [
    { id: 'table', label: 'Table' },
    { id: 'json', label: 'JSON' },
  ]
  const [active, setActive] = useState<TabId>('table')
  const tabBaseId = useId()

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const index = tabs.findIndex((tab) => tab.id === active)
    const delta = event.key === 'ArrowRight' ? 1 : -1
    const next = tabs[(index + delta + tabs.length) % tabs.length]
    if (next) setActive(next.id)
  }

  const headers = useColumnOrder(extraction)

  return (
    <section
      aria-label="Extraction result"
      className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
    >
      <div className="border-b border-slate-200 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-900">
              {describeExtraction(extraction.spreadsheetId, extraction.title)}
            </h2>
            <a
              href={extraction.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 inline-block max-w-full truncate font-mono text-xs text-slate-500 underline-offset-2 hover:text-indigo-700 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              {extraction.sourceUrl}
            </a>
          </div>
          {action}
        </div>

        <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div>
            <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              Rows
            </dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
              {formatCount(extraction.rowCount)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              Columns
            </dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
              {formatCount(extraction.columnCount)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              Extracted
            </dt>
            <dd className="mt-0.5 text-sm text-slate-700">
              {new Date(extraction.createdAt).toLocaleString()}
            </dd>
          </div>
        </dl>
      </div>

      <div className="px-4 py-4 sm:px-5">
        <div
          role="tablist"
          aria-label="Result view"
          onKeyDown={onKeyDown}
          className="mb-4 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5"
        >
          {tabs.map((tab) => {
            const selected = tab.id === active
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`${tabBaseId}-tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={`${tabBaseId}-panel-${tab.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(tab.id)}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 ${
                  selected
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            )
          })}
        </div>

        <div
          role="tabpanel"
          id={`${tabBaseId}-panel-${active}`}
          aria-labelledby={`${tabBaseId}-tab-${active}`}
          tabIndex={0}
          className="focus:outline-none"
        >
          {active === 'table' ? (
            <DataTable
              rows={extraction.data}
              columns={headers}
              caption={`Extracted data with ${extraction.rowCount} rows and ${extraction.columnCount} columns`}
            />
          ) : (
            <JsonViewer
              data={extraction.data}
              fileName={extraction.title ?? extraction.spreadsheetId}
            />
          )}
        </div>
      </div>
    </section>
  )
}

/**
 * Column order comes from the first stored row. The stored JSON preserves the
 * original header order, so no extra column metadata is needed.
 */
function useColumnOrder(extraction: ExtractionDetail): string[] {
  const first = extraction.data[0]
  return first ? Object.keys(first) : []
}
