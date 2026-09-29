import { describe, expect, it } from 'bun:test'

import { AppError } from './errors'
import { applyRowQuery, parseRowQuery } from './query'
import type { SheetRow } from './types'

const ROWS: SheetRow[] = [
  { name: 'Ansh', email: 'ansh@example.com', role: 'Developer', amount: '100' },
  { name: 'Rahul', email: 'rahul@example.com', role: 'Designer', amount: '25' },
  { name: 'Priya', email: 'priya@example.com', role: 'Developer', amount: '9' },
  { name: 'Sam', email: 'sam@example.com', role: 'Support', amount: '2500' },
]

function run(query: string, rows: SheetRow[] = ROWS): SheetRow[] {
  return applyRowQuery(rows, parseRowQuery(new URLSearchParams(query)))
}

/** Row lookup that satisfies `noUncheckedIndexedAccess` in the expectations. */
function at(index: number): SheetRow {
  const row = ROWS[index]
  if (row === undefined) throw new Error(`fixture has no row ${index}`)
  return row
}

describe('select', () => {
  it('keeps only the named columns, in the order they were asked for', () => {
    expect(run('select=email,name')).toEqual([
      { email: 'ansh@example.com', name: 'Ansh' },
      { email: 'rahul@example.com', name: 'Rahul' },
      { email: 'priya@example.com', name: 'Priya' },
      { email: 'sam@example.com', name: 'Sam' },
    ])
  })

  it('reports a column as empty when a row has no value for it', () => {
    // The parser gives every row the same keys, with '' for a blank cell, so
    // columns are read off the first row and blanks are preserved as empty.
    const rows = [
      { name: 'Ansh', title: 'Lead' },
      { name: 'Rahul', title: '' },
    ]

    expect(run('select=name,title', rows)).toEqual([
      { name: 'Ansh', title: 'Lead' },
      { name: 'Rahul', title: '' },
    ])
  })

  it('is a no-op when the parameter is absent', () => {
    expect(run('')).toEqual(ROWS)
  })
})

describe('where', () => {
  it('matches a value exactly', () => {
    expect(run('where=role=Designer')).toEqual([at(1)])
  })

  it('inverts with !=', () => {
    expect(run('where=role!=Developer')).toEqual([at(1), at(3)])
  })

  it('substrings case-insensitively with ~', () => {
    expect(run('where=email~EXAMPLE')).toHaveLength(4)
  })

  it('compares numerically, not as strings, for a range', () => {
    // As strings, "9" > "100" is false and "100" > "9" is true. Numerically it
    // is the other way round, which is what a caller means by `amount>9`.
    expect(run('where=amount>9').map((row) => row.amount)).toEqual([
      '100',
      '25',
      '2500',
    ])
    expect(run('where=amount>100').map((row) => row.amount)).toEqual(['2500'])
    expect(run('where=amount>=100').map((row) => row.amount)).toEqual([
      '100',
      '2500',
    ])
  })

  it('treats every condition as AND', () => {
    expect(
      run('where=role=Developer&where=amount>50').map((row) => row.name),
    ).toEqual(['Ansh'])
  })

  it('keeps a value that itself contains the operator', () => {
    const rows = [{ tag: 'a=b' }, { tag: 'plain' }]

    expect(run('where=tag=a=b', rows)).toEqual([{ tag: 'a=b' }])
  })

  it('matches a value containing a space, which is common in sheet data', () => {
    const rows = [{ status: 'In Progress' }, { status: 'Done' }]

    expect(run('where=status=In Progress', rows)).toEqual([
      { status: 'In Progress' },
    ])
  })
})

describe('sort', () => {
  it('sorts ascending by default and descending with a leading dash', () => {
    expect(run('sort=amount').map((row) => row.amount)).toEqual([
      '9',
      '25',
      '100',
      '2500',
    ])
    expect(run('sort=-amount').map((row) => row.amount)).toEqual([
      '2500',
      '100',
      '25',
      '9',
    ])
  })

  it('uses the first key as the primary order and later keys as tiebreaks', () => {
    // Roles sort as Designer < Developer < Support; within Developer, amount
    // breaks the tie with 9 before 100.
    expect(run('sort=role,amount').map((row) => row.name)).toEqual([
      'Rahul',
      'Priya',
      'Ansh',
      'Sam',
    ])
  })

  it('does not mutate the input array', () => {
    const rows = [...ROWS]
    run('sort=amount', rows)

    expect(rows.map((row) => row.amount)).toEqual(['100', '25', '9', '2500'])
  })
})

describe('limit', () => {
  it('caps the rows returned', () => {
    expect(run('limit=2')).toHaveLength(2)
  })

  it('is applied after sorting, so it means the top rows', () => {
    expect(run('sort=-amount&limit=2').map((row) => row.amount)).toEqual([
      '2500',
      '100',
    ])
  })

  it('is applied after filtering', () => {
    expect(run('where=role=Developer&limit=1').map((row) => row.name)).toEqual([
      'Ansh',
    ])
  })
})

describe('combining parameters', () => {
  it('applies filter, then sort, then limit, then projection', () => {
    expect(
      run('where=role=Developer&sort=-amount&limit=1&select=name,amount'),
    ).toEqual([{ name: 'Ansh', amount: '100' }])
  })
})

describe('rejecting bad input', () => {
  it('rejects a condition with no operator', () => {
    expect(() => run('where=role')).toThrow(AppError)
  })

  it('rejects a condition with no column', () => {
    expect(() => run('where==Developer')).toThrow(AppError)
  })

  it('rejects a limit that is not a positive integer', () => {
    expect(() => run('limit=0')).toThrow(AppError)
    expect(() => run('limit=abc')).toThrow(AppError)
    expect(() => run('limit=-5')).toThrow(AppError)
  })

  it('rejects a limit beyond what the sheet could hold', () => {
    expect(() => run('limit=99999999')).toThrow(/10,?000|10000/)
  })

  it('rejects an empty select', () => {
    expect(() => run('select=')).toThrow(AppError)
  })

  it('rejects an unknown column in select, where or sort', () => {
    expect(() => run('select=emial')).toThrow(/Unknown column "emial"/)
    expect(() => run('where=emial=x')).toThrow(/Unknown column "emial"/)
    expect(() => run('sort=emial')).toThrow(/Unknown column "emial"/)
  })

  it('lists the real column names so the typo is fixable', () => {
    expect(() => run('select=emial')).toThrow(/name/)
  })

  it('uses the INVALID_QUERY code, which the API maps to a 400', () => {
    try {
      run('limit=0')
      throw new Error('expected a rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('INVALID_QUERY')
    }
  })
})

describe('rows that do not match the sample shape', () => {
  it('returns nothing rather than throwing when a filter matches no row', () => {
    expect(run('where=role=Nobody')).toEqual([])
  })

  it('handles an empty sheet', () => {
    expect(run('limit=5', [])).toEqual([])
  })

  it('still rejects an unknown column when there are no rows to check', () => {
    // Column validation falls back to "no columns", so the message is honest
    // rather than the query silently returning nothing.
    expect(() => run('select=name', [])).toThrow(AppError)
  })
})
