import { describe, expect, it } from 'vitest'

import {
  createUpdater,
  isNewerVersion,
  parseVersion,
  updateMessages,
  type UpdateBackend,
  type UpdateHandlers,
  type UpdateStatus
} from './updater'

const currentVersion = '1.2.0'

interface TestBackend {
  backend: UpdateBackend
  // The handlers the updater registered, so a test can fire an outcome.
  emit: UpdateHandlers
  state: {
    checks: number
    installs: number
    subscribed: boolean
  }
}

function makeTestBackend(options: { failCheck?: Error } = {}): TestBackend {
  const state = { checks: 0, installs: 0, subscribed: false }

  let registered: UpdateHandlers | null = null

  const backend: UpdateBackend = {
    check(): void {
      state.checks++

      if (options.failCheck) {
        throw options.failCheck
      }
    },

    install(): void {
      state.installs++
    },

    subscribe(handlers: UpdateHandlers): () => void {
      registered = handlers
      state.subscribed = true

      return () => {
        registered = null
        state.subscribed = false
      }
    }
  }

  // Fires through whatever the updater registered, so a test that forgets to
  // let it subscribe fails loudly instead of silently doing nothing.
  const emit: UpdateHandlers = {
    downloaded: (version) => registered?.downloaded(version),
    downloading: () => registered?.downloading(),
    failed: (error) => registered?.failed(error),
    found: (version, message) => registered?.found(version, message),
    notFound: () => registered?.notFound()
  }

  return { backend, emit, state }
}

function makeSubject(
  options: { failCheck?: Error; unsupported?: string } = {}
): {
  errors: string[]
  updater: ReturnType<typeof createUpdater>
} & TestBackend {
  const testBackend = makeTestBackend({ failCheck: options.failCheck })
  const errors: string[] = []

  const updater = createUpdater({
    backend: testBackend.backend,
    currentVersion,
    logError: (message) => errors.push(message),
    now: () => 1_000,
    unsupported: options.unsupported ?? null
  })

  return { ...testBackend, errors, updater }
}

const idleStatus: UpdateStatus = {
  currentVersion,
  lastCheckedAt: null,
  message: null,
  releaseNotesUrl: null,
  state: 'idle',
  version: null
}

describe('parseVersion', () => {
  it('reads the version release-please produces', () => {
    expect(parseVersion('v1.3.0')).toEqual('1.3.0')
  })

  it('reads the version out of a component-prefixed release name', () => {
    expect(parseVersion('squeal: v1.2.0')).toEqual('1.2.0')
  })

  it('keeps a prerelease suffix', () => {
    expect(parseVersion('v2.0.0-beta.1')).toEqual('2.0.0-beta.1')
  })

  it('returns null for a name with no version in it', () => {
    expect(parseVersion('Latest build')).toEqual(null)
  })

  it('returns null when Windows gave us nothing', () => {
    expect(parseVersion(null)).toEqual(null)
  })
})

describe('isNewerVersion', () => {
  it('accepts a higher patch, minor, and major', () => {
    expect([
      isNewerVersion('1.2.0', '1.2.1'),
      isNewerVersion('1.2.0', '1.3.0'),
      isNewerVersion('1.2.0', '2.0.0')
    ]).toEqual([true, true, true])
  })

  it('rejects the same version and anything older', () => {
    expect([
      isNewerVersion('1.2.0', '1.2.0'),
      isNewerVersion('1.2.0', '1.1.9'),
      isNewerVersion('1.2.0', '0.9.0')
    ]).toEqual([false, false, false])
  })

  it('tolerates a v prefix on either side', () => {
    expect([
      isNewerVersion('1.2.0', 'v1.3.0'),
      isNewerVersion('v1.2.0', '1.3.0')
    ]).toEqual([true, true])
  })

  it('does not treat a prerelease of the version we run as an upgrade', () => {
    expect(isNewerVersion('1.2.0', '1.2.0-beta.1')).toEqual(false)
  })

  it('compares numerically rather than lexically', () => {
    expect(isNewerVersion('1.9.0', '1.10.0')).toEqual(true)
  })

  it('refuses to offer an update for an unreadable version', () => {
    expect([
      isNewerVersion('1.2.0', 'nightly'),
      isNewerVersion('1.2.0', '1.2'),
      isNewerVersion('not-a-version', '1.3.0')
    ]).toEqual([false, false, false])
  })
})

describe('createUpdater', () => {
  it('starts idle and subscribes to the backend', () => {
    const subject = makeSubject()

    expect(subject.updater.status()).toEqual(idleStatus)
    expect(subject.state.subscribed).toEqual(true)
  })

  it('reports checking while a check is in flight', () => {
    const subject = makeSubject()

    subject.updater.check()

    expect(subject.updater.status()).toEqual({
      ...idleStatus,
      state: 'checking'
    })
    expect(subject.state.checks).toEqual(1)
  })

  it('goes back to idle when there is no update', () => {
    const subject = makeSubject()

    subject.updater.check()
    subject.emit.notFound()

    expect(subject.updater.status()).toEqual({
      ...idleStatus,
      lastCheckedAt: 1_000
    })
  })

  it('reports downloading, then ready with the notes URL', () => {
    const subject = makeSubject()

    subject.updater.check()
    subject.emit.downloading()

    expect(subject.updater.status()).toEqual({
      ...idleStatus,
      state: 'downloading'
    })

    subject.emit.downloaded('1.3.0')

    expect(subject.updater.status()).toEqual({
      currentVersion,
      lastCheckedAt: 1_000,
      message: null,
      releaseNotesUrl: 'https://github.com/Artmann/squeal/releases/tag/v1.3.0',
      state: 'ready',
      version: '1.3.0'
    })
  })

  it('falls back to the latest-release URL when the version is unreadable', () => {
    const subject = makeSubject()

    subject.updater.check()
    subject.emit.downloaded(null)

    expect(subject.updater.status()).toEqual({
      currentVersion,
      lastCheckedAt: 1_000,
      message: null,
      releaseNotesUrl: 'https://github.com/Artmann/squeal/releases/latest',
      state: 'ready',
      version: null
    })
  })

  it('reports available with the backend message when it cannot self-install', () => {
    const subject = makeSubject()

    subject.updater.check()
    subject.emit.found('1.3.0', updateMessages.linux)

    expect(subject.updater.status()).toEqual({
      currentVersion,
      lastCheckedAt: 1_000,
      message: updateMessages.linux,
      releaseNotesUrl: 'https://github.com/Artmann/squeal/releases/tag/v1.3.0',
      state: 'available',
      version: '1.3.0'
    })
  })

  it('blames the connection when the check itself fails', () => {
    const subject = makeSubject()

    subject.updater.check()
    subject.emit.failed(new Error('getaddrinfo ENOTFOUND'))

    expect(subject.updater.status()).toEqual({
      ...idleStatus,
      lastCheckedAt: 1_000,
      message: updateMessages.checkFailed,
      state: 'error'
    })
    expect(subject.errors).toEqual([
      'Squeal could not update itself: getaddrinfo ENOTFOUND'
    ])
  })

  it('blames the download when it fails after starting', () => {
    const subject = makeSubject()

    subject.updater.check()
    subject.emit.downloading()
    subject.emit.failed(new Error('connection reset'))

    expect(subject.updater.status()).toEqual({
      ...idleStatus,
      lastCheckedAt: 1_000,
      message: updateMessages.downloadFailed,
      state: 'error'
    })
  })

  it('turns a throwing check into an error state', () => {
    const subject = makeSubject({ failCheck: new Error('no code signature') })

    subject.updater.check()

    expect(subject.updater.status()).toEqual({
      ...idleStatus,
      lastCheckedAt: 1_000,
      message: updateMessages.checkFailed,
      state: 'error'
    })
    expect(subject.errors).toEqual([
      'Squeal could not update itself: no code signature'
    ])
  })

  it('retries after a failure', () => {
    const subject = makeSubject()

    subject.updater.check()
    subject.emit.failed(new Error('offline'))
    subject.updater.check()

    expect(subject.state.checks).toEqual(2)
  })

  // Squirrel downloads the update once per checkForUpdates() call, so a second
  // check while it is busy costs the user a duplicate download.
  it('does not check again while checking, downloading, or ready', () => {
    const checking = makeSubject()

    checking.updater.check()
    checking.updater.check()

    expect(checking.state.checks).toEqual(1)

    const downloading = makeSubject()

    downloading.updater.check()
    downloading.emit.downloading()
    downloading.updater.check()

    expect(downloading.state.checks).toEqual(1)

    const ready = makeSubject()

    ready.updater.check()
    ready.emit.downloaded('1.3.0')
    ready.updater.check()

    expect(ready.state.checks).toEqual(1)
  })

  it('installs only when an update is ready', () => {
    const subject = makeSubject()

    expect(subject.updater.install()).toEqual(false)
    expect(subject.state.installs).toEqual(0)

    subject.updater.check()
    subject.emit.downloaded('1.3.0')

    expect(subject.updater.install()).toEqual(true)
    expect(subject.state.installs).toEqual(1)
  })

  it('removes its listeners when disposed', () => {
    const subject = makeSubject()

    subject.updater.dispose()

    expect(subject.state.subscribed).toEqual(false)
  })

  describe('when unsupported', () => {
    it('reports the reason and never subscribes', () => {
      const subject = makeSubject({
        unsupported: updateMessages.developmentBuild
      })

      expect(subject.updater.status()).toEqual({
        ...idleStatus,
        message: updateMessages.developmentBuild,
        state: 'unsupported'
      })
      expect(subject.state.subscribed).toEqual(false)
    })

    it('never checks or installs', () => {
      const subject = makeSubject({
        unsupported: updateMessages.notInApplicationsFolder
      })

      subject.updater.check()

      expect(subject.updater.install()).toEqual(false)
      expect(subject.state).toEqual({
        checks: 0,
        installs: 0,
        subscribed: false
      })
    })
  })
})
