import { describe, expect, it } from 'vitest'

import { createInMemoryDatabase } from '@/test/in-memory-database'

import { spansTable } from './schema'

type SpanRow = typeof spansTable.$inferInsert

describe('spans table', () => {
  it('stores and returns span rows', async () => {
    const database = await createInMemoryDatabase()

    const span: SpanRow = {
      attributes: '{"http.method":"GET"}',
      durationMs: 12.5,
      events: '[]',
      id: '00f067aa0ba902b7',
      kind: 'server',
      name: 'GET /databases',
      parentSpanId: null,
      serviceName: 'main',
      startedAt: 1700000000000,
      status: 'ok',
      statusMessage: null,
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736'
    }

    await database.insert(spansTable).values(span)

    const rows = await database.select().from(spansTable)

    expect(rows).toEqual([span])
  })

  it('defaults status to unset', async () => {
    const database = await createInMemoryDatabase()

    await database.insert(spansTable).values({
      attributes: '{}',
      durationMs: 1,
      events: '[]',
      id: 'a1b2c3d4e5f60718',
      kind: 'internal',
      name: 'query.execute',
      serviceName: 'main',
      startedAt: 1700000000000,
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736'
    })

    const [row] = await database.select().from(spansTable)

    expect(row?.status).toEqual('unset')
  })
})
