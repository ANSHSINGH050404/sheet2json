import { applyRowQuery, parseRowQuery } from '#lib/query'
import type { RowQuery } from '#lib/query'
import { AppError } from '#lib/errors'
import type { SheetRow } from '#lib/types'

/** Fields in the saved-endpoint form, using the API query syntax. */
export interface EndpointQueryDraft {
  /** Comma-separated column names. */
  columns: string
  /** One `column<operator>value` condition per line; conditions are ANDed. */
  where: string
  /** Comma-separated column names; prefix a name with `-` for descending. */
  sort: string
  /** Maximum returned rows. */
  limit: string
}

/** A checked recipe and its preview against the current extraction. */
export interface EndpointQueryPreview {
  query: string
  rows: SheetRow[]
  columns: string[]
}

const ENDPOINT_QUERY_PARAMETERS = new Set(['select', 'where', 'sort', 'limit'])

/** Parses only the row-query options stored on an endpoint. */
export function parseEndpointQuery(query: string): RowQuery {
  const params = new URLSearchParams(query)

  for (const parameter of params.keys()) {
    if (ENDPOINT_QUERY_PARAMETERS.has(parameter)) continue
    throw new AppError(
      'INVALID_QUERY',
      `Unsupported saved endpoint option: ${parameter}. Use select, where, sort or limit.`,
    )
  }

  return parseRowQuery(params)
}

/**
 * Builds and validates the query stored on a saved endpoint, then previews the
 * same recipe against the already-loaded sheet rows.
 *
 * Parsing and evaluation go through the same functions used by the REST API, so
 * a recipe that previews successfully has the same semantics when called later.
 */
export function prepareEndpointQuery(
  rows: SheetRow[],
  draft: EndpointQueryDraft,
): EndpointQueryPreview {
  const params = new URLSearchParams()
  const columnsInput = draft.columns.trim()
  const sortInput = draft.sort.trim()
  const limitInput = draft.limit.trim()

  if (columnsInput) params.set('select', columnsInput)
  for (const condition of draft.where.split(/\r?\n/)) {
    const trimmed = condition.trim()
    if (trimmed) params.append('where', trimmed)
  }
  if (sortInput) params.set('sort', sortInput)
  if (limitInput) params.set('limit', limitInput)

  const query = parseEndpointQuery(params.toString())
  const previewRows = applyRowQuery(rows, query)

  return {
    query: params.toString(),
    rows: previewRows,
    columns: query.select ?? Object.keys(rows[0] ?? {}),
  }
}
