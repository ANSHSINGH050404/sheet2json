import { describe, expect, it } from 'bun:test'

import { parseGoogleSheetUrl } from '#server/google-sheets/parser'
import { resolveSampleSheetUrl, sampleSheetUrl } from './sample'

describe('demo sheet', () => {
  it('resolves to a usable Google Sheets URL', () => {
    const url = sampleSheetUrl()

    const parsed = new URL(url)
    expect(parsed.protocol).toBe('https:')
    expect(parsed.hostname).toBe('docs.google.com')
    expect(parsed.pathname).toMatch(/^\/spreadsheets\/d\/[^/]+/)
  })

  it('passes the app own URL validator, so the demo cannot fail at the server', () => {
    // The browser check is only a UX affordance. If the demo URL would not pass
    // the real parser, the button would lead straight to an error page.
    expect(() => parseGoogleSheetUrl(sampleSheetUrl())).not.toThrow()
  })

  it('uses a configured override when it is valid', () => {
    const override =
      'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=42'

    expect(resolveSampleSheetUrl(override)).toBe(override)
  })

  it('falls back rather than shipping a button that would fail', () => {
    const fallback = sampleSheetUrl()

    for (const bad of [
      'not a url',
      'http://docs.google.com/spreadsheets/d/abcdefghij/edit',
      'https://evil.example/spreadsheets/d/abcdefghij/edit',
      // The spreadsheet id itself fails the app's allow-list.
      'https://docs.google.com/spreadsheets/d/short/edit',
      'https://docs.google.com/spreadsheets/d//edit',
      'javascript:alert(1)',
    ]) {
      const result = resolveSampleSheetUrl(bad)
      expect(result).toBe(fallback)
      expect(() => parseGoogleSheetUrl(result)).not.toThrow()
    }
  })

  it('falls back for an empty or non-string override', () => {
    const fallback = sampleSheetUrl()

    expect(resolveSampleSheetUrl('')).toBe(fallback)
    expect(resolveSampleSheetUrl('   ')).toBe(fallback)
    expect(resolveSampleSheetUrl(undefined)).toBe(fallback)
  })
})
