import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAppOn,
  mockGetAllWindows,
  mockIpcHandle,
  mockBrowserWindowConstructor
} = vi.hoisted(() => ({
  mockAppOn: vi.fn(),
  mockGetAllWindows: vi.fn(),
  mockIpcHandle: vi.fn(),
  mockBrowserWindowConstructor: vi.fn()
}))

vi.mock('electron', () => {
  class BrowserWindow {
    webContents = {
      on: vi.fn(),
      setWindowOpenHandler: vi.fn()
    }

    static getAllWindows = mockGetAllWindows

    constructor(options: unknown) {
      mockBrowserWindowConstructor(options)
    }

    loadFile = vi.fn()
    loadURL = vi.fn()
  }

  return {
    app: {
      commandLine: { appendSwitch: vi.fn() },
      exit: vi.fn(),
      getAppPath: () => '/app',
      getPath: () => '/tmp',
      isPackaged: false,
      on: mockAppOn,
      quit: vi.fn(),
      requestSingleInstanceLock: () => true
    },
    BrowserWindow,
    dialog: { showErrorBox: vi.fn(), showOpenDialog: vi.fn() },
    ipcMain: { handle: mockIpcHandle },
    shell: { openExternal: vi.fn() }
  }
})

vi.mock('electron-squirrel-startup', () => ({ default: false }))

vi.mock('./server/runtime', () => ({
  makeMainRuntime: vi.fn()
}))

// Injected by the Forge Vite plugin at build time, so nothing defines them when
// the module is imported directly. An empty dev-server URL is the packaged
// shape, which is the one that does not need a running server to load.
Object.assign(globalThis, {
  MAIN_WINDOW_VITE_DEV_SERVER_URL: '',
  MAIN_WINDOW_VITE_NAME: 'main_window'
})

type FakeWindow = {
  close: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  isDestroyed: () => boolean
  isMaximized: () => boolean
  isMinimized: () => boolean
  maximize: ReturnType<typeof vi.fn>
  minimize: ReturnType<typeof vi.fn>
  restore: ReturnType<typeof vi.fn>
  unmaximize: ReturnType<typeof vi.fn>
}

function createWindow(
  state: { maximized?: boolean; minimized?: boolean } = {}
): FakeWindow {
  return {
    close: vi.fn(),
    focus: vi.fn(),
    isDestroyed: () => false,
    isMaximized: () => state.maximized === true,
    isMinimized: () => state.minimized === true,
    maximize: vi.fn(),
    minimize: vi.fn(),
    restore: vi.fn(),
    unmaximize: vi.fn()
  }
}

// The registrations happen while the module body runs, so the import is what
// produces them and it has to happen after the mocks are in place.
async function bootMain(): Promise<void> {
  vi.resetModules()

  await import('./main')
}

function appHandler(event: string): () => void {
  const registration = mockAppOn.mock.calls.find(([name]) => name === event)

  if (!registration) {
    throw new Error(`No handler was registered for the ${event} app event.`)
  }

  return registration[1] as () => void
}

function ipcHandler(channel: string): () => void {
  const registration = mockIpcHandle.mock.calls.find(
    ([name]) => name === channel
  )

  if (!registration) {
    throw new Error(`No handler was registered for the ${channel} channel.`)
  }

  return registration[1] as () => void
}

// The window functions are unit tested in `main/window.test.ts`; what is left
// untested by those is the wiring — which channel reaches which function. A
// minimize wired to close is a data-losing bug that every test over there still
// passes.
describe('main', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAllWindows.mockReturnValue([])
  })

  it('closes the window from the title bar', async () => {
    const browserWindow = createWindow()

    mockGetAllWindows.mockReturnValue([browserWindow])

    await bootMain()

    ipcHandler('window-close')()

    expect({
      closed: browserWindow.close.mock.calls.length,
      maximized: browserWindow.maximize.mock.calls.length,
      minimized: browserWindow.minimize.mock.calls.length
    }).toEqual({ closed: 1, maximized: 0, minimized: 0 })
  })

  it('maximizes the window from the title bar', async () => {
    const browserWindow = createWindow()

    mockGetAllWindows.mockReturnValue([browserWindow])

    await bootMain()

    ipcHandler('window-maximize')()

    expect({
      closed: browserWindow.close.mock.calls.length,
      maximized: browserWindow.maximize.mock.calls.length,
      minimized: browserWindow.minimize.mock.calls.length
    }).toEqual({ closed: 0, maximized: 1, minimized: 0 })
  })

  it('minimizes the window from the title bar', async () => {
    const browserWindow = createWindow()

    mockGetAllWindows.mockReturnValue([browserWindow])

    await bootMain()

    ipcHandler('window-minimize')()

    expect({
      closed: browserWindow.close.mock.calls.length,
      maximized: browserWindow.maximize.mock.calls.length,
      minimized: browserWindow.minimize.mock.calls.length
    }).toEqual({ closed: 0, maximized: 0, minimized: 1 })
  })

  it('opens a window when the app is activated with none open', async () => {
    await bootMain()

    appHandler('activate')()

    expect(mockBrowserWindowConstructor).toHaveBeenCalledTimes(1)
  })

  it('opens no second window when the app is activated with one open', async () => {
    mockGetAllWindows.mockReturnValue([createWindow()])

    await bootMain()

    appHandler('activate')()

    expect(mockBrowserWindowConstructor).toHaveBeenCalledTimes(0)
  })

  it('raises the running window when a second instance is launched', async () => {
    const browserWindow = createWindow({ minimized: true })

    mockGetAllWindows.mockReturnValue([browserWindow])

    await bootMain()

    appHandler('second-instance')()

    expect({
      focused: browserWindow.focus.mock.calls.length,
      restored: browserWindow.restore.mock.calls.length
    }).toEqual({ focused: 1, restored: 1 })
  })
})
