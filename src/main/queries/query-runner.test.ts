import { sql } from 'drizzle-orm'
import type { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getTestDatabase,
  mockAdapterConfig,
  resetTestDatabase,
  setupApiMocks,
  testApiToken
} from '@/test/api-test-helper'

setupApiMocks()

import { createApp } from '@/api'
import { spansTable } from '@/database/schema'

const clientSpanId = '00f067aa0ba902b7'
const clientTraceId = '4bf92f3577b34da6a3ce929d0e0e4736'

const requestHeaders = {
  Authorization: `Bearer ${testApiToken}`,
  'Content-Type': 'application/json',
  traceparent: `00-${clientTraceId}-${clientSpanId}-01`
}

async function insertDatabaseRow(): Promise<string> {
  const database = getTestDatabase()
  const databaseId = crypto.randomUUID()

  await database.run(sql`
    INSERT INTO databases (id, name, type, connectionInfo, createdAt)
    VALUES (
      ${databaseId},
      'Trace DB',
      'postgres',
      ${JSON.stringify({
        database: 'tracedb',
        host: 'localhost',
        password: 'pass',
        port: 5432,
        username: 'user'
      })},
      ${Date.now()}
    )
  `)

  return databaseId
}

async function createQuery(app: Hono, databaseId: string): Promise<string> {
  const queryId = crypto.randomUUID()

  const response = await app.request('/queries', {
    body: JSON.stringify({
      content: 'SELECT 1',
      databaseId,
      id: queryId,
      queriedAt: Date.now(),
      worksheetId: crypto.randomUUID()
    }),
    headers: requestHeaders,
    method: 'POST'
  })

  expect(response.status).toEqual(200)

  return queryId
}

async function waitForSpans(count: number) {
  const database = getTestDatabase()

  return vi.waitFor(async () => {
    const rows = await database.select().from(spansTable)

    expect(rows.length).toEqual(count)

    return rows
  })
}

function parseAttributes(value: string | null): Record<string, unknown> {
  return JSON.parse(value ?? '{}') as Record<string, unknown>
}

function parseEvents(value: string | null): { name: string }[] {
  return JSON.parse(value ?? '[]') as { name: string }[]
}

describe('query execution tracing', () => {
  let app: Hono

  beforeEach(async () => {
    await resetTestDatabase()

    app = createApp({ enableLogging: false, token: testApiToken })
  })

  it('links the background execution spans to the request trace', async () => {
    const databaseId = await insertDatabaseRow()
    const queryId = await createQuery(app, databaseId)

    const spans = await waitForSpans(5)

    expect(spans.map((span) => span.traceId)).toEqual(
      Array.from({ length: 5 }, () => clientTraceId)
    )

    const server = spans.find((span) => span.name === 'POST /queries')
    const execute = spans.find((span) => span.name === 'query.execute')
    const loadConnection = spans.find(
      (span) => span.name === 'query.loadConnection'
    )
    const dbQuery = spans.find((span) => span.name === 'db.query')
    const saveResult = spans.find((span) => span.name === 'query.saveResult')

    expect(server?.parentSpanId).toEqual(clientSpanId)
    expect(execute?.parentSpanId).toEqual(server?.id)
    expect(execute?.status).toEqual('ok')
    expect(loadConnection?.parentSpanId).toEqual(execute?.id)
    expect(dbQuery?.parentSpanId).toEqual(execute?.id)
    expect(saveResult?.parentSpanId).toEqual(execute?.id)

    expect(parseAttributes(dbQuery?.attributes ?? null)).toEqual({
      'db.statement': 'SELECT 1',
      'db.system': 'postgres',
      'query.id': queryId
    })

    expect(parseAttributes(saveResult?.attributes ?? null)).toEqual({
      'query.id': queryId,
      'query.rowCount': 2,
      'query.truncated': false
    })
  })

  it('records failed executions as error spans', async () => {
    mockAdapterConfig.runQuery = async () => {
      throw new Error('relation "nope" does not exist')
    }

    const databaseId = await insertDatabaseRow()

    await createQuery(app, databaseId)

    // No query.saveResult span on the failure path.
    const spans = await waitForSpans(4)

    const execute = spans.find((span) => span.name === 'query.execute')
    const dbQuery = spans.find((span) => span.name === 'db.query')

    expect(execute?.status).toEqual('error')
    expect(dbQuery?.status).toEqual('error')
    expect(dbQuery?.statusMessage).toEqual('relation "nope" does not exist')

    const events = parseEvents(dbQuery?.events ?? null)

    expect(events[0]?.name).toEqual('exception')
  })

  it('records canceled executions as ok spans with a cancel event', async () => {
    let rejectRunningQuery: ((error: Error) => void) | undefined

    mockAdapterConfig.runQuery = () =>
      new Promise((_resolve, reject) => {
        rejectRunningQuery = reject
      })

    mockAdapterConfig.cancel = async () => {
      rejectRunningQuery?.(new Error('canceling statement due to user request'))
    }

    const databaseId = await insertDatabaseRow()
    const queryId = await createQuery(app, databaseId)

    const cancelResponse = await app.request(`/queries/${queryId}/cancel`, {
      headers: requestHeaders,
      method: 'POST'
    })

    expect(cancelResponse.status).toEqual(200)

    // Server spans for POST /queries and the cancel request, plus
    // query.execute, query.loadConnection, and db.query.
    const spans = await waitForSpans(5)

    const execute = spans.find((span) => span.name === 'query.execute')
    const dbQuery = spans.find((span) => span.name === 'db.query')

    expect(execute?.status).toEqual('ok')
    expect(dbQuery?.status).toEqual('ok')

    expect(parseEvents(execute?.events ?? null)).toEqual([
      { name: 'query.canceled', time: expect.any(Number) }
    ])
    expect(parseEvents(dbQuery?.events ?? null)).toEqual([
      { name: 'query.canceled', time: expect.any(Number) }
    ])
  })
})
