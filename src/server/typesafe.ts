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
  export: 'Prepare the sheet data for download as JSON or CSV.',
  other:
    'The requested task does not fit any supported read-only sheet action.',
} as const

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
        'I’m not sure what action you want. Try asking me to summarize, search, calculate a column, or prepare a download.',
    }
  }

  if (actionAnswer.choice === 'other') {
    return {
      action: 'clarify',
      message:
        'I can summarize the sheet, search rows, calculate a column, or prepare a JSON/CSV download.',
    }
  }

  if (actionAnswer.choice === 'summarize') return { action: 'summarize' }
  if (actionAnswer.choice === 'export') return { action: 'export' }

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
