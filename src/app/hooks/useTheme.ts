import { useEffect, useSyncExternalStore } from 'react'

type ResolvedThemeMode = 'dark' | 'light'
type ThemeMode = 'dark' | 'light' | 'system'
type ThemeName = 'squeal'

interface StoredTheme {
  mode: ThemeMode
  name: ThemeName
}

interface ThemeState extends StoredTheme {
  resolvedMode: ResolvedThemeMode
}

const legacyStorageKey = 'theme'
const storageKey = 'theme:v1'

// One entry per mounted `useTheme` caller. `subscribe` hands back the matching
// removal, so the set stays bounded by the components that are mounted.
const listeners = new Set<() => void>()

// `null` when there is no window to ask — a non-browser environment, or a test
// renderer without `matchMedia`. Callers then fall back to light.
function getDarkModeQuery(): MediaQueryList | null {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return null
  }

  return window.matchMedia('(prefers-color-scheme: dark)')
}

function getSystemMode(): ResolvedThemeMode {
  return getDarkModeQuery()?.matches === true ? 'dark' : 'light'
}

function getResolvedMode(mode: ThemeMode): ResolvedThemeMode {
  return mode === 'system' ? getSystemMode() : mode
}

function toThemeState(stored: StoredTheme): ThemeState {
  return { ...stored, resolvedMode: getResolvedMode(stored.mode) }
}

// The theme lives outside React so that every `useTheme` caller — the provider
// that owns the hotkey and the title bar button — reads and writes one state.
// Seeded from storage rather than the system preference so the very first
// render agrees with what `theme-bootstrap.ts` already painted; seeding from
// the system mode would render the wrong toggle icon until the first effect.
let theme: ThemeState = toThemeState(readStoredTheme())

function applyDocumentTheme(state: ThemeState): void {
  const root = document.documentElement

  root.setAttribute('data-theme', state.name)
  root.setAttribute('data-mode', state.resolvedMode)
}

function publishTheme(state: ThemeState): void {
  theme = state
  applyDocumentTheme(state)

  for (const listener of listeners) {
    listener()
  }
}

function readStoredTheme(): StoredTheme {
  // `squeal` is the only theme, so the stored name is ignored. That also
  // repairs state saved under the previous `catppuccin` name.
  const fallback: StoredTheme = { mode: 'system', name: 'squeal' }

  try {
    // `getItem` itself can throw when storage is blocked, so it belongs inside
    // the guard alongside the parse.
    const stored =
      localStorage.getItem(storageKey) ?? localStorage.getItem(legacyStorageKey)

    if (!stored) {
      return fallback
    }

    const parsed = JSON.parse(stored) as Partial<StoredTheme>
    const mode =
      parsed.mode === 'dark' || parsed.mode === 'light' ? parsed.mode : 'system'

    return { mode, name: 'squeal' }
  } catch (error) {
    // Unreadable state is not worth surfacing to the user; falling back to the
    // system preference repairs it on the next write.
    console.warn(
      'Could not read the stored theme; using the system one.',
      error
    )

    return fallback
  }
}

function writeStoredTheme(stored: StoredTheme): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(stored))
  } catch (error) {
    // A full or blocked localStorage must not break the toggle — the theme
    // still applies, it just does not survive a restart.
    console.warn('Could not save the theme preference.', error)
  }
}

function updateTheme(updates: Partial<StoredTheme>): void {
  const stored: StoredTheme = { mode: theme.mode, name: theme.name, ...updates }

  writeStoredTheme(stored)
  publishTheme(toThemeState(stored))
}

function getSnapshot(): ThemeState {
  return theme
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

/**
 * Re-reads the persisted theme into the store. The renderer calls this once at
 * boot so hydration is an explicit step rather than an import side effect, and
 * so it cannot happen again later — re-reading storage whenever a consumer
 * mounts would clobber live state that failed to persist.
 */
export function hydrateThemeFromStorage(): void {
  publishTheme(toThemeState(readStoredTheme()))
}

/**
 * Flips between an explicit `light` and `dark`. From `system` this lands on the
 * opposite of the current system preference. Both the title bar button and the
 * `mod+shift+l` hotkey call this, so they can never drift apart.
 */
export function toggleThemeMode(): void {
  updateTheme({ mode: theme.resolvedMode === 'dark' ? 'light' : 'dark' })
}

export function useTheme() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useEffect(() => {
    // The store is already seeded from storage, so this only repairs the
    // document when `theme-bootstrap.ts` could not run. Re-reading storage here
    // would clobber live in-memory state every time any consumer mounts.
    applyDocumentTheme(theme)

    const mediaQuery = getDarkModeQuery()

    if (!mediaQuery) {
      return
    }

    const handleChange = () => {
      const resolvedMode = getSystemMode()

      if (theme.mode !== 'system' || theme.resolvedMode === resolvedMode) {
        return
      }

      publishTheme({ ...theme, resolvedMode })
    }

    mediaQuery.addEventListener('change', handleChange)

    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [])

  return {
    mode: state.mode,
    name: state.name,
    resolvedMode: state.resolvedMode,
    setMode: (mode: ThemeMode) => updateTheme({ mode }),
    setTheme: (name: ThemeName) => updateTheme({ name }),
    toggleMode: toggleThemeMode
  }
}
