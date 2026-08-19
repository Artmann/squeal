import { BrowserWindow } from 'electron'

// Everything the app does to its own window goes through here, so that the
// window is looked up at the moment it is used rather than remembered.
//
// Electron already keeps the window list, and a second copy of it in a module
// binding cannot be kept honest: nothing clears the binding when the window
// closes, so it stays non-null long after the native window is gone. `?.` then
// reads as a guard while it is really calling into a destroyed window — and
// every method on one of those throws `Object has been destroyed` rather than
// answering.

export function closeMainWindow(): void {
  getMainWindow()?.close()
}

// Raising the running app when a second copy of it is launched. On macOS a
// second launch does not start a process, so this is the Windows and Linux
// path; there, a running app always has its window.
export function focusMainWindow(): void {
  const browserWindow = getMainWindow()

  if (!browserWindow) {
    return
  }

  if (browserWindow.isMinimized()) {
    browserWindow.restore()
  }

  browserWindow.focus()
}

// The `isDestroyed()` filter is belt-and-braces: Electron drops a window from
// `getAllWindows()` in the same breath as destroying it, so no destroyed window
// is expected to appear here. It is kept because it costs one call and it is
// the single place that decides what the four functions below act on — and what
// they must not act on, since a destroyed window throws at every method.
export function getMainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find(
    (browserWindow) => !browserWindow.isDestroyed()
  )
}

export function minimizeMainWindow(): void {
  getMainWindow()?.minimize()
}

export function toggleMainWindowMaximized(): void {
  const browserWindow = getMainWindow()

  if (!browserWindow) {
    return
  }

  if (browserWindow.isMaximized()) {
    browserWindow.unmaximize()

    return
  }

  browserWindow.maximize()
}
