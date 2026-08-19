import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

// Above the imports below it, not merely near them: the `@/database` mock
// registers as this module is evaluated, and anything evaluated first misses
// it. See the note in the helper.
import { getTestDatabase, resetTestDatabase } from '@/test/api-test-helper'

import {
  interruptedQueryMessage,
  markInterruptedQueries
} from './reconcile-queries'

async function insertQuery(options: {
  error?: string
  finishedAt?: number
  id: string
  result?: string
}): Promise<void> {
  const database = getTestDatabase()

  await database.run(sql`
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
    await resetTestDatabase()
  })

  it('marks unfinished queries as interrupted', async () => {
    await insertQuery({ id: 'orphaned' })

    const count = await markInterruptedQueries()

    expect(count).toEqual(1)

    const database = getTestDatabase()
    const rows = await database.all<{
      error: string | null
      finishedAt: number | null
    }>(sql`SELECT error, finishedAt FROM queries WHERE id = 'orphaned'`)

    expect(rows[0].error).toEqual(interruptedQueryMessage)
    expect(rows[0].finishedAt).not.toBeNull()
  })

  it('leaves finished queries untouched', async () => {
    await insertQuery({
      finishedAt: 1704067200000,
      id: 'completed',
      result: '{"fields":[],"rowCount":0,"rows":[],"truncated":false}'
    })
    await insertQuery({
      error: 'Boom',
      finishedAt: 1704067200000,
      id: 'failed'
    })

    const count = await markInterruptedQueries()

    expect(count).toEqual(0)

    const database = getTestDatabase()
    const rows = await database.all<{
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
    const count = await markInterruptedQueries()

    expect(count).toEqual(0)
  })
})
