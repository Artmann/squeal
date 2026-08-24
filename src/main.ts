import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { Cause, Effect, Exit } from 'effect'
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import started from 'electron-squirrel-startup'
import invariant from 'tiny-invariant'
import { log } from 'tiny-typescript-logger'

import { fileDialogs, type FileDialogKind } from './glue/file-dialogs'
import {
  closeMainWindow,
  focusMainWindow,
  getMainWindow,
  minimizeMainWindow,
  toggleMainWindowMaximized
} from './main/window'
import { makeMainRuntime, type MainRuntime } from './server/runtime'

if (!app.isPackaged) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
}

let apiToken = ''

ipcMain.handle('get-api-token', () => apiToken)

ipcMain.handle('window-minimize', () => {
  minimizeMainWindow()
})

ipcMain.handle('window-maximize', () => {
  toggleMainWindowMaximized()
})

ipcMain.handle('window-close', () => {
  closeMainWindow()
})

ipcMain.handle('open-file-dialog', async (_event, kind: unknown) => {
  // `Object.hasOwn` before indexing, not a truthiness check on the result: a
  // plain object literal indexed by an untrusted string answers for prototype
  // keys too, so `'constructor'` would sail past `if (!fileDialog)` and get
  // spread into the options.
  invariant(
    typeof kind === 'string' && Object.hasOwn(fileDialogs, kind),
    `Unknown file dialog kind: ${String(kind)}.`
  )

  const fileDialog = fileDialogs[kind as FileDialogKind]

  // The only thing that opens a picker is a button inside the window, so no
  // window means something is wrong rather than something to work around. It
  // is passed so the dialog is a sheet on the frameless window instead of a
  // panel floating off on its own.
  const parentWindow = getMainWindow()

  invariant(parentWindow, 'A file dialog was requested with no window open.')

  const result = await dialog.showOpenDialog(parentWindow, {
    filters: fileDialog.filters,
    properties: ['openFile'],
    title: fileDialog.title
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  return result.filePaths[0]
})

if (started) {
  app.quit()
}

// Taken before anything can touch the app database. A second instance used to
// run the boot effects against the shared SQLite file and only then fail on the
// port bind — and reconciliation marks *every* unfinished query failed, with no
// instance scoping, so it poisoned the running instance's in-flight queries.
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
}

// One value rather than a runtime beside two booleans. Three booleans gave
// eight combinations for a four-state lifecycle, and the states that cannot
// have a runtime could still name one — which is how `createWindow()` came to
// run without consulting any of them. Here the runtime is present exactly where
// it is usable, so the question has to be asked to reach it.
type Lifecycle =
  | { runtime: MainRuntime; status: 'booting' }
  | { runtime: MainRuntime; status: 'quitting' }
  | { runtime: MainRuntime; status: 'running' }
  | { status: 'idle' }

let lifecycle: Lifecycle = { status: 'idle' }

// Long enough for a normal flush, short enough that a wedged dependency cannot
// hold the app open.
const disposeTimeoutMs = 3_000

const createWindow = async () => {
  const window = new BrowserWindow({
    frame: false,
    height: 880,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 14 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true
    },
    width: 1300
  })

  // The renderer only ever shows the app itself — deny every navigation away
  // from it and every attempt to open a child window.
  const allowedOrigin = MAIN_WINDOW_VITE_DEV_SERVER_URL
    ? new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin
    : 'file://'

  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(allowedOrigin)) {
      event.preventDefault()
    }
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url)
    }

    return { action: 'deny' }
  })

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
  } else {
    window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    )
  }
}

// The packaged app gets its icon from the bundle, but in development macOS
// falls back to the Electron dock icon. The dock label still reads "Electron" —
// the OS takes the name from the dev binary's Info.plist, which only packaging
// can change.
function applyDevelopmentDockIcon(): void {
  if (app.isPackaged || process.platform !== 'darwin') {
    return
  }

  app.dock?.setIcon(path.join(app.getAppPath(), 'assets/icons/icon.png'))
}

function corsAllowedOrigins(): string[] {
  // 'null' is the Origin a packaged renderer sends when loaded from file://.
  const origins = ['null']

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    origins.push(new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin)
  }

  return origins
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Quitting while the layer is still building interrupts it. That is a shutdown,
// not a boot failure, so it must not raise a dialog racing the before-quit
// handler's own exit.
function isShutdownInterruption(cause: Cause.Cause<unknown>): boolean {
  return lifecycle.status === 'quitting' || Cause.isInterruptedOnly(cause)
}

function reportBootFailure(error: unknown): void {
  // Written synchronously: app.exit terminates before buffered stdout would be
  // flushed, and a boot failure with no trace is undebuggable.
  writeFileSync(
    path.join(app.getPath('temp'), 'squeal-boot-error.log'),
    `${new Date().toISOString()}\n${
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    }\n`
  )
  log.error(`The backend failed to boot: ${String(error)}`)

  dialog.showErrorBox(
    'Squeal could not start',
    `The backend failed to boot: ${describeError(
      error
    )}\n\nIf another Squeal instance is running, close it and try again.`
  )
}

/**
 * Shut the backend down, then leave — within `disposeTimeoutMs` either way.
 *
 * Disposing closes the HTTP server, interrupts the retention fibers and any
 * running queries, and releases the app database. None of that is allowed to
 * hold the app open, so the exit happens on every path; what the two warnings
 * add is a way to tell those paths apart afterwards, since all three reach the
 * same `app.exit(0)` and a backend that wedges on every quit otherwise leaves
 * no trace of having done so.
 */
async function shutDown(runtime: MainRuntime): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const reportFailure = (error: unknown) => {
    log.warn(
      `The backend errored while shutting down: ${describeError(error)}. Exiting anyway — whatever it still held is released by the process going away.`
    )

    return 'failed' as const
  }

  try {
    const timeout = new Promise<'timedOut'>((resolve) => {
      timer = setTimeout(() => {
        resolve('timedOut')
      }, disposeTimeoutMs)
    })

    // Handled on the disposal itself rather than after the race, because the
    // race may already have been won by the timeout — and an unhandled
    // rejection from a process on its way out prints, if at all, after the exit
    // it belongs to.
    //
    // Called inside the `try` but still synchronously, before the first await:
    // `quitAndInstall` primes an installer that only runs once this process is
    // gone, so the teardown has to start before the `before-quit` handler that
    // reached here returns. What the `try` adds is the exit on the last path
    // that lacked one — a `dispose()` that throws where it should have rejected
    // would otherwise skip the `finally`, and the quit it skips has already
    // been prevented, so nothing would be left to release it.
    const disposal = runtime
      .dispose()
      .then(() => 'disposed' as const, reportFailure)

    if ((await Promise.race([disposal, timeout])) === 'timedOut') {
      log.warn(
        `The backend did not shut down within ${disposeTimeoutMs}ms. Exiting anyway — any queries still running were left for their own server to clean up.`
      )
    }
  } catch (error) {
    reportFailure(error)
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }

    app.exit(0)
  }
}

app.on('ready', async () => {
  // A losing second instance is already quitting; booting the backend here
  // would still write to the shared database before the process goes away.
  if (!hasSingleInstanceLock) {
    return
  }

  applyDevelopmentDockIcon()

  apiToken = randomBytes(32).toString('hex')

  const runtime = makeMainRuntime({
    allowedOrigins: corsAllowedOrigins(),
    // Lets local agents read traces with plain curl during development.
    publicTraceReads: !app.isPackaged,
    token: apiToken
  })

  lifecycle = { runtime, status: 'booting' }

  // Forces the runtime layer to build: the app database initializes,
  // interrupted queries are reconciled, the encryption migration runs
  // (safeStorage is only reliable once the app is ready), and only then
  // does the HTTP server start listening.
  const bootExit = await runtime.runPromiseExit(Effect.void)

  if (Exit.isFailure(bootExit)) {
    if (isShutdownInterruption(bootExit.cause)) {
      return
    }

    reportBootFailure(Cause.squash(bootExit.cause))
    app.exit(1)

    return
  }

  // The same question the failure arm asks through `isShutdownInterruption`,
  // asked on this arm too. A quit that landed while the boot was in flight has
  // already started disposing the runtime this window would talk to, and is
  // seconds from `app.exit(0)`: what it opens is a window whose every request
  // fails, for as long as it survives.
  if (lifecycle.status !== 'booting') {
    return
  }

  lifecycle = { runtime, status: 'running' }

  createWindow()
})

app.on('second-instance', () => {
  focusMainWindow()
})

// The first real shutdown path this app has had: disposing the runtime
// closes the HTTP server, interrupts the retention fiber and any running
// queries (best-effort canceling their server-side statements), and releases
// the app database.
//
// `idle` is the losing second instance and anything else that quits before
// `ready`: it has nothing to shut down, and holding its quit would hold it
// forever, since what releases the hold is the exit at the end of `shutDown`.
app.on('before-quit', (event) => {
  if (lifecycle.status === 'idle') {
    return
  }

  // Every quit signal arriving during the dispose window has to keep being
  // prevented. Returning early without preventDefault let a second Cmd+Q — or
  // window-all-closed firing app.quit() — complete the quit and kill the
  // process mid-flush, defeating the whole point of this handler.
  event.preventDefault()

  if (lifecycle.status === 'quitting') {
    return
  }

  const { runtime } = lifecycle

  lifecycle = { runtime, status: 'quitting' }

  void shutDown(runtime)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // The same refusal the boot path makes, on the other door into `createWindow`.
  // A shutting-down app has no windows either, so a dock click here is
  // indistinguishable from the last-window-closed app this exists to revive —
  // except that what it would open talks to a runtime already inside
  // `dispose()`, seconds from `app.exit(0)`.
  if (lifecycle.status !== 'running') {
    return
  }

  // Asked through the same lookup as everywhere else, so there is one answer to
  // "is there a window?" rather than two spellings of it that can drift.
  if (!getMainWindow()) {
    createWindow()
  }
})
