import { createContext, useContext, type ReactNode } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import { useTheme } from '@/app/hooks/useTheme'

type ThemeContextValue = ReturnType<typeof useTheme>

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useTheme()

  useHotkeys('mod+shift+l', () => {
    const nextMode = theme.resolvedMode === 'light' ? 'dark' : 'light'
    theme.setMode(nextMode)
  })

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}

export function useThemeContext() {
  const context = useContext(ThemeContext)

  if (!context) {
    throw new Error('useThemeContext must be used within ThemeProvider')
  }

  return context
}
