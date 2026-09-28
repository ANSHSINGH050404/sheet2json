import { AppError } from '#lib/errors'
import { GOOGLE_SHEETS_HOSTNAME } from '#lib/validation'
import type { GoogleSheetReference } from '#lib/types'
import { FETCH_TIMEOUT_MS, GOOGLE_CSV_ENDPOINT, MAX_RESPONSE_BYTES } from '../config'

const NOT_ACCESSIBLE_MESSAGE =
  'This Google Sheet could not be accessed. Make sure the sheet is publicly accessible.'
const FETCH_FAILED_MESSAGE =
  'Could not reach Google Sheets. Please check your connection and try again.'
const TOO_LARGE_MESSAGE =
  'This spreadsheet is too large for the MVP limit. Try a smaller tab or range.'

export interface FetchCsvOptions {
  /** Injected in tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
  timeoutMs?: number
  maxBytes?: number
}

/**
 * Builds the public CSV URL for a sheet reference.
 *
 * Both components were validated against a strict character allow-list before
 * they got here, so the resulting URL can only ever point at
 * `https://docs.google.com/spreadsheets/d/<id>/gviz/tq` with a numeric `gid`.
 * User input is never interpolated into a free-form URL - this is the SSRF
 * boundary for the app.
 */
export function buildCsvUrl(reference: GoogleSheetReference): string {
  const base = GOOGLE_CSV_ENDPOINT.replace(
    '{spreadsheetId}',
    reference.spreadsheetId,
  )
  const url = new URL(base)
  if (url.hostname !== GOOGLE_SHEETS_HOSTNAME) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Refusing to build an upstream URL for an unexpected host.',
    )
  }
  if (reference.gid !== null) {
    url.searchParams.set('gid', reference.gid)
  }
  return url.toString()
}

/**
 * Downloads the CSV representation of a public Google Sheet.
 *
 * Reads the body as a stream and aborts as soon as `maxBytes` is exceeded, so a
 * multi-gigabyte sheet can never be buffered into memory.
 */
export async function fetchSheetCsv(
  reference: GoogleSheetReference,
  options: FetchCsvOptions = {},
): Promise<string> {
  const doFetch = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? MAX_RESPONSE_BYTES
  const url = buildCsvUrl(reference)

  let response: Response
  try {
    response = await doFetch(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: 'text/csv,text/plain;q=0.9,*/*;q=0.8',
        'user-agent': 'Sheet2JSON/1.0 (+public sheet extractor)',
      },
    })
  } catch (cause) {
    // `redirect: 'error'` turns an open-redirect hop into a TypeError; that is
    // a refusal to follow, not a connectivity problem.
    if (cause instanceof DOMException && cause.name === 'TimeoutError') {
      throw new AppError(
        'FETCH_FAILED',
        'Google Sheets took too long to respond. Please try again.',
        cause,
      )
    }
    throw new AppError('FETCH_FAILED', FETCH_FAILED_MESSAGE, cause)
  }

  if (!response.ok) {
    // 401/403/404 are what Google returns for private, deleted or
    // non-existent sheets. The distinction is not useful (and is guessable)
    // to the user, so all three share one message.
    if ([401, 403, 404].includes(response.status)) {
      throw new AppError('SHEET_NOT_ACCESSIBLE', NOT_ACCESSIBLE_MESSAGE)
    }
    throw new AppError(
      'FETCH_FAILED',
      'Google Sheets returned an unexpected response. Please try again.',
      `status: ${response.status}`,
    )
  }

  const body = await readBodyWithLimit(response, maxBytes)
  return body
}

async function readBodyWithLimit(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const declared = response.headers.get('content-length')
  if (declared !== null && Number(declared) > maxBytes) {
    throw new AppError('SHEET_TOO_LARGE', TOO_LARGE_MESSAGE)
  }

  if (!response.body) {
    return ''
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new AppError('SHEET_TOO_LARGE', TOO_LARGE_MESSAGE)
      }
      chunks.push(value)
    }
  } catch (cause) {
    if (cause instanceof AppError) throw cause
    throw new AppError(
      'FETCH_FAILED',
      'The download from Google Sheets was interrupted. Please try again.',
      cause,
    )
  } finally {
    reader.releaseLock()
  }

  return new TextDecoder('utf-8').decode(concat(chunks, total))
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}
