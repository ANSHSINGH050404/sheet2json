import { AppError } from '#lib/errors'
import {
  SEMANTIC_SEARCH_MAX_CELLS,
  SEMANTIC_SEARCH_MAX_CELL_CHARS,
} from '#lib/constants'
import type { SheetRow } from '#lib/types'

import { requestTypeSafe } from './typesafe-client'

/**
 * Semantic row search: one Noul per row, ranked by the probability itself.
 *
 * The literal search in `src/lib/sheet-agent.ts` matches substrings. That is
 * right for "find rows where Status is Pending" and useless for "find rows that
 * are overdue", because no cell contains the word "overdue". This ranks rows by
 * whether a judgment says they answer the question, which is what a System One
 * model is for.
 *
 * Three decisions worth stating:
 *
 * - **One Noul per row, all in one request.** Questions run in parallel, so
 *   scoring 100 rows is one round trip rather than 100. The question count is the
 *   cost driver, not the request count.
 * - **Ranked by probability, not thresholded.** Following the re-ranking
 *   cookbook: the value orders candidates, and the cut-off lives in code where it
 *   can be tuned. A Noul has no separate confidence - its single number is the
 *   probability - so a threshold here would throw away the ordering.
 * - **Rows are truncated before they are sent.** This is the only request in the
 *   app that carries sheet values, so each cell is cut to a length that is enough
 *   to judge relevance and no more.
 */

/** How many of the top-ranked rows to return. */
const MATCH_LIMIT = 20

/**
 * Below this probability a row is not considered a match at all.
 *
 * Deliberately not 0.5. A Noul near 0.5 means the model is split, not that the
 * row is a weak match, so a 0.5 cut-off would admit exactly the rows the model
 * could not decide about. Above that band a row is relevant; below it, it is not.
 */
const MATCH_FLOOR = 0.6

export class SemanticSearchUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SemanticSearchUnavailable'
  }
}

export interface RankedRows {
  /** Indexes into the submitted rows, best match first. */
  scores: number[]
}

/**
 * Ranks rows by relevance to a plain-language question.
 *
 * Returns indexes rather than the rows themselves so the caller keeps its own
 * objects and cannot accidentally hand back a row it did not score.
 */
export async function rankRowsByMeaning(
  request: string,
  rows: SheetRow[],
  options: { apiKey?: string; fetchImpl?: typeof fetch } = {},
): Promise<RankedRows> {
  const apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY?.trim()
  if (!apiKey) {
    throw new SemanticSearchUnavailable(
      'Semantic search needs TYPESAFE_API_KEY in the server environment.',
    )
  }

  if (rows.length === 0) return { scores: [] }

  const columns = columnsToRank(rows)
  const state = {
    request: request.trim(),
    columns: columns.map((name) => ({ name })),
    rows: rows.map((row, index) => ({
      id: rowId(index),
      values: columns.map((column) => truncate(row[column] ?? '')),
    })),
  }

  const questions = Object.fromEntries(
    rows.map((_, index) => [
      rowId(index),
      {
        type: 'noul',
        instructions: `Is this row a good answer to the question: "${state.request}"?`,
        criteria: {
          true: 'The row itself answers the question, or states the situation the question asks about, even if it uses different wording.',
          false:
            'The row is about something else, or is too vague to count as an answer.',
        },
      },
    ]),
  )

  const response = await requestTypeSafe(
    {
      model: 'jev-latest',
      state,
      questions,
    },
    apiKey,
    options.fetchImpl,
  )

  const body = (await response.json()) as unknown
  const answers = asRecord(asRecord(body)?.answers)
  if (!answers) {
    throw new AppError(
      'AI_REQUEST_FAILED',
      'The assistant received an invalid response. Please try again.',
    )
  }

  const scored: Array<{ index: number; probability: number }> = []
  for (const [key, value] of Object.entries(answers)) {
    const index = indexFromRowId(key)
    if (index === null) continue
    // A missing or malformed answer scores 0 rather than dropping the row: an
    // unparseable answer is not evidence of irrelevance, but it is certainly not
    // evidence of relevance either.
    scored.push({ index, probability: readNoul(value) ?? 0 })
  }

  if (scored.length === 0) {
    throw new AppError(
      'AI_REQUEST_FAILED',
      'The assistant did not score any rows. Please try again.',
    )
  }

  const scores = scored
    .filter((entry) => entry.probability >= MATCH_FLOOR)
    .sort((left, right) => right.probability - left.probability)
    .slice(0, MATCH_LIMIT)
    .map((entry) => entry.index)

  return { scores }
}

/** The columns to send, capped and chosen for carrying the most signal. */
function columnsToRank(rows: SheetRow[]): string[] {
  const columns = Object.keys(rows[0] ?? {})
  if (columns.length <= SEMANTIC_SEARCH_MAX_CELLS) return columns

  // Beyond the cap, prefer the columns with the most distinct values, since a
  // column where every row reads the same carries no discriminating power.
  return [...columns]
    .map((column) => ({
      column,
      distinct: new Set(rows.map((row) => row[column] ?? '')).size,
    }))
    .sort(
      (left, right) =>
        right.distinct - left.distinct ||
        left.column.localeCompare(right.column),
    )
    .slice(0, SEMANTIC_SEARCH_MAX_CELLS)
    .map((entry) => entry.column)
}

/**
 * Cuts a cell to a length that is enough to judge relevance.
 *
 * An ellipsis marks the cut so the model can tell a truncated cell from a
 * complete one, rather than reading a mid-word fragment as the whole value.
 */
function truncate(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= SEMANTIC_SEARCH_MAX_CELL_CHARS) return collapsed
  return `${collapsed.slice(0, SEMANTIC_SEARCH_MAX_CELL_CHARS)}…`
}

function rowId(index: number): string {
  return `row_${index}`
}

function indexFromRowId(id: string): number | null {
  const match = /^row_(\d+)$/.exec(id)
  if (!match) return null
  const digits = match[1]
  if (digits === undefined) return null
  const index = Number.parseInt(digits, 10)
  return Number.isInteger(index) ? index : null
}

/** The probability from a Noul answer, or null when the shape is not one. */
function readNoul(value: unknown): number | null {
  const answer = asRecord(value)
  if (!answer || answer.type !== 'noul') return null
  const noul = answer.noul
  if (typeof noul !== 'number' || !Number.isFinite(noul)) return null
  return noul >= 0 && noul <= 1 ? noul : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}
