import { describe, expect, it } from 'bun:test'

import { AppError } from '#lib/errors'
import {
  extractSheetTitle,
  parseGoogleSheetUrl,
} from '#server/google-sheets/parser'

const ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'

describe('parseGoogleSheetUrl', () => {
  it('extracts the spreadsheet id from an /edit url', () => {
    expect(
      parseGoogleSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit`),
    ).toEqual({ spreadsheetId: ID, gid: null })
  })

  it('extracts the spreadsheet id and gid from an /edit#gid= url', () => {
    expect(
      parseGoogleSheetUrl(
        `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=123`,
      ),
    ).toEqual({ spreadsheetId: ID, gid: '123' })
  })

  it('extracts the gid from a /view#gid= url', () => {
    expect(
      parseGoogleSheetUrl(
        `https://docs.google.com/spreadsheets/d/${ID}/view#gid=456`,
      ),
    ).toEqual({ spreadsheetId: ID, gid: '456' })
  })

  it('ignores a gid that is not a number', () => {
    expect(
      parseGoogleSheetUrl(
        `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=abc`,
      ),
    ).toEqual({ spreadsheetId: ID, gid: null })
  })

  it('ignores a range parameter and keeps the gid', () => {
    expect(
      parseGoogleSheetUrl(
        `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=7&range=A1:C9`,
      ),
    ).toEqual({ spreadsheetId: ID, gid: '7' })
  })

  it('tolerates surrounding whitespace and a bare gid fragment', () => {
    expect(
      parseGoogleSheetUrl(
        `  https://docs.google.com/spreadsheets/d/${ID}#gid=9  `,
      ),
    ).toEqual({ spreadsheetId: ID, gid: '9' })
  })

  it('rejects a non-Google host', () => {
    expect(() =>
      parseGoogleSheetUrl(`https://example.com/spreadsheets/d/${ID}/edit`),
    ).toThrow(AppError)
  })

  it('rejects the bare google.com host', () => {
    expect(() =>
      parseGoogleSheetUrl(`https://google.com/spreadsheets/d/${ID}`),
    ).toThrow(/doesn't appear to be a valid Google Sheets URL/)
  })

  it('rejects a look-alike host that merely ends in docs.google.com', () => {
    expect(() =>
      parseGoogleSheetUrl(
        `https://evil-docs.google.com.attacker.test/spreadsheets/d/${ID}`,
      ),
    ).toThrow(AppError)
  })

  it('rejects a host that smuggles the real host as userinfo', () => {
    expect(() =>
      parseGoogleSheetUrl(
        `https://docs.google.com@evil.test/spreadsheets/d/${ID}`,
      ),
    ).toThrow(AppError)
  })

  it('rejects plain http', () => {
    expect(() =>
      parseGoogleSheetUrl(`http://docs.google.com/spreadsheets/d/${ID}/edit`),
    ).toThrow(/doesn't appear to be a valid Google Sheets URL/)
  })

  it('rejects a non-http protocol', () => {
    expect(() =>
      parseGoogleSheetUrl(
        `javascript:alert(1)//docs.google.com/spreadsheets/d/${ID}`,
      ),
    ).toThrow(AppError)
  })

  it('rejects random strings', () => {
    for (const input of ['', '   ', 'not a url', 'hello world', '://']) {
      expect(() => parseGoogleSheetUrl(input)).toThrow(AppError)
    }
  })

  it('rejects a Google url that is not a spreadsheet', () => {
    expect(() =>
      parseGoogleSheetUrl('https://docs.google.com/document/d/abc/edit'),
    ).toThrow(/doesn't appear to be a valid Google Sheets URL/)
  })

  it('rejects a spreadsheet path with no id', () => {
    expect(() =>
      parseGoogleSheetUrl('https://docs.google.com/spreadsheets/d/'),
    ).toThrow(AppError)
    expect(() =>
      parseGoogleSheetUrl('https://docs.google.com/spreadsheets/edit#gid=1'),
    ).toThrow(AppError)
  })

  it('rejects an id containing path or query separators', () => {
    expect(() =>
      parseGoogleSheetUrl(
        'https://docs.google.com/spreadsheets/d/abc/../../evil/edit',
      ),
    ).toThrow(AppError)
  })

  it('rejects a query-string attempt to change the id', () => {
    // The host allow-list plus the id pattern mean only the path segment is used.
    const parsed = parseGoogleSheetUrl(
      `https://docs.google.com/spreadsheets/d/${ID}/edit?other=https://evil.test`,
    )
    expect(parsed.spreadsheetId).toBe(ID)
  })

  it('always fails with a user-safe message and no stack detail', () => {
    try {
      parseGoogleSheetUrl('https://example.com/x')
      throw new Error('expected a throw')
    } catch (error) {
      const appError = error as AppError
      expect(appError.code).toBe('INVALID_URL')
      expect(appError.message).not.toContain('http')
      expect(appError.toJSON()).toEqual({
        code: 'INVALID_URL',
        message: "This doesn't appear to be a valid Google Sheets URL.",
      })
    }
  })
})

describe('extractSheetTitle', () => {
  it('reads the tab title from the fragment', () => {
    expect(
      extractSheetTitle(
        `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0&title=Marketing%20Leads`,
      ),
    ).toBe('Marketing Leads')
  })

  it('returns null when there is no title', () => {
    expect(
      extractSheetTitle(`https://docs.google.com/spreadsheets/d/${ID}/edit`),
    ).toBeNull()
    expect(extractSheetTitle('nonsense')).toBeNull()
    expect(
      extractSheetTitle(
        `https://docs.google.com/spreadsheets/d/${ID}#gid=1&title=`,
      ),
    ).toBeNull()
  })
})
