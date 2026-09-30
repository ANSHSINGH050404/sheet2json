import { formatCount } from './format'
import { AppError } from './errors'
import { applyRowQuery } from './query'
import type { Condition } from './query'
import type {
  SheetAgentAggregateOperation,
  SheetAgentChartData,
  SheetAgentPlan,
  SheetRow,
} from './types'

export type SheetAgentOutput =
  | { kind: 'summary'; message: string }
  | { kind: 'matches'; message: string; rows: SheetRow[] }
  | { kind: 'aggregate'; message: string }
  | {
      kind: 'grouped'
      message: string
      columns: string[]
      rows: SheetRow[]
      chart: SheetAgentChartData
    }
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

  if (plan.action === 'group_aggregate') {
    return executeGroupedAggregate(rows, columns, plan)
  }

  if (plan.action === 'filter') {
    return executeFilter(rows, columns, plan)
  }

  if (!columns.includes(plan.column)) {
    return {
      kind: 'clarify',
      message: 'I could not match that column. Please use its exact heading.',
    }
  }

  return aggregateColumn(rows, plan.column, plan.operation)
}

/**
 * Runs a planned filter through the same code the `?where=` endpoint uses.
 *
 * Delegating to `applyRowQuery` is the point: it means "amount over 500" from the
 * assistant and `?where=amount>500` from the API cannot disagree, because there
 * is only one comparison implementation. Re-deriving matching here would be a
 * second grammar to keep in step with the first, and the two would drift.
 *
 * The plan is still validated first, because it came from a model. An unknown
 * column becomes a clarification rather than the `INVALID_QUERY` that
 * `applyRowQuery` would throw, since the user typed a sentence rather than a URL
 * and deserves to be asked again.
 */
function executeFilter(
  rows: SheetRow[],
  columns: string[],
  plan: Extract<SheetAgentPlan, { action: 'filter' }>,
): SheetAgentOutput {
  const referenced = [
    ...plan.conditions.map((condition) => condition.column),
    ...plan.sort.map((spec) => spec.column),
  ]
  const unknown = referenced.find((column) => !columns.includes(column))
  if (unknown !== undefined) {
    return {
      kind: 'clarify',
      message: `I could not match the column “${unknown}”. Please use its exact heading.`,
    }
  }

  try {
    const matched = applyRowQuery(rows, {
      select: null,
      conditions: plan.conditions,
      sort: plan.sort,
      limit: plan.limit,
    })

    return {
      kind: 'matches',
      message: describeFilter(plan, matched.length),
      rows: matched,
    }
  } catch (error) {
    // `applyRowQuery` only throws on an unknown column, checked above, or on a
    // malformed limit. Either way the message is already user-safe.
    return {
      kind: 'clarify',
      message:
        error instanceof AppError
          ? error.message
          : 'I could not apply that filter. Please try rephrasing it.',
    }
  }
}

/**
 * Explains the recipe in the same words a `?where=` URL would express it.
 *
 * Showing the comparison back is what lets a user tell "over 500" from "under
 * 500" at a glance, which is the failure mode worth catching.
 */
function describeFilter(
  plan: Extract<SheetAgentPlan, { action: 'filter' }>,
  matchCount: number,
): string {
  const parts: string[] = []

  for (const { column, operator, value } of plan.conditions) {
    parts.push(`“${column}” ${describeOperator(operator)} ${value}`)
  }
  const primarySort = plan.sort[0]
  if (primarySort !== undefined) {
    parts.push(
      primarySort.direction === 'desc'
        ? `highest “${primarySort.column}” first`
        : `lowest “${primarySort.column}” first`,
    )
  }

  const scope =
    parts.length > 0
      ? `Kept rows where ${parts.join(' and ')}`
      : `Showing the first ${formatCount(plan.limit ?? 0)} rows`

  return `${scope}. ${formatCount(matchCount)} ${matchCount === 1 ? 'row' : 'rows'} in this sheet ${matchCount === 1 ? 'matches' : 'match'}.`
}

function describeOperator(operator: Condition['operator']): string {
  switch (operator) {
    case '=':
      return 'is'
    case '!=':
      return 'is not'
    case '~':
      return 'contains'
    case '>':
      return 'is over'
    case '>=':
      return 'is at least'
    case '<':
      return 'is under'
    case '<=':
      return 'is at most'
  }
}

function executeGroupedAggregate(
  rows: SheetRow[],
  columns: string[],
  plan: Extract<SheetAgentPlan, { action: 'group_aggregate' }>,
): SheetAgentOutput {
  if (plan.layout === 'separate_amounts') {
    if (
      !columns.includes(plan.groupColumn) ||
      !columns.includes(plan.sentColumn) ||
      !columns.includes(plan.receivedColumn)
    ) {
      return invalidGroupColumns()
    }

    const totals = new Map<string, MemberTotals>()
    let numericValues = 0
    for (const row of rows) {
      const member = groupLabel(row[plan.groupColumn] ?? '')
      const sent = parseNumber(row[plan.sentColumn] ?? '')
      const received = parseNumber(row[plan.receivedColumn] ?? '')
      if (sent !== null) {
        addMemberTotal(totals, member, 'sent', sent)
        numericValues += 1
      }
      if (received !== null) {
        addMemberTotal(totals, member, 'received', received)
        numericValues += 1
      }
    }

    if (numericValues === 0) return noNumericValues()

    const headers = makeTotalsHeaders(plan.groupColumn)
    return {
      kind: 'grouped',
      message: `Sent and received totals for ${formatCount(totals.size)} members, grouped by “${plan.groupColumn}”.`,
      columns: headers,
      rows: toTotalsRows(totals, headers),
      chart: toTotalsChart(totals, headers),
    }
  }

  if (plan.layout === 'direction_column') {
    if (
      !columns.includes(plan.groupColumn) ||
      !columns.includes(plan.amountColumn) ||
      !columns.includes(plan.directionColumn)
    ) {
      return invalidGroupColumns()
    }

    const totals = new Map<string, MemberTotals>()
    let numericValues = 0
    let unrecognizedDirections = 0
    for (const row of rows) {
      const amount = parseNumber(row[plan.amountColumn] ?? '')
      if (amount === null) continue
      numericValues += 1

      const direction = classifyDirection(row[plan.directionColumn] ?? '')
      if (direction === null) {
        unrecognizedDirections += 1
        continue
      }
      addMemberTotal(
        totals,
        groupLabel(row[plan.groupColumn] ?? ''),
        direction,
        amount,
      )
    }

    if (numericValues === 0) return noNumericValues()
    if (totals.size === 0) {
      return {
        kind: 'clarify',
        message: `I could not identify Sent/Received values in “${plan.directionColumn}”. Use clear direction values or separate amount columns.`,
      }
    }

    const headers = makeTotalsHeaders(plan.groupColumn)
    const skipped =
      unrecognizedDirections > 0
        ? ` ${formatCount(unrecognizedDirections)} rows with unknown directions were skipped.`
        : ''
    return {
      kind: 'grouped',
      message: `Sent and received totals for ${formatCount(totals.size)} members, grouped by “${plan.groupColumn}”.${skipped}`,
      columns: headers,
      rows: toTotalsRows(totals, headers),
      chart: toTotalsChart(totals, headers),
    }
  }

  if (plan.layout === 'sender_receiver') {
    if (
      !columns.includes(plan.senderColumn) ||
      !columns.includes(plan.receiverColumn) ||
      !columns.includes(plan.amountColumn)
    ) {
      return invalidGroupColumns()
    }

    const totals = new Map<string, MemberTotals>()
    let numericValues = 0
    for (const row of rows) {
      const amount = parseNumber(row[plan.amountColumn] ?? '')
      if (amount === null) continue
      numericValues += 1
      addMemberTotal(
        totals,
        groupLabel(row[plan.senderColumn] ?? ''),
        'sent',
        amount,
      )
      addMemberTotal(
        totals,
        groupLabel(row[plan.receiverColumn] ?? ''),
        'received',
        amount,
      )
    }

    if (numericValues === 0) return noNumericValues()

    const headers = makeTotalsHeaders('Member')
    return {
      kind: 'grouped',
      message: `Sent and received totals for ${formatCount(totals.size)} members, using “${plan.senderColumn}” and “${plan.receiverColumn}”.`,
      columns: headers,
      rows: toTotalsRows(totals, headers),
      chart: toTotalsChart(totals, headers),
    }
  }

  if (
    !columns.includes(plan.groupColumn) ||
    !columns.includes(plan.amountColumn)
  ) {
    return invalidGroupColumns()
  }

  const totals = new Map<string, number>()
  let numericValues = 0
  for (const row of rows) {
    const amount = parseNumber(row[plan.amountColumn] ?? '')
    if (amount === null) continue
    numericValues += 1
    const group = groupLabel(row[plan.groupColumn] ?? '')
    totals.set(group, (totals.get(group) ?? 0) + amount)
  }

  if (numericValues === 0) return noNumericValues()

  const totalHeading = distinctOutputHeading(`Total ${plan.amountColumn}`, [
    plan.groupColumn,
  ])
  const outputColumns = [plan.groupColumn, totalHeading]
  return {
    kind: 'grouped',
    message: `Totals for ${formatCount(totals.size)} groups, grouped by “${plan.groupColumn}”.`,
    columns: outputColumns,
    rows: [...totals.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([group, amount]) => ({
        [plan.groupColumn]: group,
        [totalHeading]: formatNumber(amount),
      })),
    chart: toSingleSeriesChart(totals, totalHeading),
  }
}

interface MemberTotals {
  sent: number
  received: number
}

function addMemberTotal(
  totals: Map<string, MemberTotals>,
  member: string,
  kind: 'sent' | 'received',
  amount: number,
): void {
  const total = totals.get(member) ?? { sent: 0, received: 0 }
  total[kind] += amount
  totals.set(member, total)
}

function makeTotalsHeaders(groupColumn: string): string[] {
  const sent = distinctOutputHeading('Total sent', [groupColumn])
  const received = distinctOutputHeading('Total received', [groupColumn, sent])
  return [groupColumn, sent, received]
}

function distinctOutputHeading(preferred: string, used: string[]): string {
  let candidate = preferred
  let suffix = 2
  while (used.includes(candidate)) {
    candidate = `${preferred} (${suffix})`
    suffix += 1
  }
  return candidate
}

function toTotalsRows(
  totals: Map<string, MemberTotals>,
  headers: string[],
): SheetRow[] {
  const [groupColumn, sentColumn, receivedColumn] = headers
  if (!groupColumn || !sentColumn || !receivedColumn) return []

  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([member, total]) => ({
      [groupColumn]: member,
      [sentColumn]: formatNumber(total.sent),
      [receivedColumn]: formatNumber(total.received),
    }))
}

function toTotalsChart(
  totals: Map<string, MemberTotals>,
  headers: string[],
): SheetAgentChartData {
  const [, sentLabel, receivedLabel] = headers
  if (!sentLabel || !receivedLabel) {
    return { categories: [], series: [] }
  }

  const top = [...totals.entries()]
    .sort(([leftName, left], [rightName, right]) => {
      const difference =
        Math.abs(right.sent) +
        Math.abs(right.received) -
        Math.abs(left.sent) -
        Math.abs(left.received)
      return difference || leftName.localeCompare(rightName)
    })
    .slice(0, 10)

  return {
    categories: top.map(([member]) => member),
    series: [
      { name: sentLabel, values: top.map(([, total]) => total.sent) },
      { name: receivedLabel, values: top.map(([, total]) => total.received) },
    ],
  }
}

function toSingleSeriesChart(
  totals: Map<string, number>,
  seriesName: string,
): SheetAgentChartData {
  const top = [...totals.entries()]
    .sort(([leftName, left], [rightName, right]) => {
      return (
        Math.abs(right) - Math.abs(left) || leftName.localeCompare(rightName)
      )
    })
    .slice(0, 10)

  return {
    categories: top.map(([group]) => group),
    series: [{ name: seriesName, values: top.map(([, value]) => value) }],
  }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(
    value,
  )
}

function groupLabel(value: string): string {
  const trimmed = value.trim()
  return trimmed === '' ? '(Blank)' : trimmed
}

function classifyDirection(value: string): 'sent' | 'received' | null {
  const tokens = value.toLowerCase().match(/[a-z]+/g) ?? []
  const sent = tokens.some((token) =>
    [
      'sent',
      'send',
      'out',
      'outgoing',
      'outflow',
      'paid',
      'pay',
      'debit',
      'withdraw',
      'withdrawal',
    ].includes(token),
  )
  const received = tokens.some((token) =>
    [
      'received',
      'receive',
      'in',
      'incoming',
      'inflow',
      'got',
      'credit',
      'deposit',
    ].includes(token),
  )

  if (sent === received) return null
  return sent ? 'sent' : 'received'
}

function invalidGroupColumns(): SheetAgentOutput {
  return {
    kind: 'clarify',
    message:
      'I could not match the grouped-total columns. Please include the exact column headings.',
  }
}

function noNumericValues(): SheetAgentOutput {
  return {
    kind: 'clarify',
    message:
      'I could not find numeric amounts in the selected column or columns.',
  }
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
