import { describe, expect, it } from 'bun:test'

import { AppError } from '#lib/errors'
import type { AppErrorCode } from '#lib/types'
import {
  bucketForIp,
  quotaHeaders,
  readBearerKey,
  retryAfterHeader,
} from '#server/api/authenticate'
import {
  apiError,
  apiJson,
  apiRowsResponse,
  toCsv,
  toNdjson,
} from '#server/api/response'
import { CORS_HEADERS, corsPreflight, methodNotAllowed } from '#server/api/cors'

describe('readBearerKey', () => {
  it('reads a key from a bearer header', () => {
    expect(readBearerKey('Bearer s2j_abc')).toBe('s2j_abc')
  })

  it('is case-insensitive about the scheme', () => {
    expect(readBearerKey('bearer s2j_abc')).toBe('s2j_abc')
    expect(readBearerKey('BEARER s2j_abc')).toBe('s2j_abc')
  })

  it('tolerates surrounding whitespace', () => {
    expect(readBearerKey('  Bearer   s2j_abc  ')).toBe('s2j_abc')
  })

  it('returns null for a missing or non-bearer header', () => {
    expect(readBearerKey(null)).toBeNull()
    expect(readBearerKey('')).toBeNull()
    expect(readBearerKey('Basic abc')).toBeNull()
    expect(readBearerKey('s2j_abc')).toBeNull()
    // A token with whitespace in it is a malformed header, not a two-part one.
    expect(readBearerKey('Bearer a b')).toBeNull()
  })
})

describe('bucketForIp', () => {
  it('returns a stable opaque key for the same address', () => {
    const a = bucketForIp('203.0.113.5')
    const b = bucketForIp('203.0.113.5')
    expect(a).toBe(b)
    expect(a).toBeDefined()
  })

  it('does not expose the address it hashed', () => {
    // The bucket id is stored and logged; the address itself is not in it.
    expect(bucketForIp('203.0.113.5')).not.toContain('203.0.113.5')
  })

  it('uses only the first entry of a forwarded chain', () => {
    // X-Forwarded-For is client-first and attacker-influenceable, so the value is
    // only ever an opaque bucket key, never parsed for meaning.
    expect(bucketForIp('203.0.113.5, 70.41.3.18, 150.172.238.178')).toBe(
      bucketForIp('203.0.113.5'),
    )
  })

  it('returns undefined for a missing address', () => {
    expect(bucketForIp(undefined)).toBeUndefined()
    expect(bucketForIp('')).toBeUndefined()
    expect(bucketForIp('   ')).toBeUndefined()
    expect(bucketForIp(',,,')).toBeUndefined()
  })
})

describe('quotaHeaders', () => {
  it('returns both the standard and legacy spellings', () => {
    const headers = quotaHeaders({
      allowed: true,
      scope: 'key',
      limit: 1000,
      remaining: 998,
      retryAfterSeconds: 120,
    })

    // Clients that cannot see their remaining quota discover the limit the hard
    // way, so both conventions are sent.
    expect(headers['RateLimit-Limit']).toBe('1000')
    expect(headers['RateLimit-Remaining']).toBe('998')
    expect(headers['X-RateLimit-Limit']).toBe('1000')
    expect(headers['X-RateLimit-Remaining']).toBe('998')
    expect(headers['RateLimit-Reset']).toBeDefined()
  })

  it('is empty when there is no limit to report', () => {
    expect(quotaHeaders(null)).toEqual({})
  })
})

describe('retryAfterHeader', () => {
  it('reports the seconds until the window rolls over', () => {
    const headers = retryAfterHeader({
      allowed: false,
      scope: 'ip',
      limit: 60,
      remaining: 0,
      retryAfterSeconds: 42,
    })
    expect(headers['Retry-After']).toBe('42')
  })
})

describe('CORS', () => {
  it('allows any origin, without credentials', () => {
    // Deliberate: the credential lives in a header, and the response does not opt
    // into credentialed requests, so a hostile page has no ambient authority to
    // spend. Adding `Allow-Credentials` here would hand every site a signed-in
    // visitor's private sheets.
    expect(CORS_HEADERS['access-control-allow-origin']).toBe('*')
    expect(CORS_HEADERS['access-control-allow-credentials']).toBeUndefined()
  })

  it('answers a preflight with the headers a browser needs', () => {
    const response = corsPreflight()

    expect(response.status).toBe(204)
    // A request with an Authorization header is not "simple", so it is listed
    // explicitly or the browser blocks the real call.
    expect(response.headers.get('access-control-allow-headers')).toContain(
      'authorization',
    )
    expect(response.headers.get('access-control-allow-methods')).toContain(
      'GET',
    )
  })

  it('reports 405 with an Allow header for an unsupported method', () => {
    const response = methodNotAllowed('GET, OPTIONS')
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, OPTIONS')
  })
})

describe('apiJson', () => {
  it('returns JSON and is never cached by a shared cache', async () => {
    const response = apiJson({ ok: true })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    // An authenticated response must never be stored by a proxy on the way back.
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ ok: true })
  })

  it('lets a caller override the cache policy', () => {
    const response = apiJson(
      {},
      { headers: { 'cache-control': 'private, max-age=60' } },
    )
    expect(response.headers.get('cache-control')).toBe('private, max-age=60')
  })
})

describe('apiRowsResponse', () => {
  const rows = [{ name: 'Ansh' }]
  const jsonBody = { data: rows }
  const headers = { 'x-request-id': 'request-1' }

  it('uses the JSON body and shared headers for JSON output', async () => {
    const response = apiRowsResponse({
      format: 'json',
      rows,
      jsonBody,
      headers,
    })

    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('x-request-id')).toBe('request-1')
    expect(await response.json()).toEqual(jsonBody)
  })

  it('serializes rows as CSV', async () => {
    const response = apiRowsResponse({
      format: 'csv',
      rows,
      jsonBody,
      headers,
    })

    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('x-request-id')).toBe('request-1')
    expect(await response.text()).toBe('name\nAnsh')
  })

  it('serializes rows as NDJSON', async () => {
    const response = apiRowsResponse({
      format: 'ndjson',
      rows,
      jsonBody,
      headers,
    })

    expect(response.headers.get('content-type')).toBe(
      'application/x-ndjson; charset=utf-8',
    )
    expect(response.headers.get('x-request-id')).toBe('request-1')
    expect(await response.text()).toBe('{"name":"Ansh"}')
  })
})

describe('apiError', () => {
  it('maps each app error code to the status a client expects', async () => {
    const cases: ReadonlyArray<readonly [AppErrorCode, number]> = [
      ['UNAUTHENTICATED', 401],
      ['FORBIDDEN', 403],
      ['RATE_LIMITED', 429],
      ['NOT_FOUND', 404],
      ['INVALID_URL', 400],
      ['SHEET_NOT_ACCESSIBLE', 403],
      ['SHEET_TOO_LARGE', 413],
      ['INTERNAL_ERROR', 500],
    ]

    for (const [code, status] of cases) {
      const response = apiError(new AppError(code, 'message'))
      expect(response.status).toBe(status)
    }
  })

  it('sends only the code and message, never a stack', async () => {
    const error = new AppError('INVALID_URL', 'That URL is not valid.', {
      upstream: 'secret detail',
    })
    const response = apiError(error)
    const body = await response.json()

    expect(body).toEqual({
      error: { code: 'INVALID_URL', message: 'That URL is not valid.' },
    })
    // The cause stays in the server log.
    expect(JSON.stringify(body)).not.toContain('secret detail')
    expect(JSON.stringify(body)).not.toContain('stack')
  })

  it('does not leak an unexpected error', async () => {
    const response = apiError(new Error('connection string leaked here'))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong. Please try again.',
      },
    })
  })
})

describe('toCsv', () => {
  it('returns an empty string for no rows', () => {
    expect(toCsv([])).toBe('')
  })

  it('writes a header row and the values', () => {
    expect(toCsv([{ a: '1', b: '2' }])).toBe('a,b\n1,2')
  })

  it('quotes a value containing a comma', () => {
    expect(toCsv([{ a: 'x,y' }])).toBe('a\n"x,y"')
  })

  it('doubles an embedded quote', () => {
    expect(toCsv([{ a: 'say "hi"' }])).toBe('a\n"say ""hi"""')
  })

  it('quotes a value containing a newline', () => {
    expect(toCsv([{ a: 'one\ntwo' }])).toBe('a\n"one\ntwo"')
  })

  it('defuses a value that a spreadsheet would treat as a formula', () => {
    // Prefixed with a tab so it cannot execute when the CSV is opened in Excel or
    // Sheets, without changing the value for a parser that does not care.
    expect(toCsv([{ a: '=1+1' }])).toBe('a\n\t=1+1')
    expect(toCsv([{ a: '+1' }])).toBe('a\n\t+1')
    expect(toCsv([{ a: '-1' }])).toBe('a\n\t-1')
    expect(toCsv([{ a: '@SUM(A1)' }])).toBe('a\n\t@SUM(A1)')
  })

  it('pads a short row so the column count matches the header', () => {
    // The parser is lenient about ragged rows, so a missing value must still
    // produce the right number of columns.
    expect(toCsv([{ a: '1', b: '2' }, { a: '3' }])).toBe('a,b\n1,2\n3,')
  })
})

describe('toNdjson', () => {
  it('writes one compact JSON object per line', () => {
    expect(toNdjson([{ a: '1' }, { a: '2' }])).toBe('{"a":"1"}\n{"a":"2"}')
  })

  it('returns an empty string for no rows', () => {
    expect(toNdjson([])).toBe('')
  })

  it('emits no line breaks inside a record', () => {
    // A value containing a newline must stay on one line, or a line-by-line
    // reader would split a record in two.
    const output = toNdjson([{ a: 'one\ntwo' }])
    expect(output.split('\n')).toHaveLength(1)
    expect(JSON.parse(output)).toEqual({ a: 'one\ntwo' })
  })
})
