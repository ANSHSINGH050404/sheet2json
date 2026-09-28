import { AppError } from '#lib/errors'
import type { ExtractionDetail, ExtractionSummary, SheetRow } from '#lib/types'
import { HISTORY_PAGE_SIZE } from '../config'
import { getPrisma } from '../db/prisma'
import { parseSheetCsv } from '../google-sheets/extractor'
import { fetchSheetCsv } from '../google-sheets/fetcher'
import { extractSheetTitle, parseGoogleSheetUrl } from '../google-sheets/parser'

export interface ExtractSheetOptions {
  /** Injected in tests so the network is never required. */
  fetchImpl?: typeof fetch
  maxRows?: number
}

/**
 * The end-to-end extraction pipeline:
 *
 *   URL -> validate -> spreadsheet id + gid -> fetch CSV -> parse CSV
 *       -> count rows/columns -> persist to PostgreSQL -> return
 *
 * Only the spreadsheet id and gid ever reach the network layer, and both are
 * validated against a strict character allow-list first.
 */
export async function extractSheet(
  url: string,
  options: ExtractSheetOptions = {},
): Promise<ExtractionDetail> {
  const reference = parseGoogleSheetUrl(url)
  const title = extractSheetTitle(url)

  const csv = await fetchSheetCsv(reference, { fetchImpl: options.fetchImpl })
  const sheet = await parseSheetCsv(csv, { maxRows: options.maxRows })

  const stored = await getPrisma().extraction.create({
    data: {
      spreadsheetId: reference.spreadsheetId,
      gid: reference.gid,
      title,
      sourceUrl: url.trim(),
      rowCount: sheet.rowCount,
      columnCount: sheet.columnCount,
      data: sheet.rows,
    },
    select: {
      id: true,
      spreadsheetId: true,
      gid: true,
      title: true,
      sourceUrl: true,
      rowCount: true,
      columnCount: true,
      data: true,
      createdAt: true,
    },
  })

  return {
    ...toSummary(stored),
    data: toRows(stored.data),
  }
}

/**
 * Most recent extractions first. The MVP has no authentication, so this is
 * deliberately *global* application history - every visitor sees every row.
 * Only the fields the list renders are selected; the JSON payload is skipped.
 */
export async function getExtractions(
  limit: number = HISTORY_PAGE_SIZE,
): Promise<ExtractionSummary[]> {
  const records = await getPrisma().extraction.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 200),
    select: {
      id: true,
      spreadsheetId: true,
      gid: true,
      title: true,
      sourceUrl: true,
      rowCount: true,
      columnCount: true,
      createdAt: true,
    },
  })

  return records.map(toSummary)
}

/** A single extraction including its full stored JSON payload. */
export async function getExtraction(id: string): Promise<ExtractionDetail> {
  const record = await getPrisma().extraction.findUnique({
    where: { id },
    select: {
      id: true,
      spreadsheetId: true,
      gid: true,
      title: true,
      sourceUrl: true,
      rowCount: true,
      columnCount: true,
      data: true,
      createdAt: true,
    },
  })

  if (!record) {
    throw new AppError('NOT_FOUND', 'That extraction could not be found.')
  }

  return {
    ...toSummary(record),
    data: toRows(record.data),
  }
}

type StoredExtraction = {
  id: string
  spreadsheetId: string
  gid: string | null
  title: string | null
  sourceUrl: string
  rowCount: number
  columnCount: number
  createdAt: Date
}

function toSummary(record: StoredExtraction): ExtractionSummary {
  return {
    id: record.id,
    spreadsheetId: record.spreadsheetId,
    gid: record.gid,
    title: record.title,
    sourceUrl: record.sourceUrl,
    rowCount: record.rowCount,
    columnCount: record.columnCount,
    // Serialised as an ISO string so the client never depends on Date revival.
    createdAt: record.createdAt.toISOString(),
  }
}

/** The `Json` column is untrusted on read: normalise it back into rows. */
function toRows(data: unknown): SheetRow[] {
  if (!Array.isArray(data)) return []
  return data.filter(
    (row): row is SheetRow =>
      typeof row === 'object' && row !== null && !Array.isArray(row),
  )
}
