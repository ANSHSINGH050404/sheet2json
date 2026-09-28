import type { ReactNode } from 'react'

export interface SectionProps {
  id?: string
  /** Set false for the first section, so it does not double up with the strip above. */
  divided?: boolean
  children: ReactNode
}

/** A page-width band, separated from its neighbours by a single hairline. */
export function Section({ id, divided = true, children }: SectionProps) {
  return (
    <section
      id={id}
      className={`px-6 py-16 sm:py-24 ${divided ? 'border-t border-line' : ''}`}
    >
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  )
}

export interface SectionHeadingProps {
  eyebrow: string
  title: string
  description?: string
}

/**
 * The label / headline / one-line explanation that opens most sections.
 *
 * Left-aligned rather than centred: centred headings read as marketing, and this
 * page is trying to read as documentation.
 */
export function SectionHeading({
  eyebrow,
  title,
  description,
}: SectionHeadingProps) {
  return (
    <div className="max-w-2xl">
      <p className="text-xs font-medium tracking-[0.14em] text-ink-faint uppercase">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-balance text-ink sm:text-3xl">
        {title}
      </h2>
      {description ? (
        <p className="mt-4 text-base text-pretty text-ink-muted">
          {description}
        </p>
      ) : null}
    </div>
  )
}
