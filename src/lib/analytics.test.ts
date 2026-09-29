import { describe, expect, it } from 'bun:test'

import {
  analyticsRouteForPath,
  redactPostHogUrlProperties,
  sanitizeAnalyticsUrl,
} from './analytics'

describe('analyticsRouteForPath', () => {
  it('uses a stable route name instead of a history record id', () => {
    expect(analyticsRouteForPath('/history/private-record-id')).toBe(
      'history_detail',
    )
  })

  it('maps a live-table route without query-string data', () => {
    expect(analyticsRouteForPath('/view')).toBe('live_table')
  })

  it('maps saved endpoint management to a stable route name', () => {
    expect(analyticsRouteForPath('/endpoints')).toBe('endpoints')
  })

  it('does not expose unknown route names', () => {
    expect(analyticsRouteForPath('/unknown/private-id')).toBe('other')
  })
})

describe('sanitizeAnalyticsUrl', () => {
  it('removes sheet links and query data before analytics capture', () => {
    expect(
      sanitizeAnalyticsUrl(
        'https://sheet2json.app/view?url=https%3A%2F%2Fdocs.google.com%2Fsecret#tab',
      ),
    ).toBe('https://sheet2json.app/view')
  })

  it('normalizes private history record IDs', () => {
    expect(
      sanitizeAnalyticsUrl(
        'https://sheet2json.app/history/private-record-id?auth=token',
      ),
    ).toBe('https://sheet2json.app/history/:id')
  })

  it('rejects non-URL analytics properties', () => {
    expect(sanitizeAnalyticsUrl('not a URL')).toBeNull()
  })
})

describe('redactPostHogUrlProperties', () => {
  it('removes full URLs and referrers while preserving safe event properties', () => {
    expect(
      redactPostHogUrlProperties({
        $current_url: 'https://sheet2json.app/view?url=private-sheet',
        $referrer: 'https://example.com/?email=person@example.com',
        route: 'live_table',
        row_count: 12,
      }),
    ).toEqual({ route: 'live_table', row_count: 12 })
  })
})
