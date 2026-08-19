import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import type { database } from '@/database'
import { createInMemoryDatabase } from '@/test/in-memory-database'
import { deleteExpiredQueries } from './query-retention'

const dayInMilliseconds = 24 * 60 * 60 * 1000

let client: typeof database

async function insertQuery(
  target: typeof database,
  options: {
    id: string
    queriedAt: number
    worksheetId: string
  }
): Promise<void> {
  await target.run(sql`
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

async function remainingQueryIds(target: typeof database): Promise<string[]> {
  const rows = await target.all<{ id: string }>(
    sql`SELECT id FROM queries ORDER BY id`
  )

  return rows.map((row) => row.id)
}

describe('deleteExpiredQueries', () => {
  beforeEach(async () => {
    client = await createInMemoryDatabase()
  })

  it('deletes queries older than the retention window', async () => {
    const now = Date.now()

    await insertQuery(client, {
      id: 'old',
      queriedAt: now - 31 * dayInMilliseconds,
      worksheetId: 'worksheet-1'
    })
    await insertQuery(client, {
      id: 'recent',
      queriedAt: now,
      worksheetId: 'worksheet-1'
    })

    const deletedCount = await deleteExpiredQueries(client, 30)

    expect(deletedCount).toEqual(1)
    expect(await remainingQueryIds(client)).toEqual(['recent'])
  })

  it('keeps an expired query that is the newest for its worksheet', async () => {
    const now = Date.now()

    await insertQuery(client, {
      id: 'old-but-latest',
      queriedAt: now - 90 * dayInMilliseconds,
      worksheetId: 'worksheet-1'
    })
    await insertQuery(client, {
      id: 'older-sibling',
      queriedAt: now - 120 * dayInMilliseconds,
      worksheetId: 'worksheet-1'
    })

    const deletedCount = await deleteExpiredQueries(client, 30)

    expect(deletedCount).toEqual(1)
    expect(await remainingQueryIds(client)).toEqual(['old-but-latest'])
  })

  it('keeps everything inside the retention window', async () => {
    const now = Date.now()

    await insertQuery(client, {
      id: 'first',
      queriedAt: now - 5 * dayInMilliseconds,
      worksheetId: 'worksheet-1'
    })
    await insertQuery(client, {
      id: 'second',
      queriedAt: now - 1 * dayInMilliseconds,
      worksheetId: 'worksheet-1'
    })

    const deletedCount = await deleteExpiredQueries(client, 30)

    expect(deletedCount).toEqual(0)
    expect(await remainingQueryIds(client)).toEqual(['first', 'second'])
  })

  // Two databases is the whole point. A sweep that reaches a module singleton
  // instead of the client it was handed passes every case above, because in
  // those the two are the same database; here they are not, and the one the
  // sweep was not given is what says so.
  it('sweeps the database it is given and no other', async () => {
    const other = await createInMemoryDatabase()
    const now = Date.now()

    for (const target of [client, other]) {
      await insertQuery(target, {
        id: 'old',
        queriedAt: now - 31 * dayInMilliseconds,
        worksheetId: 'worksheet-1'
      })
      await insertQuery(target, {
        id: 'recent',
        queriedAt: now,
        worksheetId: 'worksheet-1'
      })
    }

    const deletedCount = await deleteExpiredQueries(client, 30)

    expect({
      deletedCount,
      other: await remainingQueryIds(other),
      swept: await remainingQueryIds(client)
    }).toEqual({
      deletedCount: 1,
      other: ['old', 'recent'],
      swept: ['recent']
    })
  })
})
