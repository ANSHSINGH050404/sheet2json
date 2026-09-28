/**
 * Theme selection: two states, dark first.
 *
 * The choice lives in `localStorage` and is applied as a class on `<html>`.
 * Nothing about the theme is per-request, so the server sends one document for
 * every visitor and a stored preference costs nothing until the browser reads it.
 *
 * Dark is the default rather than a mirror of `prefers-color-scheme` because this
 * is a tool people keep open next to an editor. Someone who wants light gets one
 * click and stays there; someone who never touches the switch gets the one that
 * suits the audience.
 *
 * The state itself is a plain external store rather than a provider: the shell
 * renders the switcher and nothing else needs the theme, and a provider would
 * mean context plumbing for a single consumer. `useTheme` in
 * `#hooks/use-theme` is the React binding.
 */

/** The two themes. A third "system" option would need a media query to resolve,
 *  and an `auto` state in the switcher is worse than a clear default. */
export const THEMES = ['light', 'dark'] as const

export type Theme = (typeof THEMES)[number]

/** What a visitor sees before they express a preference, and on a first visit. */
export const THEME_DEFAULT: Theme = 'dark'

const STORAGE_KEY = 's2j-theme'

/** Must match the selector in `THEME_SCRIPT` and the `dark` variant in styles.css. */
const DARK_CLASS = 'dark'

export function isTheme(value: unknown): value is Theme {
  return THEMES.includes(value as Theme)
}

/**
 * Applies a theme to the document.
 *
 * Also sets `color-scheme`, which is the part that is easy to forget: it is what
 * makes scrollbars, form controls, and the canvas behind the page follow the
 * theme, and it is a UA-level setting our own tokens cannot reach.
 */
function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.classList.toggle(DARK_CLASS, theme === 'dark')
  root.style.colorScheme = theme
}

/**
 * The theme script, inlined into `<head>` by the root route.
 *
 * The server cannot know the stored preference, so its HTML is always in the
 * default theme. Without this the page would paint once in the wrong colours and
 * then correct itself, which is the flash every hand-rolled dark mode has. It is
 * tiny, synchronous, and blocking by design: it runs before the body exists and
 * before the first paint, so the only cost is a few hundred bytes.
 *
 * The constants are interpolated rather than hard-coded, so this cannot drift
 * away from the functions below.
 */
export const THEME_SCRIPT = `(() => {
  try {
    const stored = localStorage.getItem(${JSON.stringify(STORAGE_KEY)})
    const theme = stored === 'light' ? 'light' : ${JSON.stringify(THEME_DEFAULT)}
    const root = document.documentElement
    root.classList.toggle(${JSON.stringify(DARK_CLASS)}, theme === 'dark')
    root.style.colorScheme = theme
  } catch {}
})()`

/**
 * The current theme, read from the DOM.
 *
 * Seeded from the class rather than from `localStorage`: the inline script above
 * has already run by the time anything reads this, so the class on `<html>` is
 * the single source of truth and the two cannot disagree. Cached because
 * `useSyncExternalStore` calls this on every render, and a class read is cheap
 * but not free.
 */
let current: Theme | null = null

const listeners = new Set<() => void>()

export function readTheme(): Theme {
  current ??= document.documentElement.classList.contains(DARK_CLASS)
    ? 'dark'
    : 'light'
  return current
}

/** The server has no stored preference to report, so it always renders the default. */
export function readServerTheme(): Theme {
  return THEME_DEFAULT
}

export function subscribeToTheme(listener: () => void) {
  listeners.add(listener)

  // A second tab that flips the switch should not leave this one showing a theme
  // that is no longer the stored one.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return
    const next = isTheme(event.newValue) ? event.newValue : THEME_DEFAULT
    current = next
    applyTheme(next)
    listener()
  }

  window.addEventListener('storage', onStorage)

  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function writeTheme(theme: Theme) {
  current = theme
  applyTheme(theme)

  try {
    window.localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Storage can be unavailable (private mode, blocked third-party context). The
    // theme still applies for this page view; only the choice is lost.
  }

  for (const listener of listeners) listener()
}
