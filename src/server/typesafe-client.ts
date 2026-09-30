import { AppError } from '#lib/errors'

/**
 * The shared TypeSafe transport.
 *
 * Extracted from `typesafe.ts` because two modules now talk to the service: the
 * planner, which sends only a request and column names, and the semantic search,
 * which sends row values. Both need the same retry, timeout, key handling and
 * error mapping, and a second copy of that logic would be a second set of
 * mistakes.
 */

const TYPESAFE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
const REQUEST_TIMEOUT_MS = 15_000

/** Statuses worth retrying: rate limited and overloaded. */
const RETRYABLE_STATUSES = [429, 529]

/**
 * Posts one request, retrying transient failures once.
 *
 * Retried: a network error, and a 429 or 529. Not retried: any other status, and
 * a 4xx that will answer the same way next time. Two attempts at 15s each sits
 * inside the platform's own request budget, which is why the timeout is not
 * extended for the second try.
 */
export async function requestTypeSafe(
  payload: unknown,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const body = JSON.stringify(payload)

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response
    try {
      response = await fetchImpl(TYPESAFE_ENDPOINT, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body,
      })
    } catch (cause) {
      if (attempt === 0) {
        await delay(250)
        continue
      }
      throw new AppError(
        'AI_REQUEST_FAILED',
        'The sheet assistant could not reach its AI service. Please try again.',
        cause,
      )
    }

    if (response.ok) return response

    if (RETRYABLE_STATUSES.includes(response.status) && attempt === 0) {
      await delay(readRetryDelay(response))
      continue
    }

    throw new AppError(
      'AI_REQUEST_FAILED',
      response.status === 401
        ? 'The sheet assistant API key is not valid. Check TYPESAFE_API_KEY.'
        : RETRYABLE_STATUSES.includes(response.status)
          ? 'The sheet assistant is busy. Please try again shortly.'
          : 'The sheet assistant could not plan that action. Please try again.',
      `TypeSafe status: ${response.status}`,
    )
  }

  throw new AppError(
    'AI_REQUEST_FAILED',
    'The sheet assistant could not reach its AI service. Please try again.',
  )
}

/**
 * The server-only API key, or null when the assistant is not configured.
 *
 * The UI uses the absence of a key to hide its affordances rather than render a
 * button that would fail, so this is the check the route calls first.
 */
export function readTypeSafeApiKey(): string | null {
  return process.env.TYPESAFE_API_KEY?.trim() || null
}

/** Honours `Retry-After`, clamped to a range that cannot stall the request. */
function readRetryDelay(response: Response): number {
  const retryAfter = Number(response.headers.get('retry-after'))
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(1000, Math.max(100, retryAfter * 1000))
  }
  return 300
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
