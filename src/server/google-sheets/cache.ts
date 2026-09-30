import {
  SHEET_CACHE_MAX_ENTRIES,
  SHEET_CACHE_MAX_ENTRY_BYTES,
  SHEET_CACHE_TTL_SECONDS,
} from '../config'
import type { GoogleSheetReference, ParsedSheet } from '#lib/types'
import { parseSheetCsv } from './extractor'

/**
 * A short-lived, in-process cache of parsed sheets.
 *
 * The reason this exists: the published live table polls every open tab every five
 * minutes, and every poll was a fresh request to Google. Fifty tabs on one sheet
 * meant fifty upstream fetches, all charged to the caller's rate limit and to
 * Google's. Keyed on the sheet *and the reader*, one upstream fetch now serves
 * every tab.
 *
 * Deliberately in-process rather than in the database. It is a cache, not a
 * source of truth: a lost instance costs one extra fetch and nothing else, which
 * is the right trade against a shared cache that has to be invalidated, sized and
 * paid for.
 *
 * The security-relevant property is that the key includes the reader. A sheet
 * fetched with one user's Google grant must never be handed to another user, so
 * anonymous and per-user reads occupy separate entries even for the same sheet.
 */

interface CacheEntry {
  sheet: ParsedSheet
  /** Epoch ms after which the entry is stale. */
  expiresAt: number
  /** Rough size in bytes, used to decide whether caching is worth it at all. */
  bytes: number
}

/** Insertion order is the LRU order; re-inserting on read moves an entry to the end. */
const entries = new Map<string, CacheEntry>()

/**
 * In-flight fetches, keyed the same way as the cache.
 *
 * This is the part that matters under load: a burst of concurrent misses on the
 * same sheet shares one upstream request rather than racing to make several.
 */
const inFlight = new Map<string, Promise<ParsedSheet>>()

export interface CachedSheetOptions {
  /**
   * The reader, used to keep one user's rows away from another's.
   *
   * `null` for an anonymous read. A signed-in user gets their own entry whether
   * or not they have connected Google, so a session's rows never cross over.
   */
  userId: string | null
  maxRows?: number
  /**
   * Injected in tests. Defaults to the global `fetch`; see `fetchSheetCsv`.
   */
  fetchImpl?: typeof fetch
  timeoutMs?: number
  maxBytes?: number
  sleepImpl?: (ms: number) => Promise<void>
  retryAttempts?: number
  accessToken?: string
}

/**
 * A parsed sheet, from cache when warm.
 *
 * Never throws for a cache problem: if the cache is disabled, the entry is too
 * large to keep, or something unexpected goes wrong, this reads from Google and
 * carries on. A cache is an optimisation and must not be able to fail a request.
 */
export async function getParsedSheet(
  reference: GoogleSheetReference,
  options: CachedSheetOptions,
): Promise<ParsedSheet> {
  if (SHEET_CACHE_TTL_SECONDS <= 0) {
    return readSheet(reference, options)
  }

  const key = cacheKey(reference, options.userId)
  const cached = readEntry(key)
  if (cached !== null) return cached

  // Coalesce concurrent misses: the second caller waits on the first request
  // rather than starting a second one against Google.
  const pending = inFlight.get(key)
  if (pending !== undefined) return pending

  const request = readSheet(reference, options)
    .then((sheet) => {
      writeEntry(key, sheet)
      return sheet
    })
    .finally(() => {
      inFlight.delete(key)
    })

  inFlight.set(key, request)
  return request
}

/**
 * The cache key.
 *
 * `userId` is part of the key rather than a flag, because the distinction that
 * matters is *whose* rows these are. Including the null case explicitly means an
 * anonymous read of a public sheet can never collide with a signed-in read of the
 * same sheet.
 */
function cacheKey(
  reference: GoogleSheetReference,
  userId: string | null,
): string {
  return [
    reference.spreadsheetId,
    reference.gid ?? '-',
    userId ?? 'anonymous',
  ].join(':')
}

function readEntry(key: string): ParsedSheet | null {
  const entry = entries.get(key)
  if (entry === undefined) return null

  if (entry.expiresAt <= Date.now()) {
    entries.delete(key)
    return null
  }

  // Refresh recency so a hot sheet is not the one evicted.
  entries.delete(key)
  entries.set(key, entry)
  return entry.sheet
}

function writeEntry(key: string, sheet: ParsedSheet): void {
  const bytes = estimateBytes(sheet)

  // A sheet this large would crowd out everything else. Better to keep fetching
  // it than to hold one entry that can exhaust the instance.
  if (bytes > SHEET_CACHE_MAX_ENTRY_BYTES) {
    entries.delete(key)
    return
  }

  entries.delete(key)
  entries.set(key, {
    sheet,
    expiresAt: Date.now() + SHEET_CACHE_TTL_SECONDS * 1000,
    bytes,
  })

  while (entries.size > SHEET_CACHE_MAX_ENTRIES) {
    const oldest = entries.keys().next()
    if (oldest.done === true) break
    entries.delete(oldest.value)
  }
}

/** Fetches and parses, with no cache involvement. */
async function readSheet(
  reference: GoogleSheetReference,
  options: CachedSheetOptions,
): Promise<ParsedSheet> {
  // Imported lazily so this module has no import cycle with the fetcher.
  const { fetchSheetCsv } = await import('./fetcher')

  const csv = await fetchSheetCsv(reference, {
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.timeoutMs !== undefined
      ? { timeoutMs: options.timeoutMs }
      : {}),
    ...(options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {}),
    ...(options.sleepImpl ? { sleepImpl: options.sleepImpl } : {}),
    ...(options.retryAttempts !== undefined
      ? { retryAttempts: options.retryAttempts }
      : {}),
    ...(options.accessToken ? { accessToken: options.accessToken } : {}),
  })

  return parseSheetCsv(csv, { maxRows: options.maxRows })
}

/**
 * A rough size for a parsed sheet.
 *
 * Deliberately an over-estimate: the goal is to avoid caching a sheet that would
 * crowd the instance, and being wrong in that direction is the safe direction.
 */
function estimateBytes(sheet: ParsedSheet): number {
  let bytes = 0
  for (const row of sheet.rows) {
    for (const [key, value] of Object.entries(row)) {
      bytes += key.length + value.length + 4
    }
  }
  return bytes
}

/** Empties the cache. Exported for tests, which must not share cached sheets. */
export function clearSheetCache(): void {
  entries.clear()
  inFlight.clear()
}

/** Current entry count. Exported for tests. */
export function sheetCacheSize(): number {
  return entries.size
}
