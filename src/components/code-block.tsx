import { useState } from 'react'
import type { KeyboardEvent } from 'react'

export interface CodeBlockTab {
  id: string
  label: string
  code: string
}

export interface CodeBlockProps {
  /** The snippet to show when `tabs` is not used. */
  code?: string
  language?: string
  /**
   * When given, the block renders as a tabbed snippet and owns the selection -
   * the caller passes the variants, not the tab UI. Without it the block is a
   * single snippet labelled with `language`.
   */
  tabs?: readonly CodeBlockTab[]
  /** Extra classes for the outer frame. Spacing is the caller's business. */
  className?: string
}

/**
 * A code sample with a copy button.
 *
 * The sample is rendered as a text child, never as markup, so a sheet title or
 * URL that happens to contain angle brackets is displayed rather than parsed.
 */
export function CodeBlock({
  code,
  language = 'bash',
  tabs,
  className = '',
}: CodeBlockProps) {
  const [activeId, setActiveId] = useState<string | undefined>(tabs?.[0]?.id)
  const [copied, setCopied] = useState(false)

  const activeTab = tabs?.find((tab) => tab.id === activeId) ?? tabs?.[0]
  const shownCode = activeTab?.code ?? code ?? ''
  const shownLabel = activeTab?.label ?? language

  async function copy() {
    try {
      await navigator.clipboard.writeText(shownCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be denied in an insecure context. The text is
      // selectable either way, so no error state is warranted.
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!tabs) return
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const index = tabs.findIndex((tab) => tab.id === activeTab?.id)
    const delta = event.key === 'ArrowRight' ? 1 : -1
    const next = tabs[(index + delta + tabs.length) % tabs.length]
    if (next) setActiveId(next.id)
  }

  return (
    <div
      className={`overflow-hidden rounded-lg border border-line bg-surface-muted ${className}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-line pl-1.5 pr-1.5">
        {tabs ? (
          <div
            role="tablist"
            aria-label="Code language"
            onKeyDown={onKeyDown}
            className="flex items-center gap-1 py-1.5"
          >
            {tabs.map((tab) => {
              const selected = tab.id === activeTab?.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActiveId(tab.id)}
                  className={`rounded border px-2 py-0.5 font-mono text-[11px] tracking-tight transition-colors focus-visible:ring-1 focus-visible:ring-ink focus-visible:outline-none ${
                    selected
                      ? 'border-line bg-surface text-ink'
                      : 'border-transparent text-ink-subtle hover:text-ink'
                  }`}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
        ) : (
          <span className="py-1.5 pl-2 font-mono text-[11px] tracking-tight text-ink-subtle uppercase">
            {shownLabel}
          </span>
        )}

        <button
          type="button"
          onClick={copy}
          className="rounded px-2 py-1 text-[11px] font-medium text-ink-subtle transition-colors hover:text-ink focus-visible:ring-1 focus-visible:ring-ink focus-visible:outline-none"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <pre
        tabIndex={0}
        className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-ink-strong"
      >
        {shownCode}
      </pre>
    </div>
  )
}
