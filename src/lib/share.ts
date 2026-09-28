/** Builds a shareable URL for a public, live sheet view. */
export function buildSharedSheetUrl(
  sourceUrl: string,
  origin: string,
  embed = false,
): string {
  const viewUrl = new URL('/view', origin)
  viewUrl.searchParams.set('url', sourceUrl.trim())
  if (embed) viewUrl.searchParams.set('embed', '1')
  return viewUrl.toString()
}

/** HTML snippet users can paste into a site builder or page. */
export function buildSheetEmbedCode(sourceUrl: string, origin: string): string {
  const src = buildSharedSheetUrl(sourceUrl, origin, true).replace(
    /&/g,
    '&amp;',
  )
  return `<iframe src="${src}" title="Live Google Sheets table" width="100%" height="640" loading="lazy"></iframe>`
}
