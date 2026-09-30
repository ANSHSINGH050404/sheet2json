import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'

import type { AppError } from '#lib/errors'
import { parseRowQuery } from '#lib/query'
import type { ExtractionDetail } from '#lib/types'
import { getPrisma } from '#server/db/prisma'
import { clearSheetCache } from '#server/google-sheets/cache'
import { extractSheet } from '#server/services/extraction'

/**
 * The parsed-sheet cache is module-level state, and these tests mock the network
 * with a different body per test. That deliberately breaks the cache's core
 * assumption - the same key means the same content - so it has to be cleared
 * between tests or a later test silently reads an earlier test's rows.
 */
beforeEach(() => {
  clearSheetCache()
})

const SHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'
const URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0&title=Leads`

/** The database is only required for the happy path; every error below happens
 *  before the first query, so those tests run anywhere. */
const hasDatabase = Boolean(process.env.DATABASE_URL)

const created: string[] = []

function mockFetch(body: string, status = 200): typeof fetch {
  return (async () =>
    new Response(body, {
      status,
      headers: { 'content-type': 'text/csv' },
    })) as unknown as typeof fetch
}

function mockFetchStatus(status: number): typeof fetch {
  return (async () =>
    new Response('nope', { status })) as unknown as typeof fetch
}

function mockFetchThrows(error: Error): typeof fetch {
  return (async () => {
    throw error
  }) as unknown as typeof fetch
}

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return 'NO_THROW'
  } catch (error) {
    return (error as AppError).code
  }
}

afterAll(async () => {
  if (created.length === 0 || !hasDatabase) return
  await getPrisma().extraction.deleteMany({ where: { id: { in: created } } })
})

describe('extractSheet failure paths (no database needed)', () => {
  it('rejects a URL that is not a Google Sheets link before any network call', async () => {
    let called = false
    const fetchImpl = (async () => {
      called = true
      return new Response('')
    }) as unknown as typeof fetch

    expect(
      await code(extractSheet('https://example.com/x', { fetchImpl })),
    ).toBe('INVALID_URL')
    expect(called).toBe(false)
  })

  it('rejects an empty url', async () => {
    expect(await code(extractSheet('   ', { fetchImpl: mockFetch('') }))).toBe(
      'INVALID_URL',
    )
  })

  it('maps an HTTP error to SHEET_NOT_ACCESSIBLE', async () => {
    expect(
      await code(extractSheet(URL, { fetchImpl: mockFetchStatus(404) })),
    ).toBe('SHEET_NOT_ACCESSIBLE')
  })

  it('maps a network error to FETCH_FAILED', async () => {
    expect(
      await code(
        extractSheet(URL, {
          fetchImpl: mockFetchThrows(new TypeError('fetch failed')),
        }),
      ),
    ).toBe('FETCH_FAILED')
  })

  it('rejects an empty response', async () => {
    expect(await code(extractSheet(URL, { fetchImpl: mockFetch('') }))).toBe(
      'SHEET_EMPTY',
    )
  })

  it('rejects a sheet with headers but no rows', async () => {
    expect(
      await code(extractSheet(URL, { fetchImpl: mockFetch('name,email') })),
    ).toBe('SHEET_EMPTY')
  })

  it('rejects invalid CSV', async () => {
    expect(
      await code(extractSheet(URL, { fetchImpl: mockFetch('a\n"unclosed') })),
    ).toBe('PARSE_FAILED')
  })

  it('rejects a sheet that exceeds the row limit', async () => {
    const csv = ['a', '1', '2', '3', '4', '5'].join('\n')

    expect(
      await code(extractSheet(URL, { fetchImpl: mockFetch(csv), maxRows: 3 })),
    ).toBe('SHEET_TOO_LARGE')
  })

  it('rejects an HTML sign-in page', async () => {
    expect(
      await code(
        extractSheet(URL, {
          fetchImpl: mockFetch('<!DOCTYPE html><html>Sign in</html>'),
        }),
      ),
    ).toBe('SHEET_NOT_ACCESSIBLE')
  })
})

describe('extractSheet with a row query (no database needed)', () => {
  const CSV = [
    'name,email,role,amount',
    'Ansh,ansh@example.com,Developer,100',
    'Rahul,rahul@example.com,Designer,25',
    'Priya,priya@example.com,Developer,2500',
  ].join('\n')

  async function extract(query: string): Promise<ExtractionDetail> {
    return extractSheet(URL, {
      fetchImpl: mockFetch(CSV),
      persist: false,
      query: parseRowQuery(new URLSearchParams(query)),
    })
  }

  it('returns every row when no query is given', async () => {
    const result = await extract('')

    expect(result.rowCount).toBe(3)
    expect(result.columnCount).toBe(4)
    expect(result.data).toHaveLength(3)
  })

  it('counts what the caller received, not what was fetched', async () => {
    const result = await extract('limit=1')

    expect(result.rowCount).toBe(1)
    expect(result.data).toHaveLength(1)
  })

  it('counts only the projected columns', async () => {
    const result = await extract('select=name,email')

    expect(result.columnCount).toBe(2)
    expect(Object.keys(result.data[0] as object)).toEqual(['name', 'email'])
  })

  it('filters, orders and projects in one pass', async () => {
    const result = await extract(
      'where=role=Developer&sort=-amount&select=name,amount',
    )

    expect(result.rowCount).toBe(2)
    expect(result.data).toEqual([
      { name: 'Priya', amount: '2500' },
      { name: 'Ansh', amount: '100' },
    ])
  })

  it('rejects an unknown column with INVALID_QUERY, after the fetch', async () => {
    expect(await code(extract('select=emial'))).toBe('INVALID_QUERY')
  })

  it('serves a second read of the same sheet from cache', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return new Response(CSV, {
        status: 200,
        headers: { 'content-type': 'text/csv' },
      })
    }) as unknown as typeof fetch

    const first = await extractSheet(URL, { fetchImpl, persist: false })
    const second = await extractSheet(URL, { fetchImpl, persist: false })

    expect(calls).toBe(1)
    expect(second.data).toEqual(first.data)
  })

  it('still applies the query on a cached read', async () => {
    // The cache holds the parsed sheet, not the query result, so a different
    // query has to be applied to the cached rows rather than served from a
    // previously cached answer.
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return new Response(CSV, {
        status: 200,
        headers: { 'content-type': 'text/csv' },
      })
    }) as unknown as typeof fetch

    const all = await extractSheet(URL, { fetchImpl, persist: false })
    const filtered = await extractSheet(URL, {
      fetchImpl,
      persist: false,
      query: parseRowQuery(new URLSearchParams('where=role=Designer')),
    })

    expect(calls).toBe(1)
    expect(all.data).toHaveLength(3)
    expect(filtered.rowCount).toBe(1)
    expect(filtered.data).toEqual([
      {
        name: 'Rahul',
        email: 'rahul@example.com',
        role: 'Designer',
        amount: '25',
      },
    ])
  })
})

describe.skipIf(!hasDatabase)('extractSheet with a database', () => {
  let result: ExtractionDetail

  beforeAll(async () => {
    // `beforeAll` runs before this file's first `beforeEach`, so a cached sheet
    // from an earlier block would still be warm here.
    clearSheetCache()
    result = await extractSheet(URL, {
      fetchImpl: mockFetch(
        'name,email,role\nAnsh,ansh@example.com,Developer\nRahul,rahul@example.com,Designer',
      ),
    })
    created.push(result.id)
  })

  it('returns the parsed rows with the spreadsheet metadata', () => {
    expect(result.spreadsheetId).toBe(SHEET_ID)
    expect(result.gid).toBe('0')
    expect(result.title).toBe('Leads')
    expect(result.sourceUrl).toBe(URL)
    expect(result.rowCount).toBe(2)
    expect(result.columnCount).toBe(3)
    expect(result.data).toEqual([
      { name: 'Ansh', email: 'ansh@example.com', role: 'Developer' },
      { name: 'Rahul', email: 'rahul@example.com', role: 'Designer' },
    ])
    expect(typeof result.id).toBe('string')
    expect(Number.isNaN(Date.parse(result.createdAt))).toBe(false)
  })

  it('persists the extraction so it can be read back', async () => {
    const stored = await getPrisma().extraction.findUnique({
      where: { id: result.id },
    })

    expect(stored).not.toBeNull()
    expect(stored?.rowCount).toBe(2)
    expect(stored?.columnCount).toBe(3)
    expect(stored?.data).toEqual(result.data)
  })
})
