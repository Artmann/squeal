import {
  Cause,
  Context,
  Effect,
  Exit,
  FiberId,
  Layer,
  Option,
  Tracer
} from 'effect'
import { describe, expect, it } from 'vitest'

import { spansTable } from '@/database/schema'
import { SpanRecord } from '@/glue/tracing/spans'
import { AppDatabase } from '@/server/services/app-database'
import { makeTestAppDatabase } from '@/test/effect-test-helper'

import { makeSquealTracer, TracerLive } from './effect-tracer'

const startNanos = 1_700_000_000_000_000_000n
const endNanos = startNanos + 25_000_000n

function makeCollector() {
  const written: SpanRecord[] = []
  const tracer = makeSquealTracer({
    persist: (records) => {
      written.push(...records)

      return Promise.resolve(records.length)
    }
  })

  return { tracer, written }
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
