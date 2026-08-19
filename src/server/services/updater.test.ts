// Builds the shipped `Updater.Default` with `makeElectronUpdater` replaced by a
// real `createUpdater` over a fake backend. That substitution is what makes the
// claim window visible: the gap between answering the request and handing the
// install over is where a second request arrives, and the `effect-test-helper`
// stub used by the HTTP tests re-implements the predicate rather than running
// the one that ships.
import { Duration, Effect, Exit, Fiber, TestClock } from 'effect'
import { TestContext } from 'effect/TestContext'
import invariant from 'tiny-invariant'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { updateMessages, type UpdateHandlers } from '@/main/updates/updater'
import { Updater } from './updater'

const harness = vi.hoisted(() => ({
  emit: null as UpdateHandlers | null,
  installs: 0
}))

vi.mock('@/main/updates/electron-updater', async () => {
  // `vi.importActual` rather than the module's own import, because this factory
  // is hoisted above it. `electron-updater` imports Electron at module scope,
  // so mocking it is also what keeps this file runnable outside the app.
  const { createUpdater } = await vi.importActual<
    typeof import('@/main/updates/updater')
  >('@/main/updates/updater')

  return {
    makeElectronUpdater: () =>
      createUpdater({
        backend: {
          check: () => undefined,
          install: () => {
            harness.installs += 1
          },
          subscribe: (handlers: UpdateHandlers) => {
            harness.emit = handlers

            return () => {
              harness.emit = null
            }
          }
        },
        currentVersion: '1.2.0',
        logError: () => undefined,
        now: () => 1700000000000,
        unsupported: null
      })
  }
})

function run<A, E>(
  body: (updater: Updater) => Effect.Effect<A, E>
): Promise<Exit.Exit<A, E>> {
  return Effect.runPromiseExit(
    Effect.scoped(
      Effect.gen(function* () {
        const updater = yield* Updater

        return yield* body(updater)
      }).pipe(Effect.provide(Updater.Default))
    ).pipe(Effect.provide(TestContext))
  )
}

// The backend reports a finished download, which is what puts the updater in
// the only state an install can be claimed from.
const readyForInstall = Effect.sync(() => {
  invariant(harness.emit, 'The updater subscribed to the backend.')

  harness.emit.downloaded('1.3.0')
})

describe('Updater.install', () => {
  beforeEach(() => {
    harness.emit = null
    harness.installs = 0
  })

  it('refuses when nothing is ready', async () => {
    const exit = await run((updater) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(updater.install())

        // The message is pulled out as a string rather than compared through
        // the error: `toEqual` on two `UpdateNotReadyError`s passes whatever
        // they say, so an assertion on the instance cannot tell this refusal
        // from the one below it.
        return { installs: harness.installs, message: error.message }
      })
    )

    expect(exit).toEqual(
      Exit.succeed({ installs: 0, message: updateMessages.notReady })
    )
  })

  it('answers before handing the install to the backend', async () => {
    const exit = await run((updater) =>
      Effect.gen(function* () {
        yield* readyForInstall

        // Forked and joined rather than yielded here, because in production
        // the request fiber is gone before the timer fires. A timer forked
        // into the request's own scope would be interrupted at that point and
        // every install would answer 200 and then quietly do nothing -- a
        // change that typechecks, and that a test holding the parent fiber
        // open across the clock adjustment cannot see.
        const request = yield* Effect.fork(updater.install())
        const status = yield* Fiber.join(request)

        // quitAndInstall closes every window and the before-quit handler then
        // disposes the HTTP server, so an install that reached the backend by
        // the time this returned would tear down the server still answering
        // the request.
        const whenAnswered = harness.installs

        yield* TestClock.adjust(Duration.millis(250))

        return {
          onceDelayed: harness.installs,
          state: status.state,
          whenAnswered
        }
      })
    )

    expect(exit).toEqual(
      Exit.succeed({ onceDelayed: 1, state: 'ready', whenAnswered: 0 })
    )
  })

  it('refuses a second request inside the delay window', async () => {
    const exit = await run((updater) =>
      Effect.gen(function* () {
        yield* readyForInstall

        const first = yield* updater.install()

        // A retry, or a second window. The clock has not moved, so the first
        // install has not reached the backend yet and the updater still reports
        // `ready` -- a decision that consults the status rather than the claim
        // answers this one with a 200 and then silently drops it. The message
        // has to match the situation too: nothing here is "not ready".
        const error = yield* Effect.flip(updater.install())

        yield* TestClock.adjust(Duration.millis(250))

        return {
          installs: harness.installs,
          message: error.message,
          state: first.state
        }
      })
    )

    expect(exit).toEqual(
      Exit.succeed({
        installs: 1,
        message: updateMessages.installUnderway,
        state: 'ready'
      })
    )
  })
})
