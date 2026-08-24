import type { FileDialogKind } from '@/glue/file-dialogs'

declare global {
  interface Window {
    electron: {
      getApiToken: () => Promise<string>
      openFileDialog: (kind: FileDialogKind) => Promise<string | null>
      windowClose: () => Promise<void>
      windowMaximize: () => Promise<void>
      windowMinimize: () => Promise<void>
    }
  }
}

export {}
