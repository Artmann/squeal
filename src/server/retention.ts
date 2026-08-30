// Retention as one scoped fiber owned by the runtime scope: an immediate
// sweep at boot, then one per day, and clean interruption at shutdown —
// replacing the previous fire-and-forget setInterval calls whose handles
// were never retained.
import { Duration, Effect, Layer, Schedule } from 'effect'

import { deleteExpiredQueries } from '@/main/queries/query-retention'
import { deleteExpiredSpans } from '@/main/tracing/trace-retention'
import { AppDatabase, type AppDatabaseClient } from './services/app-database'

// The sweeps used to start the moment the layer built, which put two DELETEs on
// the event loop while the window was still being created. Forking was never
// the protection it looked like: the libsql driver is synchronous, so a sweep
// in progress is the main process blocked, first paint included. Late enough to
// be clear of that, and mirroring `firstCheckDelay` in `updates.ts`.
export const firstSweepDelay = Duration.seconds(20)

interface MaintenanceSweep {
  name: string
  run: (client: AppDatabaseClient) => Promise<number>
}

// A plain list, deliberately not a registry: a sweep is a line here, and the
// order of the lines is the order they run in.
const sweeps: MaintenanceSweep[] = [
  { name: 'Query history', run: (client) => deleteExpiredQueries(client) },
  { name: 'Trace span', run: (client) => deleteExpiredSpans(client) }
]

// One pass over the list, in order, so that "daily maintenance" names a single
// point in time rather than two that are free to drift apart, and so shutdown
// has one fiber to interrupt rather than two.
//
// There is deliberately no per-sweep timeout, which is the one place this
// departs from the project rule that every external await gets one. That rule
// is about calls that can hang while this process keeps running; the libsql
// driver is synchronous and runs on this process's event loop, so a DELETE
// that is taking a long time is also blocking the timer that would have to
// fire to abandon it. A timeout here would read as protection and deliver
// none. It becomes worth adding once `AppDatabase.execute` can carry a real
// cancellation signal.
const runSweeps = (client: AppDatabaseClient) =>
  Effect.forEach(
    sweeps,
    (sweep) =>
      Effect.tryPromise(() => sweep.run(client)).pipe(
        // A failed sweep must stop neither the sweeps after it nor the
        // schedule — name it in the log and try again tomorrow.
        Effect.catchAllCause((cause) =>
          Effect.logError(`${sweep.name} cleanup failed`, cause)
        )
      ),
    { discard: true }
  )

export const RetentionLive = Layer.scopedDiscard(
  Effect.gen(function* () {
    // The client the sweeps run against, and the reason the dependency is
    // here: building this service is what creates the schema, so taking the
    // client from it is also what states, in the type system, that retention
    // cannot run before that has happened.
    const appDatabase = yield* AppDatabase

    yield* Effect.sleep(firstSweepDelay).pipe(
      Effect.andThen(
        runSweeps(appDatabase.client).pipe(
          // `fixed`, not `spaced`: the cadence is anchored to when a pass
          // started, so a slow sweep does not push every later day's
          // maintenance back by however long it took.
          Effect.repeat(Schedule.fixed(Duration.days(1)))
        )
      ),
      Effect.forkScoped
    )
  })
)
