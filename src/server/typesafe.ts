import { AppError } from '#lib/errors'
import { SHEET_AGENT_MAX_COLUMNS } from '#lib/constants'
import type { SheetAgentAggregateOperation, SheetAgentPlan } from '#lib/types'

const TYPESAFE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
const TYPESAFE_MODEL = 'jev-latest'
const CHOICE_CONFIDENCE_FLOOR = 0.55
const REQUEST_TIMEOUT_MS = 15_000

const ACTION_CRITERIA = {
  summarize:
    'Give a concise overview of the sheet, its row and column counts, or data completeness.',
  search:
    'Find, show, list, or filter rows using values the user names in the request.',
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
