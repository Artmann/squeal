import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { Cause, Effect, Exit } from 'effect'
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import started from 'electron-squirrel-startup'
import { log } from 'tiny-typescript-logger'

import { makeMainRuntime, type MainRuntime } from './server/runtime'

if (!app.isPackaged) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
}

let apiToken = ''

ipcMain.handle('get-api-token', () => apiToken)

ipcMain.handle('window-minimize', () => {
  mainWindow?.minimize()
})

ipcMain.handle('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})

ipcMain.handle('window-close', () => {
  mainWindow?.close()
})

ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog({
    filters: [
      { extensions: ['db', 'sqlite', 'sqlite3'], name: 'SQLite Database' }
    ],
    properties: ['openFile'],
    title: 'Select SQLite Database'
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

export let mainWindow: BrowserWindow

let runtime: MainRuntime | undefined
let quitting = false
let disposed = false

// Long enough for a normal flush, short enough that a wedged dependency cannot
// hold the app open.
const disposeTimeoutMs = 3_000

const createWindow = async () => {
  mainWindow = new BrowserWindow({
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

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(allowedOrigin)) {
      event.preventDefault()
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url)
    }

    return { action: 'deny' }
  })

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(
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
  return quitting || Cause.isInterruptedOnly(cause)
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

app.on('ready', async () => {
  // A losing second instance is already quitting; booting the backend here
  // would still write to the shared database before the process goes away.
  if (!hasSingleInstanceLock) {
    return
  }

  applyDevelopmentDockIcon()

  apiToken = randomBytes(32).toString('hex')

  runtime = makeMainRuntime({
    allowedOrigins: corsAllowedOrigins(),
    // Lets local agents read traces with plain curl during development.
    publicTraceReads: !app.isPackaged,
    token: apiToken
  })

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

  createWindow()
})

app.on('second-instance', () => {
  if (mainWindow === undefined) {
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  mainWindow.focus()
})

// The first real shutdown path this app has had: disposing the runtime
// closes the HTTP server, interrupts the retention fiber and any running
// queries (best-effort canceling their server-side statements), and releases
// the app database.
app.on('before-quit', (event) => {
  if (runtime === undefined || disposed) {
    return
  }

  // Every quit signal arriving during the dispose window has to keep being
  // prevented. Returning early without preventDefault let a second Cmd+Q — or
  // window-all-closed firing app.quit() — complete the quit and kill the
  // process mid-flush, defeating the whole point of this handler.
  event.preventDefault()

  if (quitting) {
    return
  }

  quitting = true

  let timer: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, disposeTimeoutMs)
  })

  void Promise.race([runtime.dispose(), timeout]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer)
    }

    disposed = true
    app.exit(0)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
