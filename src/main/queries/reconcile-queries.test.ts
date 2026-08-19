import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import type { database } from '@/database'
import { createInMemoryDatabase } from '@/test/in-memory-database'
import {
  interruptedQueryMessage,
  markInterruptedQueries
} from './reconcile-queries'

let client: typeof database

async function insertQuery(
  target: typeof database,
  options: {
    error?: string
    finishedAt?: number
    id: string
    result?: string
  }
): Promise<void> {
  await target.run(sql`
    INSERT INTO queries (
      id, content, databaseId, error, finishedAt, queriedAt, result, worksheetId
    )
    VALUES (
      ${options.id},
      'SELECT 1',
      'database-1',
      ${options.error ?? null},
      ${options.finishedAt ?? null},
      ${Date.now()},
      ${options.result ?? null},
      'worksheet-1'
    )
  `)
}

describe('markInterruptedQueries', () => {
  beforeEach(async () => {
    client = await createInMemoryDatabase()
  })

  it('marks unfinished queries as interrupted', async () => {
    await insertQuery(client, { id: 'orphaned' })

    const count = await markInterruptedQueries(client)

    expect(count).toEqual(1)

    const rows = await client.all<{
      error: string | null
      finishedAt: number | null
    }>(sql`SELECT error, finishedAt FROM queries WHERE id = 'orphaned'`)

    expect(rows[0].error).toEqual(interruptedQueryMessage)
    expect(rows[0].finishedAt).not.toBeNull()
  })

  it('leaves finished queries untouched', async () => {
    await insertQuery(client, {
      finishedAt: 1704067200000,
      id: 'completed',
      result: '{"fields":[],"rowCount":0,"rows":[],"truncated":false}'
    })
    await insertQuery(client, {
      error: 'Boom',
      finishedAt: 1704067200000,
      id: 'failed'
    })

    const count = await markInterruptedQueries(client)

    expect(count).toEqual(0)

    const rows = await client.all<{
      error: string | null
      finishedAt: number | null
      id: string
    }>(sql`SELECT id, error, finishedAt FROM queries ORDER BY id`)

    expect(rows).toEqual([
      { error: null, finishedAt: 1704067200000, id: 'completed' },
      { error: 'Boom', finishedAt: 1704067200000, id: 'failed' }
    ])
  })

  it('does nothing when there are no queries', async () => {
    const count = await markInterruptedQueries(client)

    expect(count).toEqual(0)
  })

  // Boot marks the previous process's leftovers against the client the runtime
  // just built. Reaching a module singleton instead would mark rows in whatever
  // database that happened to be.
  it('marks the database it is given and no other', async () => {
    const other = await createInMemoryDatabase()

    await insertQuery(client, { id: 'orphaned' })
    await insertQuery(other, { id: 'orphaned' })

    const count = await markInterruptedQueries(client)

    const rows = await other.all<{ error: string | null }>(
      sql`SELECT error FROM queries`
    )

    expect({ count, other: rows }).toEqual({
      count: 1,
      other: [{ error: null }]
    })
  })
})
