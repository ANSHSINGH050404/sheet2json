import { AppError } from '#lib/errors'
import { QUERY_MAX_LIMIT } from './constants'
import type { SheetRow } from './types'

/**
 * The `?select` / `?where` / `?sort` / `?limit` layer.
 *
 * This is what answers "why not just fetch the CSV export yourself": the endpoint
 * can narrow, order and cap the rows server-side, so a caller pulling one tab of a
 * large sheet does not download all of it to throw most of it away.
 *
 * Deliberately not a query language. A handful of operators, no expressions, no
 * nesting, and no `eval` - the parameters arrive in a URL from an anonymous
 * caller, so the grammar has to be small enough to read in one sitting and to
 * reject without ambiguity.
 *
 * Values are always strings: the sheet is the source of truth and the parser
 * never guesses at types. A column that looks numeric is compared numerically,
 * which is what a caller means by `?where=amount>100`, but the data itself is
 * never coerced.
 */

export type ComparisonOperator = '=' | '!=' | '>' | '>=' | '<' | '<=' | '~'

export interface Condition {
  column: string
  operator: ComparisonOperator
  value: string
}

export interface SortSpec {
  column: string
  direction: 'asc' | 'desc'
}

export interface RowQuery {
  /** Columns to keep, or null to keep every column. */
  select: string[] | null
  /** Applied as AND, in the order given. Empty means "every row passes". */
  conditions: Condition[]
  /** Applied in order, so earlier keys break ties. Empty preserves sheet order. */
  sort: SortSpec[]
  /** Rows to return after filtering and sorting, or null for all of them. */
  limit: number | null
}

const EMPTY_QUERY: RowQuery = {
  select: null,
  conditions: [],
  sort: [],
  limit: null,
}

const OPERATORS: readonly ComparisonOperator[] = [
  '!=',
  '>=',
  '<=',
  '=',
  '>',
  '<',
  '~',
]

/** How many column names an error message will list before truncating. */
const MAX_LISTED_COLUMNS = 12

/**
 * Reads the query parameters off a request.
 *
 * Only the syntax is checked here. Whether a column exists is not knowable yet -
 * the header row has not been fetched - so that is checked in `applyRowQuery`,
 * once there are rows to check it against.
 */
export function parseRowQuery(params: URLSearchParams): RowQuery {
  const select = readSelect(params.get('select'))
  const conditions = params
    .getAll('where')
    .filter((raw) => raw.trim() !== '')
    .map(parseCondition)
  const sort = readSort(params.get('sort'))
  const limit = readLimit(params.get('limit'))

  if (
    select === null &&
    conditions.length === 0 &&
    sort.length === 0 &&
    limit === null
  ) {
    return EMPTY_QUERY
  }

  return { select, conditions, sort, limit }
}

/** `?select=name,email` - a projection, or null when the parameter is absent. */
function readSelect(value: string | null): string[] | null {
  if (value === null) return null
  const columns = splitList(value)
  if (columns.length === 0) {
    throw new AppError(
      'INVALID_QUERY',
      'Invalid select. Name at least one column.',
    )
  }
  return columns
}

/**
 * `?where=amount>100` - one condition. Repeatable, and repeats are ANDed.
 *
 * The operator is found by the first match, so a value may safely contain `=`
 * or `>`: only the run of operator characters at the split point is read, and the
 * remainder is the value verbatim.
 */
function parseCondition(raw: string): Condition {
  const text = raw.trim()

  for (const operator of OPERATORS) {
    const at = text.indexOf(operator)
    if (at === -1) continue

    const column = text.slice(0, at).trim()
    const value = text.slice(at + operator.length).trim()

    if (column === '') {
      throw new AppError(
        'INVALID_QUERY',
        `Invalid where clause: "${raw}". Expected column${OPERATORS.join(' ')}value.`,
      )
    }
    // `!=` is matched before `=`, so a bare `=` never leaves a value of `=x`.
    return { column, operator, value }
  }

  throw new AppError(
    'INVALID_QUERY',
    `Invalid where clause: "${raw}". Expected column${OPERATORS.join(' ')}value.`,
  )
}

/** `?sort=-date,name` - a leading `-` sorts descending. Repeatable by priority. */
function readSort(value: string | null): SortSpec[] {
  if (value === null) return []

  return splitList(value).map((entry) => {
    if (entry.startsWith('-')) {
      const column = entry.slice(1).trim()
      if (column === '') {
        throw new AppError(
          'INVALID_QUERY',
          'Invalid sort. Name a column to sort by.',
        )
      }
      return { column, direction: 'desc' as const }
    }
    return { column: entry, direction: 'asc' as const }
  })
}

/** `?limit=10` - a positive integer no larger than `QUERY_MAX_LIMIT`. */
function readLimit(value: string | null): number | null {
  if (value === null || value.trim() === '') return null

  const parsed = Number(value.trim())
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new AppError(
      'INVALID_QUERY',
      'Invalid limit. Use a whole number above 0.',
    )
  }
  if (parsed > QUERY_MAX_LIMIT) {
    throw new AppError(
      'INVALID_QUERY',
      `Invalid limit. The most rows that can be returned is ${QUERY_MAX_LIMIT}.`,
    )
  }
  return parsed
}

/** Splits a comma-separated list, dropping empty entries. */
function splitList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}

/**
 * Applies a query to parsed rows.
 *
 * Order is filter, then sort, then limit, then project. Sorting before limiting is
 * what makes `?sort=-amount&limit=5` mean the top five rather than five arbitrary
 * rows; projecting last means the response only carries the columns that were
 * asked for.
 *
 * An unknown column is an error rather than an empty result. A caller who typo'd
 * `?select=emial` and got `[]` would have no way to tell that apart from a sheet
 * that genuinely has no matching rows.
 */
export function applyRowQuery(rows: SheetRow[], query: RowQuery): SheetRow[] {
  const columns = columnsOf(rows)
  assertKnownColumns(query.select, columns)
  assertKnownColumns(
    query.conditions.map((condition) => condition.column),
    columns,
  )
  assertKnownColumns(
    query.sort.map((entry) => entry.column),
    columns,
  )

  let result = rows

  if (query.conditions.length > 0) {
    result = result.filter((row) =>
      query.conditions.every((condition) =>
        matches(row[condition.column] ?? '', condition),
      ),
    )
  }

  if (query.sort.length > 0) {
    result = sortRows(result, query.sort)
  }

  if (query.limit !== null) {
    result = result.slice(0, query.limit)
  }

  if (query.select !== null) {
    // Bound to a local so the narrowing survives into the callback, where
    // `query.select` is no longer known to be non-null.
    const { select } = query
    result = result.map((row) => {
      const projected: SheetRow = {}
      for (const column of select) {
        projected[column] = row[column] ?? ''
      }
      return projected
    })
  }

  return result
}

/** The sheet's column names, taken from the first row. */
function columnsOf(rows: SheetRow[]): string[] {
  const first = rows[0]
  return first === undefined ? [] : Object.keys(first)
}

/**
 * Rejects a column the sheet does not have, listing the real ones.
 *
 * The list is truncated because a 200-column sheet would otherwise produce an
 * error message nobody reads.
 */
function assertKnownColumns(
  referenced: readonly string[] | null,
  available: string[],
): void {
  if (referenced === null) return
  for (const column of referenced) {
    if (available.includes(column)) continue
    throw new AppError(
      'INVALID_QUERY',
      `Unknown column "${column}". This sheet has: ${describeColumns(available)}`,
    )
  }
}

function describeColumns(columns: string[]): string {
  if (columns.length === 0) return 'no columns.'
  const shown = columns.slice(0, MAX_LISTED_COLUMNS).join(', ')
  const rest = columns.length - MAX_LISTED_COLUMNS
  return rest > 0 ? `${shown} and ${rest} more.` : `${shown}.`
}

/** Evaluates one condition against a cell value. */
function matches(cell: string, condition: Condition): boolean {
  switch (condition.operator) {
    case '=':
      return cell === condition.value
    case '!=':
      return cell !== condition.value
    case '~':
      return cell.toLowerCase().includes(condition.value.toLowerCase())
    case '>':
      return compare(cell, condition.value) > 0
    case '>=':
      return compare(cell, condition.value) >= 0
    case '<':
      return compare(cell, condition.value) < 0
    case '<=':
      return compare(cell, condition.value) <= 0
  }
}

/**
 * Orders two cells.
 *
 * Numeric when both sides are finite numbers, so `?where=amount>100` means what
 * it looks like rather than comparing the strings "99" and "100" alphabetically.
 * Everything else falls back to a locale-aware string compare.
 */
function compare(left: string, right: string): number {
  const a = Number(left)
  const b = Number(right)
  if (Number.isFinite(a) && Number.isFinite(b))
    return a === b ? 0 : a < b ? -1 : 1
  return left.localeCompare(right)
}

/**
 * Sorts by the given keys in order.
 *
 * `Array.prototype.sort` is stable, so equal keys keep their original sheet order
 * and the sort is reproducible across calls.
 */
function sortRows(rows: SheetRow[], sort: SortSpec[]): SheetRow[] {
  return [...rows].sort((a, b) => {
    for (const { column, direction } of sort) {
      const result = compare(a[column] ?? '', b[column] ?? '')
      if (result !== 0) return direction === 'asc' ? result : -result
    }
    return 0
  })
}
