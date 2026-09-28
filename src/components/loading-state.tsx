import { useEffect, useState } from 'react'

import { EXTRACTION_STAGES } from '#lib/constants'

export interface LoadingStateProps {
  /** Swap in a custom label set if needed. */
  stages?: readonly string[]
  /** Milliseconds each stage is shown before advancing. */
  intervalMs?: number
}

/**
 * A simple spinner with rotating stage hints.
 *
 * Deliberately *not* a percentage bar: the client cannot know how far along the
 * server is, so a fake progress number would be a lie. The stages simply
 * describe the order of the work that is actually happening.
 */
export function LoadingState({
  stages = EXTRACTION_STAGES,
  intervalMs = 900,
}: LoadingStateProps) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((current) => (current + 1) % stages.length)
    }, intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs, stages.length])

  const stage = stages[Math.min(index, stages.length - 1)] ?? stages[0]

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
    >
      <span
        aria-hidden="true"
        className="size-4 shrink-0 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600"
      />
      <span className="font-medium">{stage}</span>
    </div>
  )
}
