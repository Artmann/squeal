import { HttpClient, HttpClientRequest } from '@effect/platform'
import { Effect, Layer } from 'effect'
import invariant from 'tiny-invariant'
import { describe, expect, it } from 'vitest'

import { SpanRecord } from '@/glue/tracing/spans'
import { makeSquealTracer } from '@/server/tracing/effect-tracer'
import { makeTestApi, testApiToken } from '@/test/effect-test-helper'

const inboundTraceId = '4bf92f3577b34da6a3ce929d0e0e4736'
const inboundSpanId = '00f067aa0ba902b7'

interface Handled {
  spans: SpanRecord[]
  status: number
}

/** One request, and every span the server finished while handling it. */
async function handleRequest(
  headers: Record<string, string>
): Promise<Handled> {
  const spans: SpanRecord[] = []

  // The production tracer, not a stand-in. What happens to an inbound parent
  // is decided in `SquealSpan`'s constructor, so a collector that skipped it
  // would not be measuring the thing under test.
  const tracer = makeSquealTracer({
    persist: (records) => {
      spans.push(...records)

      return Promise.resolve(records.length)
    }
  })

  const { layer } = makeTestApi()

  const status = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient.pipe(
        // Without this the client opens a span of its own around the request.
        // That span would land in the collection below — where it is neither
        // the server's work nor part of the server's trace — and the server
        // would inherit it as its parent, so the test would be measuring
        // itself. `src/app/api-client.ts` switches the same thing off in
        // production for the same reason.
        Effect.map(HttpClient.withTracerDisabledWhen(() => true))
      )

      const response = yield* client.execute(
        HttpClientRequest.get('/databases').pipe(
          HttpClientRequest.setHeaders({
            authorization: `Bearer ${testApiToken}`,
            ...headers
          })
        )
      )

      return response.status
    }).pipe(
      Effect.scoped,
      Effect.provide(layer),
      Effect.provide(Layer.setTracer(tracer))
    )
  )

  return { spans, status }
}

function describeSpans(handled: Handled): string {
  return handled.spans.map((span) => span.name).join(', ')
}

function serverSpanOf(handled: Handled): SpanRecord {
  const span = handled.spans.find((candidate) => candidate.kind === 'server')

  invariant(
    span,
    `The server wrote no request span, so there is nothing to assert about its parent. It wrote: ${describeSpans(handled)}`
  )

  return span
}

// Who reads an inbound `traceparent` is a question this repository answered
// twice. `@effect/platform` reads it in its own HTTP middleware —
// `HttpTraceContext.fromHeaders`, which also falls through to the `b3` and
// `x-b3-*` headers — and hands the result to the request span as its parent.
// `src/glue/tracing/traceparent.ts` had a second parser that nothing called.
//
// Nothing here asserts that the duplicate is gone; a deleted function needs no
// test. What was missing is coverage of the behaviour the deletion leans on, so
// that removing the spare parser is a provable non-event rather than a `tsc`
// pass. Every assertion below fails identically before and after the deletion —
// which is the point.
//
// The division these pin down is that the platform decides which header to
// believe, and `isValidTraceId` / `isValidSpanId` — reached from `SquealSpan`'s
// constructor — decide whether the ids in it are usable at all. Both halves are
// load-bearing and the second is this repository's own code, so both are
// covered. Measured against `@effect/platform` 0.97.0.
describe('inbound traceparent', () => {
  it('continues the trace the caller names', async () => {
    const handled = await handleRequest({
      traceparent: `00-${inboundTraceId}-${inboundSpanId}-01`
    })

    const { parentSpanId, traceId } = serverSpanOf(handled)

    expect({ parentSpanId, status: handled.status, traceId }).toEqual({
      parentSpanId: inboundSpanId,
      status: 200,
      traceId: inboundTraceId
    })
  })

  // The request span is one span of several. A caller that stitched only that
  // one into the caller's trace, and left the work underneath it in a trace of
  // its own, would satisfy the assertion above and still produce a waterfall
  // with nothing in it.
  //
  // By parentage rather than by counting spans, because how many spans a
  // request produces is a property of how the services happen to be
  // instrumented — CLAUDE.md prescribes an unnamed `Effect.fn` for methods on
  // untraced paths, so that count is something someone may legitimately change.
  it('puts the work it does under that same trace', async () => {
    const handled = await handleRequest({
      traceparent: `00-${inboundTraceId}-${inboundSpanId}-01`
    })

    const requestSpan = serverSpanOf(handled)
    const child = handled.spans.find(
      (candidate) => candidate.parentSpanId === requestSpan.id
    )

    invariant(
      child,
      `Nothing ran under the request span, so there is no way to tell whether the work it did joined the caller's trace. The server wrote: ${describeSpans(handled)}`
    )

    expect(child.traceId).toEqual(inboundTraceId)
  })

  // A header nobody can read is not a reason to fail a request, and it is not a
  // reason to write a span into a trace id the dashboard cannot open either.
  // This one is rejected by the platform's arity check — a traceparent has four
  // dash-separated fields and this has three — rather than by its hex patterns.
  it('starts a fresh trace when the header is not a traceparent', async () => {
    const handled = await handleRequest({ traceparent: 'not-a-traceparent' })

    const { parentSpanId, traceId } = serverSpanOf(handled)

    expect({ parentSpanId, status: handled.status }).toEqual({
      parentSpanId: null,
      status: 200
    })
    expect(traceId).toMatch(/^[0-9a-f]{32}$/)
  })

  // The cases the platform accepts and the validators then reject, which is why
  // the validators are the half of this that had to survive the deletion.
  //
  // All-zero ids are 32 and 16 hex characters, so the platform's patterns pass
  // them and produce an external span the W3C spec calls invalid. Uppercase hex
  // is the same story for a different reason: those patterns carry the `i` flag,
  // so they are more permissive than the spec — and more permissive than the
  // parser this commit deletes, which was case-sensitive and had a test saying
  // so. That case is preserved here rather than lost with it.
  //
  // Without the validators either one becomes a trace the dashboard lists and
  // `GET /traces/:id` then refuses to open. `effect-tracer.test.ts` already
  // covers an all-zero parent, but it builds the parent with
  // `Tracer.externalSpan` by hand, and so cannot say whether a header produces
  // one. Anyone deleting "the dead traceparent module" wholesale takes both
  // validators with it and that unit test keeps passing — it never reaches this
  // code path.
  //
  // Both halves of the all-zero case separately, because `Option.filter` needs
  // both to hold: zeroing only the span id leaves the trace id valid, and
  // nothing else in the suite fails when `isValidSpanId` stops rejecting zeros.
  it.each([
    { part: 'trace', traceparent: `00-${'0'.repeat(32)}-${inboundSpanId}-01` },
    { part: 'span', traceparent: `00-${inboundTraceId}-${'0'.repeat(16)}-01` },
    {
      part: 'uppercase trace',
      traceparent: `00-${inboundTraceId.toUpperCase()}-${inboundSpanId}-01`
    }
  ])(
    'starts a fresh trace when the $part id is unusable',
    async ({ traceparent }) => {
      const handled = await handleRequest({ traceparent })

      const { parentSpanId, traceId } = serverSpanOf(handled)

      expect({ parentSpanId, status: handled.status }).toEqual({
        parentSpanId: null,
        status: 200
      })
      expect(traceId).toMatch(/^[0-9a-f]{32}$/)
      expect([
        inboundTraceId,
        inboundTraceId.toUpperCase(),
        '0'.repeat(32)
      ]).not.toContain(traceId)
    }
  )
})

// `fromHeaders` falls through to `b3` when there is no `traceparent`, and `b3`
// validates nothing at all — it splits on dashes and passes both fields
// straight through. That is why `isValidTraceId` and `isValidSpanId` are a
// separate check rather than something folded into a parser: on this path there
// is no parser to fold them into.
describe('inbound b3', () => {
  it('continues the trace the caller names', async () => {
    const handled = await handleRequest({
      b3: `${inboundTraceId}-${inboundSpanId}-1`
    })

    const { parentSpanId, traceId } = serverSpanOf(handled)

    expect({ parentSpanId, status: handled.status, traceId }).toEqual({
      parentSpanId: inboundSpanId,
      status: 200,
      traceId: inboundTraceId
    })
  })

  it('starts a fresh trace when b3 carries ids nothing could look up', async () => {
    const handled = await handleRequest({ b3: 'nonsense-ids' })

    const { parentSpanId, traceId } = serverSpanOf(handled)

    expect({ parentSpanId, status: handled.status }).toEqual({
      parentSpanId: null,
      status: 200
    })
    expect(traceId).toMatch(/^[0-9a-f]{32}$/)
  })
})
