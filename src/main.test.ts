import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BootOutcome } from './main/backend'

// `src/main.ts` is a script, not a module: importing it registers every ipc
// handler and every `app` event listener as a side effect, and there is no
// exported function to call instead. So the way to drive it is to import it and
// then fire the listeners it registered — which is what `fire` below does, and
// why every case re-imports it through `vi.resetModules()` for a fresh set of
// module-level lifecycle values.
const electron = vi.hoisted(() => ({
  applicationMenus: 0,

  // What `nativeTheme.shouldUseDarkColors` answers, which is how the window
  // picks the background it paints before the renderer has rendered anything.
  darkMode: false,
  errorBoxes: 0,
  exits: [] as number[],
  hasSingleInstanceLock: true,
  ipcHandlers: new Map<string, (...args: never[]) => unknown>(),
  listeners: new Map<string, Array<(...args: never[]) => unknown>>(),

  // What `BrowserWindow.getAllWindows()` answers. The constructor deliberately
  // does not add to it: `windows` counts what the app built, this says what the
  // app currently has, and the cases that matter are the ones where those two
  // differ — a dock click on an app whose last window is already closed.
  openWindows: [] as FakeWindow[],

  // What `showOpenDialog` was handed and what it answers. Recorded rather than
  // stubbed flat, because the options are the whole point of the file-dialog
  // cases: which title and filters a kind resolves to, and that the dialog is
  // parented to the window instead of floating free.
  openDialogArguments: [] as unknown[][],
  openDialogResult: { canceled: true, filePaths: [] as string[] },
  preventedQuits: 0,

  // The options each `BrowserWindow` was built with, so the loading background
  // can be asserted on. The window is shown before anything has painted in it
  // now, so that colour is what the user actually sees first.
  windowOptions: [] as Array<Record<string, unknown>>,
  windows: 0
}))

// The runtime is the app's whole backend — the layer graph, the app database,
// the HTTP server. None of it is what these cases are about: they are about
// which of `main.ts`'s lifecycle branches runs. Both of its methods are
// therefore stubs the case drives directly, so that "the backend is still
// booting" and "shutdown is wedged" become states a test can hold open.
const backend = vi.hoisted(() => ({
  boot: undefined as (() => Promise<BootOutcome>) | undefined,
  dispose: undefined as (() => Promise<void>) | undefined,
  disposeCalls: 0,
  runtimes: 0
}))

// The whole `Logger` surface, not the subset `main.ts` happens to call today.
// A partial literal here turns the next added log line into a dozen failures in
// cases that log nothing, reported against `main.ts` rather than against this
// mock — see `.agents/friction-log/20260830125059-the-logger-mock`.
const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  trace: vi.fn(),
  warn: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    commandLine: { appendSwitch: () => undefined },
    dock: undefined,
    exit: (code: number) => {
      electron.exits.push(code)
    },
    getAppPath: () => '/squeal',
    getPath: () => '/squeal/temp',
    isPackaged: false,
    on: (event: string, listener: (...args: never[]) => unknown) => {
      electron.listeners.set(event, [
        ...(electron.listeners.get(event) ?? []),
        listener
      ])
    },
    quit: () => undefined,
    requestSingleInstanceLock: () => electron.hasSingleInstanceLock
  },
  BrowserWindow: class {
    static getAllWindows() {
      return electron.openWindows
    }

    webContents = {
      on: () => undefined,
      setWindowOpenHandler: () => undefined
    }

    constructor(options: Record<string, unknown>) {
      electron.windows += 1
      electron.windowOptions.push(options)
    }

    loadFile() {
      return undefined
    }

    loadURL() {
      return undefined
    }
  },
  dialog: {
    showErrorBox: () => {
      electron.errorBoxes += 1
    },
    showOpenDialog: (...args: unknown[]) => {
      electron.openDialogArguments.push(args)

      return Promise.resolve(electron.openDialogResult)
    }
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: never[]) => unknown) => {
      electron.ipcHandlers.set(channel, handler)
    }
  },
  // Recorded rather than ignored: `applyApplicationMenu` runs on the boot path
  // this file drives, and a menu installed on a run that should not have
  // reached `ready` is the same class of bug as a window opened there.
  Menu: {
    buildFromTemplate: (template: unknown) => ({ template }),
    setApplicationMenu: () => {
      electron.applicationMenus += 1
    }
  },
  nativeTheme: {
    get shouldUseDarkColors() {
      return electron.darkMode
    }
  },
  shell: { openExternal: () => Promise.resolve() }
}))

vi.mock('electron-squirrel-startup', () => ({ default: false }))

// A boot failure writes its stack to a file under `app.getPath('temp')`, which
// is a directory this fake `app` invents. Left real, the write is the one thing
// in here that reaches the machine running the suite — and it throws when the
// invented directory is not there, turning a case about the dialog into a case
// about `ENOENT`.
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  writeFileSync: () => undefined
}))

vi.mock('tiny-typescript-logger', () => ({ log: logger }))

// `./main/backend` rather than `./server/runtime`: the boot path reaches the
// backend through a dynamic import of that module, so that is the seam. It is
// also where Effect stops — the outcomes below are plain values, which is the
// whole point of the module existing.
vi.mock('./main/backend', () => ({
  makeBackend: () => {
    backend.runtimes += 1

    return {
      boot: () => backend.boot?.() ?? Promise.resolve({ status: 'ready' }),
      dispose: () => {
        backend.disposeCalls += 1

        return backend.dispose?.() ?? Promise.resolve()
      }
    }
  }
}))

/** Import a fresh `main.ts`, with its module-level lifecycle values reset. */
async function importMain(): Promise<void> {
  vi.resetModules()

  await import('./main')
}

/**
 * Call what `main.ts` registered for an `app` event.
 *
 * Returns the listener's own promise where it has one — the `ready` listener is
 * `async`, and the point of several cases below is what it does *after* the
 * boot it awaits comes back.
 */
function fire(event: string, ...args: unknown[]): unknown {
  const listeners = electron.listeners.get(event)

  if (listeners === undefined || listeners.length === 0) {
    throw new Error(
      `\`main.ts\` registered no listener for '${event}'. Registered: ${[...electron.listeners.keys()].join(', ')}.`
    )
  }

  return listeners.map((listener) =>
    (listener as (...values: unknown[]) => unknown)(...args)
  )[0]
}

/** Call what `main.ts` registered for an ipc channel. */
function ipc(channel: string): (...args: unknown[]) => unknown {
  const handler = electron.ipcHandlers.get(channel)

  if (handler === undefined) {
    throw new Error(
      `\`main.ts\` registered no handler for '${channel}'. Registered: ${[...electron.ipcHandlers.keys()].join(', ')}.`
    )
  }

  return handler as (...args: unknown[]) => unknown
}

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

/** Give the app a window, and hand it back to assert on. */
function openWindow(
  state: { maximized?: boolean; minimized?: boolean } = {}
): FakeWindow {
  const browserWindow: FakeWindow = {
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

  electron.openWindows.push(browserWindow)

  return browserWindow
}

/** Let every already-settled promise run its continuation. */
function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

/** The `before-quit` event, counting the times the quit was held. */
function quitEvent(): { preventDefault: () => void } {
  return {
    preventDefault: () => {
      electron.preventedQuits += 1
    }
  }
}

beforeEach(() => {
  electron.applicationMenus = 0
  electron.darkMode = false
  electron.errorBoxes = 0
  electron.exits = []
  electron.hasSingleInstanceLock = true
  electron.ipcHandlers.clear()
  electron.listeners.clear()
  electron.openDialogArguments = []
  electron.openDialogResult = { canceled: true, filePaths: [] }
  electron.openWindows = []
  electron.preventedQuits = 0
  electron.windowOptions = []
  electron.windows = 0

  backend.boot = () => Promise.resolve({ status: 'ready' })
  backend.dispose = () => Promise.resolve()
  backend.disposeCalls = 0
  backend.runtimes = 0

  for (const level of Object.values(logger)) {
    level.mockClear()
  }

  vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', undefined)
  vi.stubGlobal('MAIN_WINDOW_VITE_NAME', 'main_window')
})

afterEach(async () => {
  // Before the tick below, which is a real `setTimeout`.
  vi.useRealTimers()

  // The ready handler spans an await now — the dynamic import of
  // `./main/backend` — so a case that holds the boot open and asserts without
  // awaiting it is still inside that handler when the case ends. Unstubbing
  // first pulls `MAIN_WINDOW_VITE_DEV_SERVER_URL` out from under
  // `corsAllowedOrigins()`, which the handler reads on the far side of that
  // import: it rejects with a ReferenceError belonging to no test, and vitest
  // fails the run on an unhandled error while reporting every case as passing.
  // One tick is all it takes to get the handler as far as the boot it parks on.
  await flush()

  vi.unstubAllGlobals()
})

// The four things `main.ts` decides — open a window, hold a quit, dispose the
// backend, exit the process — all read module-level lifecycle state, and each
// of the cases below is a moment where two of those decisions overlap.
describe('the app lifecycle', () => {
  it('opens a window once the backend has booted', async () => {
    await importMain()

    await fire('ready')

    expect(electron.windows).toEqual(1)
  })

  // The change this file's window cases are all about: the window used to be
  // built after the backend was up, so everything the layer graph does — open
  // SQLite, run the DDL, reconcile the previous process's queries, bind the
  // port — happened with nothing at all on screen. Holding the boot open and
  // asserting *without* awaiting it is what pins the ordering down; awaiting
  // first would pass either way.
  it('opens the window before the backend has finished booting', async () => {
    backend.boot = () => new Promise(() => undefined)

    await importMain()

    void fire('ready')

    expect(electron.windows).toEqual(1)
  })

  // The gap the `starting` state exists for: the window is up and the backend
  // module has not finished importing, so there is nothing acquired to dispose
  // and no reason to hold the quit — but the ready handler is still going to
  // wake up on the other side of that import, and it must not go on to open the
  // database and bind the port for an app that is already leaving.
  it('boots no backend when a quit arrives while the backend module is loading', async () => {
    await importMain()

    const ready = fire('ready')

    // Deliberately not flushed first: this is the one case that wants the quit
    // to land before the import resolves.
    fire('before-quit', quitEvent())

    await ready
    await flush()

    expect({
      disposals: backend.disposeCalls,
      prevented: electron.preventedQuits,
      runtimes: backend.runtimes
    }).toEqual({ disposals: 0, prevented: 0, runtimes: 0 })
  })

  // What makes opening the window early safe. The renderer awaits its token
  // inside the request transform, before any fetch leaves, so a token withheld
  // is a request not yet sent — which is the difference between a spinner and
  // the client spending three retries and its backoff on an unbound port.
  it('withholds the session token until the backend is listening', async () => {
    let finishBoot = (): void => undefined

    backend.boot = () =>
      new Promise((resolve) => {
        finishBoot = () => {
          resolve({ status: 'ready' })
        }
      })

    await importMain()

    const ready = fire('ready')
    const token = ipc('get-api-token')() as Promise<string>

    // Raced rather than asserted directly: a pending promise has no state to
    // read, so the sentinel winning is the evidence that it is still pending.
    expect(
      await Promise.race([token, flush().then(() => 'still waiting')])
    ).toEqual('still waiting')

    finishBoot()

    await ready

    expect(await token).toMatch(/^[0-9a-f]{64}$/)
  })

  // The gate is released on the failure path too, and that is deliberate: the
  // renderer is up and asking by the time a boot fails, so leaving it pending
  // would hold it on the spinner behind the error dialog. Released, the request
  // goes out, finds nothing listening, and says so the way it always has.
  it('releases the session token when the boot fails', async () => {
    backend.boot = () =>
      Promise.resolve({ error: new Error('port in use'), status: 'failed' })

    await importMain()

    await fire('ready')

    expect(await (ipc('get-api-token')() as Promise<string>)).toMatch(
      /^[0-9a-f]{64}$/
    )
  })

  // A dock click between the window opening and the backend coming up finds an
  // app that is genuinely on its way in. Refusing it — which `!== 'running'`
  // did — left a macOS user who closed the loading window with no way back
  // until the boot finished, and the boot path no longer opens one at the end.
  it('reopens a window closed while the backend is still booting', async () => {
    backend.boot = () => new Promise(() => undefined)

    await importMain()

    void fire('ready')

    fire('activate')

    expect(electron.windows).toEqual(2)
  })

  // The window is on screen before the renderer has painted into it, so the
  // colour it is built with is what the user actually sees first. Unset, that
  // is white — a full-window flash on the theme where it is most obvious.
  it('builds the window in the dark loading colour when the OS is dark', async () => {
    electron.darkMode = true

    await importMain()

    await fire('ready')

    expect(electron.windowOptions[0]?.backgroundColor).toEqual('#181c24')
  })

  it('builds the window in the light loading colour when the OS is light', async () => {
    electron.darkMode = false

    await importMain()

    await fire('ready')

    expect(electron.windowOptions[0]?.backgroundColor).toEqual('#f6f7f9')
  })

  // The window used to be withheld here, because the boot path only opened one
  // after the backend was up: a quit landing mid-boot meant the window was
  // never made. It is made first now, so the same guarantee — that no window is
  // left over a backend already mid-`dispose()` and a few seconds from
  // `app.exit(0)` — has to be kept by closing it instead.
  //
  // The quit lands in the gap between the boot promise resolving and the
  // continuation that reads it, which is why the boot here is held open across
  // the quit rather than resolved before it.
  it('closes the window when a quit arrives while the backend is still booting', async () => {
    let finishBoot = (): void => undefined

    backend.boot = () =>
      new Promise((resolve) => {
        finishBoot = () => {
          resolve({ status: 'ready' })
        }
      })

    await importMain()

    const ready = fire('ready')

    // Lets the dynamic import of `./main/backend` resolve, so the quit below
    // lands while the backend is booting rather than while its module is still
    // loading. Those are different branches, and the other one has its own case.
    await flush()

    // Stands in for the window the boot path just built. The fake constructor
    // deliberately does not add to `openWindows` — that list is what the app
    // currently has — so `shutDown` needs one put there to find.
    const window = openWindow()

    fire('before-quit', quitEvent())
    finishBoot()

    await ready
    await flush()

    expect({
      closes: window.close.mock.calls.length,
      disposals: backend.disposeCalls,
      exits: electron.exits
    }).toEqual({ closes: 1, disposals: 1, exits: [0] })
  })

  // Both halves matter and they pull in opposite directions. Disposing twice
  // would tear the same resources down under a shutdown already running; *not*
  // preventing the second quit is worse, and is a bug this app has had — a
  // second Cmd+Q, or `window-all-closed` firing `app.quit()`, completes the quit
  // and kills the process mid-flush, which is the whole thing the handler is
  // there to stop.
  it('holds every quit signal that arrives during shutdown, and disposes once', async () => {
    backend.dispose = () => new Promise(() => undefined)

    await importMain()

    await fire('ready')

    fire('before-quit', quitEvent())
    fire('before-quit', quitEvent())
    fire('before-quit', quitEvent())

    await flush()

    expect({
      disposals: backend.disposeCalls,
      heldQuits: electron.preventedQuits
    }).toEqual({ disposals: 1, heldQuits: 3 })
  })

  // The losing second instance quits before `ready`, so it never builds a
  // runtime. Holding its quit would prevent a quit with nothing to shut down,
  // and nothing would ever release it: the release is in the dispose callback
  // that this path does not reach.
  it('lets a quit through when there is no backend to shut down', async () => {
    await importMain()

    fire('before-quit', quitEvent())

    await flush()

    expect({
      disposals: backend.disposeCalls,
      exits: electron.exits,
      heldQuits: electron.preventedQuits
    }).toEqual({ disposals: 0, exits: [], heldQuits: 0 })
  })

  // A shutdown that never finishes must not hold the app open, so the exit is
  // deliberate. What is missing is any way to tell it apart afterwards: the
  // timeout and a clean shutdown reach the same `app.exit(0)` and say nothing,
  // and a backend that wedges every time leaves no trace of having done so.
  it('says so when the backend does not shut down in time, and exits anyway', async () => {
    vi.useFakeTimers()

    backend.dispose = () => new Promise(() => undefined)

    await importMain()

    await fire('ready')

    fire('before-quit', quitEvent())

    await vi.advanceTimersByTimeAsync(3_000)

    expect({
      exits: electron.exits,
      warnings: logger.warn.mock.calls.map(([message]) => message)
    }).toEqual({
      exits: [0],
      warnings: [expect.stringContaining('did not shut down within 3000ms')]
    })
  })

  // The same silence from the other side. A `dispose()` that rejects reaches
  // the same `app.exit(0)`, and until it said something the rejection showed up
  // only as an unhandled-rejection warning from a process already leaving —
  // printed, if the terminal got to it at all, after the message about the exit.
  it('says so when the backend errors while shutting down, and exits anyway', async () => {
    backend.dispose = () =>
      Promise.reject(new Error('the span writer is already closed'))

    await importMain()

    await fire('ready')

    fire('before-quit', quitEvent())

    await flush()

    expect({
      exits: electron.exits,
      warnings: logger.warn.mock.calls.map(([message]) => message)
    }).toEqual({
      exits: [0],
      warnings: [expect.stringContaining('the span writer is already closed')]
    })
  })

  // The other half of the same branch, and the reason it cannot simply be
  // silenced: a backend that genuinely failed to start leaves an app with a
  // window that will never load anything, so this one says so and goes. The
  // window is built either way now — `app.exit(1)` is what takes it away.
  it('reports a boot failure that is not a shutdown, and exits nonzero', async () => {
    backend.boot = () =>
      Promise.resolve({ error: new Error('port in use'), status: 'failed' })

    await importMain()

    await fire('ready')

    expect({
      dialogs: electron.errorBoxes,
      exits: electron.exits,
      windows: electron.windows
    }).toEqual({ dialogs: 1, exits: [1], windows: 1 })
  })

  // A quit while the layer is still building interrupts the build, so the boot
  // comes back a failure. Reported as one it raises a modal over an app already
  // three seconds from `app.exit(0)` — a dialog nobody asked for, about a
  // shutdown the user started, on a window that is about to disappear under it.
  it('raises no dialog when the boot fails because the quit interrupted it', async () => {
    let failBoot = (): void => undefined

    backend.boot = () =>
      new Promise((resolve) => {
        failBoot = () => {
          resolve({ status: 'interrupted' })
        }
      })

    await importMain()

    const ready = fire('ready')

    // As above: past the backend module's import, so the quit interrupts the
    // layer build rather than the load.
    await flush()

    fire('before-quit', quitEvent())
    failBoot()

    await ready
    await flush()

    expect({ dialogs: electron.errorBoxes, exits: electron.exits }).toEqual({
      dialogs: 0,
      exits: [0]
    })
  })

  // A dock click on macOS reaches `activate` whether or not the app is on its
  // way out, and the last-window-closed app it is meant to revive looks exactly
  // like the mid-quit one: no windows. Between `before-quit` and `app.exit(0)`
  // there is a whole dispose budget for that click to land in, and the window it
  // would open is the same doomed window the boot path now refuses to open.
  it('opens no window when a dock click lands during shutdown', async () => {
    backend.dispose = () => new Promise(() => undefined)

    await importMain()

    await fire('ready')

    fire('before-quit', quitEvent())
    fire('activate')

    await flush()

    expect(electron.windows).toEqual(1)
  })

  // The control for the case above: outside a shutdown the dock click is the
  // only thing that brings a closed-down macOS app back, so refusing it always
  // would be the worse bug.
  it('opens a window when a dock click lands on a running app', async () => {
    await importMain()

    await fire('ready')

    fire('activate')

    expect(electron.windows).toEqual(2)
  })

  // `dispose()` is called outside the `try` on purpose — it has to start
  // synchronously, inside the `before-quit` handler, because `quitAndInstall`
  // depends on that. What that placement must not cost is the exit: a throw
  // rather than a rejected promise would otherwise skip the `finally`, and the
  // quit has already been prevented, so nothing is left to release it. The app
  // would be unquittable by every means except killing it.
  it('exits when the backend throws on its way down rather than rejecting', async () => {
    backend.dispose = () => {
      throw new Error('the runtime was already finalized')
    }

    await importMain()

    await fire('ready')

    fire('before-quit', quitEvent())

    await flush()

    expect(electron.exits).toEqual([0])
  })

  // The losing second instance quits on the lock, before anything is built.
  // Booting here would give a second process its own handle on the one shared
  // SQLite file and let it write through the moment before it goes away.
  // The template is checked in `main/menu.test.ts`; what is checked here is
  // that it is installed at all. Without this call Electron supplies its own
  // menu, whose Reload accelerator is Mod-R -- and a missing call is invisible,
  // because the app looks completely normal right up until a shortcut reloads
  // the window.
  it('replaces the default application menu once the backend has booted', async () => {
    await importMain()

    await fire('ready')

    expect(electron.applicationMenus).toEqual(1)
  })

  it('boots no backend when another instance already holds the lock', async () => {
    electron.hasSingleInstanceLock = false

    await importMain()

    await fire('ready')

    expect({
      applicationMenus: electron.applicationMenus,
      runtimes: backend.runtimes,
      windows: electron.windows
    }).toEqual({ applicationMenus: 0, runtimes: 0, windows: 0 })
  })

  // The timeout is a three-second timer, and a clean shutdown wins the race
  // long before it fires. Left pending it keeps the event loop alive with a
  // callback that resolves a promise nobody is waiting on any more — which is
  // exactly the acquire-without-release the memory rules are about, on the one
  // path where the process is not already leaving.
  it('leaves no timer pending once the backend is down', async () => {
    vi.useFakeTimers()

    await importMain()

    await fire('ready')

    fire('before-quit', quitEvent())

    await vi.advanceTimersByTimeAsync(0)

    expect(vi.getTimerCount()).toEqual(0)
  })
})

// The window functions are unit tested in `main/window.test.ts`; what is left
// untested by those is the wiring — which channel reaches which function. A
// minimize wired to close is a data-losing bug that every test over there still
// passes. The handlers are registered while the module body runs, so importing
// `main.ts` is all these need; none of them waits for `ready`.
// One channel serves both pickers, and the renderer names an intent rather
// than passing dialog options across the bridge: an options object it
// controlled could ask for directories or hidden files. So what needs holding
// is that the intent it names is what decides the title and the filters — a
// certificate picker cannot end up offering `.sqlite` files.
describe('the file dialog', () => {
  // One channel serves both pickers, and the renderer names an intent rather
  // than passing dialog options: what these cases hold is that the intent it
  // names is what decides the title and the filters, so a certificate picker
  // cannot end up offering `.sqlite` files.
  it('offers certificate filters when the renderer asks for a certificate', async () => {
    const browserWindow = openWindow()

    await importMain()

    await ipc('open-file-dialog')(undefined, 'certificate')

    expect(electron.openDialogArguments).toEqual([
      [
        browserWindow,
        {
          filters: [
            {
              extensions: ['pem', 'crt', 'cer', 'cert', 'ca'],
              name: 'Certificate'
            },
            { extensions: ['*'], name: 'All Files' }
          ],
          properties: ['openFile'],
          title: 'Select CA Certificate'
        }
      ]
    ])
  })

  it('offers database filters when the renderer asks for a SQLite database', async () => {
    const browserWindow = openWindow()

    await importMain()

    await ipc('open-file-dialog')(undefined, 'sqliteDatabase')

    expect(electron.openDialogArguments).toEqual([
      [
        browserWindow,
        {
          filters: [
            {
              extensions: ['db', 'sqlite', 'sqlite3'],
              name: 'SQLite Database'
            }
          ],
          properties: ['openFile'],
          title: 'Select SQLite Database'
        }
      ]
    ])
  })

  it('answers the chosen path', async () => {
    openWindow()

    electron.openDialogResult = {
      canceled: false,
      filePaths: ['/etc/ssl/certs/pagila.pem']
    }

    await importMain()

    expect(await ipc('open-file-dialog')(undefined, 'certificate')).toEqual(
      '/etc/ssl/certs/pagila.pem'
    )
  })

  // Null rather than an error or an empty string: cancelling is an answer, and
  // the field the renderer would fill keeps whatever was already typed in it.
  it('answers null when the file dialog is cancelled', async () => {
    openWindow()

    await importMain()

    expect(await ipc('open-file-dialog')(undefined, 'certificate')).toEqual(
      null
    )
  })

  // A kind the catalogue does not have can only come from a renderer bug, and
  // the guard has to be `Object.hasOwn` rather than a truthiness check on the
  // lookup: indexing a plain object with 'constructor' answers a function, so a
  // truthiness check would spread one into the dialog options.
  it('opens no dialog for a file dialog kind it does not have', async () => {
    openWindow()

    await importMain()

    await expect(
      ipc('open-file-dialog')(undefined, 'constructor')
    ).rejects.toThrow(/constructor/)

    expect(electron.openDialogArguments).toEqual([])
  })
})

describe('the title bar and the dock', () => {
  it('closes the window from the title bar', async () => {
    const browserWindow = openWindow()

    await importMain()

    ipc('window-close')()

    expect({
      closed: browserWindow.close.mock.calls.length,
      maximized: browserWindow.maximize.mock.calls.length,
      minimized: browserWindow.minimize.mock.calls.length
    }).toEqual({ closed: 1, maximized: 0, minimized: 0 })
  })

  it('maximizes the window from the title bar', async () => {
    const browserWindow = openWindow()

    await importMain()

    ipc('window-maximize')()

    expect({
      closed: browserWindow.close.mock.calls.length,
      maximized: browserWindow.maximize.mock.calls.length,
      minimized: browserWindow.minimize.mock.calls.length
    }).toEqual({ closed: 0, maximized: 1, minimized: 0 })
  })

  it('minimizes the window from the title bar', async () => {
    const browserWindow = openWindow()

    await importMain()

    ipc('window-minimize')()

    expect({
      closed: browserWindow.close.mock.calls.length,
      maximized: browserWindow.maximize.mock.calls.length,
      minimized: browserWindow.minimize.mock.calls.length
    }).toEqual({ closed: 0, maximized: 0, minimized: 1 })
  })

  // The other half of the dock-click cases above: a running app that still has
  // its window gets nothing new. `activate` fires on every dock click, not only
  // the ones with no window behind them.
  it('opens no second window when a dock click lands on an app that has one', async () => {
    await importMain()

    await fire('ready')

    openWindow()

    fire('activate')

    expect(electron.windows).toEqual(1)
  })

  it('raises the running window when a second instance is launched', async () => {
    const browserWindow = openWindow({ minimized: true })

    await importMain()

    fire('second-instance')

    expect({
      focused: browserWindow.focus.mock.calls.length,
      restored: browserWindow.restore.mock.calls.length
    }).toEqual({ focused: 1, restored: 1 })
  })
})
