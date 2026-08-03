// The update check as a scoped fiber owned by the runtime scope, mirroring the
// retention sweeps: one check shortly after boot, then one every few hours,
// and clean interruption at shutdown.
//
// Nothing in the UI triggers a check, so this schedule is the only thing that
// ever does. The updater itself refuses to start a second check while one is in
// flight or an update is already waiting, which is what keeps Squirrel from
// downloading the same release twice.
import { Duration, Effect, Layer, Schedule } from 'effect'

import { Updater } from './services/updater'

// Late enough that the check is not competing with the window opening and the
// first schema load for the network.
const firstCheckDelay = Duration.seconds(30)

const checkInterval = Duration.hours(6)

export const UpdaterLive = Layer.scopedDiscard(
  Effect.gen(function* () {
    const updater = yield* Updater

    yield* Effect.sleep(firstCheckDelay).pipe(
      Effect.andThen(
        updater.check.pipe(
          // A check that throws must not take the schedule with it — the
          // updater has already recorded the failure for the UI to show.
          Effect.catchAllCause((cause) =>
            Effect.logError('The update check failed', cause)
          ),
          Effect.repeat(Schedule.fixed(checkInterval))
        )
      ),
      Effect.forkScoped
    )
  })
)
