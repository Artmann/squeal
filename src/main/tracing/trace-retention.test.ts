import { beforeEach, describe, expect, it } from 'vitest'

import type { database } from '@/database'
import { spansTable } from '@/database/schema'
import { generateSpanId, generateTraceId } from '@/glue/tracing/ids'
import { createInMemoryDatabase } from '@/test/in-memory-database'
import { writeSpans } from './span-writer'
import { deleteExpiredSpans } from './trace-retention'

const dayInMilliseconds = 24 * 60 * 60 * 1000

let client: typeof database

async function insertSpan(
  target: typeof database,
  options: {
    name: string
    startedAt: number
  }
): Promise<void> {
  await writeSpans(target, [
    {
      attributes: {},
      durationMs: 1,
      events: [],
      id: generateSpanId(),
      kind: 'internal',
      name: options.name,
      parentSpanId: null,
      serviceName: 'main',
      startedAt: options.startedAt,
      status: 'ok',
      statusMessage: null,
      traceId: generateTraceId()
    }
  ])
}

async function remainingSpanNames(target: typeof database): Promise<string[]> {
  const rows = await target.select().from(spansTable)

  return rows.map((row) => row.name).sort()
}

describe('deleteExpiredSpans', () => {
  beforeEach(async () => {
    client = await createInMemoryDatabase()
  })

  it('deletes spans older than the retention window', async () => {
    const now = Date.now()

    await insertSpan(client, {
      name: 'old',
      startedAt: now - 8 * dayInMilliseconds
    })
    await insertSpan(client, { name: 'recent', startedAt: now })

    const deletedCount = await deleteExpiredSpans(client, { retentionDays: 7 })

    expect(deletedCount).toEqual(1)
    expect(await remainingSpanNames(client)).toEqual(['recent'])
  })

  it('keeps everything inside the retention window', async () => {
    const now = Date.now()

    await insertSpan(client, {
      name: 'first',
      startedAt: now - dayInMilliseconds
    })
    await insertSpan(client, { name: 'second', startedAt: now })

    const deletedCount = await deleteExpiredSpans(client, { retentionDays: 7 })

    expect(deletedCount).toEqual(0)
    expect(await remainingSpanNames(client)).toEqual(['first', 'second'])
  })

  it('caps the total span count by deleting the oldest', async () => {
    const now = Date.now()

    await insertSpan(client, { name: 'oldest', startedAt: now - 3000 })
    await insertSpan(client, { name: 'middle', startedAt: now - 2000 })
    await insertSpan(client, { name: 'newest', startedAt: now - 1000 })

    const deletedCount = await deleteExpiredSpans(client, {
      maxSpanCount: 2,
      retentionDays: 7
    })

    expect(deletedCount).toEqual(1)
    expect(await remainingSpanNames(client)).toEqual(['middle', 'newest'])
  })

  // Both statements this sweep runs are unqualified DELETEs. Reaching a module
  // singleton instead of the client it was handed would empty a database
  // nobody asked it to touch.
  it('sweeps the database it is given and no other', async () => {
    const other = await createInMemoryDatabase()
    const now = Date.now()

    for (const target of [client, other]) {
      await insertSpan(target, {
        name: 'old',
        startedAt: now - 8 * dayInMilliseconds
      })
      await insertSpan(target, { name: 'recent', startedAt: now })
    }

    const deletedCount = await deleteExpiredSpans(client, { retentionDays: 7 })

    expect({
      deletedCount,
      other: await remainingSpanNames(other),
      swept: await remainingSpanNames(client)
    }).toEqual({
      deletedCount: 1,
      other: ['old', 'recent'],
      swept: ['recent']
    })
  })
})
