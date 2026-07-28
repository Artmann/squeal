import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  getTestDatabase,
  resetTestDatabase,
  setupApiMocks
} from '@/test/api-test-helper'

setupApiMocks()

import { deleteExpiredQueries } from './query-retention'

const dayInMilliseconds = 24 * 60 * 60 * 1000

async function insertQuery(options: {
  id: string
  queriedAt: number
  worksheetId: string
}): Promise<void> {
  const database = getTestDatabase()

  await database.run(sql`
    INSERT INTO queries (
      id, content, databaseId, finishedAt, queriedAt, worksheetId
    )
    VALUES (
      ${options.id},
      'SELECT 1',
      'database-1',
      ${options.queriedAt},
      ${options.queriedAt},
      ${options.worksheetId}
    )
  `)
}

async function remainingQueryIds(): Promise<string[]> {
  const database = getTestDatabase()
  const rows = await database.all<{ id: string }>(
    sql`SELECT id FROM queries ORDER BY id`
  )

  return rows.map((row) => row.id)
}

describe('deleteExpiredQueries', () => {
  beforeEach(async () => {
    await resetTestDatabase()
  })

  it('deletes queries older than the retention window', async () => {
    const now = Date.now()

    await insertQuery({
      id: 'old',
      queriedAt: now - 31 * dayInMilliseconds,
      worksheetId: 'worksheet-1'
    })
    await insertQuery({
      id: 'recent',
      queriedAt: now,
      worksheetId: 'worksheet-1'
    })

    const deletedCount = await deleteExpiredQueries(30)

    expect(deletedCount).toEqual(1)
    expect(await remainingQueryIds()).toEqual(['recent'])
  })

  it('keeps an expired query that is the newest for its worksheet', async () => {
    const now = Date.now()

    await insertQuery({
      id: 'old-but-latest',
      queriedAt: now - 90 * dayInMilliseconds,
      worksheetId: 'worksheet-1'
    })
    await insertQuery({
      id: 'older-sibling',
      queriedAt: now - 120 * dayInMilliseconds,
      worksheetId: 'worksheet-1'
    })

    const deletedCount = await deleteExpiredQueries(30)

    expect(deletedCount).toEqual(1)
    expect(await remainingQueryIds()).toEqual(['old-but-latest'])
  })

  it('keeps everything inside the retention window', async () => {
    const now = Date.now()

    await insertQuery({
      id: 'first',
      queriedAt: now - 5 * dayInMilliseconds,
      worksheetId: 'worksheet-1'
    })
    await insertQuery({
      id: 'second',
      queriedAt: now - 1 * dayInMilliseconds,
      worksheetId: 'worksheet-1'
    })

    const deletedCount = await deleteExpiredQueries(30)

    expect(deletedCount).toEqual(0)
    expect(await remainingQueryIds()).toEqual(['first', 'second'])
  })
})
