import { getTableName } from 'drizzle-orm'
import invariant from 'tiny-invariant'
import { beforeEach, describe, expect, it } from 'vitest'

// Above the imports below it, not merely near them: the `@/database` mock
// registers as this module is evaluated, and anything evaluated first misses
// it. See the note in the helper.
import { getTestDatabase, resetTestDatabase } from './api-test-helper'

import { appTables } from '@/database/app-tables'
import { database } from '@/database'

// Five test files depend on this harness for their isolation and none of them
// asserts anything about it. What is left of the module after the unreachable
// adapter mocks came out is small enough to hold down completely.
describe('api-test-helper', () => {
  beforeEach(async () => {
    await resetTestDatabase()
  })

  // Identity, not shape, which is the exception to the project's `toEqual`
  // default. `toEqual` does discriminate here — two in-memory databases with
  // the same tables compare unequal, because each drizzle instance holds its
  // own client object — but that is an implementation detail of drizzle, and
  // the property under test really is that both names point at one object.
  it('serves the current database to a module that imported it once', () => {
    expect(database).toBe(getTestDatabase())
  })

  it('hands out a new database on every reset', async () => {
    const first = getTestDatabase()

    await resetTestDatabase()

    expect(getTestDatabase()).not.toBe(first)
  })

  // A database with no tables in it is not isolation, it is a different error
  // one line later.
  //
  // Every table, not a representative one: a `createTables` that made only the
  // table this happened to name would pass a single-table check while breaking
  // six tests in the files that depend on this harness. Both sides are derived
  // from `appTables`, which reads the schema, so adding a table does not make
  // this fail for a table that is fine — and a missing one is named in the
  // diff, beside the error SQLite gave.
  it('creates every table the schema declares', async () => {
    invariant(appTables.length > 0, 'The schema declares no tables.')

    const database = getTestDatabase()

    const rows = await Promise.all(
      appTables.map((table) =>
        database
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
})
