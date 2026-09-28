import { describe, expect, it } from 'bun:test'

import { executeSheetAgentPlan } from './sheet-agent'
import type { SheetRow } from './types'

const COLUMNS = ['Name', 'Status', 'Amount']
const ADA: SheetRow = {
  Name: 'Ada Lovelace',
  Status: 'Pending',
  Amount: '$1,200.50',
}
const GRACE: SheetRow = {
  Name: 'Grace Hopper',
  Status: 'Complete',
  Amount: '800',
}
const KATHERINE: SheetRow = {
  Name: 'Katherine Johnson',
  Status: 'Pending',
  Amount: '',
}
const ROWS: SheetRow[] = [ADA, GRACE, KATHERINE]

describe('executeSheetAgentPlan', () => {
  it('summarizes row, column, and blank-cell counts', () => {
    expect(
      executeSheetAgentPlan('summarize this sheet', ROWS, COLUMNS, {
        action: 'summarize',
      }),
    ).toEqual({
      kind: 'summary',
      message: '3 rows across 3 columns. 1 of 9 cells are blank.',
    })
  })

  it('searches only the selected column using values in the request', () => {
    const result = executeSheetAgentPlan(
      'find rows where Status is pending',
      ROWS,
      COLUMNS,
      { action: 'search', column: 'Status' },
    )

    expect(result.kind).toBe('matches')
    if (result.kind !== 'matches') throw new Error('Expected matching rows')
    expect(result.rows).toEqual([ADA, KATHERINE])
    expect(result.message).toBe('Found 2 matching rows in “Status”.')
  })

  it('calculates numeric values while ignoring currency formatting and blanks', () => {
    expect(
      executeSheetAgentPlan('sum Amount', ROWS, COLUMNS, {
        action: 'aggregate',
        column: 'Amount',
        operation: 'sum',
      }),
    ).toEqual({ kind: 'aggregate', message: 'Sum for “Amount”: 2,000.5.' })
  })

  it('clarifies numeric row filters instead of treating them as text searches', () => {
    expect(
      executeSheetAgentPlan(
        'show rows where Amount is greater than 500',
        ROWS,
        COLUMNS,
        { action: 'search', column: 'Amount' },
      ),
    ).toEqual({
      kind: 'clarify',
      message:
        'Numeric row filters are not supported yet. Search for an exact value, or ask for a sum, average, minimum, or maximum.',
    })
  })

  it('returns sheet rows for a download action without changing them', () => {
    const result = executeSheetAgentPlan('download as JSON', ROWS, COLUMNS, {
      action: 'export',
    })

    expect(result).toEqual({
      kind: 'download',
      message: 'Your 3 sheet rows are ready to download as JSON or CSV.',
      rows: ROWS,
    })
  })
})
