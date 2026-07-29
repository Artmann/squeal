// Retention sweeps as scoped fibers owned by the runtime scope: an immediate
// sweep at boot, then one per day, and clean interruption at shutdown —
// replacing the previous fire-and-forget setInterval calls whose handles
// were never retained.
import { Duration, Effect, Layer, Schedule } from 'effect'

import { deleteExpiredQueries } from '@/main/queries/query-retention'
import { deleteExpiredSpans } from '@/main/tracing/trace-retention'

function dailySweep(
  name: string,
  sweep: () => Promise<number>
): Layer.Layer<never> {
  return Layer.scopedDiscard(
    Effect.promise(sweep).pipe(
      // One failed sweep must not stop the schedule — log and try again
      // tomorrow.
      Effect.catchAllCause((cause) =>
        Effect.logError(`${name} cleanup failed`, cause)
      ),
      Effect.repeat(Schedule.fixed(Duration.days(1))),
      Effect.forkScoped
    )
  )
}

export const QueryRetentionLive = dailySweep(
  'Query history',
  () => deleteExpiredQueries()
)

export const TraceRetentionLive = dailySweep(
  'Trace span',
  () => deleteExpiredSpans()
)

export const RetentionLive = Layer.mergeAll(
  QueryRetentionLive,
  TraceRetentionLive
)
