// Retention as one scoped fiber owned by the runtime scope: an immediate
// sweep at boot, then one per day, and clean interruption at shutdown —
// replacing the previous fire-and-forget setInterval calls whose handles
// were never retained.
import { Duration, Effect, Layer, Schedule } from 'effect'

import { deleteExpiredQueries } from '@/main/queries/query-retention'
import { deleteExpiredSpans } from '@/main/tracing/trace-retention'
import { AppDatabase } from './services/app-database'

interface MaintenanceSweep {
  name: string
  run: () => Promise<number>
}

// A plain list, deliberately not a registry: a sweep is a line here, and the
// order of the lines is the order they run in.
const sweeps: MaintenanceSweep[] = [
  { name: 'Query history', run: () => deleteExpiredQueries() },
  { name: 'Trace span', run: () => deleteExpiredSpans() }
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
const runSweeps = Effect.forEach(
  sweeps,
  (sweep) =>
    Effect.tryPromise(sweep.run).pipe(
      // A failed sweep must stop neither the sweeps after it nor the schedule
      // — name it in the log and try again tomorrow.
      Effect.catchAllCause((cause) =>
        Effect.logError(`${sweep.name} cleanup failed`, cause)
      )
    ),
  { discard: true }
)

export const RetentionLive = Layer.scopedDiscard(
  Effect.gen(function* () {
    // Nothing here uses the client. The dependency is what states, in the type
    // system, that retention runs against an initialized schema.
    // `Layer.provideMerge` in `runtime.ts` already builds it that way, so this
    // line changes no behaviour today — it is what keeps the ordering true if
    // that composition is ever rearranged.
    yield* AppDatabase

    yield* runSweeps.pipe(
      // `fixed`, not `spaced`: the cadence is anchored to when a pass started,
      // so a slow sweep does not push every later day's maintenance back by
      // however long it took.
      Effect.repeat(Schedule.fixed(Duration.days(1))),
      Effect.forkScoped
    )
  })
)
