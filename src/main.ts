import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  shell
} from 'electron'
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import started from 'electron-squirrel-startup'
import invariant from 'tiny-invariant'
import { log } from 'tiny-typescript-logger'

import { fileDialogs, type FileDialogKind } from './glue/file-dialogs'
import { applyApplicationMenu } from './main/menu'
import {
  closeMainWindow,
  focusMainWindow,
  getMainWindow,
  minimizeMainWindow,
  toggleMainWindowMaximized
} from './main/window'
// Type-only, so it is erased and the backend module stays out of this file's
// runtime import graph -- which is the entire point of `./main/backend`.
import type { Backend } from './main/backend'

if (!app.isPackaged) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
}

// Milliseconds since the process started, which `performance.now()` measures
// from `timeOrigin` — not from when this line runs. That distinction is the
// reason it is used instead of a mark taken here: evaluating this file's import
// graph pulls in the whole backend, and a mark taken after the imports would be
// blind to the largest thing it needs to report on.
function millisecondsSinceStart(): number {
  return performance.now()
}

let apiToken = ''

// Resolved once the backend has finished booting — successfully or not. Every
// renderer request awaits the token before its fetch leaves (see the request
// transform in `src/app/api-client.ts`), so gating the token is what keeps a
// window that opens *during* the boot from firing requests at a server that is
// not listening yet. Without it the renderer's three retries and their backoff
// would spend about seven seconds arriving at the error screen.
//
// It resolves rather than rejects on a failed boot on purpose: the renderer is
// already up and asking by then, and what it needs is for the request to go
// out and fail the way an unreachable backend normally fails — the error
// screen it already has. A rejection here would instead reach `Effect.promise`
// in the api-client, which turns a rejected promise into a defect.
let markBackendSettled: () => void = () => undefined

const backendSettled = new Promise<void>((resolve) => {
  markBackendSettled = resolve
})

ipcMain.handle('get-api-token', async () => {
  await backendSettled

  return apiToken
})

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
  | { backend: Backend; status: 'booting' }
  | { backend: Backend; status: 'quitting' }
  | { backend: Backend; status: 'running' }
  | { status: 'idle' }
  // The window is up and the backend module is still being imported. It earns a
  // state of its own because it is the one moment with something on screen and
  // nothing behind it: there is no backend to dispose, but a quit landing here
  // still has to stop the boot that is about to start, which is why it cannot
  // simply be `idle`.
  | { status: 'starting' }

let lifecycle: Lifecycle = { status: 'idle' }

// Long enough for a normal flush, short enough that a wedged dependency cannot
// hold the app open.
const disposeTimeoutMs = 3_000

// The `--panel2` token both themes paint the loading screen in, converted to
// the hex Electron wants. The window is now built before the renderer has
// loaded anything, so whatever is set here is what the user actually sees for
// the first frames — unset, that is white, and on a dark theme a white
// frameless rectangle reads as a broken app rather than a starting one.
//
// `nativeTheme` is the closest the main process can get to the answer: the real
// choice lives in the renderer's localStorage (`src/theme-bootstrap.ts` reads
// `theme:v1`), which is unreachable from here. A user who has forced a theme
// against their system setting gets one wrong-coloured frame instead of a
// wrong-coloured flash.
function windowBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? '#181c24' : '#f6f7f9'
}

// Synchronous, and that is load-bearing rather than tidiness: the boot path
// below depends on the window existing before the first tick of the layer
// build, which an `async` function returning a discarded promise only happened
// to deliver.
function createWindow(): void {
  const window = new BrowserWindow({
    backgroundColor: windowBackgroundColor(),
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

// Asked through a function so the answer is opaque to narrowing. `lifecycle` is
// module-level and mutable, and an await is exactly where a quit changes it —
// but TypeScript narrows it from the assignment made before that await and
// calls the inline comparison unreachable.
function isQuitting(): boolean {
  return lifecycle.status === 'quitting'
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
async function shutDown(backend: Backend): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined

  // The window goes first, and this is the guarantee that used to come from
  // never having opened one: a quit that lands mid-boot now finds a window on
  // screen, and everything behind it is about to be disposed. Left up, it
  // would spend its last seconds turning every request into an error.
  closeMainWindow()

  // Nothing should be left waiting on a backend that is being torn down. A
  // renderer still holding its token request would otherwise sit on the
  // spinner until the process exits underneath it.
  markBackendSettled()

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
    const disposal = backend
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
  applyApplicationMenu()

  apiToken = randomBytes(32).toString('hex')

  lifecycle = { status: 'starting' }

  // Opened first, before the backend module has even been loaded — which is the
  // whole point. Importing it evaluates Effect, drizzle and the libsql driver,
  // and building the layer graph then opens the app database, runs the DDL,
  // reconciles interrupted queries and binds the port. None of that needs a
  // window and all of it used to happen with nothing on screen. The renderer
  // paints the spinner it already has through all of it now.
  //
  // What stops the window racing the server it talks to is `backendSettled`:
  // the renderer awaits `get-api-token` before every request's fetch leaves.
  createWindow()

  const windowCreatedAt = millisecondsSinceStart()

  const { makeBackend } = await import('./main/backend')

  // A quit can land while that import is in flight. `before-quit` has no
  // backend to dispose at that point, so it lets the quit through and leaves
  // the lifecycle idle — and booting one here would open the database and bind
  // the port on an app that is already on its way out.
  if (lifecycle.status !== 'starting') {
    markBackendSettled()

    return
  }

  const backend = makeBackend({
    allowedOrigins: corsAllowedOrigins(),
    // Lets local agents read traces with plain curl during development.
    publicTraceReads: !app.isPackaged,
    token: apiToken
  })

  lifecycle = { backend, status: 'booting' }

  const outcome = await backend.boot()

  log.info(
    `Startup: window at ${windowCreatedAt.toFixed(0)}ms, backend at ${millisecondsSinceStart().toFixed(0)}ms.`
  )

  if (outcome.status !== 'ready') {
    // Released on this arm too. The renderer is up and waiting on the token by
    // now, and holding it pending would leave it on the spinner behind the
    // dialog below rather than letting the request fail and say so.
    markBackendSettled()

    // Quitting while the layer is still building interrupts it, and that is a
    // shutdown rather than a boot failure — reporting it would raise a modal
    // racing the before-quit handler's own exit. Two spellings of the same
    // situation, and both are needed: the backend reports an interrupt-only
    // cause, and the lifecycle knows about a quit that landed too early for the
    // layer build to have noticed. The outcome half stays inline so that what
    // is left below is narrowed to the arm that carries an error.
    if (isQuitting() || outcome.status === 'interrupted') {
      return
    }

    reportBootFailure(outcome.error)
    app.exit(1)

    return
  }

  // The same question the failure arm asks through `isShutdownInterruption`,
  // asked on this arm too. A quit that landed while the boot was in flight has
  // already started disposing the runtime, and `shutDown` has already closed
  // the window — so there is nothing here to promote to `running`, and the
  // token must not be handed to a renderer whose backend is mid-`dispose()`.
  if (lifecycle.status !== 'booting') {
    return
  }

  lifecycle = { backend, status: 'running' }

  markBackendSettled()
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

  // A window is up, but the backend module is still being imported: nothing has
  // been acquired, so there is nothing to dispose and no reason to hold the
  // quit. Dropping back to `idle` is also the signal the ready handler reads
  // when its import finally resolves — without it, it would go on to boot a
  // backend for an app that is already gone.
  if (lifecycle.status === 'starting') {
    lifecycle = { status: 'idle' }

    markBackendSettled()

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

  const { backend } = lifecycle

  lifecycle = { backend, status: 'quitting' }

  void shutDown(backend)
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
  //
  // `starting` and `booting` are allowed through now that the boot path opens
  // its window before the backend exists: a window closed while the backend is
  // still coming up leaves an app that a dock click should revive, and what it
  // opens waits on `backendSettled` like any other. Refusing them would strand
  // a macOS user with no window until the boot finished, since the boot path no
  // longer opens one when it does.
  if (lifecycle.status === 'idle' || lifecycle.status === 'quitting') {
    return
  }

  // Asked through the same lookup as everywhere else, so there is one answer to
  // "is there a window?" rather than two spellings of it that can drift.
  if (!getMainWindow()) {
    createWindow()
  }
})
