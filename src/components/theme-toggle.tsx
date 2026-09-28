import type { SVGProps } from 'react'

import { useTheme } from '#hooks/use-theme'
import type { Theme } from '#lib/theme'

/**
 * The light/dark switch, in the header.
 *
 * Two buttons rather than one that flips: with a single button, nothing on screen
 * says which theme is active, and a switch whose current state is invisible is a
 * switch people toggle twice. `aria-pressed` carries the same information for
 * assistive tech, so the two stay in step.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useTheme()

  return (
    <div
      role="group"
      aria-label="Theme"
      className="flex items-center gap-0.5 rounded-md border border-line bg-surface-muted p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const selected = theme === value

        return (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            aria-pressed={selected}
            title={label}
            className={`flex size-6 items-center justify-center rounded-sm transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink-subtle ${
              selected
                ? 'bg-surface text-ink shadow-sm'
                : 'text-ink-faint hover:text-ink-muted'
            }`}
          >
            <Icon className="size-3.5" />
            <span className="sr-only">{label}</span>
          </button>
        )
      })}
    </div>
  )
}

const OPTIONS = [
  { value: 'light', label: 'Light theme', Icon: SunIcon },
  { value: 'dark', label: 'Dark theme', Icon: MoonIcon },
] as const satisfies ReadonlyArray<{
  value: Theme
  label: string
  Icon: (props: SVGProps<SVGSVGElement>) => React.JSX.Element
}>

/**
 * The two glyphs, drawn to match the 1.5px hairline stroke used across the app.
 *
 * They live here rather than in `#components/landing/icons` because that set is
 * scoped to the landing page, and the switcher is shell chrome that has to keep
 * working when the landing page is deleted.
 */
function Glyph({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

function SunIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Glyph>
  )
}

function MoonIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </Glyph>
  )
}
