declare global {
  interface Window {
    electron: {
      getApiToken: () => Promise<string>
      openFileDialog: () => Promise<string | null>
      windowClose: () => Promise<void>
      windowMaximize: () => Promise<void>
      windowMinimize: () => Promise<void>
    }
  }
}

export {}
