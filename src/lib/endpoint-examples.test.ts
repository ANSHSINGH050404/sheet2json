import { describe, expect, it } from 'bun:test'

import { buildSavedEndpointExamples } from '#lib/endpoint-examples'

describe('buildSavedEndpointExamples', () => {
  it('builds one stable URL and server-side examples for an endpoint id', () => {
    expect(
      buildSavedEndpointExamples('endpoint-id', 'https://sheet2json.app'),
    ).toEqual({
      path: '/api/v1/endpoints/endpoint-id',
      url: 'https://sheet2json.app/api/v1/endpoints/endpoint-id',
      curl: 'curl "https://sheet2json.app/api/v1/endpoints/endpoint-id" -H "Authorization: Bearer YOUR_API_KEY"',
      javascript: [
        'const response = await fetch("https://sheet2json.app/api/v1/endpoints/endpoint-id", {',
        '  headers: { Authorization: "Bearer " + process.env.S2J_KEY },',
        '});',
        'const data = await response.json();',
      ].join('\n'),
    })
  })
})
