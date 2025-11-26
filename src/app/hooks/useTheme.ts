import { useCallback, useEffect, useState } from 'react'

export type ThemeMode = 'dark' | 'light' | 'system'
export type ThemeName = 'catppuccin'

interface ThemeState {
  mode: ThemeMode
  name: ThemeName
}

const storageKey = 'theme'

function getSystemMode(): 'dark' | 'light' {
  if (typeof window === 'undefined') {
    return 'light'
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function getResolvedMode(mode: ThemeMode): 'dark' | 'light' {
  return mode === 'system' ? getSystemMode() : mode
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeState>({
    mode: 'system',
    name: 'catppuccin'
  })

  const applyTheme = useCallback((state: ThemeState) => {
    const root = document.documentElement
    const resolvedMode = getResolvedMode(state.mode)

    root.setAttribute('data-theme', state.name)
    root.setAttribute('data-mode', resolvedMode)
  }, [])

  const setTheme = useCallback(
    (updates: Partial<ThemeState>) => {
      setThemeState((previous) => {
        const next = { ...previous, ...updates }
        localStorage.setItem(storageKey, JSON.stringify(next))
        applyTheme(next)

        return next
      })
    },
    [applyTheme]
  )

  useEffect(() => {
    const stored = localStorage.getItem(storageKey)
    const initial: ThemeState = stored
      ? JSON.parse(stored)
      : { mode: 'system', name: 'catppuccin' }

    setThemeState(initial)
    applyTheme(initial)

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    const handleChange = () => {
      if (initial.mode === 'system') {
        applyTheme(initial)
      }
    }

    mediaQuery.addEventListener('change', handleChange)

    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [applyTheme])

  return {
    mode: theme.mode,
    name: theme.name,
    resolvedMode: getResolvedMode(theme.mode),
    setMode: (mode: ThemeMode) => setTheme({ mode }),
    setTheme: (name: ThemeName) => setTheme({ name })
  }
}
