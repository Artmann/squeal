import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  getBootstrapData: () => ipcRenderer.invoke('get-bootstrap-data'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowMinimize: () => ipcRenderer.invoke('window-minimize')
})
