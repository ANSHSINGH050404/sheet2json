import { describe, expect, it } from 'bun:test'

import { buildSheetEmbedCode, buildSharedSheetUrl } from './share'

const SOURCE_URL =
  'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=123&title=Sales'

describe('shared sheet links', () => {
  it('keeps the sheet URL, including its selected tab, in the share link', () => {
    const shared = new URL(
      buildSharedSheetUrl(SOURCE_URL, 'https://sheet2json.example'),
    )

    expect(shared.pathname).toBe('/view')
    expect(shared.searchParams.get('url')).toBe(SOURCE_URL)
    expect(shared.searchParams.has('embed')).toBe(false)
  })

  it('creates an iframe snippet for the minimal embed view', () => {
    const code = buildSheetEmbedCode(SOURCE_URL, 'https://sheet2json.example')

    expect(code).toContain('src="https://sheet2json.example/view?url=')
    expect(code).toContain('&amp;embed=1"')
    expect(code).toContain('loading="lazy"')
  })
})
