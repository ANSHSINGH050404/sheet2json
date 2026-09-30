import { AppError } from '#lib/errors'
import { getGoogleAccess } from '#server/auth/google-tokens'
import { applyRowQuery } from '#lib/query'
import type { RowQuery } from '#lib/query'
import type { ExtractionDetail, ExtractionSummary, SheetRow } from '#lib/types'
import { HISTORY_PAGE_SIZE } from '../config'
import { getPrisma } from '../db/prisma'
import { getParsedSheet } from '../google-sheets/cache'
import { extractSheetTitle, parseGoogleSheetUrl } from '../google-sheets/parser'

export interface ExtractSheetOptions {
  /** Injected in tests so the network is never required. */
  fetchImpl?: typeof fetch
  maxRows?: number
  /**
   * The signed-in user, when there is one.
   *
   * When present, the sheet is read with that user's Google grant if they have
   * one, which is what makes a private sheet readable. When absent, only public
   * sheets can be read.
   */
  userId?: string
  /**
   * Set when the caller is a signed-in browser, so anonymous use skips the
   * database write entirely rather than leaving an orphan row behind.
   */
  persist?: boolean
  /**
   * An optional `select` / `where` / `sort` / `limit` layer applied to the parsed
   * rows before they are counted or stored.
   *
   * Only the API sets this. The browser UI always wants the whole sheet, so an
   * absent query leaves the pipeline byte-for-byte what it was.
   */
  query?: RowQuery
}

/**
 * The end-to-end extraction pipeline:
 *
 *   URL -> validate -> spreadsheet id + gid -> fetch CSV -> parse CSV
 *       -> filter/sort/project -> count -> persist to PostgreSQL -> return
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

  // A signed-in user with a live Google grant reads the sheet as themselves,
  // which also covers public sheets. Anonymous callers only ever see public
  // sheets. A refresh failure downgrades to the anonymous path rather than
  // failing, because the sheet may well be public.
  const accessToken = await resolveAccessToken(
    options.userId,
    options.fetchImpl,
  )

  const parsed = await getParsedSheet(reference, {
    // The reader is part of the cache key, so a signed-in user's rows can never
    // be served to an anonymous caller, even for a public sheet.
    userId: options.userId ?? null,
    maxRows: options.maxRows,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(accessToken ? { accessToken } : {}),
  })

  // An unknown column is rejected here rather than silently yielding no rows.
  const data =
    options.query === undefined
      ? parsed.rows
      : applyRowQuery(parsed.rows, options.query)

  // The counts describe what the caller actually received, so `?limit=5` on a
  // 900-row sheet reports 5 rows rather than the 900 that were fetched.
  const rowCount = data.length
  const columnCount =
    options.query?.select === null || options.query?.select === undefined
      ? parsed.columnCount
      : data[0] === undefined
        ? 0
        : Object.keys(data[0]).length

  // Anonymous extractions are not stored. There is no owner to file them under
  // and no way to list them, so persisting them would only grow the table.
  if (options.persist === false) {
    return {
      id: '',
      spreadsheetId: reference.spreadsheetId,
      gid: reference.gid,
      title,
      sourceUrl: url.trim(),
      rowCount,
      columnCount,
      createdAt: new Date().toISOString(),
      isPrivate: accessToken !== undefined,
      data,
    }
  }

  const stored = await getPrisma().extraction.create({
    data: {
      spreadsheetId: reference.spreadsheetId,
      gid: reference.gid,
      title,
      sourceUrl: url.trim(),
      rowCount,
      columnCount,
      data,
      userId: options.userId ?? null,
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
      userId: true,
      createdAt: true,
    },
  })

  return {
    ...toSummary(stored),
    data: toRows(stored.data),
  }
}

/**
 * A usable Google access token for this user, or undefined.
 *
 * Never throws. A user whose grant has lapsed falls back to the anonymous path,
 * which still works for public sheets; surfacing a re-auth error here would break
 * the public case for an account problem.
 */
async function resolveAccessToken(
  userId: string | undefined,
  fetchImpl: typeof fetch | undefined,
): Promise<string | undefined> {
  if (!userId) return undefined
  try {
    const access = await getGoogleAccess(userId, { fetchImpl })
    return access.accessToken
  } catch (error) {
    if (error instanceof AppError && error.code === 'GOOGLE_REAUTH_REQUIRED') {
      return undefined
    }
    throw error
  }
}

/**
 * A user's own extractions, most recent first.
 *
 * Scoped to the owner. There is no global history any more: a null `userId` row
 * from before accounts existed belongs to nobody and is never listed.
 */
export async function getExtractions(
  userId: string,
  limit: number = HISTORY_PAGE_SIZE,
): Promise<ExtractionSummary[]> {
  const records = await getPrisma().extraction.findMany({
    where: { userId },
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
      userId: true,
      createdAt: true,
    },
  })

  return records.map(toSummary)
}

/**
 * A single extraction including its full stored JSON payload.
 *
 * A row owned by someone else reads as `NOT_FOUND`, not `FORBIDDEN`: telling the
 * two apart would confirm that an id exists, which leaks the shape of other
 * people's history.
 */
export async function getExtraction(
  id: string,
  userId: string,
): Promise<ExtractionDetail> {
  const record = await getPrisma().extraction.findFirst({
    where: { id, userId },
    select: {
      id: true,
      spreadsheetId: true,
      gid: true,
      title: true,
      sourceUrl: true,
      rowCount: true,
      columnCount: true,
      data: true,
      userId: true,
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

/** Deletes one of a user's extractions. Returns whether a row was removed. */
export async function deleteExtraction(
  id: string,
  userId: string,
): Promise<boolean> {
  const { count } = await getPrisma().extraction.deleteMany({
    where: { id, userId },
  })
  return count > 0
}

type StoredExtraction = {
  id: string
  spreadsheetId: string
  gid: string | null
  title: string | null
  sourceUrl: string
  rowCount: number
  columnCount: number
  userId: string | null
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
    // Stored rows are always owned (anonymous extractions are not persisted), so
    // any row read back here was read on that owner's behalf.
    isPrivate: record.userId !== null,
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
