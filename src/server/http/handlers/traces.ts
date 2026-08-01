import { HttpApiBuilder } from '@effect/platform'
import { Effect } from 'effect'

import { SquealApi } from '@/glue/api/api'
import { SpanRecord } from '@/glue/tracing/spans'
import { TraceStore } from '@/server/services/trace-store'
import { orDieInternal } from '../internal-errors'

export const TracesLive = HttpApiBuilder.group(
  SquealApi,
  'traces',
  (handlers) =>
    handlers
      .handle('list', ({ urlParams }) =>
        Effect.gen(function* () {
          const store = yield* TraceStore

          const traces = yield* store.listTraces(urlParams)

          return { traces }
        }).pipe(orDieInternal)
      )
      .handle('get', ({ path }) =>
        Effect.gen(function* () {
          const store = yield* TraceStore

          const spans = yield* store.getTrace(path.traceId)

          return { spans }
        }).pipe(orDieInternal)
      )
      .handle('ingest', ({ payload }) =>
        Effect.gen(function* () {
          const store = yield* TraceStore

          const spans: SpanRecord[] = payload.spans.map((span) => ({
            ...span,
            events: span.events.map((event) => ({ ...event }))
          }))

          const insertedCount = yield* store.ingestSpans(spans)

          return { insertedCount }
        }).pipe(orDieInternal)
      )
)
