import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { SheetRow } from '#lib/types'

export interface JsonViewerProps {
  data: SheetRow[]
  /** Base name for the downloaded file. */
  fileName?: string
}

type CopyState = 'idle' | 'copied' | 'failed'

/**
 * Pretty-printed JSON with copy and download actions.
 *
 * The payload is rendered as a text child inside <pre>, so sheet contents are
 * never interpreted as markup.
 */
export function JsonViewer({ data, fileName = 'sheet2json' }: JsonViewerProps) {
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )

  useEffect(() => () => clearTimeout(resetTimer.current), [])

  const json = useMemo(() => JSON.stringify(data, null, 2), [data])
  const byteSize = useMemo(() => new TextEncoder().encode(json).length, [json])

  const handleCopy = useCallback(async () => {
    clearTimeout(resetTimer.current)
    try {
      await navigator.clipboard.writeText(json)
      setCopyState('copied')
    } catch {
      // Clipboard access can be denied (insecure context, permissions).
      setCopyState('failed')
    }
    resetTimer.current = setTimeout(() => setCopyState('idle'), 2000)
  }, [json])

  const handleDownload = useCallback(() => {
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${sanitiseFileName(fileName)}.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }, [fileName, json])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-2 rounded-md bg-ink px-3 py-1.5 text-xs font-semibold text-surface transition-colors hover:bg-ink-hover focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
        >
          {copyState === 'copied'
            ? 'Copied!'
            : copyState === 'failed'
              ? 'Copy failed'
              : 'Copy JSON'}
        </button>

        <button
          type="button"
          onClick={handleDownload}
          className="inline-flex items-center gap-2 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink-strong transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-ink-subtle focus:ring-offset-2"
        >
          Download JSON
        </button>

        <span className="ml-auto text-xs tabular-nums text-ink-subtle">
          {byteSize.toLocaleString()} bytes
        </span>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {copyState === 'copied'
          ? 'JSON copied to clipboard'
          : copyState === 'failed'
            ? 'Copying failed. Select the text and copy manually.'
            : ''}
      </p>

      <pre className="max-h-[32rem] overflow-auto rounded-lg border border-line bg-surface-muted p-4 font-mono text-xs leading-relaxed text-ink-strong">
        {json}
      </pre>
    </div>
  )
}

function sanitiseFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned === '' ? 'sheet2json' : cleaned.slice(0, 60)
}
