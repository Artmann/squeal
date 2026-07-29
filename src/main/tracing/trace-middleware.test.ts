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

const authorization = { Authorization: 'Bearer secret-token' }

async function selectSpans() {
  const database = getTestDatabase()

  return database.select().from(spansTable)
}

describe('trace middleware', () => {
  let app: Hono

  beforeEach(async () => {
    await resetTestDatabase()

    app = createApp({ enableLogging: false, token: 'secret-token' })
  })

  it('creates a server span for an API request', async () => {
    const response = await app.request('/databases', {
      headers: authorization
    })

    expect(response.status).toEqual(200)

    const rows = await selectSpans()

    expect(rows).toEqual([
      expect.objectContaining({
        kind: 'server',
        name: 'GET /databases',
        parentSpanId: null,
        serviceName: 'main',
        status: 'ok'
      })
    ])

    const attributes = JSON.parse(rows[0]?.attributes ?? '{}') as Record<
      string,
      unknown
    >

    expect(attributes).toEqual({
      'http.method': 'GET',
      'http.route': '/databases',
      'http.status_code': 200,
      'http.target': '/databases',
      'request.id': expect.any(String)
    })
  })

  it('adopts an incoming traceparent as the parent context', async () => {
    const spanId = '00f067aa0ba902b7'
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'

    await app.request('/databases', {
      headers: {
        ...authorization,
        traceparent: `00-${traceId}-${spanId}-01`
      }
    })

    const [row] = await selectSpans()

    expect(row?.parentSpanId).toEqual(spanId)
    expect(row?.traceId).toEqual(traceId)
  })

  it('records thrown validation errors on the span', async () => {
    const response = await app.request('/queries', {
      body: JSON.stringify({}),
      headers: { ...authorization, 'Content-Type': 'application/json' },
      method: 'POST'
    })

    expect(response.status).toEqual(400)

    const [row] = await selectSpans()

    expect(row?.status).toEqual('error')
    expect(row?.statusMessage).toEqual('Validation error')

    const attributes = JSON.parse(row?.attributes ?? '{}') as Record<
      string,
      unknown
    >

    expect(attributes['http.status_code']).toEqual(400)

    const events = JSON.parse(row?.events ?? '[]') as {
      attributes?: Record<string, unknown>
      name: string
    }[]

    expect(events[0]?.name).toEqual('exception')
    expect(events[0]?.attributes?.['exception.type']).toEqual('ValidationError')
  })

  it('names unmatched routes after the raw path', async () => {
    const response = await app.request('/nonexistent', {
      headers: authorization
    })

    expect(response.status).toEqual(404)

    const [row] = await selectSpans()

    expect(row?.name).toEqual('GET /nonexistent')
  })

  it('does not trace health checks', async () => {
    await app.request('/health')

    expect(await selectSpans()).toEqual([])
  })

  it('does not trace unauthorized requests', async () => {
    const response = await app.request('/databases')

    expect(response.status).toEqual(401)
    expect(await selectSpans()).toEqual([])
  })

  it('does not trace trace API requests', async () => {
    await app.request('/traces', { headers: authorization })
    await app.request('/traces/spans', {
      body: JSON.stringify({ spans: [] }),
      headers: { ...authorization, 'Content-Type': 'application/json' },
      method: 'POST'
    })

    expect(await selectSpans()).toEqual([])
  })

  it('does not trace query result polling', async () => {
    await app.request('/queries/some-query-id', { headers: authorization })

    expect(await selectSpans()).toEqual([])
  })
})
