import { beforeEach, describe, expect, it } from 'vitest'

import {
  getTestDatabase,
  resetTestDatabase,
  setupApiMocks
} from '@/test/api-test-helper'

setupApiMocks()

import { spansTable } from '@/database/schema'
import { generateSpanId, generateTraceId } from '@/glue/tracing/ids'
import { deleteExpiredSpans } from './trace-retention'
import { writeSpans } from './span-writer'

const dayInMilliseconds = 24 * 60 * 60 * 1000

async function insertSpan(options: {
  name: string
  startedAt: number
}): Promise<void> {
  await writeSpans([
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

async function remainingSpanNames(): Promise<string[]> {
  const database = getTestDatabase()
  const rows = await database.select().from(spansTable)

  return rows.map((row) => row.name).sort()
}

describe('deleteExpiredSpans', () => {
  beforeEach(async () => {
    await resetTestDatabase()
  })

  it('deletes spans older than the retention window', async () => {
    const now = Date.now()

    await insertSpan({ name: 'old', startedAt: now - 8 * dayInMilliseconds })
    await insertSpan({ name: 'recent', startedAt: now })

    const deletedCount = await deleteExpiredSpans({ retentionDays: 7 })

    expect(deletedCount).toEqual(1)
    expect(await remainingSpanNames()).toEqual(['recent'])
  })

  it('keeps everything inside the retention window', async () => {
    const now = Date.now()

    await insertSpan({ name: 'first', startedAt: now - dayInMilliseconds })
    await insertSpan({ name: 'second', startedAt: now })

    const deletedCount = await deleteExpiredSpans({ retentionDays: 7 })

    expect(deletedCount).toEqual(0)
    expect(await remainingSpanNames()).toEqual(['first', 'second'])
  })

  it('caps the total span count by deleting the oldest', async () => {
    const now = Date.now()

    await insertSpan({ name: 'oldest', startedAt: now - 3000 })
    await insertSpan({ name: 'middle', startedAt: now - 2000 })
    await insertSpan({ name: 'newest', startedAt: now - 1000 })

    const deletedCount = await deleteExpiredSpans({
      maxSpanCount: 2,
      retentionDays: 7
    })

    expect(deletedCount).toEqual(1)
    expect(await remainingSpanNames()).toEqual(['middle', 'newest'])
  })
})
