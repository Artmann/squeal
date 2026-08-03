// The Electron half of self-updating: it decides whether this build can update
// itself at all, and builds the backend that talks to the outside world. The
// state machine it hands that backend to lives in `./updater.ts`.
//
// Only ever built in the main process. Tests drive `createUpdater` with a fake
// backend instead of building anything here.
import { app, autoUpdater, net } from 'electron'
import { log } from 'tiny-typescript-logger'

import {
  createUpdater,
  isNewerVersion,
  latestReleaseApiUrl,
  parseVersion,
  updateMessages,
  type UpdateBackend,
  type UpdateHandlers,
  type Updater
} from './updater'

// A hung request must become a settled rejection rather than a check that stays
// 'checking' forever and blocks every later one.
const githubTimeoutMilliseconds = 10_000

// update.electronjs.org is the free Squirrel feed for public repositories. It
// only sees releases whose git tag is valid semver — `squeal-v1.2.0` is not,
// which is why release-please is configured without a component prefix.
function feedUrl(): string {
  return `https://update.electronjs.org/Artmann/squeal/${process.platform}-${process.arch}/${app.getVersion()}`
}

// Why this build has no update path, or null when it does.
function unsupportedReason(): string | null {
  if (!app.isPackaged) {
    // setFeedURL throws outright on an unsigned development build.
    return updateMessages.developmentBuild
  }

  if (process.platform === 'darwin' && !app.isInApplicationsFolder()) {
    // Squirrel.Mac swaps the bundle in place, which it cannot do on the
    // read-only volume a DMG mounts as.
    return updateMessages.notInApplicationsFolder
  }

  return null
}

// Squirrel does the work on macOS and Windows: one call starts the check, and
// an available update downloads itself without being asked.
function squirrelBackend(): UpdateBackend {
  return {
    check(): void {
      autoUpdater.setFeedURL({ url: feedUrl() })
      autoUpdater.checkForUpdates()
    },

    install(): void {
      autoUpdater.quitAndInstall()
    },

    subscribe(handlers: UpdateHandlers): () => void {
      const onAvailable = (): void => handlers.downloading()
      const onError = (error: Error): void => handlers.failed(error)
      const onNotAvailable = (): void => handlers.notFound()

      const onDownloaded = (
        _event: unknown,
        _releaseNotes: string,
        releaseName: string
      ): void => handlers.downloaded(parseVersion(releaseName ?? null))

      // Nothing has to happen here — a downloaded update is applied on next
      // launch either way — but this is the only trace the quit-to-install path
      // leaves in the log, and it is the path hardest to observe live.
      const onQuitForUpdate = (): void => {
        log.info('Quitting to install an update.')
      }

      autoUpdater.on('before-quit-for-update', onQuitForUpdate)
      autoUpdater.on('error', onError)
      autoUpdater.on('update-available', onAvailable)
      autoUpdater.on('update-downloaded', onDownloaded)
      autoUpdater.on('update-not-available', onNotAvailable)

      return () => {
        autoUpdater.removeListener('before-quit-for-update', onQuitForUpdate)
        autoUpdater.removeListener('error', onError)
        autoUpdater.removeListener('update-available', onAvailable)
        autoUpdater.removeListener('update-downloaded', onDownloaded)
        autoUpdater.removeListener('update-not-available', onNotAvailable)
      }
    }
  }
}

interface GithubRelease {
  tag_name?: unknown
}

// Electron's autoUpdater has no Linux support at all, so Linux gets the honest
// version: notice the new release, then point at the download.
function githubBackend(): UpdateBackend {
  let handlers: UpdateHandlers | null = null

  const load = async (): Promise<void> => {
    // net.fetch rather than the global one: in the main process `fetch` is
    // Node's undici, which knows nothing about Chromium's proxy configuration
    // or the system certificate store, so an update check behind a corporate
    // proxy fails while the rest of the app works. net.fetch honours both, and
    // honours AbortSignal.timeout the same way.
    const response = await net.fetch(latestReleaseApiUrl(), {
      headers: {
        accept: 'application/vnd.github+json',
        // GitHub asks API clients to identify themselves. Without this the
        // request still carries a User-Agent, but an anonymous one.
        'user-agent': `Squeal/${app.getVersion()}`
      },
      signal: AbortSignal.timeout(githubTimeoutMilliseconds)
    })

    if (!response.ok) {
      throw new Error(
        `GitHub answered ${response.status} for the latest release.`
      )
    }

    const release = (await response.json()) as GithubRelease
    const tagName =
      typeof release.tag_name === 'string' ? release.tag_name : null

    if (tagName === null) {
      throw new Error('The latest GitHub release has no tag name.')
    }

    const version = parseVersion(tagName)

    if (version === null || !isNewerVersion(app.getVersion(), version)) {
      handlers?.notFound()

      return
    }

    handlers?.found(version, updateMessages.linux)
  }

  return {
    check(): void {
      void load().catch((error: unknown) => handlers?.failed(error))
    },

    install(): void {
      // Unreachable: this backend never reports an update as downloaded, so the
      // state machine never reaches 'ready', which is the only state that
      // installs. Throwing rather than silently doing nothing keeps a future
      // caller from believing an update was applied.
      throw new Error('Squeal cannot install updates on Linux.')
    },

    subscribe(next: UpdateHandlers): () => void {
      handlers = next

      return () => {
        handlers = null
      }
    }
  }
}

export function makeElectronUpdater(): Updater {
  const unsupported = unsupportedReason()

  const backend =
    process.platform === 'linux' ? githubBackend() : squirrelBackend()

  return createUpdater({
    backend,
    currentVersion: app.getVersion(),
    logError: (message: string) => log.error(message),
    now: () => Date.now(),
    unsupported
  })
}
