import { AppError } from '#lib/errors'

export type ApiOutputFormat = 'json' | 'csv' | 'ndjson'

/** Validates the public API's output format, defaulting to JSON. */
export function readApiOutputFormat(value: string | null): ApiOutputFormat {
  if (value === null || value === '') return 'json'
  if (value === 'json' || value === 'csv' || value === 'ndjson') return value
  throw new AppError(
    'INVALID_URL',
    'Unsupported format. Use one of: json, csv, ndjson.',
  )
}
