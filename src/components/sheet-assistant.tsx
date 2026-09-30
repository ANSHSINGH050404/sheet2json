import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useId, useState } from 'react'

import { DataTable } from '#components/data-table'
import { GroupedBarChart } from '#components/grouped-bar-chart'
import { formatCount, unwrap } from '#lib/format'
import { trackAnalytics } from '#lib/analytics'
import { rowsToCsv } from '#lib/csv'
import { executeSheetAgentPlan } from '#lib/sheet-agent'
import type { SheetAgentOutput } from '#lib/sheet-agent'
import {
  SEMANTIC_SEARCH_MAX_ROWS,
  SHEET_AGENT_MAX_COLUMNS,
  SHEET_AGENT_MAX_COLUMN_NAME_LENGTH,
  SHEET_AGENT_MAX_PROMPT_LENGTH,
} from '#lib/constants'
import type { SheetRow } from '#lib/types'
import { planSheetAgentFn } from '#server/api/sheet-agent'
import {
  getSemanticSearchConfigFn,
  rankSheetRowsFn,
} from '#server/api/semantic-search'

export interface SheetAssistantProps {
  rows: SheetRow[]
  title: string
  /** Clears the previous answer when a live sheet refreshes. */
  dataVersion: string
}

/**
 * What the semantic pass can return.
 *
 * A subset of `SheetAgentOutput`, declared separately because `Pick` over the
 * union would not narrow `kind` to the two members this path can produce, and a
 * type that admits a `grouped` result here would be a lie about what the server
 * can send back.
 */
type SemanticOutput =
  | { kind: 'matches'; message: string; rows: SheetRow[] }
  | { kind: 'clarify'; message: string; rows: SheetRow[] }

const QUICK_PROMPTS = [
  { label: 'Summarize', request: 'Summarize this sheet' },
  { label: 'Search rows…', request: 'Find rows where ' },
  { label: 'Filter by value…', request: 'Show rows where ' },
  { label: 'Top N…', request: 'Show the top 5 rows by ' },
  { label: 'Calculate…', request: 'Calculate the sum of ' },
  {
    label: 'Totals by member…',
    request: 'Total the amount sent and received per member and make a table',
  },
  { label: 'Prepare download', request: 'Prepare this sheet for download' },
] as const

/** A read-only assistant: TypeSafe plans the action; code processes the rows. */
export function SheetAssistant({
  rows,
  title,
  dataVersion,
}: SheetAssistantProps) {
  const columns = Object.keys(rows[0] ?? {})
  const [request, setRequest] = useState('')
  const [semanticPrompt, setSemanticPrompt] = useState('')
  const requestId = useId()
  const semanticId = useId()

  // Whether the affordance is offered at all. Resolved once per sheet rather
  // than on every render, and defaulting to false so the button never appears
  // before the answer is known.
  const availability = useQuery({
    queryKey: ['semantic-search-config'],
    queryFn: () => getSemanticSearchConfigFn().then(unwrap),
    staleTime: Infinity,
  })
  const semanticSearchAvailable = availability.data?.available ?? false
  const mutation = useMutation({
    mutationFn: async (prompt: string) => {
      trackAnalytics({ event: 'sheet_assistant_requested' })
      const plan = await planSheetAgentFn({
        data: { request: prompt, columns },
      }).then(unwrap)
      const output = executeSheetAgentPlan(prompt, rows, columns, plan)
      trackAnalytics({
        event: 'sheet_assistant_completed',
        action: plan.action,
        result_kind: output.kind,
      })
      return output
    },
  })

  /**
   * The semantic pass, which is opt-in and separate from the main request.
   *
   * Only reachable when the literal search has already come back empty: it is a
   * second, more expensive call, so it never runs speculatively.
   */
  const semantic = useMutation<SemanticOutput, Error, string>({
    mutationFn: async (prompt: string): Promise<SemanticOutput> => {
      trackAnalytics({ event: 'sheet_semantic_search_requested' })
      const scannable = rows.slice(0, SEMANTIC_SEARCH_MAX_ROWS)
      const result = await rankSheetRowsFn({
        data: { request: prompt, rows: scannable },
      }).then(unwrap)

      trackAnalytics({
        event: 'sheet_semantic_search_completed',
        result_kind: result.matches.length > 0 ? 'matches' : 'none',
        skipped_rows: Math.max(0, rows.length - scannable.length),
      })

      if (result.matches.length === 0) {
        return {
          kind: 'clarify',
          message: `No rows look like a match${result.skippedRows > 0 ? ` in the first ${SEMANTIC_SEARCH_MAX_ROWS} rows` : ''}. Try naming a value that appears in the sheet.`,
          rows: [] as SheetRow[],
        }
      }

      // An index the server sent that is out of range cannot be turned back into
      // a row, and a filtered hole in the table would be a silent wrong answer,
      // so the row is dropped rather than rendered as undefined.
      const matched = result.matches
        .map((index) => scannable[index])
        .filter((row): row is SheetRow => row !== undefined)

      return {
        kind: 'matches',
        message: `Found ${formatCount(matched.length)} rows that look relevant.`,
        rows: matched,
      }
    },
  })
  const reset = mutation.reset

  useEffect(() => {
    reset()
    semantic.reset()
    setSemanticPrompt('')
  }, [dataVersion, reset, semantic.reset])

  /**
   * The semantic pass is only worth offering when the literal search found
   * nothing. If the substring search already answered the question, this is a
   * slower and more expensive way to reach the same rows.
   */
  const searchFoundNothing =
    mutation.data?.kind === 'matches' && mutation.data.rows.length === 0
  const shouldOfferSemanticSearch =
    semanticSearchAvailable &&
    searchFoundNothing &&
    request.trim().length >= 3 &&
    rows.length > 0

  if (rows.length === 0 || columns.length === 0) return null

  return (
    <section
      aria-labelledby={`${requestId}-heading`}
      className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm"
    >
      <header className="border-b border-line px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id={`${requestId}-heading`}
            className="text-base font-semibold tracking-tight text-ink"
          >
            Ask this sheet
          </h2>
          <span className="rounded-full border border-line px-2.5 py-1 text-[11px] font-medium text-ink-subtle">
            Read-only
          </span>
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          Summarize, search, filter, calculate, or download data. Filters and
          calculations run in this app; the assistant will not change your
          sheet.
        </p>
      </header>

      <div className="space-y-4 px-4 py-4 sm:px-5">
        {columns.length > SHEET_AGENT_MAX_COLUMNS ? (
          <p className="rounded-lg border border-warning-line bg-warning-soft px-3 py-2 text-sm text-warning">
            The assistant supports up to {SHEET_AGENT_MAX_COLUMNS} columns.
          </p>
        ) : columns.some(
            (column) => column.length > SHEET_AGENT_MAX_COLUMN_NAME_LENGTH,
          ) ? (
          <p className="rounded-lg border border-warning-line bg-warning-soft px-3 py-2 text-sm text-warning">
            A column name is too long for the assistant. Shorten it to{' '}
            {SHEET_AGENT_MAX_COLUMN_NAME_LENGTH} characters or fewer.
          </p>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              const prompt = request.trim()
              if (prompt) mutation.mutate(prompt)
            }}
            className="space-y-3"
          >
            <label
              htmlFor={requestId}
              className="block text-xs font-medium text-ink-muted"
            >
              What should I do with the sheet data?
            </label>
            <textarea
              id={requestId}
              value={request}
              maxLength={SHEET_AGENT_MAX_PROMPT_LENGTH}
              onChange={(event) => setRequest(event.target.value)}
              placeholder="Try: summarize this sheet, show rows where Amount is over 500, find rows where Status is Pending, or sum the Amount column."
              rows={3}
              required
              disabled={mutation.isPending}
              onFocus={() => {
                if (mutation.data || mutation.isError) mutation.reset()
              }}
              className="w-full resize-y rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-ink/10 disabled:cursor-not-allowed disabled:bg-surface-muted"
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-xs text-ink-subtle">Try:</span>
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt.label}
                  type="button"
                  onClick={() => {
                    setRequest(prompt.request)
                    mutation.reset()
                  }}
                  disabled={mutation.isPending}
                  className="rounded-full border border-line px-3 py-1 text-xs font-medium text-ink-muted transition-colors hover:border-line-strong hover:bg-surface-muted hover:text-ink focus:outline-none focus:ring-2 focus:ring-ink-subtle disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {prompt.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-ink-subtle">
                Only your request and column names go to TypeSafe; row values
                stay in this app.
              </p>
              <button
                type="submit"
                disabled={mutation.isPending || request.trim().length < 3}
                className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-surface transition-colors hover:bg-ink-hover focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {mutation.isPending ? 'Working...' : 'Run assistant'}
              </button>
            </div>
          </form>
        )}

        {mutation.isPending ? (
          <p role="status" className="text-sm text-ink-subtle">
            Checking your request and working with the sheet data...
          </p>
        ) : null}

        {mutation.isError ? (
          <p
            role="alert"
            className="rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger-muted"
          >
            {mutation.error.message}
          </p>
        ) : null}

        {mutation.data ? (
          <AssistantOutput
            output={mutation.data}
            columns={columns}
            fileName={title}
          />
        ) : null}

        {shouldOfferSemanticSearch ? (
          <SemanticSearchOffer
            id={semanticId}
            prompt={semanticPrompt}
            onPromptChange={setSemanticPrompt}
            onSubmit={() => {
              const prompt = semanticPrompt.trim() || request.trim()
              if (prompt) semantic.mutate(prompt)
            }}
            isPending={semantic.isPending}
            error={semantic.isError ? semantic.error.message : null}
            output={semantic.data ?? null}
            columns={columns}
            fileName={title}
            sheetRowCount={rows.length}
          />
        ) : null}
      </div>
    </section>
  )
}

/**
 * The opt-in semantic pass.
 *
 * Rendered only after a literal search found nothing, and always with the data
 * it will send stated up front. This is the only feature in the app that puts
 * row values into an external request, and it would rather lose the user than
 * send their data without saying so.
 */
function SemanticSearchOffer({
  id,
  prompt,
  onPromptChange,
  onSubmit,
  isPending,
  error,
  output,
  columns,
  fileName,
  sheetRowCount,
}: {
  id: string
  prompt: string
  onPromptChange: (value: string) => void
  onSubmit: () => void
  isPending: boolean
  error: string | null
  output: SemanticOutput | null
  columns: string[]
  fileName: string
  sheetRowCount: number
}) {
  const scannable = Math.min(sheetRowCount, SEMANTIC_SEARCH_MAX_ROWS)

  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface-muted p-4">
      <div>
        <h3 className="text-sm font-semibold text-ink-strong">
          No rows matched that exactly
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-ink-subtle">
          You can search by meaning instead &mdash; ask for rows that look like
          a match even if they use different words.
        </p>
      </div>

      <p className="rounded-md border border-warning-line bg-warning-soft px-3 py-2 text-xs leading-relaxed text-warning">
        This sends up to {scannable} of your rows (first{' '}
        {SEMANTIC_SEARCH_MAX_ROWS}, each cell shortened) to the AI service to
        rank them. The rest of the assistant never sends row values.
      </p>

      <div>
        <label
          htmlFor={id}
          className="block text-xs font-medium text-ink-muted"
        >
          What should the rows look like?
        </label>
        <input
          id={id}
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder="e.g. rows where payment is late"
          maxLength={SHEET_AGENT_MAX_PROMPT_LENGTH}
          disabled={isPending}
          className="mt-1 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:ring-2 focus:ring-ink/10 focus:outline-none disabled:bg-surface-muted"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] text-ink-subtle">
          {sheetRowCount > scannable
            ? `Only the first ${scannable} of ${formatCount(sheetRowCount)} rows are searched.`
            : `Searching ${formatCount(scannable)} rows.`}
        </p>
        <button
          type="button"
          onClick={onSubmit}
          disabled={isPending || prompt.trim().length < 3}
          className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink-strong transition-colors hover:bg-surface-muted focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2 focus:outline-none disabled:opacity-60"
        >
          {isPending ? 'Ranking rows...' : 'Search by meaning'}
        </button>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-xs text-danger-muted"
        >
          {error}
        </p>
      ) : null}

      {output ? (
        <AssistantOutput
          output={output}
          columns={columns}
          fileName={fileName}
        />
      ) : null}
    </div>
  )
}

function AssistantOutput({
  output,
  columns,
  fileName,
}: {
  output: SemanticOutput | SheetAgentOutput
  columns: string[]
  fileName: string
}) {
  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface-muted p-4">
      <p
        role="status"
        aria-live="polite"
        className="text-sm font-medium text-ink-strong"
      >
        {output.message}
      </p>
      {output.kind === 'matches' && output.rows.length > 0 ? (
        <>
          <DataTable
            rows={output.rows}
            columns={columns}
            caption={`Assistant found ${output.rows.length} matching rows`}
          />
          <DownloadButtons
            rows={output.rows}
            fileName={`${fileName}-matches`}
          />
        </>
      ) : null}
      {output.kind === 'grouped' && output.rows.length > 0 ? (
        <>
          <GroupedBarChart data={output.chart} />
          <DataTable
            rows={output.rows}
            columns={output.columns}
            caption={`Assistant grouped ${output.rows.length} totals`}
          />
          <DownloadButtons rows={output.rows} fileName={`${fileName}-totals`} />
        </>
      ) : null}
      {output.kind === 'download' ? (
        <DownloadButtons rows={output.rows} fileName={fileName} />
      ) : null}
      {output.kind === 'matches' && output.rows.length === 0 ? (
        <p className="text-xs text-ink-subtle">No matching rows to download.</p>
      ) : null}
    </div>
  )
}

function DownloadButtons({
  rows,
  fileName,
}: {
  rows: SheetRow[]
  fileName: string
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => downloadRows(rows, fileName, 'csv')}
        className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink-strong transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
      >
        Download CSV
      </button>
      <button
        type="button"
        onClick={() => downloadRows(rows, fileName, 'json')}
        className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink-strong transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
      >
        Download JSON
      </button>
      <span className="ml-auto self-center text-xs text-ink-subtle">
        {formatCount(rows.length)} rows
      </span>
    </div>
  )
}

function downloadRows(
  rows: SheetRow[],
  fileName: string,
  format: 'csv' | 'json',
) {
  const content =
    format === 'csv' ? rowsToCsv(rows) : JSON.stringify(rows, null, 2)
  const blob = new Blob([content], {
    type:
      format === 'csv'
        ? 'text/csv;charset=utf-8'
        : 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${sanitiseFileName(fileName)}.${format}`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
  trackAnalytics({
    event: 'sheet_data_downloaded',
    format,
    row_count: rows.length,
  })
}

function sanitiseFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned === '' ? 'sheet2json' : cleaned.slice(0, 60)
}
