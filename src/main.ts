import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import started from 'electron-squirrel-startup'

import { apiPort, startServer } from './api'
import { bootstrap, BootstrapData } from './main/bootstrap'

let bootstrapData: BootstrapData | null = null

ipcMain.handle('get-bootstrap-data', () => {
  return bootstrapData
})

if (started) {
  app.quit()
}

export let mainWindow: BrowserWindow

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 880,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
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

app.on('ready', () => {
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
