import type { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  getTestDatabase,
  resetTestDatabase,
  setupApiMocks
} from '@/test/api-test-helper'

setupApiMocks()

import { createApp } from '@/api'
import { spansTable } from '@/database/schema'
import { generateSpanId, generateTraceId } from '@/glue/tracing/ids'
import { SpanRecord } from '@/glue/tracing/spans'
import { writeSpans } from './span-writer'

const authorization = { Authorization: 'Bearer secret-token' }
const jsonHeaders = { ...authorization, 'Content-Type': 'application/json' }

function buildSpan(overrides: Partial<SpanRecord> = {}): SpanRecord {
  return {
    attributes: {},
    durationMs: 10,
    events: [],
    id: generateSpanId(),
    kind: 'internal',
    name: 'test.span',
    parentSpanId: null,
    serviceName: 'main',
    startedAt: 1700000000000,
    status: 'ok',
    statusMessage: null,
    traceId: generateTraceId(),
    ...overrides
  }
}

describe('POST /traces/spans', () => {
  let app: Hono

  beforeEach(async () => {
    await resetTestDatabase()

    app = createApp({ enableLogging: false, token: 'secret-token' })
  })

  it('stores a batch of spans', async () => {
    const spans = [buildSpan(), buildSpan()]

    const response = await app.request('/traces/spans', {
      body: JSON.stringify({ spans }),
      headers: jsonHeaders,
      method: 'POST'
    })

    expect(response.status).toEqual(200)
    expect(await response.json()).toEqual({ insertedCount: 2 })

    const database = getTestDatabase()
    const rows = await database.select().from(spansTable)

    expect(rows.length).toEqual(2)
  })

  it('ignores spans that were already ingested', async () => {
    const span = buildSpan()

    await app.request('/traces/spans', {
      body: JSON.stringify({ spans: [span] }),
      headers: jsonHeaders,
      method: 'POST'
    })

    const response = await app.request('/traces/spans', {
      body: JSON.stringify({ spans: [span] }),
      headers: jsonHeaders,
      method: 'POST'
    })

    expect(await response.json()).toEqual({ insertedCount: 0 })
  })

  it('rejects malformed spans', async () => {
    const response = await app.request('/traces/spans', {
      body: JSON.stringify({ spans: [{ ...buildSpan(), id: 'not-hex' }] }),
      headers: jsonHeaders,
      method: 'POST'
    })

    expect(response.status).toEqual(400)
  })

  it('rejects oversized batches', async () => {
    const spans = Array.from({ length: 201 }, () => buildSpan())

    const response = await app.request('/traces/spans', {
      body: JSON.stringify({ spans }),
      headers: jsonHeaders,
      method: 'POST'
    })

    expect(response.status).toEqual(400)
  })
})

describe('GET /traces', () => {
  let app: Hono

  beforeEach(async () => {
    await resetTestDatabase()

    app = createApp({ enableLogging: false, token: 'secret-token' })
  })

  it('aggregates spans into trace summaries', async () => {
    const traceId = generateTraceId()
    const root = buildSpan({
      durationMs: 5,
      name: 'query.run',
      serviceName: 'renderer',
      startedAt: 1000,
      traceId
    })

    await writeSpans([
      root,
      buildSpan({
        durationMs: 100,
        parentSpanId: root.id,
        startedAt: 1050,
        traceId
      })
    ])

    const response = await app.request('/traces', { headers: authorization })

    expect(response.status).toEqual(200)
    expect(await response.json()).toEqual({
      traces: [
        {
          durationMs: 150,
          errorMessage: null,
          hasError: false,
          name: 'query.run',
          serviceName: 'renderer',
          spanCount: 2,
          startedAt: 1000,
          traceId
        }
      ]
    })
  })

  it('exposes the first error message of a trace', async () => {
    const traceId = generateTraceId()

    await writeSpans([
      buildSpan({ startedAt: 1000, traceId }),
      buildSpan({
        parentSpanId: generateSpanId(),
        startedAt: 1050,
        status: 'error',
        statusMessage: 'relation "nope" does not exist',
        traceId
      }),
      buildSpan({
        parentSpanId: generateSpanId(),
        startedAt: 1100,
        status: 'error',
        statusMessage: 'a later failure',
        traceId
      })
    ])

    const response = await app.request('/traces', { headers: authorization })
    const { traces } = (await response.json()) as {
      traces: { errorMessage: string | null }[]
    }

    expect(traces[0]?.errorMessage).toEqual('relation "nope" does not exist')
  })

  it('falls back to the earliest span when a trace has no root', async () => {
    const traceId = generateTraceId()

    await writeSpans([
      buildSpan({
        name: 'later.child',
        parentSpanId: generateSpanId(),
        startedAt: 2000,
        traceId
      }),
      buildSpan({
        name: 'earliest.child',
        parentSpanId: generateSpanId(),
        startedAt: 1000,
        traceId
      })
    ])

    const response = await app.request('/traces', { headers: authorization })
    const { traces } = (await response.json()) as {
      traces: { name: string }[]
    }

    expect(traces[0]?.name).toEqual('earliest.child')
  })

  it('marks traces containing an error span', async () => {
    const traceId = generateTraceId()

    await writeSpans([
      buildSpan({ startedAt: 1000, traceId }),
      buildSpan({ parentSpanId: generateSpanId(), status: 'error', traceId })
    ])

    const response = await app.request('/traces', { headers: authorization })
    const { traces } = (await response.json()) as {
      traces: { hasError: boolean }[]
    }

    expect(traces[0]?.hasError).toEqual(true)
  })

  it('filters to traces with errors', async () => {
    await writeSpans([
      buildSpan({ name: 'healthy', startedAt: 2000 }),
      buildSpan({ name: 'broken', startedAt: 1000, status: 'error' })
    ])

    const response = await app.request('/traces?errorOnly=true', {
      headers: authorization
    })
    const { traces } = (await response.json()) as {
      traces: { name: string }[]
    }

    expect(traces.map((trace) => trace.name)).toEqual(['broken'])
  })

  it('filters by name search', async () => {
    await writeSpans([
      buildSpan({ name: 'query.run', startedAt: 2000 }),
      buildSpan({ name: 'GET /databases', startedAt: 1000 })
    ])

    const response = await app.request('/traces?search=Query', {
      headers: authorization
    })
    const { traces } = (await response.json()) as {
      traces: { name: string }[]
    }

    expect(traces.map((trace) => trace.name)).toEqual(['query.run'])
  })

  it('orders newest first and paginates with before', async () => {
    await writeSpans([
      buildSpan({ name: 'first', startedAt: 1000 }),
      buildSpan({ name: 'second', startedAt: 2000 }),
      buildSpan({ name: 'third', startedAt: 3000 })
    ])

    const firstPage = await app.request('/traces?limit=1', {
      headers: authorization
    })
    const firstTraces = (await firstPage.json()) as {
      traces: { name: string }[]
    }

    expect(firstTraces.traces.map((trace) => trace.name)).toEqual(['third'])

    const secondPage = await app.request('/traces?before=3000', {
      headers: authorization
    })
    const secondTraces = (await secondPage.json()) as {
      traces: { name: string }[]
    }

    expect(secondTraces.traces.map((trace) => trace.name)).toEqual([
      'second',
      'first'
    ])
  })

  it('rejects invalid query parameters', async () => {
    const response = await app.request('/traces?limit=nope', {
      headers: authorization
    })

    expect(response.status).toEqual(400)
  })
})

describe('GET /traces/:traceId', () => {
  let app: Hono

  beforeEach(async () => {
    await resetTestDatabase()

    app = createApp({ enableLogging: false, token: 'secret-token' })
  })

  it('returns the spans of a trace ordered by start time', async () => {
    const traceId = generateTraceId()
    const first = buildSpan({
      attributes: { 'http.method': 'POST' },
      startedAt: 1000,
      traceId
    })
    const second = buildSpan({
      events: [{ name: 'query.finished', time: 2500 }],
      parentSpanId: first.id,
      startedAt: 2000,
      traceId
    })

    await writeSpans([second, first])

    const response = await app.request(`/traces/${traceId}`, {
      headers: authorization
    })

    expect(response.status).toEqual(200)
    expect(await response.json()).toEqual({
      spans: [first, second]
    })
  })

  it('survives rows with corrupted JSON columns', async () => {
    const database = getTestDatabase()
    const traceId = generateTraceId()

    await database.insert(spansTable).values({
      attributes: 'not-json',
      durationMs: 1,
      events: 'not-json',
      id: generateSpanId(),
      kind: 'internal',
      name: 'corrupt',
      serviceName: 'main',
      startedAt: 1000,
      status: 'ok',
      traceId
    })

    const response = await app.request(`/traces/${traceId}`, {
      headers: authorization
    })
    const { spans } = (await response.json()) as {
      spans: { attributes: unknown; events: unknown }[]
    }

    expect(response.status).toEqual(200)
    expect(spans[0]?.attributes).toEqual({})
    expect(spans[0]?.events).toEqual([])
  })
})

describe('trace read auth bypass', () => {
  beforeEach(async () => {
    await resetTestDatabase()
  })

  it('allows tokenless trace reads when publicTraceReads is on', async () => {
    const app = createApp({
      enableLogging: false,
      publicTraceReads: true,
      token: 'secret-token'
    })

    const list = await app.request('/traces')
    const detail = await app.request(`/traces/${generateTraceId()}`)

    expect(list.status).toEqual(200)
    expect(detail.status).toEqual(200)
  })

  it('still requires a token for span ingest', async () => {
    const app = createApp({
      enableLogging: false,
      publicTraceReads: true,
      token: 'secret-token'
    })

    const response = await app.request('/traces/spans', {
      body: JSON.stringify({ spans: [] }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    })

    expect(response.status).toEqual(401)
  })

  it('still requires a token for other routes', async () => {
    const app = createApp({
      enableLogging: false,
      publicTraceReads: true,
      token: 'secret-token'
    })

    const response = await app.request('/databases')

    expect(response.status).toEqual(401)
  })

  it('requires a token for trace reads by default', async () => {
    const app = createApp({ enableLogging: false, token: 'secret-token' })

    const response = await app.request('/traces')

    expect(response.status).toEqual(401)
  })
})
