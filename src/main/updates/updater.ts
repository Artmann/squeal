// Squeal's self-update state machine.
//
// Electron's autoUpdater is fire-and-forget: `checkForUpdates()` returns
// nothing and every outcome arrives as an event, with no way to ask it what it
// is currently doing. This module owns that missing state and translates the
// events into it, so the rest of the app has a single value to read.
//
// The state machine is deliberately free of Electron and of `fetch`: both
// arrive through an UpdateBackend, so the transitions can be driven by a fake.
// `src/main/updates/electron-updater.ts` builds the real backends.

export type UpdateState =
  // A newer version exists but this platform cannot install it itself.
  | 'available'
  | 'checking'
  | 'downloading'
  | 'error'
  | 'idle'
  // On disk and installing it is one restart away.
  | 'ready'
  | 'unsupported'

export interface UpdateStatus {
  currentVersion: string
  lastCheckedAt: number | null
  message: string | null
  releaseNotesUrl: string | null
  state: UpdateState
  version: string | null
}

// How a backend reports the outcome of a check. A backend calls exactly one of
// these per check, except Squirrel, which reports `downloading` first and
// `downloaded` once the transfer finishes.
export interface UpdateHandlers {
  downloaded(version: string | null): void
  downloading(): void
  failed(error: unknown): void
  // A newer version exists that this platform cannot install itself, so the
  // backend supplies the message explaining what the user should do instead.
  found(version: string, message: string): void
  notFound(): void
}

export interface UpdateBackend {
  check(): void
  install(): void
  // Registering the listeners once and returning their removal keeps them off
  // the long-lived Electron singleton after the runtime is disposed.
  subscribe(handlers: UpdateHandlers): () => void
}

export interface UpdaterOptions {
  backend: UpdateBackend
  currentVersion: string
  // Swallowing the cause would make a failed update undiagnosable, but the
  // state machine should not own the logger either.
  logError: (message: string) => void
  now: () => number
  // When set, the updater is inert and reports this as its message: there is no
  // update path from here, and the reason is something the user can act on.
  unsupported: string | null
}

export interface Updater {
  check(): void
  dispose(): void
  // False when nothing is ready to install — the caller's cue to answer the
  // request with an error rather than restarting the app — and also false for
  // every call after the first, so the app can only ever be told to swap
  // itself once.
  install(): boolean
  status(): UpdateStatus
}

const repository = 'Artmann/squeal'

export const updateMessages = {
  checkFailed:
    'Squeal could not check for updates. Check your internet connection — it will try again automatically.',
  developmentBuild: 'Updates are only available in a packaged build.',
  downloadFailed:
    'The update could not be downloaded. Squeal will try again later, or you can download it from the release page.',
  linux:
    'Squeal cannot update itself on Linux. Download the latest .deb or .rpm from the release page.',
  notInApplicationsFolder:
    'Squeal cannot update itself from this location. Move Squeal to your Applications folder and restart it to get updates.',
  notReady: 'No update is ready to install yet.'
}

// Squirrel hands us a release *name*, not a version, and on Windows it is the
// only argument populated at all. release-please names releases `v1.3.0`, but
// releases cut before the tag format changed are named `squeal: v1.2.0`, so
// pull the version out rather than trusting either shape.
export function parseVersion(releaseName: string | null): string | null {
  if (releaseName === null) {
    return null
  }

  const match = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/.exec(releaseName)

  return match === null ? null : match[1]
}

export function releaseNotesUrl(version: string | null): string {
  if (version === null) {
    return `https://github.com/${repository}/releases/latest`
  }

  return `https://github.com/${repository}/releases/tag/v${version}`
}

export function latestReleaseApiUrl(): string {
  return `https://api.github.com/repos/${repository}/releases/latest`
}

function releaseParts(version: string): number[] {
  // Everything from the first prerelease or build separator on is dropped: a
  // prerelease sorts below its own release, which the caller handles.
  const core = version.replace(/^v/, '').split(/[-+]/)[0]

  return core.split('.').map((part) => Number.parseInt(part, 10))
}

// Hand-rolled rather than pulling in `semver` for one comparison. Only handles
// what release-please produces — `x.y.z`, optionally with a prerelease suffix,
// optionally `v`-prefixed.
export function isNewerVersion(current: string, candidate: string): boolean {
  const currentParts = releaseParts(current)
  const candidateParts = releaseParts(candidate)

  const unreadable =
    currentParts.length !== 3 ||
    candidateParts.length !== 3 ||
    [...currentParts, ...candidateParts].some((part) => Number.isNaN(part))

  if (unreadable) {
    // An unreadable version is not grounds for offering an update.
    return false
  }

  for (let index = 0; index < 3; index++) {
    if (candidateParts[index] !== currentParts[index]) {
      return candidateParts[index] > currentParts[index]
    }
  }

  // Same `x.y.z`: a prerelease of a version we already run is not an upgrade.
  return false
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createUpdater(options: UpdaterOptions): Updater {
  const { backend, currentVersion, logError, now, unsupported } = options

  const idleStatus: UpdateStatus = {
    currentVersion,
    lastCheckedAt: null,
    message: null,
    releaseNotesUrl: null,
    state: 'idle',
    version: null
  }

  let status: UpdateStatus =
    unsupported === null
      ? idleStatus
      : { ...idleStatus, message: unsupported, state: 'unsupported' }

  // One-way: once the app has been told to replace itself there is nothing to
  // reset it for, and the process is on its way out.
  let installing = false

  function fail(error: unknown, message: string): void {
    status = { ...status, lastCheckedAt: now(), message, state: 'error' }

    logError(`Squeal could not update itself: ${describeError(error)}`)
  }

  // An inert updater must not attach listeners: on an unpackaged build touching
  // the feed at all throws, and there is nothing to listen to anyway.
  const unsubscribe =
    unsupported === null
      ? backend.subscribe({
          downloaded: (version) => {
            status = {
              ...status,
              lastCheckedAt: now(),
              message: null,
              releaseNotesUrl: releaseNotesUrl(version),
              state: 'ready',
              version
            }
          },

          downloading: () => {
            status = { ...status, state: 'downloading' }
          },

          failed: (error) => {
            // Which message applies depends on how far the attempt got, and
            // only the state we are leaving still knows that.
            fail(
              error,
              status.state === 'downloading'
                ? updateMessages.downloadFailed
                : updateMessages.checkFailed
            )
          },

          found: (version, message) => {
            status = {
              ...status,
              lastCheckedAt: now(),
              message,
              releaseNotesUrl: releaseNotesUrl(version),
              state: 'available',
              version
            }
          },

          notFound: () => {
            status = { ...idleStatus, lastCheckedAt: now() }
          }
        })
      : (): void => undefined

  return {
    check(): void {
      // Squirrel downloads the update again for every extra `checkForUpdates()`
      // call, and once one is ready there is nothing left to learn.
      const busy =
        status.state === 'checking' ||
        status.state === 'downloading' ||
        status.state === 'ready' ||
        status.state === 'unsupported'

      if (busy) {
        return
      }

      status = { ...status, state: 'checking' }

      try {
        backend.check()
      } catch (error) {
        fail(error, updateMessages.checkFailed)
      }
    },

    dispose(): void {
      unsubscribe()
    },

    install(): boolean {
      // Idempotent rather than merely guarded. The install is handed to the
      // backend on a short delay so the HTTP response can reach the renderer
      // first, which leaves a window where a retry or a second client can ask
      // again — and Squirrel spawns its installer per quitAndInstall call, so
      // the second one buys a redundant swap of the bundle being replaced.
      if (status.state !== 'ready' || installing) {
        return false
      }

      installing = true

      backend.install()

      return true
    },

    status(): UpdateStatus {
      return status
    }
  }
}
