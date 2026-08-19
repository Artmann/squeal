// Self-updating as a service. The Live implementation attaches listeners to
// Electron's process-wide autoUpdater, so it is only ever built in the main
// process — tests provide a substitute layer and never build Default.
import { Duration, Effect } from 'effect'

import { UpdateNotReadyError } from '@/glue/api/errors'
import { makeElectronUpdater } from '@/main/updates/electron-updater'
import { updateMessages } from '@/main/updates/updater'

// Long enough for the response to reach the renderer, short enough that the
// click still feels immediate. quitAndInstall closes every window and the
// before-quit handler then disposes the HTTP server, so installing inline
// would tear down the server that is still answering the request.
const installDelay = Duration.millis(250)

export class Updater extends Effect.Service<Updater>()('Updater', {
  accessors: true,
  scoped: Effect.gen(function* () {
    // The install timer is forked into this scope rather than the request's:
    // the request finishes long before the timer fires, and its scope with it.
    // This scope belongs to the runtime, so shutdown interrupts a pending
    // install instead of racing it.
    const scope = yield* Effect.scope

    const updater = yield* Effect.acquireRelease(
      Effect.sync(() => makeElectronUpdater()),
      (instance) => Effect.sync(() => instance.dispose())
    )

    // No Effect.fn spans on check and status: the scheduled check has no
    // request span to attach to and would emit a parentless root trace every
    // few hours, and status is polled from memory for the life of the app.
    const check = Effect.sync(() => updater.check())

    const status = Effect.sync(() => updater.status())

    const install = Effect.fn('Updater.install')(function* () {
      // One evaluation decides both the response and the claim, so a second
      // request inside the delay below is refused with the 409 the contract
      // promises rather than being handed a 200 and silently dropped.
      const claimed = yield* Effect.sync(() => updater.beginInstall())

      if (claimed === null) {
        // The status is read only to pick the prose. It has no say in the
        // refusal — that was already decided above — so the two cannot
        // disagree the way the guard this replaced could.
        const { state } = yield* status

        return yield* new UpdateNotReadyError({
          message:
            state === 'ready'
              ? updateMessages.installUnderway
              : updateMessages.notReady
        })
      }

      yield* Effect.sleep(installDelay).pipe(
        Effect.andThen(Effect.sync(() => updater.completeInstall())),
        Effect.forkIn(scope)
      )

      return claimed
    })

    return { check, install, status }
  })
}) {}
