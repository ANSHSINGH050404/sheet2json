import type { Result } from './types'

/**
 * Turns a `Result` returned by a server function into a plain value, throwing a
 * message that is already safe to display.
 *
 * Used with TanStack Query so failures land in the query/mutation `error`
 * state, which keeps loading / success / error handling in one place.
 */
export function unwrap<T>(result: Result<T>): T {
  if (result.ok) {
    return result.data
  }
  throw new Error(result.error.message)
}

/** Absolute timestamp for `title`/`dateTime` attributes. */
export function formatAbsolute(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

/** Compact "2 min ago" style label. */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'unknown'

  const seconds = (now - then) / 1000
  if (Math.abs(seconds) < 45) return 'just now'

  // Each entry is "how many of this unit make up the next one up". We divide
  // while the remaining value is still >= the next unit's size, and remember the
  // last unit we actually divided by.
  const units = [
    { unit: 'minute', size: 60 },
    { unit: 'hour', size: 60 },
    { unit: 'day', size: 24 },
    { unit: 'month', size: 30.44 },
    { unit: 'year', size: 12 },
  ] as const

  let value = seconds
  let lastIndex = -1
  for (let i = 0; i < units.length; i += 1) {
    const entry = units[i]
    if (entry === undefined) break
    if (Math.abs(value) < entry.size) break
    value = value / entry.size
    lastIndex = i
  }

  const unit =
    lastIndex === -1 ? 'second' : (units[lastIndex]?.unit ?? 'second')
  const rounded = Math.round(value)
  if (rounded === 0) return 'just now'
  // Intl renders negative deltas as "... ago" and positive ones as "in ...".
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(
    -rounded,
    unit,
  )
}

/** 1204 -> "1,204" */
export function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value)
}

/** Short, readable fallback label when a sheet has no tab title in its URL. */
export function describeExtraction(
  spreadsheetId: string,
  title: string | null,
): string {
  return title && title.trim() !== '' ? title : `${spreadsheetId.slice(0, 8)}…`
}
