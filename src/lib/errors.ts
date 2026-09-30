import type { AppErrorPayload } from './types'

/**
 * Extra behaviour attached to a retryable failure.
 *
 * Not part of the wire payload: a caller is told the request failed, not how we
 * intend to schedule our next attempt. Only the server reads this.
 */
export interface AppErrorRetryOptions {
  /** Whether another attempt could plausibly succeed. */
  retryable?: boolean
  /** How long the upstream asked us to wait, in milliseconds. */
  retryAfterMs?: number | null
}

/**
 * An error that carries a code and a message that is safe to show to end users.
 *
 * The `cause` is kept for server-side logging only - it is never serialised to
 * the client, so stack traces and upstream response bodies cannot leak.
 */
export class AppError extends Error {
  readonly code: AppErrorPayload['code']
  override readonly cause: unknown
  /** Whether retrying the underlying operation could plausibly succeed. */
  readonly retryable: boolean
  /** An upstream-requested wait, in milliseconds, or null. */
  readonly retryAfterMs: number | null

  constructor(
    code: AppErrorPayload['code'],
    message: string,
    cause?: unknown,
    retry: AppErrorRetryOptions = {},
  ) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.cause = cause
    this.retryable = retry.retryable ?? false
    this.retryAfterMs = retry.retryAfterMs ?? null
  }

  toJSON(): AppErrorPayload {
    return { code: this.code, message: this.message }
  }
}

/** Narrowing helper for `catch` blocks. */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

/**
 * Coerces any thrown value into an `AppError`.
 *
 * Needed on the retry path, where a `TypeError` or a `DOMException` from `fetch`
 * has to be judged for retryability without the caller re-implementing the
 * conversion. Anything unrecognised becomes a non-retryable internal error, so an
 * unexpected throw is never retried into a longer outage.
 */
export function asAppError(error: unknown): AppError {
  if (isAppError(error)) return error
  return new AppError(
    'INTERNAL_ERROR',
    'Something went wrong. Please try again.',
  )
}

export function toAppError(error: unknown): AppErrorPayload {
  return asAppError(error).toJSON()
}
