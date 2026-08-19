import {
  Cause,
  Chunk,
  Context,
  Effect,
  Exit,
  FiberId,
  Layer,
  Option,
  Queue,
  Tracer
} from 'effect'
import { log } from 'tiny-typescript-logger'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { spansTable } from '@/database/schema'
import { SpanRecord } from '@/glue/tracing/spans'
import { AppDatabase } from '@/server/services/app-database'
import { makeTestAppDatabase } from '@/test/effect-test-helper'

// Counts the writes without replacing them: how many INSERTs a burst of spans
// turns into is the thing under test, and the rows still have to land for the
// flush test below.
const { writeSpansSpy } = vi.hoisted(() => ({
  writeSpansSpy: vi.fn<(records: unknown[]) => void>()
}))

vi.mock('@/main/tracing/span-writer', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/main/tracing/span-writer')>()

  return {
    ...actual,
    writeSpans: (...args: Parameters<typeof actual.writeSpans>) => {
      writeSpansSpy(args[0])

      return actual.writeSpans(...args)
    }
  }
})

import { makeQueuedEmit, makeSquealTracer, TracerLive } from './effect-tracer'

const startNanos = 1_700_000_000_000_000_000n
const endNanos = startNanos + 25_000_000n

function makeCollector() {
  const written: SpanRecord[] = []
  const tracer = makeSquealTracer({
    emit: (record) => {
      written.push(record)
    }
  })

  return { tracer, written }
}

function makeRecord(name: string): SpanRecord {
  return {
    attributes: {},
    durationMs: 1,
    events: [],
    id: 'a'.repeat(16),
    kind: 'internal',
    name,
    parentSpanId: null,
    serviceName: 'main',
    startedAt: 1_700_000_000_000,
    status: 'ok',
    statusMessage: null,
    traceId: 'b'.repeat(32)
  }
}

function startSpan(
  tracer: Tracer.Tracer,
  options: {
    kind?: Tracer.SpanKind
    name?: string
    parent?: Option.Option<Tracer.AnySpan>
  } = {}
) {
  return tracer.span(
    options.name ?? 'test.span',
    options.parent ?? Option.none(),
    Context.empty(),
    [],
    startNanos,
    options.kind ?? 'internal'
  )
}

describe('makeSquealTracer', () => {
  it('writes a successful span as a full record with W3C ids', () => {
    const { tracer, written } = makeCollector()
    const span = startSpan(tracer)

    span.end(endNanos, Exit.succeed(undefined))

    expect(written).toEqual([
      {
        attributes: {},
        durationMs: 25,
        events: [],
        id: expect.stringMatching(/^[0-9a-f]{16}$/),
        kind: 'internal',
        name: 'test.span',
        parentSpanId: null,
        serviceName: 'main',
        startedAt: 1_700_000_000_000,
        status: 'ok',
        statusMessage: null,
        traceId: expect.stringMatching(/^[0-9a-f]{32}$/)
      }
    ])
  })

  it('records a failure as an exception event with status error', () => {
    const { tracer, written } = makeCollector()
    const span = startSpan(tracer)
    const failure = new Error('Connection refused.')

    span.end(endNanos, Exit.fail(failure))

    expect(written[0].status).toEqual('error')
    expect(written[0].statusMessage).toEqual('Connection refused.')
    expect(written[0].events).toEqual([
      {
        attributes: {
          'exception.message': 'Connection refused.',
          'exception.stacktrace': expect.stringContaining('Error'),
          'exception.type': 'Error'
        },
        name: 'exception',
        time: 1_700_000_000_025
      }
    ])
  })

  it('records interruption without an exception event', () => {
    const { tracer, written } = makeCollector()
    const span = startSpan(tracer)

    span.end(endNanos, Exit.failCause(Cause.interrupt(FiberId.none)))

    expect(written[0].status).toEqual('error')
    expect(written[0].statusMessage).toEqual('Interrupted')
    expect(written[0].events).toEqual([])
  })

  it('renames server spans to their method and route pattern', () => {
    const { tracer, written } = makeCollector()
    const span = startSpan(tracer, {
      kind: 'server',
      name: 'http.server POST'
    })

    span.attribute('http.request.method', 'POST')
    span.attribute('http.route', '/queries')
    span.end(endNanos, Exit.succeed(undefined))

    expect(written[0].name).toEqual('POST /queries')
  })

  it('keeps the generic name when no route was matched', () => {
    const { tracer, written } = makeCollector()
    const span = startSpan(tracer, {
      kind: 'server',
      name: 'http.server GET'
    })

    span.attribute('http.request.method', 'GET')
    span.end(endNanos, Exit.succeed(undefined))

    expect(written[0].name).toEqual('http.server GET')
  })

  it('inherits trace id and parent span id from an external span', () => {
    const { tracer, written } = makeCollector()
    const external = Tracer.externalSpan({
      spanId: 'aaaaaaaaaaaaaaaa',
      traceId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    })
    const span = startSpan(tracer, { parent: Option.some(external) })

    span.end(endNanos, Exit.succeed(undefined))

    expect(written[0].parentSpanId).toEqual('aaaaaaaaaaaaaaaa')
    expect(written[0].traceId).toEqual('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
  })

  // The platform's b3 fallback does not validate inbound ids at all, and an id
  // the TraceId schema rejects would produce a trace the dashboard lists but
  // cannot open.
  it('ignores a parent whose trace id is not a usable W3C id', () => {
    const { tracer, written } = makeCollector()
    const external = Tracer.externalSpan({
      spanId: 'aaaaaaaaaaaaaaaa',
      traceId: 'junk'
    })
    const span = startSpan(tracer, { parent: Option.some(external) })

    span.end(endNanos, Exit.succeed(undefined))

    expect(written[0].parentSpanId).toEqual(null)
    expect(written[0].traceId).toEqual(expect.stringMatching(/^[0-9a-f]{32}$/))
    expect(written[0].traceId).not.toEqual('junk')
  })

  it('ignores an all-zero parent so those spans do not merge into one trace', () => {
    const { tracer, written } = makeCollector()
    const external = Tracer.externalSpan({
      spanId: '0000000000000000',
      traceId: '00000000000000000000000000000000'
    })
    const span = startSpan(tracer, { parent: Option.some(external) })

    span.end(endNanos, Exit.succeed(undefined))

    expect(written[0].parentSpanId).toEqual(null)
    expect(written[0].traceId).not.toEqual('00000000000000000000000000000000')
  })

  it('coerces and truncates attribute values', () => {
    const { tracer, written } = makeCollector()
    const span = startSpan(tracer)

    span.attribute('bool', true)
    span.attribute('count', 3)
    span.attribute('object', { nested: true })
    span.attribute('long', 'x'.repeat(3000))
    span.end(endNanos, Exit.succeed(undefined))

    const attributes = written[0].attributes

    expect(attributes.bool).toEqual(true)
    expect(attributes.count).toEqual(3)
    expect(attributes.object).toEqual('[object Object]')
    expect(String(attributes.long)).toHaveLength(2000)
  })

  it('maps producer and consumer kinds to internal', () => {
    const { tracer, written } = makeCollector()
    const span = startSpan(tracer, { kind: 'producer' })

    span.end(endNanos, Exit.succeed(undefined))

    expect(written[0].kind).toEqual('internal')
  })

  it('converts event times to milliseconds', () => {
    const { tracer, written } = makeCollector()
    const span = startSpan(tracer)

    span.event('query.canceled', startNanos + 10_000_000n, { reason: 'user' })
    span.end(endNanos, Exit.succeed(undefined))

    expect(written[0].events).toEqual([
      {
        attributes: { reason: 'user' },
        name: 'query.canceled',
        time: 1_700_000_000_010
      }
    ])
  })

  it('ignores a second end call', () => {
    const { tracer, written } = makeCollector()
    const span = startSpan(tracer)

    span.end(endNanos, Exit.succeed(undefined))
    span.end(endNanos + 5_000_000n, Exit.fail(new Error('late')))

    expect(written).toHaveLength(1)
    expect(written[0].status).toEqual('ok')
  })

  it('persists spans created by Effect.withSpan with fiber parenting', async () => {
    const { tracer, written } = makeCollector()

    await Effect.runPromise(
      Effect.void.pipe(
        Effect.withSpan('child'),
        Effect.withSpan('parent'),
        Effect.provide(Layer.setTracer(tracer))
      )
    )

    expect(written.map((record) => record.name)).toEqual(['child', 'parent'])

    const child = written[0]
    const parent = written[1]

    expect(child.traceId).toEqual(parent.traceId)
    expect(child.parentSpanId).toEqual(parent.id)
  })
})

describe('TracerLive', () => {
  beforeEach(() => {
    writeSpansSpy.mockClear()
  })

  // The drain loop used to take a minimum of one span, which returns the instant
  // a span is available — so the batch of 100 it looks like it writes was really
  // one INSERT, one transaction and one fsync per span, on the main process's
  // event loop. Running a single query ends seven spans.
  it('writes spans that end within the linger window as one batch', async () => {
    await Effect.runPromise(
      Effect.forEach([1, 2, 3, 4], (index) =>
        // Spread out on purpose. Spans that all end in the same tick get batched
        // either way; the ones a real query produces end tens of milliseconds
        // apart, which is exactly when a minimum of one span per take turns into
        // a write per span.
        Effect.sleep('10 millis').pipe(Effect.withSpan(`burst.${index}`))
      )
        .pipe(
          // Outlasts the linger window, so the write under test is the batched
          // one from the drain fiber rather than the shutdown flush.
          Effect.andThen(Effect.sleep('400 millis')),
          Effect.provide(TracerLive)
        )
        .pipe(Effect.provide(makeTestAppDatabase()))
    )

    expect(
      writeSpansSpy.mock.calls.map((call) => (call[0] as unknown[]).length)
    ).toEqual([4])
  })

  // Spans are queued rather than written inline, so the shutdown flush is the
  // only thing that keeps the spans explaining a shutdown from being lost.
  it('flushes queued spans when its scope closes', async () => {
    const rows = await Effect.runPromise(
      Effect.gen(function* () {
        const appDatabase = yield* AppDatabase

        yield* Effect.void.pipe(
          Effect.withSpan('queued.child'),
          Effect.withSpan('queued.parent'),
          Effect.provide(TracerLive)
        )

        return yield* Effect.promise(() =>
          appDatabase.client.select().from(spansTable)
        )
      }).pipe(Effect.provide(makeTestAppDatabase()))
    )

    expect(rows.map((row) => row.name).sort()).toEqual([
      'queued.child',
      'queued.parent'
    ])
  })
})

// Offering never blocks, so a writer that has fallen behind has to be answered
// by dropping rather than by retaining — and the only record that the drop
// happened is the counter and its log line. Nothing else in the app can observe
// a span that was never written.
describe('makeQueuedEmit', () => {
  beforeEach(() => {
    vi.spyOn(log, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('offers each span to the queue in order', async () => {
    const queue = Effect.runSync(Queue.bounded<SpanRecord>(4))
    const emit = makeQueuedEmit(queue)

    emit(makeRecord('first'))
    emit(makeRecord('second'))

    const queued = await Effect.runPromise(Queue.takeAll(queue))

    // The silence is half the assertion. Counting a span that was accepted as
    // dropped shifts every later count by exactly one, which cancels against
    // the `% 100 === 1` offset and leaves the drop tests below green.
    expect({
      queued: Chunk.toReadonlyArray(queued).map((record) => record.name),
      warnings: vi.mocked(log.warn).mock.calls
    }).toEqual({ queued: ['first', 'second'], warnings: [] })
  })

  // The span that does not fit is the one dropped — the queue keeps what it
  // already accepted, so a burst loses its tail rather than its head.
  it('drops the span a full queue has no room for', async () => {
    const queue = Effect.runSync(Queue.bounded<SpanRecord>(1))
    const emit = makeQueuedEmit(queue)

    emit(makeRecord('kept'))
    emit(makeRecord('dropped'))

    const queued = await Effect.runPromise(Queue.takeAll(queue))

    expect({
      queued: Chunk.toReadonlyArray(queued).map((record) => record.name),
      warnings: vi.mocked(log.warn).mock.calls
    }).toEqual({
      queued: ['kept'],
      warnings: [['Span queue is full; dropped 1 span(s).']]
    })
  })

  // Dropping is what a full queue does, not a mode the sink latches into: the
  // moment the drain takes one off, the next span goes in.
  it('accepts spans again once the queue has room', async () => {
    const queue = Effect.runSync(Queue.bounded<SpanRecord>(1))
    const emit = makeQueuedEmit(queue)

    emit(makeRecord('kept'))
    emit(makeRecord('dropped'))

    await Effect.runPromise(Queue.take(queue))

    emit(makeRecord('kept again'))

    const queued = await Effect.runPromise(Queue.takeAll(queue))

    expect(Chunk.toReadonlyArray(queued).map((record) => record.name)).toEqual([
      'kept again'
    ])
  })

  // A writer far enough behind to drop is far enough behind to drop thousands,
  // and a line each would bury whatever is actually wrong. The first one still
  // has to appear immediately, or the first hundred losses are silent.
  it('logs the first drop and then only every hundredth', () => {
    const queue = Effect.runSync(Queue.bounded<SpanRecord>(1))
    const emit = makeQueuedEmit(queue)

    for (let index = 0; index < 202; index += 1) {
      emit(makeRecord(`span.${index}`))
    }

    expect(vi.mocked(log.warn).mock.calls).toEqual([
      ['Span queue is full; dropped 1 span(s).'],
      ['Span queue is full; dropped 101 span(s).'],
      ['Span queue is full; dropped 201 span(s).']
    ])
  })

  // Each tracer gets its own counter, so one instance's drops cannot silence
  // another's first warning.
  it('counts drops per sink rather than across all of them', () => {
    const first = makeQueuedEmit(Effect.runSync(Queue.bounded<SpanRecord>(1)))
    const second = makeQueuedEmit(Effect.runSync(Queue.bounded<SpanRecord>(1)))

    first(makeRecord('one'))
    first(makeRecord('one too many'))
    second(makeRecord('two'))
    second(makeRecord('two too many'))

    expect(vi.mocked(log.warn).mock.calls).toEqual([
      ['Span queue is full; dropped 1 span(s).'],
      ['Span queue is full; dropped 1 span(s).']
    ])
  })
})
