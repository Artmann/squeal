// Applies the stored theme before first paint to avoid a flash of the wrong
// mode. Loaded from index.html instead of an inline script so the renderer
// works under a script-src 'self' Content-Security-Policy.

interface StoredTheme {
  mode: string
  name: string
}

try {
  const stored = localStorage.getItem('theme')
  const theme: StoredTheme = stored
    ? (JSON.parse(stored) as StoredTheme)
    : { mode: 'system', name: 'catppuccin' }
  const mode =
    theme.mode === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme.mode

  document.documentElement.setAttribute('data-theme', theme.name)
  document.documentElement.setAttribute('data-mode', mode)
} catch {
  // A malformed stored theme falls back to the default styling.
}

export {}
