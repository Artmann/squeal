import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import started from 'electron-squirrel-startup'

import { apiPort, startServer } from './api'
import { initializeDatabase } from './database'
import { migrateConnectionInfoEncryption } from './main/databases/connection-info-migration'
import { isEncryptionAvailable } from './main/databases/secret-storage'
import { startQueryRetentionSchedule } from './main/queries/query-retention'
import { markInterruptedQueries } from './main/queries/reconcile-queries'
import { startTraceRetentionSchedule } from './main/tracing/trace-retention'

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

  await initializeDatabase()

  // Runs before the server accepts requests so the renderer never sees a
  // stale "running" query from a previous process.
  await markInterruptedQueries()

  startQueryRetentionSchedule()
  startTraceRetentionSchedule()

  // safeStorage is only reliable once the app is ready.
  await migrateConnectionInfoEncryption()

  const allowedOrigins = ['null']

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    allowedOrigins.push(new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin)
  }

  const { token } = startServer(apiPort, {
    allowedOrigins,
    encryptionAvailable: isEncryptionAvailable(),
    // Lets local agents read traces with plain curl during development.
    publicTraceReads: !app.isPackaged
  })

  apiToken = token

  createWindow()
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
