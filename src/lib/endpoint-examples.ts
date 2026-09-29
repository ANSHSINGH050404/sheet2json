/** Copyable request forms for a saved endpoint. */
export interface SavedEndpointExamples {
  path: string
  url: string
  curl: string
  javascript: string
}

/** Builds a stable URL and server-side examples for the same endpoint id. */
export function buildSavedEndpointExamples(
  endpointId: string,
  origin: string,
): SavedEndpointExamples {
  const path = `/api/v1/endpoints/${endpointId}`
  const url = `${origin}${path}`

  return {
    path,
    url,
    curl: `curl "${url}" -H "Authorization: Bearer YOUR_API_KEY"`,
    javascript: [
      `const response = await fetch("${url}", {`,
      '  headers: { Authorization: "Bearer " + process.env.S2J_KEY },',
      '});',
      'const data = await response.json();',
    ].join('\n'),
  }
}
