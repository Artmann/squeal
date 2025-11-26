import type { BootstrapData } from '../../main/bootstrap'

declare global {
  interface Window {
    __BOOTSTRAP_DATA__?: BootstrapData
    electron: {
      getBootstrapData: () => Promise<BootstrapData>
      windowClose: () => Promise<void>
      windowMaximize: () => Promise<void>
      windowMinimize: () => Promise<void>
    }
  }
}

export {}
