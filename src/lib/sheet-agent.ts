import { formatCount } from './format'
import type {
  SheetAgentAggregateOperation,
  SheetAgentPlan,
  SheetRow,
} from './types'

export type SheetAgentOutput =
  | { kind: 'summary'; message: string }
  | { kind: 'matches'; message: string; rows: SheetRow[] }
  | { kind: 'aggregate'; message: string }
  | { kind: 'download'; message: string; rows: SheetRow[] }
  | { kind: 'clarify'; message: string }

const SEARCH_STOP_WORDS = new Set([
  'a',
  'all',
  'an',
  'and',
  'are',
  'by',
  'can',
  'containing',
  'contains',
  'data',
  'entries',
  'find',
  'filter',
  'for',
  'from',
  'get',
  'give',
  'has',
  'have',
  'in',
  'include',
  'including',
  'is',
  'list',
  'match',
  'matching',
  'me',
  'of',
  'on',
  'order',
  'orders',
  'please',
  'record',
  'records',
  'row',
  'rows',
  'search',
  'sheet',
  'show',
  'that',
  'the',
  'to',
  'value',
  'values',
  'where',
  'with',
  'you',
])

const NUMERIC_COMPARISON_PATTERN =
  /\b(?:above|at least|at most|below|greater than|less than|more than|over|under)\b|[<>]=?/i

/** Executes an approved, bounded plan against rows already loaded in the UI. */
export function executeSheetAgentPlan(
  request: string,
  rows: SheetRow[],
  columns: string[],
  plan: SheetAgentPlan,
): SheetAgentOutput {
  if (plan.action === 'clarify') {
    return { kind: 'clarify', message: plan.message }
  }

  if (plan.action === 'summarize') {
    const cellCount = rows.length * columns.length
    const blankCount = rows.reduce(
      (total, row) =>
        total +
        columns.filter((column) => (row[column] ?? '').trim() === '').length,
      0,
    )
    return {
      kind: 'summary',
      message: `${formatCount(rows.length)} rows across ${formatCount(columns.length)} columns. ${formatCount(blankCount)} of ${formatCount(cellCount)} cells are blank.`,
    }
  }

  if (plan.action === 'export') {
    return {
      kind: 'download',
      message: `Your ${formatCount(rows.length)} sheet rows are ready to download as JSON or CSV.`,
      rows,
    }
  }

  if (plan.action === 'search') {
    if (NUMERIC_COMPARISON_PATTERN.test(request)) {
      return {
        kind: 'clarify',
        message:
          'Numeric row filters are not supported yet. Search for an exact value, or ask for a sum, average, minimum, or maximum.',
      }
    }

    const terms = extractSearchTerms(request, columns)
    if (terms.length === 0) {
      return {
        kind: 'clarify',
        message:
          'Include a value to search for, such as “find rows where Status is Pending”.',
      }
    }

    if (plan.column !== null && !columns.includes(plan.column)) {
      return {
        kind: 'clarify',
        message: 'I could not match that column. Please use its exact heading.',
      }
    }

    const matchingRows = rows.filter((row) => {
      const values = plan.column ? [row[plan.column] ?? ''] : Object.values(row)
      return terms.every((term) =>
        values.some((value) => value.toLowerCase().includes(term)),
      )
    })
    const target = plan.column ? ` in “${plan.column}”` : ' across all columns'

    return {
      kind: 'matches',
      message: `Found ${formatCount(matchingRows.length)} matching rows${target}.`,
      rows: matchingRows,
    }
  }

  if (!columns.includes(plan.column)) {
    return {
      kind: 'clarify',
      message: 'I could not match that column. Please use its exact heading.',
    }
  }

  return aggregateColumn(rows, plan.column, plan.operation)
}

function aggregateColumn(
  rows: SheetRow[],
  column: string,
  operation: SheetAgentAggregateOperation,
): SheetAgentOutput {
  const values = rows
    .map((row) => row[column] ?? '')
    .filter((value) => value.trim())
  if (operation === 'count') {
    return {
      kind: 'aggregate',
      message: `There are ${formatCount(values.length)} non-empty values in “${column}”.`,
    }
  }

  const numbers = values
    .map(parseNumber)
    .filter((value): value is number => value !== null)
  if (numbers.length === 0) {
    return {
      kind: 'clarify',
      message: `I could not find numeric values in “${column}” to calculate.`,
    }
  }

  const result = aggregateNumbers(numbers, operation)
  const formatted = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(result)

  return {
    kind: 'aggregate',
    message: `${operationLabel(operation)} for “${column}”: ${formatted}.`,
  }
}

function aggregateNumbers(
  numbers: number[],
  operation: Exclude<SheetAgentAggregateOperation, 'count'>,
): number {
  switch (operation) {
    case 'sum':
      return numbers.reduce((sum, value) => sum + value, 0)
    case 'average':
      return numbers.reduce((sum, value) => sum + value, 0) / numbers.length
    case 'minimum':
      return Math.min(...numbers)
    case 'maximum':
      return Math.max(...numbers)
  }
}

function operationLabel(
  operation: Exclude<SheetAgentAggregateOperation, 'count'>,
): string {
  switch (operation) {
    case 'sum':
      return 'Sum'
    case 'average':
      return 'Average'
    case 'minimum':
      return 'Minimum'
    case 'maximum':
      return 'Maximum'
  }
}

function parseNumber(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null

  const parenthesized = /^\((.*)\)$/.exec(trimmed)
  const unwrapped = parenthesized?.[1] ?? trimmed
  const normalized = unwrapped.replace(/[\s,$€£¥%]/g, '')
  if (normalized === '') return null

  const number = Number(parenthesized ? `-${normalized}` : normalized)
  return Number.isFinite(number) ? number : null
}

function extractSearchTerms(request: string, columns: string[]): string[] {
  const columnTerms = new Set(
    columns.flatMap((column) => tokenize(column.toLowerCase())),
  )
  const seen = new Set<string>()

  for (const token of tokenize(request.toLowerCase())) {
    if (
      token.length < 2 ||
      SEARCH_STOP_WORDS.has(token) ||
      columnTerms.has(token)
    ) {
      continue
    }
    seen.add(token)
  }

  return [...seen]
}

function tokenize(value: string): string[] {
  return value.match(/[\p{L}\p{N}@._+-]+/gu) ?? []
}
