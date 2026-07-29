import { HttpClient, HttpClientRequest } from '@effect/platform'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import type { SpanDto } from '@/glue/api/schemas'
import { makeAuthorizedClient, makeTestApi } from '@/test/effect-test-helper'

const traceId = 'a'.repeat(32)

function makeSpan(overrides: Partial<SpanDto> = {}): SpanDto {
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
  effect: Effect.Effect<A, E, HttpClient.HttpClient>
): Promise<A> {
  const { layer } = makeTestApi({ publicTraceReads: true })

  return Effect.runPromise(Effect.provide(effect, layer))
}

describe('trace routes', () => {
  it('ingests spans and lists the aggregated trace without auth in dev', async () => {
    const { ingest, listBody } = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient
        const http = yield* HttpClient.HttpClient

        const ingest = yield* client.traces.ingest({
          payload: { spans: [makeSpan()] }
        })

        // The dev curl path: an unauthenticated read.
        const listResponse = yield* http
          .execute(HttpClientRequest.get('/traces?limit=5'))
          .pipe(Effect.scoped)
        const listBody = yield* listResponse.json

        return { ingest, listBody }
      })
    )

    expect(ingest).toEqual({ insertedCount: 1 })
    expect(listBody).toEqual({
      traces: [
        {
          durationMs: 5,
          errorMessage: null,
          hasError: false,
          name: 'POST /queries',
          serviceName: 'main',
          spanCount: 1,
          startedAt: 1_000,
          traceId
        }
      ]
    })
  })

  it('returns the span tree for a trace', async () => {
    const response = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        yield* client.traces.ingest({
          payload: {
            spans: [
              makeSpan(),
              makeSpan({
                id: '2'.repeat(16),
                name: 'query.execute',
                parentSpanId: '1'.repeat(16),
                startedAt: 1_010
              })
            ]
          }
        })

        return yield* client.traces.get({ path: { traceId } })
      })
    )

    expect(response.spans.map((span) => span.name)).toEqual([
      'POST /queries',
      'query.execute'
    ])
  })

  it('filters to error traces with errorOnly', async () => {
    const response = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        yield* client.traces.ingest({
          payload: {
            spans: [
              makeSpan(),
              makeSpan({
                id: '2'.repeat(16),
                name: 'GET /databases',
                startedAt: 2_000,
                status: 'error',
                statusMessage: 'boom',
                traceId: 'b'.repeat(32)
              })
            ]
          }
        })

        return yield* client.traces.list({
          urlParams: { errorOnly: true, limit: 50 }
        })
      })
    )

    expect(response.traces.map((trace) => trace.traceId)).toEqual([
      'b'.repeat(32)
    ])
  })
})
