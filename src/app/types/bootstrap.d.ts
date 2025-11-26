import type { BootstrapData } from '../../main/bootstrap'

declare global {
  interface Window {
    __BOOTSTRAP_DATA__?: BootstrapData
    electron: {
      getBootstrapData: () => Promise<BootstrapData>
    }
  }
}

export {}
