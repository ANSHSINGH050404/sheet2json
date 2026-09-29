import { describe, expect, it } from 'bun:test'

import { AppError } from '#lib/errors'
import {
  describeSelectedSheetTab,
  parseEndpointQuery,
  prepareEndpointQuery,
} from '#lib/endpoints'
import type { SheetRow } from '#lib/types'

const rows: SheetRow[] = [
  { name: 'Ansh', role: 'Developer', amount: '100' },
  { name: 'Rahul', role: 'Designer', amount: '25' },
  { name: 'Priya', role: 'Developer', amount: '2500' },
]

describe('prepareEndpointQuery', () => {
  it('previews the selected, filtered, sorted and limited rows', () => {
    const preview = prepareEndpointQuery(rows, {
      columns: 'name, amount',
      where: 'role=Developer\namount>50',
      sort: '-amount',
      limit: '1',
    })

    expect(preview.rows).toEqual([{ name: 'Priya', amount: '2500' }])
    expect(preview.columns).toEqual(['name', 'amount'])

    const params = new URLSearchParams(preview.query)
    expect(params.get('select')).toBe('name, amount')
    expect(params.getAll('where')).toEqual(['role=Developer', 'amount>50'])
    expect(params.get('sort')).toBe('-amount')
    expect(params.get('limit')).toBe('1')
  })

  it('keeps the whole sheet when no query options are set', () => {
    const preview = prepareEndpointQuery(rows, {
      columns: '',
      where: '',
      sort: '',
      limit: '',
    })

    expect(preview.query).toBe('')
    expect(preview.rows).toEqual(rows)
    expect(preview.columns).toEqual(['name', 'role', 'amount'])
  })

  it('rejects a recipe that refers to a column the sheet does not have', () => {
    try {
      prepareEndpointQuery(rows, {
        columns: 'email',
        where: '',
        sort: '',
        limit: '',
      })
      throw new Error('Expected the invalid column to be rejected')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('INVALID_QUERY')
    }
  })

  it('rejects a limit that is not a positive integer', () => {
    expect(() =>
      prepareEndpointQuery(rows, {
        columns: '',
        where: '',
        sort: '',
        limit: '0',
      }),
    ).toThrow('Invalid limit. Use a whole number above 0.')
  })

  it('rejects parameters that are not part of a saved recipe', () => {
    expect(() => parseEndpointQuery('url=https%3A%2F%2Fexample.com')).toThrow(
      'Unsupported saved endpoint option: url.',
    )
  })
})

describe('describeSelectedSheetTab', () => {
  it('names the tab selected in the Google Sheets link', () => {
    expect(
      describeSelectedSheetTab(
        'https://docs.google.com/spreadsheets/d/sheet-id/edit#gid=123&title=Orders',
      ),
    ).toBe('Orders (gid 123)')
  })

  it('identifies the default tab when the link has no tab fragment', () => {
    expect(
      describeSelectedSheetTab(
        'https://docs.google.com/spreadsheets/d/sheet-id/edit',
      ),
    ).toBe('the default tab')
  })

  it('ignores a malformed tab id', () => {
    expect(
      describeSelectedSheetTab(
        'https://docs.google.com/spreadsheets/d/sheet-id/edit#gid=invalid',
      ),
    ).toBe('the default tab')
  })
})
