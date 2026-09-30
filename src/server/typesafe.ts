import { AppError } from '#lib/errors'
import { QUERY_MAX_LIMIT, SHEET_AGENT_MAX_COLUMNS } from '#lib/constants'
import type { ComparisonOperator } from '#lib/query'
import type {
  SheetAgentAggregateOperation,
  SheetAgentFilterPlan,
  SheetAgentPlan,
} from '#lib/types'

const TYPESAFE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
const TYPESAFE_MODEL = 'jev-latest'
const CHOICE_CONFIDENCE_FLOOR = 0.55
const REQUEST_TIMEOUT_MS = 15_000

const ACTION_CRITERIA = {
  summarize:
    'Give a concise overview of the sheet, its row and column counts, or data completeness.',
  filter:
    'Keep only the rows that pass a comparison against a threshold the user names, such as a number, a status, or a limit such as the top five.',
  search:
    'Find, show, list, or look up rows by describing their content, without a comparison against a threshold.',
  aggregate:
    'Calculate a sum, average, minimum, maximum, or count for one named column.',
  group_aggregate:
    'Group rows by a person or category and total sent/received amounts, or one numeric measure, for each group.',
  export: 'Prepare the sheet data for download as JSON or CSV.',
  other:
    'The requested task does not fit any supported read-only sheet action.',
} as const

const GROUP_LAYOUT_CRITERIA = {
  separate_amounts:
    'Each row has separate numeric columns for sent and received amounts, plus a person/member column.',
  direction_column:
    'Each row has one amount column and one direction/type column whose values distinguish sent from received.',
  sender_receiver:
    'Each transaction has separate sender and recipient columns plus one amount column; total sent by sender and received by recipient.',
  single_amount:
    'The request asks for one numeric measure totaled by a group or category, not a sent-versus-received breakdown.',
  other: 'The available columns do not identify a usable grouped-total layout.',
} as const

type GroupLayout = Exclude<keyof typeof GROUP_LAYOUT_CRITERIA, 'other'>

interface ColumnRole {
  id: string
  instructions: string
  missingMessage: string
}

const GROUP_COLUMN_ROLES: Record<GroupLayout, ColumnRole[]> = {
  separate_amounts: [
    {
      id: 'group_column',
      instructions: 'Which column identifies the person/member to group by?',
      missingMessage:
        'Which column identifies each member? Include its heading.',
    },
    {
      id: 'sent_column',
      instructions: 'Which numeric column contains the amount sent?',
      missingMessage: 'Which column contains the amount sent?',
    },
    {
      id: 'received_column',
      instructions: 'Which numeric column contains the amount received?',
      missingMessage: 'Which column contains the amount received?',
    },
  ],
  direction_column: [
    {
      id: 'group_column',
      instructions: 'Which column identifies the person/member to group by?',
      missingMessage:
        'Which column identifies each member? Include its heading.',
    },
    {
      id: 'amount_column',
      instructions: 'Which numeric column contains the transaction amount?',
      missingMessage: 'Which column contains the transaction amount?',
    },
    {
      id: 'direction_column',
      instructions:
        'Which column says whether each transaction was sent or received?',
      missingMessage:
        'Which column identifies whether an amount was sent or received?',
    },
  ],
  sender_receiver: [
    {
      id: 'sender_column',
      instructions: 'Which column names the sender of each transaction?',
      missingMessage: 'Which column names the sender?',
    },
    {
      id: 'recipient_column',
      instructions: 'Which column names the recipient of each transaction?',
      missingMessage: 'Which column names the recipient?',
    },
    {
      id: 'amount_column',
      instructions: 'Which numeric column contains the transaction amount?',
      missingMessage: 'Which column contains the transaction amount?',
    },
  ],
  single_amount: [
    {
      id: 'group_column',
      instructions: 'Which column identifies the group or category?',
      missingMessage: 'Which column should I group by? Include its heading.',
    },
    {
      id: 'amount_column',
      instructions: 'Which numeric column should be totaled for each group?',
      missingMessage: 'Which numeric column should I total?',
    },
  ],
}

/**
 * Comparison operators, as the assistant's filter action may express them.
 *
 * These are the same strings `?where=` accepts, and they map one-to-one onto
 * `ComparisonOperator`. The set is closed on purpose: the request arrives from an
 * anonymous caller, so the planner may only choose from operators the executor
 * already knows how to apply.
 */
const FILTER_OPERATOR_CRITERIA = {
  equals:
    'The value is exactly this, such as "status is ready" or "role is admin".',
  not_equals: 'The value is anything but this, such as "not cancelled".',
  contains:
    'The value appears anywhere within the cell, such as names containing a partial word.',
  greater_than:
    'The value is a larger number than this, such as "over 500" or "more than 3 days".',
  greater_or_equal:
    'The value is at least this number, such as "500 or more" or "at least 80".',
  less_than:
    'The value is a smaller number than this, such as "under 100" or "less than 5".',
  less_or_equal: 'The value is at most this number, such as "100 or fewer".',
} as const

type FilterOperator = keyof typeof FILTER_OPERATOR_CRITERIA

const FILTER_OPERATORS: Record<FilterOperator, ComparisonOperator> = {
  equals: '=',
  not_equals: '!=',
  contains: '~',
  greater_than: '>',
  greater_or_equal: '>=',
  less_than: '<',
  less_or_equal: '<=',
}

/**
 * Words that introduce a threshold, mapped to the operator they imply.
 *
 * The value itself is extracted separately, so this only has to answer "which
 * comparison did they ask for". Anything not listed here falls back to the
 * operator TypeSafe chose, which is why the list is a hint rather than a gate.
 */
const OPERATOR_HINTS: ReadonlyArray<[RegExp, ComparisonOperator]> = [
  [/\b(?:not|isn't|is\s+not|except|excluding|other\s+than)\b/i, '!='],
  [
    /\b(?:at\s+least|or\s+(?:more|greater)|minimum\s+of|no\s+less\s+than|>=)\b/i,
    '>=',
  ],
  [
    /\b(?:at\s+most|or\s+(?:less|fewer)|maximum\s+of|no\s+more\s+than|<=)\b/i,
    '<=',
  ],
  [
    /\b(?:over|above|more\s+than|greater\s+than|exceeds?|higher\s+than|>)\b/i,
    '>',
  ],
  [/\b(?:under|below|less\s+than|fewer\s+than|lower\s+than|<)\b/i, '<'],
]

/**
 * Spans that could be a filter threshold.
 *
 * Tuned to over-find, then handed to TypeSafe as the *options* of a Choice
 * question, so the model selects one of these verbatim rather than generating a
 * number. A model asked to "read off the value" will happily produce a plausible
 * 4999 where the user wrote 5000; a model asked to *pick* from a list of spans
 * found in the request cannot, because the answer is a copy of one of them.
 */
const THRESHOLD_PATTERN =
  /(?:[$€£¥]\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?%?|\b\d+(?:\.\d+)?\s?(?:days?|hours?|weeks?|months?|years?|items?|rows?)\b)/gi

const LIMIT_PATTERN =
  /\b(?:top|first|last|limit|only|show\s+me)\s+(\d{1,5})\b/gi

/**
 * Ceiling on threshold candidates, so the Choice question stays well inside the
 * 255-option limit even on a request dense with numbers.
 */
const MAX_THRESHOLD_CANDIDATES = 24

/**
 * The option id for a candidate span.
 *
 * A prefix, rather than the bare span, because an option key has to be a
 * non-empty identifier and a span may be a bare digit. The prefix is stripped
 * back off the answer to recover the text the user wrote.
 */
function thresholdId(candidate: string): string {
  return `value_${candidate}`
}

const OPERATION_CRITERIA: Record<
  SheetAgentAggregateOperation | 'none',
  string
> = {
  sum: 'Add the numeric values in the selected column.',
  average:
    'Calculate the arithmetic mean of numeric values in the selected column.',
  minimum: 'Find the smallest numeric value in the selected column.',
  maximum: 'Find the largest numeric value in the selected column.',
  count: 'Count non-empty cells in the selected column.',
  none: 'No numeric calculation is requested.',
}

interface ChoiceAnswer {
  type?: unknown
  choice?: unknown
  confidence?: unknown
}

export interface PlanSheetActionOptions {
  /** Injected in tests so the external service is never required. */
  fetchImpl?: typeof fetch
  /** Injected in tests; production reads the server-only environment variable. */
  apiKey?: string
}

/**
 * Uses TypeSafe only to map a natural-language request to a closed action plan.
 * Sheet rows are deliberately not included in the request state.
 */
export async function planSheetAction(
  request: string,
  columns: string[],
  options: PlanSheetActionOptions = {},
): Promise<SheetAgentPlan> {
  const apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY?.trim()
  if (!apiKey) {
    throw new AppError(
      'AI_NOT_CONFIGURED',
      'The sheet assistant is not configured yet. Add TYPESAFE_API_KEY to the server environment.',
    )
  }

  if (columns.length > SHEET_AGENT_MAX_COLUMNS) {
    throw new AppError(
      'AI_REQUEST_FAILED',
      `The sheet assistant supports up to ${SHEET_AGENT_MAX_COLUMNS} columns.`,
    )
  }

  const columnIds = columns.map((_, index) => `column_${index}`)
  const columnCriteria: Record<string, string> = {
    none: 'No single column is required; the request applies to the whole sheet.',
  }
  for (const [index, column] of columns.entries()) {
    columnCriteria[`column_${index}`] =
      `The column with the exact heading: ${column}`
  }

  const payload = {
    model: TYPESAFE_MODEL,
    state: {
      request: request.trim(),
      columns: columns.map((name, index) => ({
        id: columnIds[index],
        name,
      })),
    },
    questions: {
      action: {
        type: 'choice',
        instructions:
          'Which supported read-only action best matches the user request?',
        criteria: ACTION_CRITERIA,
      },
      column: {
        type: 'choice',
        instructions:
          'Which sheet column, if any, is explicitly named or clearly referred to? Do not guess. Choose none if no single column is identified.',
        criteria: columnCriteria,
      },
      operation: {
        type: 'choice',
        instructions:
          'Which numeric operation does the request ask for? Choose none when no numeric calculation is requested.',
        criteria: OPERATION_CRITERIA,
      },
      group_layout: {
        type: 'choice',
        instructions:
          'Which available-column layout supports the grouped totals requested? Choose other if the headers do not show a clear layout.',
        criteria: GROUP_LAYOUT_CRITERIA,
      },
    },
  }

  const response = await requestTypeSafe(payload, apiKey, options.fetchImpl)
  const body = await readResponseBody(response)
  const answers = readRecord(readRecord(body)?.answers)
  const actionAnswer = readChoiceAnswer(
    answers?.action,
    Object.keys(ACTION_CRITERIA),
  )

  if (actionAnswer.confidence < CHOICE_CONFIDENCE_FLOOR) {
    return {
      action: 'clarify',
      message:
        'I’m not sure what action you want. Try summarizing, searching, calculating a column, totaling by member, or preparing a download.',
    }
  }

  if (actionAnswer.choice === 'other') {
    return {
      action: 'clarify',
      message:
        'I can summarize the sheet, search rows, calculate a column, total sent/received amounts per member, or prepare a JSON/CSV download.',
    }
  }

  if (actionAnswer.choice === 'summarize') return { action: 'summarize' }
  if (actionAnswer.choice === 'export') return { action: 'export' }

  if (actionAnswer.choice === 'filter') {
    return planFilterAction(request, columns, apiKey, options.fetchImpl)
  }

  if (actionAnswer.choice === 'group_aggregate') {
    const layoutAnswer = readChoiceAnswer(
      answers?.group_layout,
      Object.keys(GROUP_LAYOUT_CRITERIA),
    )
    if (
      layoutAnswer.confidence < CHOICE_CONFIDENCE_FLOOR ||
      layoutAnswer.choice === 'other'
    ) {
      return {
        action: 'clarify',
        message:
          'I can total values per member, but I could not match the sheet columns to sent/received amounts. Please clarify the relevant column headings.',
      }
    }

    return planGroupedAction(
      request,
      columns,
      layoutAnswer.choice as GroupLayout,
      apiKey,
      options.fetchImpl,
    )
  }

  const columnAnswer = readChoiceAnswer(answers?.column, ['none', ...columnIds])
  if (columnAnswer.confidence < CHOICE_CONFIDENCE_FLOOR) {
    return {
      action: 'clarify',
      message:
        'Which column should I use? Please include its heading in your request.',
    }
  }

  const column =
    columnAnswer.choice === 'none'
      ? null
      : (columns[columnIds.indexOf(columnAnswer.choice)] ?? null)

  if (actionAnswer.choice === 'search') {
    return { action: 'search', column: column ?? null }
  }

  if (column === null) {
    return {
      action: 'clarify',
      message: 'Which column should I calculate? Please include its heading.',
    }
  }

  const operationAnswer = readChoiceAnswer(
    answers?.operation,
    Object.keys(OPERATION_CRITERIA),
  )
  if (
    operationAnswer.confidence < CHOICE_CONFIDENCE_FLOOR ||
    operationAnswer.choice === 'none'
  ) {
    return {
      action: 'clarify',
      message:
        'Which calculation do you want? Ask for a sum, average, minimum, maximum, or count.',
    }
  }

  return {
    action: 'aggregate',
    column,
    operation: operationAnswer.choice as SheetAgentAggregateOperation,
  }
}

/**
 * Plans a row filter by asking TypeSafe to *select* spans found in the request.
 *
 * Three judgments, asked in one request because they are independent of each
 * other: which column the comparison is about, which operator the words imply,
 * and which of the threshold candidates the user actually wrote. All three can be
 * answered from the request alone, so there is no reason to spend a second call.
 *
 * The thresholds are candidate spans extracted by regex in this module, and the
 * returned value is copied verbatim from that list. The model cannot invent a
 * number: if the user wrote 5000, 4999 is not reachable, because it was never an
 * option. That is the whole reason this is a Choice over spans rather than a
 * "read the threshold" instruction.
 */
async function planFilterAction(
  request: string,
  columns: string[],
  apiKey: string,
  fetchImpl: typeof fetch | undefined,
): Promise<SheetAgentPlan> {
  const columnIds = columns.map((_, index) => `column_${index}`)
  const columnCriteria: Record<string, string> = {
    none: 'No single column is required; the request applies to the whole sheet.',
  }
  for (const [index, column] of columns.entries()) {
    columnCriteria[`column_${index}`] =
      `The column with the exact heading: ${column}`
  }

  const thresholdCandidates = findThresholdCandidates(request)
  const sortColumnIds = columns.map((_, index) => `sort_${index}`)
  const sortCriteria: Record<string, string> = {
    none: 'The request does not ask to order the rows.',
  }
  for (const [index, column] of columns.entries()) {
    sortCriteria[`sort_${index}`] =
      `The column to order by, with the exact heading: ${column}`
  }

  const thresholdCriteria: Record<string, string> = {
    none: 'The request names no value to compare against.',
  }
  for (const candidate of thresholdCandidates) {
    // The span is the option id as well as its description, which is what makes
    // the answer copyable: `picked.choice` minus this prefix is the user's text.
    thresholdCriteria[thresholdId(candidate)] =
      `The comparison value written in the request: ${candidate}`
  }

  const payload = {
    model: TYPESAFE_MODEL,
    state: {
      request: request.trim(),
      columns: columns.map((name, index) => ({
        id: columnIds[index],
        name,
      })),
    },
    questions: {
      column: {
        type: 'choice',
        instructions:
          'Which single column is the comparison about? Choose none when the request only asks for a limit, such as "the top 5 rows".',
        criteria: columnCriteria,
      },
      operator: {
        type: 'choice',
        instructions:
          'Which comparison does the wording of the request express?',
        criteria: FILTER_OPERATOR_CRITERIA,
      },
      threshold: {
        type: 'choice',
        instructions:
          'Which of these candidate values is the one the user wrote as the comparison threshold? Choose none if the request names no such value.',
        criteria: thresholdCriteria,
      },
      sort_column: {
        type: 'choice',
        instructions:
          'Which column should the result be ordered by, if the request asks for a ranking such as highest, lowest, newest or top?',
        criteria: sortCriteria,
      },
    },
  }

  const response = await requestTypeSafe(payload, apiKey, fetchImpl)
  const body = await readResponseBody(response)
  const filterAnswers = readRecord(readRecord(body)?.answers)

  // Read the sort answer before branching on the column. Every question was
  // asked in the same request, so a request with no comparison column but a
  // ranking - "the lowest Amount" - still has an answer waiting here. Returning
  // early instead would drop it and turn a valid request into a prompt.
  const sortAnswer = readChoiceAnswer(filterAnswers?.sort_column, [
    'none',
    ...sortColumnIds,
  ])
  const sortColumn =
    sortAnswer.confidence >= CHOICE_CONFIDENCE_FLOOR &&
    sortAnswer.choice !== 'none'
      ? (columns[sortColumnIds.indexOf(sortAnswer.choice)] ?? null)
      : null

  const columnAnswer = readChoiceAnswer(filterAnswers?.column, [
    'none',
    ...columnIds,
  ])
  if (
    columnAnswer.confidence < CHOICE_CONFIDENCE_FLOOR ||
    columnAnswer.choice === 'none'
  ) {
    // "Top 5 rows" and "the lowest Amount" name an ordering but no comparison,
    // which is a valid request rather than a confusing one, so it becomes a
    // sort-and-limit filter instead of a clarification prompt.
    if (sortColumn !== null || findLimitCandidate(request) !== null) {
      return buildFilterPlan(request, columns, {}, sortColumn)
    }
    return {
      action: 'clarify',
      message:
        'Which column should I compare? Name its heading, for example “where Status is Ready”.',
    }
  }

  const column = columns[columnIds.indexOf(columnAnswer.choice)]
  if (column === undefined) {
    return {
      action: 'clarify',
      message: 'I could not match that column. Please use its exact heading.',
    }
  }

  const picked = readChoiceAnswer(filterAnswers?.threshold, [
    'none',
    ...thresholdCandidates.map(thresholdId),
  ])
  const operator = resolveOperator(picked, filterAnswers?.operator, request)

  // The operator and threshold are independent, so a missing one is filled from
  // the request's own wording rather than by asking the model to reconcile them.
  if (picked.choice === 'none' || picked.confidence < CHOICE_CONFIDENCE_FLOOR) {
    return {
      action: 'clarify',
      message: `Which value should I compare “${column}” against? Include the value in your request, for example “where ${column} is over 500”.`,
    }
  }

  return buildFilterPlan(
    request,
    columns,
    {
      column,
      operator,
      // The answer id is `value_<span>`; the span itself is what the user wrote,
      // copied back out rather than reconstructed.
      value: picked.choice.replace(/^value_/, ''),
    },
    sortColumn,
  )
}

/**
 * Whether a ranking request wants the largest or the smallest values.
 *
 * "Top", "highest" and "best" mean descending; "lowest", "smallest" and
 * "worst" mean ascending. Decided here rather than asked, because the words are
 * unambiguous and a misread direction silently returns the wrong rows - the
 * failure a user is least likely to notice.
 */
function resolveSortDirection(request: string): 'asc' | 'desc' {
  return /\b(?:lowest|smallest|least|fewest|worst|cheapest|oldest)\b/i.test(
    request,
  )
    ? 'asc'
    : 'desc'
}

/**
 * Assembles a filter plan, deciding which of the three parts the user gave.
 *
 * Each is optional, because people ask for them separately: "amount over 500",
 * "sort by amount", and "top 5". An empty plan is rejected here rather than
 * returned, since a filter with no conditions, no sort and no limit would
 * silently hand back the whole sheet.
 */
function buildFilterPlan(
  request: string,
  columns: string[],
  selected: {
    column?: string
    operator?: ComparisonOperator
    value?: string
  },
  sortColumn: string | null,
): SheetAgentPlan {
  const conditions =
    selected.column !== undefined &&
    selected.operator !== undefined &&
    selected.value !== undefined
      ? [
          {
            column: selected.column,
            operator: selected.operator,
            value: selected.value,
          },
        ]
      : []

  const sort =
    sortColumn !== null && columns.includes(sortColumn)
      ? [{ column: sortColumn, direction: resolveSortDirection(request) }]
      : []

  const limitCandidate = findLimitCandidate(request)
  const limit =
    limitCandidate !== null ? Math.min(limitCandidate, QUERY_MAX_LIMIT) : null

  if (conditions.length === 0 && sort.length === 0 && limit === null) {
    return {
      action: 'clarify',
      message:
        'Tell me which rows to keep, for example “where Amount is over 500” or “the top 5 rows by Amount”.',
    }
  }

  const plan: SheetAgentFilterPlan = {
    action: 'filter',
    conditions,
    sort,
    limit,
    // A plan can be limit-only, in which case there is no comparison column.
    column: conditions[0]?.column ?? sort[0]?.column ?? '',
  }

  return plan
}

/**
 * Picks the operator, preferring the request's own wording over the model.
 *
 * A regex over the request is not wrong, it is *literal*: "over 500" is `>` but
 * so is "over budget", which is not a numeric comparison at all. So the wording
 * is checked first, because when it fires it is certainly right, and the model's
 * choice is the fallback for everything phrased indirectly.
 */
function resolveOperator(
  threshold: { choice: string; confidence: number },
  operatorAnswer: unknown,
  request: string,
): ComparisonOperator | undefined {
  for (const [pattern, operator] of OPERATOR_HINTS) {
    if (pattern.test(request)) return operator
  }

  if (threshold.choice === 'none') return undefined

  const answer = readRecord(operatorAnswer) as {
    type?: unknown
    choice?: unknown
    confidence?: unknown
  } | null
  if (
    answer?.type !== 'choice' ||
    typeof answer.choice !== 'string' ||
    !(answer.choice in FILTER_OPERATOR_CRITERIA)
  ) {
    return undefined
  }

  const confidence =
    typeof answer.confidence === 'number' &&
    Number.isFinite(answer.confidence) &&
    answer.confidence >= 0 &&
    answer.confidence <= 1
      ? answer.confidence
      : 0

  if (confidence < CHOICE_CONFIDENCE_FLOOR) return undefined

  return FILTER_OPERATORS[answer.choice as FilterOperator]
}

/**
 * The number-like spans in the request, de-duplicated, in the order written.
 *
 * Bounded because every candidate becomes an option on a Choice question, which
 * accepts at most 255. Over-finding is the point: TypeSafe picks, so a candidate
 * list that is too narrow cannot be recovered from, while one that is too wide
 * only costs a little precision on an answer the code then verifies anyway.
 */
function findThresholdCandidates(request: string): string[] {
  const seen = new Set<string>()
  const candidates: string[] = []

  for (const match of request.matchAll(THRESHOLD_PATTERN)) {
    const span = match[0].trim()
    // Bare small integers are almost always part of the sentence rather than a
    // threshold ("top 5 rows"), and `1` or `2` as a filter value is almost never
    // what someone meant, so both are dropped.
    if (span === '' || /^\d?$/.test(span.replace(/\D/g, ''))) continue
    if (seen.has(span.toLowerCase())) continue
    seen.add(span.toLowerCase())
    candidates.push(span)
  }

  return candidates.slice(0, MAX_THRESHOLD_CANDIDATES)
}

/**
 * The row count in "the top 5 rows", if the request names one.
 *
 * Returned as null when absent, so 0 is never mistaken for "no limit".
 */
function findLimitCandidate(request: string): number | null {
  for (const match of request.matchAll(LIMIT_PATTERN)) {
    const parsed = Number.parseInt(match[1] ?? '', 10)
    if (Number.isInteger(parsed) && parsed > 0) return parsed
  }
  return null
}

async function planGroupedAction(
  request: string,
  columns: string[],
  layout: GroupLayout,
  apiKey: string,
  fetchImpl: typeof fetch | undefined,
): Promise<SheetAgentPlan> {
  const columnIds = columns.map((_, index) => `column_${index}`)
  const columnCriteria: Record<string, string> = {
    none: 'No column matches this role.',
  }
  for (const [index, column] of columns.entries()) {
    columnCriteria[`column_${index}`] =
      `The column with the exact heading: ${column}`
  }

  const roles = GROUP_COLUMN_ROLES[layout]
  const questions = Object.fromEntries(
    roles.map((role) => [
      role.id,
      {
        type: 'choice',
        instructions: role.instructions,
        criteria: columnCriteria,
      },
    ]),
  )
  const payload = {
    model: TYPESAFE_MODEL,
    state: {
      request: request.trim(),
      layout,
      columns: columns.map((name, index) => ({
        id: columnIds[index],
        name,
      })),
    },
    questions,
  }

  const response = await requestTypeSafe(payload, apiKey, fetchImpl)
  const body = await readResponseBody(response)
  const answers = readRecord(readRecord(body)?.answers)
  const selected = new Map<string, string>()

  for (const role of roles) {
    const answer = readChoiceAnswer(answers?.[role.id], ['none', ...columnIds])
    if (
      answer.confidence < CHOICE_CONFIDENCE_FLOOR ||
      answer.choice === 'none'
    ) {
      return { action: 'clarify', message: role.missingMessage }
    }

    const column = columns[columnIds.indexOf(answer.choice)]
    if (!column) {
      return {
        action: 'clarify',
        message:
          'I could not match one of the columns. Please use its exact heading.',
      }
    }

    if ([...selected.values()].includes(column)) {
      return {
        action: 'clarify',
        message:
          'I matched more than one role to the same column. Please name the relevant column headings explicitly.',
      }
    }

    selected.set(role.id, column)
  }

  const selectedColumn = (id: string): string => {
    const column = selected.get(id)
    if (column === undefined) {
      throw new AppError(
        'AI_REQUEST_FAILED',
        'The sheet assistant could not match the grouped-total columns.',
      )
    }
    return column
  }

  switch (layout) {
    case 'separate_amounts':
      return {
        action: 'group_aggregate',
        layout,
        groupColumn: selectedColumn('group_column'),
        sentColumn: selectedColumn('sent_column'),
        receivedColumn: selectedColumn('received_column'),
      }
    case 'direction_column':
      return {
        action: 'group_aggregate',
        layout,
        groupColumn: selectedColumn('group_column'),
        amountColumn: selectedColumn('amount_column'),
        directionColumn: selectedColumn('direction_column'),
      }
    case 'sender_receiver':
      return {
        action: 'group_aggregate',
        layout,
        senderColumn: selectedColumn('sender_column'),
        receiverColumn: selectedColumn('recipient_column'),
        amountColumn: selectedColumn('amount_column'),
      }
    case 'single_amount':
      return {
        action: 'group_aggregate',
        layout,
        groupColumn: selectedColumn('group_column'),
        amountColumn: selectedColumn('amount_column'),
      }
  }
}

async function requestTypeSafe(
  payload: unknown,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const body = JSON.stringify(payload)

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response
    try {
      response = await fetchImpl(TYPESAFE_ENDPOINT, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body,
      })
    } catch (cause) {
      if (attempt === 0) {
        await delay(250)
        continue
      }
      throw new AppError(
        'AI_REQUEST_FAILED',
        'The sheet assistant could not reach its AI service. Please try again.',
        cause,
      )
    }

    if (response.ok) return response

    if ([429, 529].includes(response.status) && attempt === 0) {
      await delay(readRetryDelay(response))
      continue
    }

    throw new AppError(
      'AI_REQUEST_FAILED',
      response.status === 401
        ? 'The sheet assistant API key is not valid. Check TYPESAFE_API_KEY.'
        : [429, 529].includes(response.status)
          ? 'The sheet assistant is busy. Please try again shortly.'
          : 'The sheet assistant could not plan that action. Please try again.',
      `TypeSafe status: ${response.status}`,
    )
  }

  throw new AppError(
    'AI_REQUEST_FAILED',
    'The sheet assistant could not reach its AI service. Please try again.',
  )
}

async function readResponseBody(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch (cause) {
    throw new AppError(
      'AI_REQUEST_FAILED',
      'The sheet assistant received an invalid response. Please try again.',
      cause,
    )
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function readChoiceAnswer(
  value: unknown,
  allowedChoices: string[],
): { choice: string; confidence: number } {
  const answer = readRecord(value) as ChoiceAnswer | null
  if (
    answer?.type !== 'choice' ||
    typeof answer.choice !== 'string' ||
    !allowedChoices.includes(answer.choice)
  ) {
    throw new AppError(
      'AI_REQUEST_FAILED',
      'The sheet assistant returned an invalid action. Please try again.',
    )
  }

  return {
    choice: answer.choice,
    confidence:
      typeof answer.confidence === 'number' &&
      Number.isFinite(answer.confidence) &&
      answer.confidence >= 0 &&
      answer.confidence <= 1
        ? answer.confidence
        : 0,
  }
}

function readRetryDelay(response: Response): number {
  const retryAfter = Number(response.headers.get('retry-after'))
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(1000, Math.max(100, retryAfter * 1000))
  }
  return 300
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
