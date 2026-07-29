import { beforeEach, describe, expect, it } from 'vitest'

import {
  getTestDatabase,
  resetTestDatabase,
  setupApiMocks
} from '@/test/api-test-helper'

setupApiMocks()

import { spansTable } from '@/database/schema'
import { SpanRecord } from '@/glue/tracing/spans'
import { writeSpans } from './span-writer'

const record: SpanRecord = {
  attributes: { 'http.method': 'GET' },
  durationMs: 12.5,
  events: [],
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

describe('writeSpans', () => {
  beforeEach(async () => {
    await resetTestDatabase()
  })

  it('serializes attributes and events as JSON', async () => {
    await writeSpans([record])

    const database = getTestDatabase()

    expect(await database.select().from(spansTable)).toEqual([
      {
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
    ])
  })

  it('ignores spans whose id already exists', async () => {
    await writeSpans([record])
    await writeSpans([{ ...record, name: 'changed' }])

    const database = getTestDatabase()
    const rows = await database.select().from(spansTable)

    expect(rows.length).toEqual(1)
    expect(rows[0]?.name).toEqual('GET /databases')
  })

  it('does nothing for an empty batch', async () => {
    await writeSpans([])

    const database = getTestDatabase()

    expect(await database.select().from(spansTable)).toEqual([])
  })
})
