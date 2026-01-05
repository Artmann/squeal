import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'
import started from 'electron-squirrel-startup'

import { apiPort, startServer } from './api'
import { initializeDatabase } from './database'
import { bootstrap, BootstrapData } from './main/bootstrap'

let bootstrapData: BootstrapData | null = null

ipcMain.handle('get-bootstrap-data', () => {
  return bootstrapData
})

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
      preload: path.join(__dirname, 'preload.js')
    },
    width: 1300
  })

  bootstrapData = await bootstrap()

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    )
  }

  mainWindow.webContents.openDevTools()
}

app.on('ready', async () => {
  await initializeDatabase()

  startServer(apiPort)

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
