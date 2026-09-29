import { describe, expect, it } from 'bun:test'

import { AppError } from '#lib/errors'
import { readApiOutputFormat } from '#server/api/output-format'

describe('readApiOutputFormat', () => {
  it('defaults to JSON and accepts the supported formats', () => {
    expect(readApiOutputFormat(null)).toBe('json')
    expect(readApiOutputFormat('')).toBe('json')
    expect(readApiOutputFormat('json')).toBe('json')
    expect(readApiOutputFormat('csv')).toBe('csv')
    expect(readApiOutputFormat('ndjson')).toBe('ndjson')
  })

  it('rejects an unsupported format', () => {
    try {
      readApiOutputFormat('yaml')
      throw new Error('Expected the unknown output format to be rejected')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('INVALID_URL')
    }
  })
})
