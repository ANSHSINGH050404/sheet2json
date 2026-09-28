import { describe, expect, it } from 'bun:test'

import type { AppError } from '#lib/errors'
import { parseSheetCsv } from '#server/google-sheets/extractor'

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return 'NO_THROW'
  } catch (error) {
    return (error as AppError).code
  }
}

describe('parseSheetCsv', () => {
  it('parses a standard sheet into objects keyed by header', async () => {
    const result = await parseSheetCsv(
      'name,email,role\nAnsh,ansh@example.com,Developer\nRahul,rahul@example.com,Designer',
    )

    expect(result.headers).toEqual(['name', 'email', 'role'])
    expect(result.rows).toEqual([
      { name: 'Ansh', email: 'ansh@example.com', role: 'Developer' },
      { name: 'Rahul', email: 'rahul@example.com', role: 'Designer' },
    ])
    expect(result.rowCount).toBe(2)
    expect(result.columnCount).toBe(3)
  })

  it('handles quoted values and escaped quotes', async () => {
    const result = await parseSheetCsv(
      'name,note\n"Doe, John","said ""hi"" loudly"',
    )

    expect(result.rows).toEqual([
      { name: 'Doe, John', note: 'said "hi" loudly' },
    ])
  })

  it('keeps commas inside values without splitting columns', async () => {
    const result = await parseSheetCsv('a,b\n"1,2,3",plain')

    expect(result.rows).toEqual([{ a: '1,2,3', b: 'plain' }])
    expect(result.columnCount).toBe(2)
  })

  it('keeps empty cells as empty strings', async () => {
    const result = await parseSheetCsv('a,b,c\n1,,3')

    expect(result.rows).toEqual([{ a: '1', b: '', c: '3' }])
  })

  it('drops rows where every cell is empty', async () => {
    const result = await parseSheetCsv('a,b,c\n1,2,3\n,,\n4,5,6')

    expect(result.rowCount).toBe(2)
    expect(result.rows[1]).toEqual({ a: '4', b: '5', c: '6' })
  })

  it('trims surrounding whitespace on headers and values', async () => {
    const result = await parseSheetCsv(' name , role \n  Ansh  ,  Dev  ')

    expect(result.headers).toEqual(['name', 'role'])
    expect(result.rows).toEqual([{ name: 'Ansh', role: 'Dev' }])
  })

  it('preserves Unicode', async () => {
    const result = await parseSheetCsv(
      '名前,emoji\n"日本語テキスト","\u{1F389}"',
    )

    expect(result.rows).toEqual([
      { 名前: '日本語テキスト', emoji: '\u{1F389}' },
    ])
  })

  it('strips a UTF-8 BOM from the first header', async () => {
    const result = await parseSheetCsv('\uFEFFname,email\nAnsh,a@b.c')

    expect(result.headers).toEqual(['name', 'email'])
  })

  it('handles CRLF line endings', async () => {
    const result = await parseSheetCsv('a,b\r\n1,2\r\n')

    expect(result.rows).toEqual([{ a: '1', b: '2' }])
  })

  it('keeps duplicate values in separate rows', async () => {
    const result = await parseSheetCsv('a,b\nsame,same\nsame,same')

    expect(result.rowCount).toBe(2)
    expect(result.rows[0]).toEqual({ a: 'same', b: 'same' })
  })

  it('de-duplicates repeated header names instead of overwriting data', async () => {
    const result = await parseSheetCsv('name,name,email\nx,y,z')

    expect(result.headers).toEqual(['name', 'name_2', 'email'])
    expect(result.rows).toEqual([{ name: 'x', name_2: 'y', email: 'z' }])
  })

  it('names blank headers positionally', async () => {
    const result = await parseSheetCsv('name,,role\nx,y,z')

    expect(result.headers).toEqual(['name', 'column_2', 'role'])
    expect(result.rows).toEqual([{ name: 'x', column_2: 'y', role: 'z' }])
  })

  it('pads short rows and ignores extra fields in ragged rows', async () => {
    const short = await parseSheetCsv('a,b,c\n1,2')
    expect(short.rows).toEqual([{ a: '1', b: '2', c: '' }])

    const long = await parseSheetCsv('a,b,c\n1,2,3,4,5')
    expect(long.rows).toEqual([{ a: '1', b: '2', c: '3' }])
  })

  it('keeps values as strings so leading zeros survive', async () => {
    const result = await parseSheetCsv('id,qty\n007,1.50')

    expect(result.rows).toEqual([{ id: '007', qty: '1.50' }])
  })

  it('rejects a sheet with only headers', async () => {
    expect(await code(parseSheetCsv('a,b,c'))).toBe('SHEET_EMPTY')
  })

  it('rejects an empty document', async () => {
    expect(await code(parseSheetCsv(''))).toBe('SHEET_EMPTY')
    expect(await code(parseSheetCsv('   '))).toBe('SHEET_EMPTY')
    expect(await code(parseSheetCsv('\n\n\n'))).toBe('SHEET_EMPTY')
  })

  it('treats an HTML sign-in page as an inaccessible sheet', async () => {
    expect(
      await code(parseSheetCsv('<!DOCTYPE html><html>Sign in</html>')),
    ).toBe('SHEET_NOT_ACCESSIBLE')
  })

  it('rejects malformed CSV', async () => {
    expect(await code(parseSheetCsv('a\n"unclosed'))).toBe('PARSE_FAILED')
  })

  it('accepts exactly maxRows rows', async () => {
    const result = await parseSheetCsv('a\n1\n2\n3', { maxRows: 3 })

    expect(result.rowCount).toBe(3)
  })

  it('rejects a sheet that exceeds maxRows', async () => {
    expect(await code(parseSheetCsv('a\n1\n2\n3\n4\n5', { maxRows: 3 }))).toBe(
      'SHEET_TOO_LARGE',
    )
  })

  it('does not count blank rows against maxRows', async () => {
    const result = await parseSheetCsv('a\n1\n\n2\n3', { maxRows: 3 })

    expect(result.rowCount).toBe(3)
  })

  it('rejects a sheet far larger than maxRows rather than truncating it', async () => {
    const csv = ['a', ...Array.from({ length: 500 }, (_, i) => String(i))].join(
      '\n',
    )

    expect(await code(parseSheetCsv(csv, { maxRows: 100 }))).toBe(
      'SHEET_TOO_LARGE',
    )
  })

  it('never returns more rows than the limit allows', async () => {
    for (const maxRows of [1, 5, 50]) {
      const csv = [
        'a',
        ...Array.from({ length: maxRows }, (_, i) => String(i)),
      ].join('\n')
      const result = await parseSheetCsv(csv, { maxRows })
      expect(result.rowCount).toBe(maxRows)
    }
  })
})
