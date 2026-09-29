import { useId } from 'react'

import type { SheetAgentChartData } from '#lib/types'

const SERIES_COLORS = ['bg-ink', 'bg-success'] as const

/** Small responsive horizontal bar chart for the assistant's grouped totals. */
export function GroupedBarChart({ data }: { data: SheetAgentChartData }) {
  const chartId = useId()
  const maxValue = Math.max(
    0,
    ...data.series.flatMap((series) => series.values.map(Math.abs)),
  )

  if (data.categories.length === 0 || data.series.length === 0) return null

  return (
    <figure
      aria-labelledby={`${chartId}-title`}
      className="space-y-4 rounded-lg border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <figcaption
          id={`${chartId}-title`}
          className="text-sm font-semibold text-ink-strong"
        >
          Top {data.categories.length} groups by amount
        </figcaption>
        <ul aria-label="Chart legend" className="flex flex-wrap gap-3">
          {data.series.map((series, index) => (
            <li
              key={series.name}
              className="flex items-center gap-1.5 text-xs text-ink-muted"
            >
              <span
                aria-hidden="true"
                className={`size-2.5 rounded-full ${seriesColor(index)}`}
              />
              {series.name}
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-4">
        {data.categories.map((category, categoryIndex) => (
          <div
            key={category}
            className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(7rem,11rem)_1fr] sm:items-center sm:gap-4"
          >
            <p
              title={category}
              className="truncate text-xs font-medium text-ink-strong"
            >
              {category}
            </p>
            <div className="space-y-2">
              {data.series.map((series, seriesIndex) => {
                const value = series.values[categoryIndex] ?? 0
                const percentage =
                  maxValue === 0 ? 0 : (Math.abs(value) / maxValue) * 100

                return (
                  <div
                    key={series.name}
                    className="flex items-center gap-2"
                    aria-label={`${category}: ${series.name} ${formatNumber(value)}`}
                  >
                    <div
                      role="meter"
                      aria-label={`${series.name} for ${category}`}
                      aria-valuemin={0}
                      aria-valuemax={maxValue}
                      aria-valuenow={Math.abs(value)}
                      className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-sunken"
                    >
                      <span
                        aria-hidden="true"
                        className={`block h-full rounded-full ${seriesColor(seriesIndex)}`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                    <span className="w-20 shrink-0 text-right font-mono text-[11px] tabular-nums text-ink-subtle">
                      {formatNumber(value)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-ink-faint">
        Bar lengths are scaled to the largest amount shown.
      </p>
    </figure>
  )
}

function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length] ?? 'bg-ink'
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(value)
}
