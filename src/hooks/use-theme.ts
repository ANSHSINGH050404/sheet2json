import { useSyncExternalStore } from 'react'

import {
  readServerTheme,
  readTheme,
  subscribeToTheme,
  writeTheme,
} from '#lib/theme'
import type { Theme } from '#lib/theme'

/**
 * The active theme and a setter for it.
 *
 * `useSyncExternalStore` rather than `useState` + an effect, because the very
 * first client render has to agree with the server's: the server does not know
 * the stored preference, so it renders `readServerTheme()`. React hydrates
 * against that and only then swaps in what the document actually has, which is
 * also what the inline head script already applied. An effect would instead
 * render a wrong theme, then correct it a frame later.
 */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(
    subscribeToTheme,
    readTheme,
    readServerTheme,
  )

  return [theme, writeTheme]
}
