import { useState } from 'react'

import { trackAnalytics } from '#lib/analytics'
import { buildSheetEmbedCode, buildSharedSheetUrl } from '#lib/share'

export interface ShareActionsProps {
  sourceUrl: string
}

/** Copyable links for publishing an anonymous, live view of a public sheet. */
export function ShareActions({ sourceUrl }: ShareActionsProps) {
  const [message, setMessage] = useState<string | null>(null)

  async function copy(
    value: string,
    successMessage: string,
    kind: 'link' | 'embed',
  ) {
    try {
      await navigator.clipboard.writeText(value)
      setMessage(successMessage)
      trackAnalytics({ event: 'share_asset_copied', kind })
    } catch {
      setMessage('Could not copy. Check your browser clipboard permissions.')
    }
  }

  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink">Share a live table</h3>
          <p className="mt-1 text-xs text-ink-subtle">
            Visitors can open it only when the sheet is shared as “Anyone with
            the link” with Viewer access.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              void copy(
                buildSharedSheetUrl(sourceUrl, window.location.origin),
                'Live table link copied.',
                'link',
              )
            }
            className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink-strong transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
          >
            Copy link
          </button>
          <button
            type="button"
            onClick={() =>
              void copy(
                buildSheetEmbedCode(sourceUrl, window.location.origin),
                'Embed code copied.',
                'embed',
              )
            }
            className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink-strong transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
          >
            Copy embed code
          </button>
        </div>
      </div>
      {message ? (
        <p role="status" className="mt-2 text-xs text-ink-subtle">
          {message}
        </p>
      ) : null}
    </div>
  )
}
