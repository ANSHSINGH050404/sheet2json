import { beforeEach, describe, expect, it } from 'bun:test'

import { clearSheetCache, getParsedSheet, sheetCacheSize } from './cache'

const REFERENCE = {
  spreadsheetId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
  gid: '0',
}

const CSV = 'name,role\nAnsh,Developer\nRahul,Designer'

/** A fetch that counts its calls and can be told how to fail. */
function countingFetch(body: string = CSV): {
  impl: typeof fetch
  calls: () => number
} {
  let count = 0
  const impl = (async () => {
    count += 1
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/csv' },
    })
  }) as unknown as typeof fetch
  return { impl, calls: () => count }
}

beforeEach(() => {
  clearSheetCache()
})

describe('getParsedSheet', () => {
  it('fetches once and serves the second caller from cache', async () => {
    const { impl, calls } = countingFetch()

    const first = await getParsedSheet(REFERENCE, {
      userId: null,
      fetchImpl: impl,
    })
    const second = await getParsedSheet(REFERENCE, {
      userId: null,
      fetchImpl: impl,
    })

    expect(calls()).toBe(1)
    expect(second.rows).toEqual(first.rows)
  })

  it('parses the sheet rather than caching raw CSV', async () => {
    const { impl } = countingFetch()

    const sheet = await getParsedSheet(REFERENCE, {
      userId: null,
      fetchImpl: impl,
    })

    expect(sheet.headers).toEqual(['name', 'role'])
    expect(sheet.rowCount).toBe(2)
  })

  it('keeps one user sheet apart from another', async () => {
    const { impl, calls } = countingFetch()

    await getParsedSheet(REFERENCE, { userId: 'user-a', fetchImpl: impl })
    await getParsedSheet(REFERENCE, { userId: 'user-b', fetchImpl: impl })

    // The same sheet read as two different people is two different reads: one of
    // them may be a private sheet the other cannot see.
    expect(calls()).toBe(2)
  })

  it('keeps a signed-in read apart from an anonymous one', async () => {
    const { impl, calls } = countingFetch()

    await getParsedSheet(REFERENCE, { userId: null, fetchImpl: impl })
    await getParsedSheet(REFERENCE, { userId: 'user-a', fetchImpl: impl })

    expect(calls()).toBe(2)
  })

  it('treats a different tab as a different entry', async () => {
    const { impl, calls } = countingFetch()

    await getParsedSheet(REFERENCE, { userId: null, fetchImpl: impl })
    await getParsedSheet(
      { ...REFERENCE, gid: '99' },
      {
        userId: null,
        fetchImpl: impl,
      },
    )

    expect(calls()).toBe(2)
  })

  it('collapses concurrent misses into one upstream request', async () => {
    let count = 0
    const impl = (async () => {
      count += 1
      // A little latency, so the second caller arrives while the first is
      // still in flight. Without coalescing this would be two requests.
      await new Promise((resolve) => setTimeout(resolve, 10))
      return new Response(CSV, { status: 200 })
    }) as unknown as typeof fetch

    const [a, b, c] = await Promise.all([
      getParsedSheet(REFERENCE, { userId: null, fetchImpl: impl }),
      getParsedSheet(REFERENCE, { userId: null, fetchImpl: impl }),
      getParsedSheet(REFERENCE, { userId: null, fetchImpl: impl }),
    ])

    expect(count).toBe(1)
    expect(b.rows).toEqual(a.rows)
    expect(c.rows).toEqual(a.rows)
  })

  it('does not cache a failed read', async () => {
    let count = 0
    const impl = (async () => {
      count += 1
      return new Response('nope', { status: 500 })
    }) as unknown as typeof fetch

    // Retries are disabled so one call is one attempt.
    for (let i = 0; i < 2; i += 1) {
      await getParsedSheet(REFERENCE, {
        userId: null,
        fetchImpl: impl,
        retryAttempts: 1,
        sleepImpl: async () => undefined,
      }).catch(() => undefined)
    }

    // A failure must not be remembered as an empty sheet.
    expect(count).toBe(2)
    expect(sheetCacheSize()).toBe(0)
  })

  it('evicts the least recently used entry when full', async () => {
    // Each sheet is a distinct id, so each is a distinct entry.
    const { impl, calls } = countingFetch()

    for (let i = 0; i < 70; i += 1) {
      await getParsedSheet(
        {
          spreadsheetId: `sheetid${i.toString().padStart(8, '0')}`,
          gid: '0',
        },
        { userId: null, fetchImpl: impl },
      )
    }

    expect(sheetCacheSize()).toBeLessThanOrEqual(64)

    // Re-reading the most recent sheet should be a hit; the oldest was evicted.
    await getParsedSheet(
      { spreadsheetId: 'sheetid00000069', gid: '0' },
      { userId: null, fetchImpl: impl },
    )
    expect(calls()).toBe(70)
  })

  it('clearing empties the cache', async () => {
    const { impl, calls } = countingFetch()

    await getParsedSheet(REFERENCE, { userId: null, fetchImpl: impl })
    clearSheetCache()
    await getParsedSheet(REFERENCE, { userId: null, fetchImpl: impl })

    expect(calls()).toBe(2)
  })
})
