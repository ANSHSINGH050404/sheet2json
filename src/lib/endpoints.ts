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

/** Describes the tab encoded in the source URL used for the current extraction. */
export function describeSelectedSheetTab(sourceUrl: string): string {
  try {
    const fragment = new URL(sourceUrl).hash.replace(/^#/, '')
    const params = new URLSearchParams(fragment)
    const rawGid = params.get('gid')
    const gid = rawGid && /^\d{1,19}$/.test(rawGid) ? rawGid : null
    const title = params.get('title')?.trim()

    if (title) return gid ? `${title} (gid ${gid})` : title
    if (gid) return `gid ${gid}`
  } catch {
    // The extraction pipeline has already validated this URL; this is only a
    // display hint, so fall through to the default-tab label if it is absent.
  }

  return 'the default tab'
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

/** Human-readable row-query settings for the saved endpoint list. */
export function describeEndpointRecipe(recipe: RowQuery): string[] {
  return [
    recipe.select ? `columns: ${recipe.select.join(', ')}` : null,
    ...recipe.conditions.map(
      ({ column, operator, value }) => `where ${column}${operator}${value}`,
    ),
    recipe.sort.length > 0
      ? `sort: ${recipe.sort
          .map(({ column, direction }) =>
            direction === 'desc' ? `-${column}` : column,
          )
          .join(', ')}`
      : null,
    recipe.limit !== null ? `limit: ${recipe.limit}` : null,
  ].filter((part): part is string => part !== null)
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
