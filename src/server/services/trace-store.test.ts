import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { SpanRecord } from '@/glue/tracing/spans'
import { makeTestAppDatabase } from '@/test/effect-test-helper'
import { AppDatabase } from './app-database'
import { TraceStore } from './trace-store'

const traceId = 'a'.repeat(32)

function makeSpan(overrides: Partial<SpanRecord> = {}): SpanRecord {
  return {
    attributes: { 'query.id': 'q1' },
    durationMs: 5,
    events: [],
    id: '1'.repeat(16),
    kind: 'server',
    name: 'POST /queries',
    parentSpanId: null,
    serviceName: 'main',
    startedAt: 1_000,
    status: 'ok',
    statusMessage: null,
    traceId,
    ...overrides
  }
}

function run<A, E>(
  effect: Effect.Effect<A, E, AppDatabase | TraceStore>
): Promise<A> {
  const layer = TraceStore.DefaultWithoutDependencies.pipe(
    Layer.provideMerge(makeTestAppDatabase())
  )

  return Effect.runPromise(Effect.provide(effect, layer))
}

describe('TraceStore', () => {
  it('deduplicates re-ingested spans by span id', async () => {
    const counts = await run(
      Effect.gen(function* () {
        const store = yield* TraceStore

        const first = yield* store.ingestSpans([makeSpan()])
        const second = yield* store.ingestSpans([makeSpan()])

        return { first, second }
      })
    )

    expect(counts).toEqual({ first: 1, second: 0 })
  })

  it('returns a trace ordered by start time with parsed attributes', async () => {
    const spans = await run(
      Effect.gen(function* () {
        const store = yield* TraceStore

        yield* store.ingestSpans([
          makeSpan({
            id: '2'.repeat(16),
            name: 'query.execute',
            parentSpanId: '1'.repeat(16),
            startedAt: 1_010
          }),
          makeSpan()
        ])

        return yield* store.getTrace(traceId)
      })
    )

    expect(spans.map((span) => span.name)).toEqual([
      'POST /queries',
      'query.execute'
    ])
    expect(spans[0].attributes).toEqual({ 'query.id': 'q1' })
  })

  it('aggregates trace summaries with error information', async () => {
    const traces = await run(
      Effect.gen(function* () {
        const store = yield* TraceStore

        yield* store.ingestSpans([
          makeSpan(),
          makeSpan({
            durationMs: 20,
            id: '2'.repeat(16),
            name: 'query.execute',
            parentSpanId: '1'.repeat(16),
            startedAt: 1_010,
            status: 'error',
            statusMessage: 'relation "missing" does not exist'
          })
        ])

        return yield* store.listTraces({
          errorOnly: false,
          limit: 50
        })
      })
    )

    expect(traces).toEqual([
      {
        durationMs: 30,
        errorMessage: 'relation "missing" does not exist',
        hasError: true,
        name: 'POST /queries',
        serviceName: 'main',
        spanCount: 2,
        startedAt: 1_000,
        traceId
      }
    ])
  })

  it('filters to error traces only', async () => {
    const traces = await run(
      Effect.gen(function* () {
        const store = yield* TraceStore

        yield* store.ingestSpans([
          makeSpan(),
          makeSpan({
            id: '2'.repeat(16),
            name: 'GET /databases',
            startedAt: 2_000,
            status: 'error',
            statusMessage: 'boom',
            traceId: 'b'.repeat(32)
          })
        ])

        return yield* store.listTraces({ errorOnly: true, limit: 50 })
      })
    )

    expect(traces.map((trace) => trace.traceId)).toEqual(['b'.repeat(32)])
  })
})
