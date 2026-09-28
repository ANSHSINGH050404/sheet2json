import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import type { AppError } from '#lib/errors'
import type { ExtractionDetail } from '#lib/types'
import { getPrisma } from '#server/db/prisma'
import { extractSheet } from '#server/services/extraction'

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
  return (async () => new Response('nope', { status })) as unknown as typeof fetch
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

    expect(await code(extractSheet('https://example.com/x', { fetchImpl }))).toBe(
      'INVALID_URL',
    )
    expect(called).toBe(false)
  })

  it('rejects an empty url', async () => {
    expect(await code(extractSheet('   ', { fetchImpl: mockFetch('') }))).toBe(
      'INVALID_URL',
    )
  })

  it('maps an HTTP error to SHEET_NOT_ACCESSIBLE', async () => {
    expect(
      await code(
        extractSheet(URL, { fetchImpl: mockFetchStatus(404) }),
      ),
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

describe.skipIf(!hasDatabase)('extractSheet with a database', () => {
  let result: ExtractionDetail

  beforeAll(async () => {
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
