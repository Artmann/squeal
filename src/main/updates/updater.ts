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

import invariant from 'tiny-invariant'

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
  // Claims the install: the ready status when this caller got it, null when
  // nothing is ready or someone already holds it — the caller's cue to answer
  // the request with an error rather than restarting the app. Only one caller
  // can ever hold the claim, so the app can only be told to swap itself once.
  beginInstall(): UpdateStatus | null
  check(): void
  // Hands the claimed install to the backend. Reachable only by whoever
  // `beginInstall` said yes to.
  completeInstall(): void
  dispose(): void
  status(): UpdateStatus
}

const repository = 'Artmann/squeal'

export const updateMessages = {
  checkFailed:
    'Squeal could not check for updates. Check your internet connection — it will try again automatically.',
  developmentBuild: 'Updates are only available in a packaged build.',
  downloadFailed:
    'The update could not be downloaded. Squeal will try again later, or you can download it from the release page.',
  installUnderway:
    'Squeal is already installing an update — it will restart on its own in a moment.',
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

// What the updater is doing right now. Nothing else is ever in flight: an
// install is claimed rather than reported, and by the time one is handed over
// the process is on its way out.
type Activity = 'checking' | 'downloading' | 'idle'

// What the last completed check learned, and the only thing that owns a
// message, a version, or a notes URL. Held apart from the activity because the
// two answer different questions: sharing one slot is what let a finished
// check's message describe an attempt still in flight, and let an update found
// by one check outlive the check that failed to find it again.
type Knowledge =
  | { kind: 'available'; message: string; version: string }
  | { kind: 'error'; message: string }
  | { kind: 'none' }
  | { kind: 'ready'; version: string | null }
  | { kind: 'unsupported'; message: string }

export function createUpdater(options: UpdaterOptions): Updater {
  const { backend, currentVersion, logError, now, unsupported } = options

  let activity: Activity = 'idle'

  // One-way: once someone holds the claim there is nothing to release it for,
  // and the process is on its way out. Nothing resets it if the holder is
  // interrupted before handing the install over — that costs the user an update
  // they asked for, but it is only reachable during shutdown, where the install
  // was going to be abandoned anyway.
  let claimed = false

  let knowledge: Knowledge =
    unsupported === null
      ? { kind: 'none' }
      : { kind: 'unsupported', message: unsupported }

  let lastCheckedAt: number | null = null

  // The one place the two halves become the flat status the contract declares.
  // An activity outranks the knowledge behind it, which is how the state label
  // has always read; what it no longer does is carry that knowledge's fields
  // into a state which has not earned them.
  function project(): UpdateStatus {
    const base = { currentVersion, lastCheckedAt }

    if (activity !== 'idle') {
      return {
        ...base,
        message: null,
        releaseNotesUrl: null,
        state: activity,
        version: null
      }
    }

    switch (knowledge.kind) {
      case 'available':
        return {
          ...base,
          message: knowledge.message,
          releaseNotesUrl: releaseNotesUrl(knowledge.version),
          state: 'available',
          version: knowledge.version
        }

      case 'error':
        return {
          ...base,
          message: knowledge.message,
          releaseNotesUrl: null,
          state: 'error',
          version: null
        }

      case 'none':
        return {
          ...base,
          message: null,
          releaseNotesUrl: null,
          state: 'idle',
          version: null
        }

      case 'ready':
        return {
          ...base,
          message: null,
          releaseNotesUrl: releaseNotesUrl(knowledge.version),
          state: 'ready',
          version: knowledge.version
        }

      case 'unsupported':
        return {
          ...base,
          message: knowledge.message,
          releaseNotesUrl: null,
          state: 'unsupported',
          version: null
        }
    }
  }

  function fail(error: unknown, message: string): void {
    activity = 'idle'
    knowledge = { kind: 'error', message }
    lastCheckedAt = now()

    logError(`Squeal could not update itself: ${describeError(error)}`)
  }

  // An inert updater must not attach listeners: on an unpackaged build touching
  // the feed at all throws, and there is nothing to listen to anyway.
  const unsubscribe =
    unsupported === null
      ? backend.subscribe({
          downloaded: (version) => {
            activity = 'idle'
            knowledge = { kind: 'ready', version }
            lastCheckedAt = now()
          },

          downloading: () => {
            activity = 'downloading'
          },

          failed: (error) => {
            // Which message applies depends on how far the attempt got, and
            // only the activity it is ending still knows that.
            fail(
              error,
              activity === 'downloading'
                ? updateMessages.downloadFailed
                : updateMessages.checkFailed
            )
          },

          found: (version, message) => {
            activity = 'idle'
            knowledge = { kind: 'available', message, version }
            lastCheckedAt = now()
          },

          notFound: () => {
            activity = 'idle'
            knowledge = { kind: 'none' }
            lastCheckedAt = now()
          }
        })
      : (): void => undefined

  return {
    beginInstall(): UpdateStatus | null {
      // The claim is taken here, at ask time, rather than at hand-off time.
      // The install reaches the backend on a short delay so the HTTP response
      // can leave first, and that gap is exactly the window a retry or a second
      // client can ask in — a latch taken on the far side of it still refuses
      // the duplicate hand-off, so the bundle was never swapped twice. What it
      // cannot do is say so: it closes after the answer has already gone out,
      // and the second caller is told 200 for an install that was dropped.
      //
      // Off the projection rather than `knowledge`, because that is what the
      // caller is handed: an activity in flight outranks the knowledge behind
      // it there, so reading only `knowledge` would license a claim and answer
      // it with a status that does not say ready.
      if (project().state !== 'ready' || claimed) {
        return null
      }

      claimed = true

      return project()
    },

    check(): void {
      // Squirrel downloads the update again for every extra `checkForUpdates()`
      // call, and once one is ready there is nothing left to learn.
      const busy =
        activity !== 'idle' ||
        knowledge.kind === 'ready' ||
        knowledge.kind === 'unsupported'

      if (busy) {
        return
      }

      activity = 'checking'

      try {
        backend.check()
      } catch (error) {
        fail(error, updateMessages.checkFailed)
      }
    },

    completeInstall(): void {
      invariant(claimed, 'The install was claimed before it was handed over.')

      backend.install()
    },

    dispose(): void {
      unsubscribe()
    },

    status(): UpdateStatus {
      return project()
    }
  }
}
