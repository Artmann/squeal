import { type ReactNode } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import { toggleThemeMode } from '@/app/hooks/useTheme'

/**
 * Hosts the theme hotkey. The theme itself lives in a module-level store, so
 * this deliberately provides no context — every `useTheme` caller already reads
 * the same state without one.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  useHotkeys('mod+shift+l', toggleThemeMode)

  return children
}
