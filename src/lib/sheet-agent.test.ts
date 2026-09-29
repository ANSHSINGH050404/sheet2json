import { describe, expect, it } from 'bun:test'

import { executeSheetAgentPlan } from './sheet-agent'
import type { SheetAgentPlan, SheetRow } from './types'

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

  it('groups sent and received totals into one row per member', () => {
    const rows: SheetRow[] = [
      { Member: 'Alex', Sent: '10', Received: '5' },
      { Member: 'Bea', Sent: '20', Received: '15' },
      { Member: 'Alex', Sent: '7', Received: '3' },
    ]
    const plan = {
      action: 'group_aggregate',
      layout: 'separate_amounts',
      groupColumn: 'Member',
      sentColumn: 'Sent',
      receivedColumn: 'Received',
    } as unknown as SheetAgentPlan
    const result = executeSheetAgentPlan(
      'total sent and received per member',
      rows,
      ['Member', 'Sent', 'Received'],
      plan,
    ) as unknown as {
      kind: string
      message: string
      columns: string[]
      rows: SheetRow[]
      chart: {
        categories: string[]
        series: { name: string; values: number[] }[]
      }
    }

    expect(result.kind).toBe('grouped')
    expect(result.columns).toEqual(['Member', 'Total sent', 'Total received'])
    expect(result.rows).toEqual([
      { Member: 'Alex', 'Total sent': '17', 'Total received': '8' },
      { Member: 'Bea', 'Total sent': '20', 'Total received': '15' },
    ])
    expect(result.chart).toEqual({
      categories: ['Bea', 'Alex'],
      series: [
        { name: 'Total sent', values: [20, 17] },
        { name: 'Total received', values: [15, 8] },
      ],
    })
  })

  it('uses a direction column to split grouped amount totals', () => {
    const rows: SheetRow[] = [
      { Member: 'Bea', Amount: '8', Direction: 'Received' },
      { Member: 'Ada', Amount: '10', Direction: 'Sent' },
      { Member: 'Ada', Amount: '2', Direction: 'Out' },
      { Member: 'Bea', Amount: '3', Direction: 'Incoming' },
    ]
    const result = executeSheetAgentPlan(
      'total sent and received per member',
      rows,
      ['Member', 'Amount', 'Direction'],
      {
        action: 'group_aggregate',
        layout: 'direction_column',
        groupColumn: 'Member',
        amountColumn: 'Amount',
        directionColumn: 'Direction',
      },
    )

    expect(result.kind).toBe('grouped')
    if (result.kind !== 'grouped') throw new Error('Expected grouped totals')
    expect(result.rows).toEqual([
      { Member: 'Ada', 'Total sent': '12', 'Total received': '0' },
      { Member: 'Bea', 'Total sent': '0', 'Total received': '11' },
    ])
    expect(result.chart.categories).toEqual(['Ada', 'Bea'])
  })

  it('counts sent by sender and received by recipient', () => {
    const rows: SheetRow[] = [
      { From: 'Alex', To: 'Bea', Amount: '8' },
      { From: 'Bea', To: 'Alex', Amount: '3' },
    ]
    const result = executeSheetAgentPlan(
      'total sent and received for each member',
      rows,
      ['From', 'To', 'Amount'],
      {
        action: 'group_aggregate',
        layout: 'sender_receiver',
        senderColumn: 'From',
        receiverColumn: 'To',
        amountColumn: 'Amount',
      },
    )

    expect(result.kind).toBe('grouped')
    if (result.kind !== 'grouped') throw new Error('Expected grouped totals')
    expect(result.rows).toEqual([
      { Member: 'Alex', 'Total sent': '8', 'Total received': '3' },
      { Member: 'Bea', 'Total sent': '3', 'Total received': '8' },
    ])
    expect(result.chart.categories).toEqual(['Alex', 'Bea'])
  })

  it('totals a single measure by group', () => {
    const rows: SheetRow[] = [
      { Category: 'Books', Amount: '12' },
      { Category: 'Games', Amount: '8' },
      { Category: 'Books', Amount: '3' },
    ]
    const result = executeSheetAgentPlan(
      'total Amount by Category',
      rows,
      ['Category', 'Amount'],
      {
        action: 'group_aggregate',
        layout: 'single_amount',
        groupColumn: 'Category',
        amountColumn: 'Amount',
      },
    )

    expect(result.kind).toBe('grouped')
    if (result.kind !== 'grouped') throw new Error('Expected grouped totals')
    expect(result.columns).toEqual(['Category', 'Total Amount'])
    expect(result.rows).toEqual([
      { Category: 'Books', 'Total Amount': '15' },
      { Category: 'Games', 'Total Amount': '8' },
    ])
    expect(result.chart).toEqual({
      categories: ['Books', 'Games'],
      series: [{ name: 'Total Amount', values: [15, 8] }],
    })
  })
})
