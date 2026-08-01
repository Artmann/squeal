import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { hydrateThemeFromStorage } from '@/app/hooks/useTheme'

import { ThemeProvider } from './ThemeProvider'
import { TitleBar } from './TitleBar'

const storageKey = 'theme:v1'

type SystemMode = 'dark' | 'light'

interface SystemModeStub {
  /** Fires the `change` event the OS emits when its colour scheme flips. */
  emitChange: (mode: SystemMode) => void
}

function readStoredTheme(): unknown {
  const stored = localStorage.getItem(storageKey)

  return stored === null ? null : JSON.parse(stored)
}

function stubSystemMode(mode: SystemMode): SystemModeStub {
  const listeners = new Set<() => void>()

  const mediaQueryList = {
    addEventListener: (_event: string, listener: () => void) => {
      listeners.add(listener)
    },
    matches: mode === 'dark',
    media: '(prefers-color-scheme: dark)',
    removeEventListener: (_event: string, listener: () => void) => {
      listeners.delete(listener)
    }
  } as unknown as MediaQueryList

  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mediaQueryList)
  )

  return {
    emitChange: (next: SystemMode) => {
      Object.defineProperty(mediaQueryList, 'matches', {
        configurable: true,
        value: next === 'dark'
      })

      act(() => {
        for (const listener of listeners) {
          listener()
        }
      })
    }
  }
}

/** Seeds the persisted theme and hydrates the store the way boot does. */
function storeTheme(mode: SystemMode): void {
  localStorage.setItem(storageKey, JSON.stringify({ mode, name: 'squeal' }))
  hydrateThemeFromStorage()
}

describe('TitleBar', () => {
  beforeEach(() => {
    localStorage.clear()
    stubSystemMode('light')
    hydrateThemeFromStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the app name', () => {
    render(<TitleBar />)

    expect(screen.getByText('Squeal')).toBeInTheDocument()
  })

  it('offers to switch to dark while the resolved mode is light', () => {
    storeTheme('light')

    render(<TitleBar />)

    expect(
      screen.getByRole('button', { name: 'Switch to dark theme' })
    ).toBeInTheDocument()
  })

  it('offers to switch to light while the resolved mode is dark', () => {
    storeTheme('dark')

    render(<TitleBar />)

    expect(
      screen.getByRole('button', { name: 'Switch to light theme' })
    ).toBeInTheDocument()
  })

  it('renders the stored mode on the very first paint', () => {
    // The system is light but the user stored dark. Seeding the store from the
    // system preference instead of storage would paint the wrong icon until the
    // first effect flushed.
    storeTheme('dark')

    render(<TitleBar />)

    expect(
      screen.getByRole('button', { name: 'Switch to light theme' })
    ).toBeInTheDocument()
  })

  it('flips an explicit dark mode to light when clicked', async () => {
    const user = userEvent.setup()

    storeTheme('dark')

    render(<TitleBar />)

    await user.click(
      screen.getByRole('button', { name: 'Switch to light theme' })
    )

    expect(readStoredTheme()).toEqual({ mode: 'light', name: 'squeal' })
    expect(document.documentElement.getAttribute('data-mode')).toEqual('light')
    expect(document.documentElement.getAttribute('data-theme')).toEqual('squeal')
    expect(
      screen.getByRole('button', { name: 'Switch to dark theme' })
    ).toBeInTheDocument()
  })

  it('resolves the first click from system to the opposite of a dark system mode', async () => {
    const user = userEvent.setup()

    stubSystemMode('dark')
    hydrateThemeFromStorage()

    render(<TitleBar />)

    await user.click(
      screen.getByRole('button', { name: 'Switch to light theme' })
    )

    expect(readStoredTheme()).toEqual({ mode: 'light', name: 'squeal' })
    expect(document.documentElement.getAttribute('data-mode')).toEqual('light')
  })

  it('resolves the first click from system to the opposite of a light system mode', async () => {
    const user = userEvent.setup()

    stubSystemMode('light')
    hydrateThemeFromStorage()

    render(<TitleBar />)

    await user.click(
      screen.getByRole('button', { name: 'Switch to dark theme' })
    )

    expect(readStoredTheme()).toEqual({ mode: 'dark', name: 'squeal' })
    expect(document.documentElement.getAttribute('data-mode')).toEqual('dark')
  })

  it('follows the system while the mode is still system', () => {
    const system = stubSystemMode('light')

    hydrateThemeFromStorage()
    render(<TitleBar />)

    system.emitChange('dark')

    expect(document.documentElement.getAttribute('data-mode')).toEqual('dark')
  })

  it('keeps an explicit choice when the system mode changes afterwards', async () => {
    const user = userEvent.setup()
    const system = stubSystemMode('light')

    hydrateThemeFromStorage()
    render(<TitleBar />)

    await user.click(
      screen.getByRole('button', { name: 'Switch to dark theme' })
    )

    system.emitChange('light')

    // The explicit dark choice must survive an OS flip back to light.
    expect(document.documentElement.getAttribute('data-mode')).toEqual('dark')
    expect(
      screen.getByRole('button', { name: 'Switch to light theme' })
    ).toBeInTheDocument()
  })

  it('shares one theme between the hotkey host and the title bar', async () => {
    const user = userEvent.setup()

    storeTheme('light')

    render(
      <ThemeProvider>
        <TitleBar />
      </ThemeProvider>
    )

    await user.click(
      screen.getByRole('button', { name: 'Switch to dark theme' })
    )

    expect(document.documentElement.getAttribute('data-mode')).toEqual('dark')
    expect(
      screen.getByRole('button', { name: 'Switch to light theme' })
    ).toBeInTheDocument()
  })
})
