import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  getApiToken: () => ipcRenderer.invoke('get-api-token'),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowMinimize: () => ipcRenderer.invoke('window-minimize')
})
