import { contextBridge, ipcRenderer } from 'electron'

// Type-only, so it is erased and the preload bundle still imports nothing but
// `electron` — which matters because it runs with `sandbox: true`. Relative
// rather than `@/`: the preload build has no path alias.
import type { FileDialogKind } from './glue/file-dialogs'

contextBridge.exposeInMainWorld('electron', {
  getApiToken: () => ipcRenderer.invoke('get-api-token'),
  openFileDialog: (kind: FileDialogKind) =>
    ipcRenderer.invoke('open-file-dialog', kind),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowMinimize: () => ipcRenderer.invoke('window-minimize')
})
