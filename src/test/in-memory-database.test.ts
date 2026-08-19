import { getTableName, sql } from 'drizzle-orm'
import invariant from 'tiny-invariant'
import { describe, expect, it } from 'vitest'

import { appTables } from '@/database/app-tables'
import { createInMemoryDatabase } from './in-memory-database'

// Every test that needs an app database reaches this helper, five of them
// directly and the rest through `makeTestAppDatabase`, which is written over
// it. The property they all lean on is the one a helper is least likely to be
// checked for: that two calls really are two databases. Without it every "and
// no other" case in those files passes no matter what the code under test does.
describe('createInMemoryDatabase', () => {
  // A database with no tables in it is not isolation, it is a different error
  // one line later.
  //
  // Every table rather than a representative one: a `createTables` that made
  // only the table this happened to name would pass a single-table check while
  // breaking the files that depend on this helper. Both sides derive from
  // `appTables`, which reads the schema, so a new table does not make this fail
  // for a table that is fine — and a missing one is named in the diff.
  it('creates every table the schema declares', async () => {
    invariant(appTables.length > 0, 'The schema declares no tables.')

    const client = await createInMemoryDatabase()

    const rows = await Promise.all(
      appTables.map((table) =>
        client
          .select()
          .from(table)
          .catch((error: unknown) => String(error))
      )
    )

    const names = appTables.map((table) => getTableName(table))

    expect(
      Object.fromEntries(names.map((name, index) => [name, rows[index]]))
    ).toEqual(Object.fromEntries(names.map((name) => [name, []])))
  })

  // Written through one and read back through both, rather than comparing the
  // two objects: identity would also be satisfied by two handles onto the same
  // file, and what the callers need is that a write to one is invisible to the
  // other.
  it('hands out a database of its own on every call', async () => {
    const first = await createInMemoryDatabase()
    const second = await createInMemoryDatabase()

    await first.run(sql`
      INSERT INTO worksheets (id, content, createdAt, name)
      VALUES ('worksheet-1', 'SELECT 1', 1700000000000, 'One')
    `)

    const count = async (client: typeof first): Promise<number> => {
      const rows = await client.all<{ total: number }>(
        sql`SELECT COUNT(*) AS total FROM worksheets`
      )

      return rows[0]?.total ?? -1
    }

    expect({ first: await count(first), second: await count(second) }).toEqual({
      first: 1,
      second: 0
    })
  })
})
