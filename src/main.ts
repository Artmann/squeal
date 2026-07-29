import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { Effect } from 'effect'
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

export let mainWindow: BrowserWindow

let runtime: MainRuntime | undefined
let quitting = false

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    frame: false,
    height: 880,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 8 },
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

app.on('ready', async () => {
  // The packaged app gets its icon from the bundle, but in development macOS
  // falls back to the Electron dock icon. The dock label still reads
  // "Electron" — the OS takes the name from the dev binary's Info.plist,
  // which only packaging can change.
  if (!app.isPackaged && process.platform === 'darwin') {
    app.dock?.setIcon(path.join(app.getAppPath(), 'assets/icons/icon.png'))
  }

  apiToken = randomBytes(32).toString('hex')

  const allowedOrigins = ['null']

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    allowedOrigins.push(new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin)
  }

  runtime = makeMainRuntime({
    allowedOrigins,
    // Lets local agents read traces with plain curl during development.
    publicTraceReads: !app.isPackaged,
    token: apiToken
  })

  try {
    // Forces the runtime layer to build: the app database initializes,
    // interrupted queries are reconciled, the encryption migration runs
    // (safeStorage is only reliable once the app is ready), and only then
    // does the HTTP server start listening.
    await runtime.runPromise(Effect.void)
  } catch (error) {
    // Written synchronously: app.exit below terminates before buffered
    // stdout would be flushed, and a boot failure with no trace is
    // undebuggable.
    writeFileSync(
      path.join(app.getPath('temp'), 'squeal-boot-error.log'),
      `${new Date().toISOString()}\n${
        error instanceof Error ? (error.stack ?? error.message) : String(error)
      }\n`
    )
    log.error(`The backend failed to boot: ${String(error)}`)

    dialog.showErrorBox(
      'Squeal could not start',
      `The backend failed to boot: ${
        error instanceof Error ? error.message : String(error)
      }\n\nIf another Squeal instance is running, close it and try again.`
    )
    app.exit(1)

    return
  }

  createWindow()
})

// The first real shutdown path this app has had: disposing the runtime
// closes the HTTP server, interrupts the retention fibers and any running
// queries (best-effort canceling their server-side statements), and releases
// the app database.
app.on('before-quit', (event) => {
  if (quitting || runtime === undefined) {
    return
  }

  quitting = true
  event.preventDefault()

  const timeout = new Promise((resolve) => {
    setTimeout(resolve, 3_000)
  })

  void Promise.race([runtime.dispose(), timeout]).finally(() => {
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
