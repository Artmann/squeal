import { beforeEach, describe, expect, it } from 'vitest'

import type { database } from '@/database'
import { spansTable } from '@/database/schema'
import { SpanRecord } from '@/glue/tracing/spans'
import { createInMemoryDatabase } from '@/test/in-memory-database'
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

let client: typeof database

describe('writeSpans', () => {
  beforeEach(async () => {
    client = await createInMemoryDatabase()
  })

  it('serializes attributes and events as JSON', async () => {
    await writeSpans(client, [record])

    expect(await client.select().from(spansTable)).toEqual([
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
    await writeSpans(client, [record])
    await writeSpans(client, [{ ...record, name: 'changed' }])

    const rows = await client.select().from(spansTable)

    expect(rows.length).toEqual(1)
    expect(rows[0]?.name).toEqual('GET /databases')
  })

  it('does nothing for an empty batch', async () => {
    await writeSpans(client, [])

    expect(await client.select().from(spansTable)).toEqual([])
  })

  // The writer already took a client, but defaulted to the singleton when it
  // was left out, so nothing stopped a caller from writing somewhere else by
  // saying nothing. There is no longer anything to leave out.
  it('writes to the database it is given and no other', async () => {
    const other = await createInMemoryDatabase()

    await writeSpans(client, [record])

    // Both halves, because either alone is satisfied by a writer that writes
    // nowhere at all: "the other one is empty" is a property of a database
    // nothing has touched, and "this one has the row" says nothing about where
    // else the row also went.
    expect({
      given: (await client.select().from(spansTable)).map((row) => row.id),
      other: (await other.select().from(spansTable)).map((row) => row.id)
    }).toEqual({ given: [record.id], other: [] })
  })
})
