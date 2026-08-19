import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetAllWindows } = vi.hoisted(() => ({
  mockGetAllWindows: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: mockGetAllWindows
  }
}))

import {
  closeMainWindow,
  focusMainWindow,
  getMainWindow,
  minimizeMainWindow,
  toggleMainWindowMaximized
} from './window'

type FakeWindow = {
  close: ReturnType<typeof vi.fn>
  destroyed: boolean
  focus: ReturnType<typeof vi.fn>
  isDestroyed: () => boolean
  isMaximized: () => boolean
  isMinimized: () => boolean
  maximize: ReturnType<typeof vi.fn>
  maximized: boolean
  minimize: ReturnType<typeof vi.fn>
  minimized: boolean
  restore: ReturnType<typeof vi.fn>
  unmaximize: ReturnType<typeof vi.fn>
}

// A destroyed window is not a window that politely answers `false` to
// everything. Electron's remote-object wrapper throws `Object has been
// destroyed` from every method except `isDestroyed()`, so a fake that answers
// instead of throwing would let a missing guard pass here and crash the app.
// Verified against Electron 39.2.3, the version this app ships: every method
// above throws, and `isDestroyed()` answers true.
function createWindow(
  overrides: Partial<
    Pick<FakeWindow, 'destroyed' | 'maximized' | 'minimized'>
  > = {}
): FakeWindow {
  const live = <Value>(produce: () => Value): (() => Value) => {
    return () => {
      if (browserWindow.destroyed) {
        throw new TypeError('Object has been destroyed')
      }

      return produce()
    }
  }

  const browserWindow: FakeWindow = {
    close: vi.fn(live(() => undefined)),
    destroyed: false,
    focus: vi.fn(live(() => undefined)),
    isDestroyed: () => browserWindow.destroyed,
    isMaximized: live(() => browserWindow.maximized),
    isMinimized: live(() => browserWindow.minimized),
    maximize: vi.fn(
      live(() => {
        browserWindow.maximized = true
      })
    ),
    maximized: false,
    minimize: vi.fn(
      live(() => {
        browserWindow.minimized = true
      })
    ),
    minimized: false,
    restore: vi.fn(
      live(() => {
        browserWindow.minimized = false
      })
    ),
    unmaximize: vi.fn(
      live(() => {
        browserWindow.maximized = false
      })
    ),
    ...overrides
  }

  return browserWindow
}

function openWindows(...windows: FakeWindow[]): void {
  mockGetAllWindows.mockReturnValue(windows)
}

beforeEach(() => {
  vi.clearAllMocks()

  // Every test says which windows are open; this only keeps a test that forgets
  // from reading the previous one's list.
  openWindows()
})

describe('closeMainWindow', () => {
  it('closes the open window', () => {
    const browserWindow = createWindow()

    openWindows(browserWindow)
    closeMainWindow()

    expect(browserWindow.close).toHaveBeenCalledTimes(1)
  })

  it('does nothing when no window is open', () => {
    expect(() => closeMainWindow()).not.toThrow()
  })

  it('does nothing when the window has already been destroyed', () => {
    const browserWindow = createWindow({ destroyed: true })

    openWindows(browserWindow)
    closeMainWindow()

    expect(browserWindow.close).toHaveBeenCalledTimes(0)
  })
})

describe('focusMainWindow', () => {
  it('focuses the open window', () => {
    const browserWindow = createWindow()

    openWindows(browserWindow)
    focusMainWindow()

    expect({
      focused: browserWindow.focus.mock.calls.length,
      restored: browserWindow.restore.mock.calls.length
    }).toEqual({ focused: 1, restored: 0 })
  })

  // Focusing a minimized window leaves it minimized, so the restore has to come
  // first — a second launch of the app that only focuses raises nothing the
  // user can see.
  it('restores a minimized window before focusing it', () => {
    const browserWindow = createWindow({ minimized: true })

    openWindows(browserWindow)
    focusMainWindow()

    expect({
      focused: browserWindow.focus.mock.calls.length,
      minimized: browserWindow.minimized,
      restored: browserWindow.restore.mock.calls.length
    }).toEqual({ focused: 1, minimized: false, restored: 1 })
  })

  it('does nothing when no window is open', () => {
    expect(() => focusMainWindow()).not.toThrow()
  })

  // A second launch of the app raises the running one. With no window left to
  // raise there is nothing to do, and the reference the app used to keep would
  // have had it asking a destroyed window whether it was minimized — which
  // throws, out of an IPC handler that has no one to report to.
  it('does nothing when the window has been destroyed', () => {
    const browserWindow = createWindow({ destroyed: true, minimized: true })

    openWindows(browserWindow)
    focusMainWindow()

    expect({
      focused: browserWindow.focus.mock.calls.length,
      restored: browserWindow.restore.mock.calls.length
    }).toEqual({ focused: 0, restored: 0 })
  })
})

describe('getMainWindow', () => {
  it('returns nothing before a window has been opened', () => {
    openWindows()

    expect(getMainWindow()).toEqual(undefined)
  })

  it('returns the open window', () => {
    const browserWindow = createWindow()

    openWindows(browserWindow)

    expect(getMainWindow()).toEqual(browserWindow)
  })

  // The whole point of asking Electron each time. A held reference to a closed
  // window stays non-null forever, so `?.` reads as a guard while it is really
  // calling into a window that is no longer there.
  it('returns nothing when the only window has been destroyed', () => {
    openWindows(createWindow({ destroyed: true }))

    expect(getMainWindow()).toEqual(undefined)
  })

  it('skips a destroyed window to find one that is still open', () => {
    const browserWindow = createWindow()

    openWindows(createWindow({ destroyed: true }), browserWindow)

    expect(getMainWindow()).toEqual(browserWindow)
  })
})

describe('minimizeMainWindow', () => {
  it('minimizes the open window', () => {
    const browserWindow = createWindow()

    openWindows(browserWindow)
    minimizeMainWindow()

    expect(browserWindow.minimize).toHaveBeenCalledTimes(1)
  })

  it('does nothing when no window is open', () => {
    expect(() => minimizeMainWindow()).not.toThrow()
  })

  it('does nothing when the window has been destroyed', () => {
    const browserWindow = createWindow({ destroyed: true })

    openWindows(browserWindow)
    minimizeMainWindow()

    expect(browserWindow.minimize).toHaveBeenCalledTimes(0)
  })
})

describe('toggleMainWindowMaximized', () => {
  it('maximizes a window that is not maximized', () => {
    const browserWindow = createWindow()

    openWindows(browserWindow)
    toggleMainWindowMaximized()

    expect({
      maximized: browserWindow.maximize.mock.calls.length,
      unmaximized: browserWindow.unmaximize.mock.calls.length
    }).toEqual({ maximized: 1, unmaximized: 0 })
  })

  it('restores a window that is already maximized', () => {
    const browserWindow = createWindow({ maximized: true })

    openWindows(browserWindow)
    toggleMainWindowMaximized()

    expect({
      maximized: browserWindow.maximize.mock.calls.length,
      unmaximized: browserWindow.unmaximize.mock.calls.length
    }).toEqual({ maximized: 0, unmaximized: 1 })
  })

  it('does nothing when no window is open', () => {
    expect(() => toggleMainWindowMaximized()).not.toThrow()
  })

  // The only function here that asks the window a question before acting, so it
  // is the one that cannot be written with `?.` — and the one where reaching a
  // destroyed window throws out of `isMaximized()` before any decision is made.
  it('does nothing when the window has been destroyed', () => {
    const browserWindow = createWindow({ destroyed: true })

    openWindows(browserWindow)
    toggleMainWindowMaximized()

    expect({
      maximized: browserWindow.maximize.mock.calls.length,
      unmaximized: browserWindow.unmaximize.mock.calls.length
    }).toEqual({ maximized: 0, unmaximized: 0 })
  })
})
