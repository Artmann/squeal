import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  getBootstrapData: () => ipcRenderer.invoke('get-bootstrap-data')
})
