// Applies the stored theme before first paint to avoid a flash of the wrong
// mode. Loaded from index.html instead of an inline script so the renderer
// works under a script-src 'self' Content-Security-Policy.

interface StoredTheme {
  mode?: string
}

try {
  // These keys must match the ones `useTheme` writes, or this script silently
  // applies the default and the saved mode only lands after first paint.
  const stored =
    localStorage.getItem('theme:v1') ?? localStorage.getItem('theme')
  const theme: StoredTheme = stored
    ? (JSON.parse(stored) as StoredTheme)
    : { mode: 'system' }

  // Anything other than an explicit mode resolves against the system. Without
  // this, valid JSON that simply lacks `mode` would write `data-mode="undefined"`,
  // no mode selector would match, and every token would stay unset until the
  // first effect ran — exactly the flash this script exists to prevent.
  const mode =
    theme.mode === 'dark' || theme.mode === 'light'
      ? theme.mode
      : window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'

  // `squeal` is the only theme, so the stored name is ignored. That also
  // repairs state saved under the previous `catppuccin` name.
  document.documentElement.setAttribute('data-theme', 'squeal')
  document.documentElement.setAttribute('data-mode', mode)
} catch {
  // A malformed stored theme falls back to the default styling.
}

export {}
