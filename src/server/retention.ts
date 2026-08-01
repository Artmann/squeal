// Retention sweeps as scoped fibers owned by the runtime scope: an immediate
// sweep at boot, then one per day, and clean interruption at shutdown —
// replacing the previous fire-and-forget setInterval calls whose handles
// were never retained.
import { Duration, Effect, Layer, Schedule } from 'effect'

import { deleteExpiredQueries } from '@/main/queries/query-retention'
import { deleteExpiredSpans } from '@/main/tracing/trace-retention'
import { AppDatabase } from './services/app-database'

function dailySweep(
  name: string,
  sweep: () => Promise<number>
): Layer.Layer<never, never, AppDatabase> {
  return Layer.scopedDiscard(
    Effect.gen(function* () {
      // Depending on AppDatabase is what orders the first sweep after schema
      // initialization. Without it this layer declares no dependencies, and
      // mergeAll starts the boot sweep concurrently with initializeDatabase().
      yield* AppDatabase

      yield* Effect.promise(sweep).pipe(
        // One failed sweep must not stop the schedule — log and try again
        // tomorrow.
        Effect.catchAllCause((cause) =>
          Effect.logError(`${name} cleanup failed`, cause)
        ),
        Effect.repeat(Schedule.fixed(Duration.days(1))),
        Effect.forkScoped
      )
    })
  )
}

const queryRetention = dailySweep('Query history', () => deleteExpiredQueries())

const traceRetention = dailySweep('Trace span', () => deleteExpiredSpans())

export const RetentionLive = Layer.mergeAll(queryRetention, traceRetention)
