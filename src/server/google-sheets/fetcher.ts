import { AppError, asAppError } from '#lib/errors'
import { GOOGLE_SHEETS_HOSTNAME } from '#lib/validation'
import type { GoogleSheetReference } from '#lib/types'
import {
  FETCH_RETRY_ATTEMPTS,
  FETCH_RETRY_BASE_MS,
  FETCH_TIMEOUT_MS,
  GOOGLE_CSV_ENDPOINT,
  MAX_RESPONSE_BYTES,
} from '../config'

/** Ceiling on any single backoff wait, including one we took from `Retry-After`. */
const MAX_BACKOFF_MS = 4_000

const NOT_ACCESSIBLE_MESSAGE =
  'This Google Sheet could not be accessed. Share it as "Anyone with the link - Viewer", or connect your Google account to read a private sheet.'
const FETCH_FAILED_MESSAGE =
  'Could not reach Google Sheets. Please check your connection and try again.'
const TOO_LARGE_MESSAGE =
  'This spreadsheet is too large for the MVP limit. Try a smaller tab or range.'

export interface FetchCsvOptions {
  /** Injected in tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
  timeoutMs?: number
  maxBytes?: number
  /**
   * Injected in tests so a retry backoff does not make the suite wait.
   * Defaults to a real timer.
   */
  sleepImpl?: (ms: number) => Promise<void>
  /**
   * Total attempts, including the first. Injected in tests so the retry paths can
   * be exercised without the real attempt count.
   */
  retryAttempts?: number
  /**
   * The caller's Google access token, when the extraction runs on their behalf.
   *
   * When present the sheet is read as that user, which is what makes a private
   * sheet readable. It is passed as a bearer header rather than a query parameter
   * so the credential cannot end up in a URL, a log line, or a `Referer`.
   */
  accessToken?: string
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
 * Downloads the CSV representation of a Google Sheet.
 *
 * Reads the body as a stream and aborts as soon as `maxBytes` is exceeded, so a
 * multi-gigabyte sheet can never be buffered into memory.
 *
 * A 429 or 5xx is retried with exponential backoff, because a transient Google
 * blip should not read to the user as a failed extraction. A 4xx is not retried:
 * a sheet that is private or gone will still be private or gone in 500ms, and
 * retrying only spends the caller's rate limit to reach the same answer.
 */
export async function fetchSheetCsv(
  reference: GoogleSheetReference,
  options: FetchCsvOptions = {},
): Promise<string> {
  const attempts = options.retryAttempts ?? FETCH_RETRY_ATTEMPTS
  const sleep = options.sleepImpl ?? defaultSleep

  let lastError: AppError | null = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await attemptFetch(reference, options)
    } catch (error) {
      const appError = asAppError(error)
      if (!appError.retryable || attempt === attempts) throw appError

      lastError = appError
      await sleep(backoffFor(attempt, appError.retryAfterMs))
    }
  }

  // Unreachable: the loop either returns or throws on its final attempt.
  throw lastError ?? new AppError('FETCH_FAILED', FETCH_FAILED_MESSAGE)
}

/** Exponential backoff, doubling per attempt, never waiting longer than 4s. */
function backoffFor(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs !== null) return Math.min(retryAfterMs, MAX_BACKOFF_MS)
  return Math.min(FETCH_RETRY_BASE_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS)
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** One request, with no retry logic. */
async function attemptFetch(
  reference: GoogleSheetReference,
  options: FetchCsvOptions,
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
        // A bearer header, not a query parameter: the URL is the part of a
        // request most likely to be logged or forwarded.
        ...(options.accessToken
          ? { authorization: `Bearer ${options.accessToken}` }
          : {}),
      },
    })
  } catch (cause) {
    // `redirect: 'error'` turns an open-redirect hop into a TypeError; that is
    // a refusal to follow, not a connectivity problem.
    if (cause instanceof DOMException && cause.name === 'TimeoutError') {
      // Not retried: a request that ran out of time will usually run out again,
      // and three attempts would exceed the platform's own request budget.
      throw new AppError(
        'FETCH_FAILED',
        'Google Sheets took too long to respond. Please try again.',
        cause,
      )
    }
    // A dropped connection is worth one more go.
    throw new AppError('FETCH_FAILED', FETCH_FAILED_MESSAGE, cause, {
      retryable: true,
    })
  }

  if (!response.ok) {
    // 401/403/404 are what Google returns for private, deleted or
    // non-existent sheets. The distinction is not useful (and is guessable)
    // to the user, so all three share one message.
    if ([401, 403, 404].includes(response.status)) {
      throw new AppError('SHEET_NOT_ACCESSIBLE', NOT_ACCESSIBLE_MESSAGE)
    }

    const retryable = response.status === 429 || response.status >= 500
    throw new AppError(
      'FETCH_FAILED',
      'Google Sheets returned an unexpected response. Please try again.',
      `status: ${response.status}`,
      { retryable, retryAfterMs: readRetryAfter(response.headers) },
    )
  }

  return readBodyWithLimit(response, maxBytes)
}

/**
 * The upstream's `Retry-After`, in milliseconds, or null.
 *
 * Honoured so a throttled request waits as long as Google asked rather than
 * backing off on our own schedule and being throttled again.
 */
function readRetryAfter(headers: Headers): number | null {
  const raw = headers.get('retry-after')
  if (raw === null) return null

  const seconds = Number(raw)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)

  const at = Date.parse(raw)
  if (Number.isNaN(at)) return null
  return Math.max(0, at - Date.now())
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
