import { describe, expect, it } from 'bun:test'

import { AppError, toAppError } from '#lib/errors'
import { formatCount, formatRelative, unwrap } from '#lib/format'
import { extractInputSchema } from '#lib/validation'

describe('extractInputSchema', () => {
  it('trims a valid url', () => {
    const result = extractInputSchema.safeParse({ url: '  https://x.test  ' })

    expect(result.success).toBe(true)
    expect(result.data?.url).toBe('https://x.test')
  })

  it('rejects a missing url with a user-facing message', () => {
    const result = extractInputSchema.safeParse({ url: '   ' })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe(
      'Please enter a Google Sheets URL.',
    )
  })

  it('rejects a missing field entirely', () => {
    expect(extractInputSchema.safeParse({}).success).toBe(false)
  })
})

describe('toAppError', () => {
  it('passes an AppError through with only its safe fields', () => {
    const error = toAppError(
      new AppError(
        'INVALID_URL',
        "This doesn't appear to be a valid Google Sheets URL.",
        'https://secret.internal/path',
      ),
    )

    expect(error).toEqual({
      code: 'INVALID_URL',
      message: "This doesn't appear to be a valid Google Sheets URL.",
    })
    expect(error.message).not.toContain('secret.internal')
  })

  it('hides unexpected errors behind a generic message', () => {
    const error = toAppError(
      new TypeError('connect ECONNREFUSED 10.0.0.5:5432'),
    )

    expect(error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
    })
    expect(error.message).not.toContain('10.0.0.5')
  })
})

describe('unwrap', () => {
  it('returns the data on success', () => {
    expect(unwrap({ ok: true, data: 42 })).toBe(42)
  })

  it('throws the safe message on failure', () => {
    expect(() =>
      unwrap({ ok: false, error: { code: 'NOT_FOUND', message: 'nope' } }),
    ).toThrow('nope')
  })
})

describe('formatRelative', () => {
  const now = Date.parse('2026-01-01T12:00:00Z')

  it('formats recent timestamps', () => {
    expect(formatRelative('2026-01-01T11:59:40Z', now)).toBe('just now')
    expect(formatRelative('2026-01-01T11:58:00Z', now)).toBe('2 minutes ago')
    expect(formatRelative('2026-01-01T11:10:00Z', now)).toBe('50 minutes ago')
    expect(formatRelative('2026-01-01T11:00:00Z', now)).toBe('1 hour ago')
    expect(formatRelative('2025-12-31T12:00:00Z', now)).toBe('yesterday')
  })

  it('does not throw on an invalid timestamp', () => {
    expect(formatRelative('not-a-date', now)).toBe('unknown')
  })
})

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(1204)).toMatch(/1.204|1,204/)
    expect(formatCount(12)).toBe('12')
  })
})
