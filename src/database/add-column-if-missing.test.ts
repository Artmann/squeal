import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { describe, expect, it } from 'vitest'

import { addColumnIfMissing } from './add-column-if-missing'

describe('addColumnIfMissing', () => {
  it('adds a missing column', async () => {
    const database = drizzle(':memory:')

    await database.run(sql`CREATE TABLE things (id TEXT PRIMARY KEY)`)
    await addColumnIfMissing(
      database,
      sql`ALTER TABLE things ADD COLUMN name TEXT`
    )

    const rows = await database.all<{ name: string }>(
      sql`SELECT name FROM pragma_table_info('things') ORDER BY name`
    )

    expect(rows).toEqual([{ name: 'id' }, { name: 'name' }])
  })

  it('swallows the duplicate column error', async () => {
    const database = drizzle(':memory:')

    await database.run(sql`CREATE TABLE things (id TEXT PRIMARY KEY)`)
    await addColumnIfMissing(
      database,
      sql`ALTER TABLE things ADD COLUMN name TEXT`
    )

    await expect(
      addColumnIfMissing(database, sql`ALTER TABLE things ADD COLUMN name TEXT`)
    ).resolves.toEqual(undefined)
  })

  it('propagates every other error', async () => {
    const database = drizzle(':memory:')

    await expect(
      addColumnIfMissing(
        database,
        sql`ALTER TABLE missing_table ADD COLUMN name TEXT`
      )
    ).rejects.toThrow(/ALTER TABLE missing_table/)
  })
})
