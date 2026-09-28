import type { AppErrorPayload } from './types'

/**
 * An error that carries a code and a message that is safe to show to end users.
 *
 * The `cause` is kept for server-side logging only - it is never serialised to
 * the client, so stack traces and upstream response bodies cannot leak.
 */
export class AppError extends Error {
  readonly code: AppErrorPayload['code']
  override readonly cause: unknown

  constructor(code: AppErrorPayload['code'], message: string, cause?: unknown) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.cause = cause
  }

  toJSON(): AppErrorPayload {
    return { code: this.code, message: this.message }
  }
}

/** Narrowing helper for `catch` blocks. */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

export function toAppError(error: unknown): AppErrorPayload {
  if (isAppError(error)) {
    return error.toJSON()
  }
  return {
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong. Please try again.',
  }
}
