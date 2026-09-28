import { describe, expect, it } from 'bun:test'

import type { AppError } from '#lib/errors'
import type { GoogleSheetReference } from '#lib/types'
import { buildCsvUrl, fetchSheetCsv } from '#server/google-sheets/fetcher'

const REFERENCE: GoogleSheetReference = {
  spreadsheetId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
  gid: null,
}

function mockFetch(handler: (url: string) => Response | Promise<Response>): {
  impl: typeof fetch
  calls: string[]
} {
  const calls: string[] = []
  const impl = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : String(input)
    calls.push(url)
    return handler(url)
  }) as unknown as typeof fetch
  return { impl, calls }
}

function csvResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/csv' },
  })
}

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return 'NO_THROW'
  } catch (error) {
    return (error as AppError).code
  }
}

describe('buildCsvUrl', () => {
  it('builds the public gviz CSV url', () => {
    const url = new URL(buildCsvUrl(REFERENCE))

    expect(url.origin).toBe('https://docs.google.com')
    expect(url.pathname).toBe(
      `/spreadsheets/d/${REFERENCE.spreadsheetId}/gviz/tq`,
    )
    expect(url.searchParams.get('tqx')).toBe('out:csv')
    expect(url.searchParams.get('gid')).toBeNull()
  })

  it('includes the gid when present', () => {
    const url = new URL(buildCsvUrl({ ...REFERENCE, gid: '42' }))

    expect(url.searchParams.get('gid')).toBe('42')
  })
})

describe('fetchSheetCsv', () => {
  it('returns the CSV body from a successful response', async () => {
    const { impl, calls } = mockFetch(() => csvResponse('a,b\n1,2'))

    const body = await fetchSheetCsv(REFERENCE, { fetchImpl: impl })

    expect(body).toBe('a,b\n1,2')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('docs.google.com')
  })

  it('requests the tab named by the gid', async () => {
    const { impl, calls } = mockFetch(() => csvResponse('a\n1'))

    await fetchSheetCsv({ ...REFERENCE, gid: '99' }, { fetchImpl: impl })

    expect(calls[0]).toContain('gid=99')
  })

  it('maps 401, 403 and 404 to SHEET_NOT_ACCESSIBLE', async () => {
    for (const status of [401, 403, 404]) {
      const { impl } = mockFetch(() => new Response('nope', { status }))
      expect(await code(fetchSheetCsv(REFERENCE, { fetchImpl: impl }))).toBe(
        'SHEET_NOT_ACCESSIBLE',
      )
    }
  })

  it('maps other error statuses to FETCH_FAILED', async () => {
    const { impl } = mockFetch(() => new Response('boom', { status: 500 }))

    expect(await code(fetchSheetCsv(REFERENCE, { fetchImpl: impl }))).toBe(
      'FETCH_FAILED',
    )
  })

  it('maps a network error to FETCH_FAILED', async () => {
    const { impl } = mockFetch(() => {
      throw new TypeError('fetch failed')
    })

    expect(await code(fetchSheetCsv(REFERENCE, { fetchImpl: impl }))).toBe(
      'FETCH_FAILED',
    )
  })

  it('maps a timeout to FETCH_FAILED', async () => {
    const { impl } = mockFetch(() => {
      throw new DOMException('The operation timed out', 'TimeoutError')
    })

    expect(await code(fetchSheetCsv(REFERENCE, { fetchImpl: impl }))).toBe(
      'FETCH_FAILED',
    )
  })

  it('rejects an oversized body declared by content-length', async () => {
    const { impl } = mockFetch(
      () =>
        new Response('a\n1', {
          status: 200,
          headers: { 'content-length': '999999' },
        }),
    )

    expect(
      await code(fetchSheetCsv(REFERENCE, { fetchImpl: impl, maxBytes: 1024 })),
    ).toBe('SHEET_TOO_LARGE')
  })

  it('stops reading a stream that exceeds the byte limit', async () => {
    // No content-length, so the limit can only be enforced while reading.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const chunk = new TextEncoder().encode('a'.repeat(512))
        for (let i = 0; i < 8; i += 1) controller.enqueue(chunk)
        controller.close()
      },
    })
    const { impl } = mockFetch(() => new Response(stream, { status: 200 }))

    expect(
      await code(fetchSheetCsv(REFERENCE, { fetchImpl: impl, maxBytes: 1024 })),
    ).toBe('SHEET_TOO_LARGE')
  })

  it('handles an empty response body', async () => {
    const { impl } = mockFetch(() => new Response(null, { status: 200 }))

    expect(await fetchSheetCsv(REFERENCE, { fetchImpl: impl })).toBe('')
  })

  it('decodes multi-byte UTF-8 correctly', async () => {
    const { impl } = mockFetch(() => csvResponse('名前\n日本語'))

    expect(await fetchSheetCsv(REFERENCE, { fetchImpl: impl })).toBe(
      '名前\n日本語',
    )
  })

  it('never leaks the upstream error body to the caller', async () => {
    const { impl } = mockFetch(
      () => new Response('SECRET-UPSTREAM-DETAIL', { status: 500 }),
    )

    try {
      await fetchSheetCsv(REFERENCE, { fetchImpl: impl })
      throw new Error('expected a throw')
    } catch (error) {
      const appError = error as AppError
      expect(appError.message).not.toContain('SECRET')
      expect(appError.toJSON()).toEqual({
        code: 'FETCH_FAILED',
        message:
          'Google Sheets returned an unexpected response. Please try again.',
      })
    }
  })
})
