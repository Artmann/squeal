declare global {
  interface Window {
    electron: {
      openFileDialog: () => Promise<string | null>
      windowClose: () => Promise<void>
      windowMaximize: () => Promise<void>
      windowMinimize: () => Promise<void>
    }
  }
}

export {}
