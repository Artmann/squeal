# Theming System

This document describes our approach to theming using Tailwind v4's CSS-first
configuration. The system supports multiple themes, each with light mode, dark
mode, or both.

## Architecture Overview

Our theming system uses three layers:

1. **Semantic color variables** — Abstract names like `--color-surface` and
   `--color-primary` that describe the purpose of each color
2. **Theme definitions** — CSS files that map semantic variables to actual color
   values
3. **Theme switching** — A data attribute on the root element that activates the
   appropriate theme

This separation means components only reference semantic names, making theme
changes trivial.

## File Structure

```
app/
├── styles/
│   ├── app.css              # Main entry point
│   └── themes/
│       ├── catppuccin-latte.css
│       └── catppuccin-frappe.css
├── hooks/
│   └── useTheme.ts
└── components/
    └── ThemeProvider.tsx
```

## CSS Implementation

### Main Stylesheet

The main stylesheet imports Tailwind and defines the semantic color structure.
Each theme will override these variables.

```css
/* app/styles/app.css */
@import 'tailwindcss';
@import './themes/catppuccin-latte.css';
@import './themes/catppuccin-frappe.css';

@theme {
  /* Base colors */
  --color-base: initial;
  --color-crust: initial;
  --color-mantle: initial;
  --color-surface-0: initial;
  --color-surface-1: initial;
  --color-surface-2: initial;

  /* Text colors */
  --color-text: initial;
  --color-subtext-0: initial;
  --color-subtext-1: initial;

  /* Overlay colors */
  --color-overlay-0: initial;
  --color-overlay-1: initial;
  --color-overlay-2: initial;

  /* Accent colors */
  --color-blue: initial;
  --color-green: initial;
  --color-lavender: initial;
  --color-maroon: initial;
  --color-mauve: initial;
  --color-peach: initial;
  --color-pink: initial;
  --color-red: initial;
  --color-rosewater: initial;
  --color-sapphire: initial;
  --color-sky: initial;
  --color-teal: initial;
  --color-yellow: initial;
  --color-flamingo: initial;
}
```

### Theme Files

Each theme file scopes its variables to a data attribute. This allows themes to
specify whether they support light mode, dark mode, or both.

```css
/* app/styles/themes/catppuccin-latte.css */

/* Light mode only theme */
[data-theme='catppuccin'][data-mode='light'] {
  /* Base colors */
  --color-base: #eff1f5;
  --color-crust: #dce0e8;
  --color-mantle: #e6e9ef;
  --color-surface-0: #ccd0da;
  --color-surface-1: #bcc0cc;
  --color-surface-2: #acb0be;

  /* Text colors */
  --color-text: #4c4f69;
  --color-subtext-0: #6c6f85;
  --color-subtext-1: #5c5f77;

  /* Overlay colors */
  --color-overlay-0: #9ca0b0;
  --color-overlay-1: #8c8fa1;
  --color-overlay-2: #7c7f93;

  /* Accent colors */
  --color-blue: #1e66f5;
  --color-flamingo: #dd7878;
  --color-green: #40a02b;
  --color-lavender: #7287fd;
  --color-maroon: #e64553;
  --color-mauve: #8839ef;
  --color-peach: #fe640b;
  --color-pink: #ea76cb;
  --color-red: #d20f39;
  --color-rosewater: #dc8a78;
  --color-sapphire: #209fb5;
  --color-sky: #04a5e5;
  --color-teal: #179299;
  --color-yellow: #df8e1d;
}
```

```css
/* app/styles/themes/catppuccin-frappe.css */

/* Dark mode only theme */
[data-theme='catppuccin'][data-mode='dark'] {
  /* Base colors */
  --color-base: #303446;
  --color-crust: #232634;
  --color-mantle: #292c3c;
  --color-surface-0: #414559;
  --color-surface-1: #51576d;
  --color-surface-2: #626880;

  /* Text colors */
  --color-text: #c6d0f5;
  --color-subtext-0: #a5adce;
  --color-subtext-1: #b5bfe2;

  /* Overlay colors */
  --color-overlay-0: #737994;
  --color-overlay-1: #838ba7;
  --color-overlay-2: #949cbb;

  /* Accent colors */
  --color-blue: #8caaee;
  --color-flamingo: #eebebe;
  --color-green: #a6d189;
  --color-lavender: #babbf1;
  --color-maroon: #ea999c;
  --color-mauve: #ca9ee6;
  --color-peach: #ef9f76;
  --color-pink: #f4b8e4;
  --color-red: #e78284;
  --color-rosewater: #f2d5cf;
  --color-sapphire: #85c1dc;
  --color-sky: #99d1db;
  --color-teal: #81c8be;
  --color-yellow: #e5c890;
}
```

## Theme Hook

The hook manages theme state and syncs it with the DOM and localStorage.

```ts
/* app/hooks/useTheme.ts */
import { useCallback, useEffect, useState } from 'react'

export type ThemeMode = 'dark' | 'light' | 'system'
export type ThemeName = 'catppuccin'

interface ThemeState {
  mode: ThemeMode
  name: ThemeName
}

const STORAGE_KEY = 'theme'

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
      setThemeState((prev) => {
        const next = { ...prev, ...updates }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        applyTheme(next)
        return next
      })
    },
    [applyTheme]
  )

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
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
```

## Theme Provider

Wrap your app with this provider to make the theme hook available and prevent
flash of unstyled content.

```tsx
/* app/components/ThemeProvider.tsx */
import { createContext, useContext, type ReactNode } from 'react'
import { useTheme } from '~/hooks/useTheme'

type ThemeContextValue = ReturnType<typeof useTheme>

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useTheme()

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}

export function useThemeContext() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useThemeContext must be used within ThemeProvider')
  }
  return context
}
```

## Preventing Flash of Unstyled Content

Add this script to your document head to apply the theme before React hydrates:

```html
<script>
  ;(function () {
    try {
      const stored = localStorage.getItem('theme')
      const theme = stored
        ? JSON.parse(stored)
        : { mode: 'system', name: 'catppuccin' }
      const mode =
        theme.mode === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : theme.mode

      document.documentElement.setAttribute('data-theme', theme.name)
      document.documentElement.setAttribute('data-mode', mode)
    } catch (e) {}
  })()
</script>
```

## Usage in Components

With this setup, you can use the semantic color classes anywhere in your app:

```tsx
function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-surface-0 border border-surface-0 rounded-lg p-4">
      <h2 className="text-text font-semibold">{title}</h2>
      <p className="text-subtext-0">{children}</p>
    </div>
  )
}

function Button({ children }: { children: ReactNode }) {
  return (
    <button className="bg-blue text-base px-4 py-2 rounded hover:bg-sapphire">
      {children}
    </button>
  )
}
```

## Adding New Themes

To add a new theme, create a new CSS file in the themes directory. Themes can
support:

- **Light mode only**: Use `[data-theme='name'][data-mode='light']`
- **Dark mode only**: Use `[data-theme='name'][data-mode='dark']`
- **Both modes**: Define both selectors

Example for a theme that supports both modes:

```css
/* app/styles/themes/nord.css */

[data-theme='nord'][data-mode='light'] {
  --color-base: #eceff4;
  --color-text: #2e3440;
  /* ... */
}

[data-theme='nord'][data-mode='dark'] {
  --color-base: #2e3440;
  --color-text: #eceff4;
  /* ... */
}
```

Then update the type definition:

```ts
export type ThemeName = 'catppuccin' | 'nord'
```

## Color Reference

### Catppuccin Latte (Light)

| Name      | Hex       | Usage                |
| --------- | --------- | -------------------- |
| Base      | `#eff1f5` | Main background      |
| Mantle    | `#e6e9ef` | Secondary background |
| Crust     | `#dce0e8` | Tertiary background  |
| Surface 0 | `#ccd0da` | Elevated surfaces    |
| Surface 1 | `#bcc0cc` | Higher elevation     |
| Surface 2 | `#acb0be` | Highest elevation    |
| Text      | `#4c4f69` | Primary text         |
| Subtext 1 | `#5c5f77` | Secondary text       |
| Subtext 0 | `#6c6f85` | Tertiary text        |
| Blue      | `#1e66f5` | Primary accent       |
| Green     | `#40a02b` | Success states       |
| Red       | `#d20f39` | Error states         |
| Yellow    | `#df8e1d` | Warning states       |
| Mauve     | `#8839ef` | Links, highlights    |

### Catppuccin Frappé (Dark)

| Name      | Hex       | Usage                |
| --------- | --------- | -------------------- |
| Base      | `#303446` | Main background      |
| Mantle    | `#292c3c` | Secondary background |
| Crust     | `#232634` | Tertiary background  |
| Surface 0 | `#414559` | Elevated surfaces    |
| Surface 1 | `#51576d` | Higher elevation     |
| Surface 2 | `#626880` | Highest elevation    |
| Text      | `#c6d0f5` | Primary text         |
| Subtext 1 | `#b5bfe2` | Secondary text       |
| Subtext 0 | `#a5adce` | Tertiary text        |
| Blue      | `#8caaee` | Primary accent       |
| Green     | `#a6d189` | Success states       |
| Red       | `#e78284` | Error states         |
| Yellow    | `#e5c890` | Warning states       |
| Mauve     | `#ca9ee6` | Links, highlights    |
