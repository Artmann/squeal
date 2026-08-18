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

  it('names a trace after its earliest span when none is parentless', async () => {
    const traces = await run(
      Effect.gen(function* () {
        const store = yield* TraceStore

        // A renderer trace mid-flight: the root is exported last, so every
        // span stored so far names a parent that is not here yet.
        yield* store.ingestSpans([
          makeSpan({
            id: '2'.repeat(16),
            name: 'query.execute',
            parentSpanId: '9'.repeat(16),
            serviceName: 'main',
            startedAt: 1_010
          }),
          makeSpan({
            name: 'HTTP POST /queries',
            parentSpanId: '9'.repeat(16),
            serviceName: 'renderer',
            startedAt: 1_000
          })
        ])

        return yield* store.listTraces({ errorOnly: false, limit: 50 })
      })
    )

    expect(traces).toEqual([
      {
        durationMs: 15,
        errorMessage: null,
        hasError: false,
        name: 'HTTP POST /queries',
        serviceName: 'renderer',
        spanCount: 2,
        startedAt: 1_000,
        traceId
      }
    ])
  })

  it('prefers a parentless span to a child that started earlier', async () => {
    const traces = await run(
      Effect.gen(function* () {
        const store = yield* TraceStore

        // The root is timed by the renderer's clock and its children by the
        // main process's, so a few milliseconds of skew is enough to file a
        // child ahead of the span that owns it.
        yield* store.ingestSpans([
          makeSpan({
            id: '2'.repeat(16),
            name: 'query.execute',
            parentSpanId: '9'.repeat(16),
            serviceName: 'main',
            startedAt: 1_000
          }),
          makeSpan({
            name: 'query.run',
            serviceName: 'renderer',
            startedAt: 1_010
          })
        ])

        return yield* store.listTraces({ errorOnly: false, limit: 50 })
      })
    )

    expect(traces).toEqual([
      {
        durationMs: 15,
        errorMessage: null,
        hasError: false,
        name: 'query.run',
        serviceName: 'renderer',
        spanCount: 2,
        startedAt: 1_000,
        traceId
      }
    ])
  })

  it('names a trace after the earliest of several parentless spans', async () => {
    const traces = await run(
      Effect.gen(function* () {
        const store = yield* TraceStore

        yield* store.ingestSpans([
          makeSpan({
            id: '2'.repeat(16),
            name: 'POST /queries',
            serviceName: 'main',
            startedAt: 1_005
          }),
          makeSpan({
            name: 'query.run',
            serviceName: 'renderer',
            startedAt: 1_000
          })
        ])

        return yield* store.listTraces({ errorOnly: false, limit: 50 })
      })
    )

    // Both fields have to come off the same span: the pairing is what makes a
    // summary readable, and nothing in `TraceSummaryDto` would show a name and
    // a service that came from different spans.
    expect(traces).toEqual([
      {
        durationMs: 10,
        errorMessage: null,
        hasError: false,
        name: 'query.run',
        serviceName: 'renderer',
        spanCount: 2,
        startedAt: 1_000,
        traceId
      }
    ])
  })

  it('reports a failed trace that carries no message', async () => {
    const traces = await run(
      Effect.gen(function* () {
        const store = yield* TraceStore

        yield* store.ingestSpans([
          makeSpan({ status: 'error', statusMessage: null })
        ])

        return yield* store.listTraces({ errorOnly: false, limit: 50 })
      })
    )

    expect(traces).toEqual([
      {
        durationMs: 5,
        errorMessage: null,
        hasError: true,
        name: 'POST /queries',
        serviceName: 'main',
        spanCount: 1,
        startedAt: 1_000,
        traceId
      }
    ])
  })

  it('skips a failure that carries no message to reach one that does', async () => {
    const traces = await run(
      Effect.gen(function* () {
        const store = yield* TraceStore

        // A failure propagates up the span tree, so the outer spans are marked
        // failed too and only the innermost one knows why.
        yield* store.ingestSpans([
          makeSpan({ status: 'error' }),
          makeSpan({
            id: '2'.repeat(16),
            name: 'query.execute',
            parentSpanId: '1'.repeat(16),
            startedAt: 1_005,
            status: 'error',
            statusMessage: 'relation "missing" does not exist'
          })
        ])

        return yield* store.listTraces({ errorOnly: false, limit: 50 })
      })
    )

    expect(traces.map((trace) => trace.errorMessage)).toEqual([
      'relation "missing" does not exist'
    ])
  })

  it('reports the first failure when several carry a message', async () => {
    const traces = await run(
      Effect.gen(function* () {
        const store = yield* TraceStore

        // The one the user needs is the original failure, not whatever the
        // layers above rephrased it as on the way out.
        yield* store.ingestSpans([
          makeSpan({
            id: '2'.repeat(16),
            name: 'query.execute',
            parentSpanId: '1'.repeat(16),
            startedAt: 1_005,
            status: 'error',
            statusMessage: 'The query failed.'
          }),
          makeSpan({
            status: 'error',
            statusMessage: 'relation "missing" does not exist'
          })
        ])

        return yield* store.listTraces({ errorOnly: false, limit: 50 })
      })
    )

    expect(traces.map((trace) => trace.errorMessage)).toEqual([
      'relation "missing" does not exist'
    ])
  })

  it('ignores a message left on a span that did not fail', async () => {
    const traces = await run(
      Effect.gen(function* () {
        const store = yield* TraceStore

        yield* store.ingestSpans([
          makeSpan({ statusMessage: 'Canceled by the user.' }),
          makeSpan({
            id: '2'.repeat(16),
            name: 'query.execute',
            parentSpanId: '1'.repeat(16),
            startedAt: 1_005,
            status: 'error',
            statusMessage: 'relation "missing" does not exist'
          })
        ])

        return yield* store.listTraces({ errorOnly: false, limit: 50 })
      })
    )

    expect(traces.map((trace) => trace.errorMessage)).toEqual([
      'relation "missing" does not exist'
    ])
  })

  it('matches a search term against the name whatever its case', async () => {
    const searches = await run(
      Effect.gen(function* () {
        const store = yield* TraceStore

        yield* store.ingestSpans([
          makeSpan(),
          makeSpan({
            id: '2'.repeat(16),
            name: 'GET /databases',
            startedAt: 2_000,
            traceId: 'b'.repeat(32)
          })
        ])

        // Both sides have to be folded: 'DATABASES' only matches once the term
        // is lowered, and 'get' only once the name is.
        return {
          loweredName: yield* store.listTraces({
            errorOnly: false,
            limit: 50,
            search: 'get'
          }),
          loweredTerm: yield* store.listTraces({
            errorOnly: false,
            limit: 50,
            search: 'DATABASES'
          })
        }
      })
    )

    expect({
      loweredName: searches.loweredName.map((trace) => trace.traceId),
      loweredTerm: searches.loweredTerm.map((trace) => trace.traceId)
    }).toEqual({
      loweredName: ['b'.repeat(32)],
      loweredTerm: ['b'.repeat(32)]
    })
  })

  it('searches the name the trace is listed under, not every span in it', async () => {
    const traces = await run(
      Effect.gen(function* () {
        const store = yield* TraceStore

        yield* store.ingestSpans([
          makeSpan({ name: 'query.run' }),
          makeSpan({
            id: '2'.repeat(16),
            name: 'db.query',
            parentSpanId: '1'.repeat(16),
            startedAt: 1_005
          })
        ])

        // Searching a child's name finds nothing: the list shows one name per
        // trace, and a row that matched on a name it never displays reads as a
        // bug in the filter.
        return yield* store.listTraces({
          errorOnly: false,
          limit: 50,
          search: 'db.query'
        })
      })
    )

    expect(traces).toEqual([])
  })

  it('filters on when the trace started, not when it ended', async () => {
    const traces = await run(
      Effect.gen(function* () {
        const store = yield* TraceStore

        yield* store.ingestSpans([
          makeSpan(),
          // A long trace: it starts before the cutoff and is still running
          // well after it.
          makeSpan({
            id: '2'.repeat(16),
            name: 'query.execute',
            parentSpanId: '1'.repeat(16),
            startedAt: 5_000
          }),
          makeSpan({
            id: '3'.repeat(16),
            name: 'GET /databases',
            startedAt: 3_000,
            traceId: 'b'.repeat(32)
          })
        ])

        return yield* store.listTraces({
          before: 2_000,
          errorOnly: false,
          limit: 50
        })
      })
    )

    expect(traces.map((trace) => trace.traceId)).toEqual([traceId])
  })

  it('lists the most recent trace first', async () => {
    const traces = await run(
      Effect.gen(function* () {
        const store = yield* TraceStore

        yield* store.ingestSpans([
          makeSpan({ startedAt: 2_000 }),
          makeSpan({
            id: '2'.repeat(16),
            startedAt: 1_000,
            traceId: 'b'.repeat(32)
          }),
          makeSpan({
            id: '3'.repeat(16),
            startedAt: 3_000,
            traceId: 'c'.repeat(32)
          })
        ])

        return yield* store.listTraces({ errorOnly: false, limit: 50 })
      })
    )

    expect(traces.map((trace) => trace.traceId)).toEqual([
      'c'.repeat(32),
      traceId,
      'b'.repeat(32)
    ])
  })

  it('returns no more traces than the limit', async () => {
    const traces = await run(
      Effect.gen(function* () {
        const store = yield* TraceStore

        yield* store.ingestSpans([
          makeSpan({ startedAt: 2_000 }),
          makeSpan({
            id: '2'.repeat(16),
            startedAt: 1_000,
            traceId: 'b'.repeat(32)
          }),
          makeSpan({
            id: '3'.repeat(16),
            startedAt: 3_000,
            traceId: 'c'.repeat(32)
          })
        ])

        return yield* store.listTraces({ errorOnly: false, limit: 2 })
      })
    )

    // The limit is applied after the ordering, so it keeps the newest.
    expect(traces.map((trace) => trace.traceId)).toEqual([
      'c'.repeat(32),
      traceId
    ])
  })
})
