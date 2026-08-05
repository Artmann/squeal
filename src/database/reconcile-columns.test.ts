import { getTableColumns, getTableName, sql } from 'drizzle-orm'
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql'
import type { AnySQLiteTable } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'

import { appTables } from './app-tables'
import { reconcileColumns } from './reconcile-columns'
import { queriesTable, worksheetsTable } from './schema'
import { createTables } from './tables'

// The `worksheets` and `queries` tables exactly as they were stored in a
// packaged build that predates `databaseId`. Reproduced verbatim from the
// shipped database, trailing ALTER-appended columns and all, because the whole
// point of the reconciler is to repair this shape.
const driftedWorksheets = sql`
  CREATE TABLE worksheets (
    id TEXT PRIMARY KEY NOT NULL,
    createdAt INTEGER NOT NULL,
    deletedAt INTEGER,
    name TEXT NOT NULL DEFAULT 'Untitled Worksheet'
  , content TEXT NOT NULL DEFAULT '', lastOpenedAt INTEGER, sortOrder INTEGER)
`

const driftedQueries = sql`
  CREATE TABLE queries (
    id TEXT PRIMARY KEY NOT NULL,
    content TEXT NOT NULL,
    error TEXT,
    finishedAt INTEGER,
    queriedAt INTEGER NOT NULL,
    result TEXT,
    worksheetId TEXT NOT NULL
  )
`

async function columnNames(
  database: LibSQLDatabase,
  tableName: string
): Promise<string[]> {
  const rows = await database.all<{ name: string }>(
    sql`SELECT name FROM pragma_table_info(${tableName}) ORDER BY name`
  )

  return rows.map((row) => row.name)
}

function schemaColumnNames(table: AnySQLiteTable): string[] {
  return Object.values(getTableColumns(table))
    .map((column) => column.name)
    .sort()
}

describe('reconcileColumns', () => {
  it('repairs a database missing databaseId on worksheets and queries', async () => {
    const database = drizzle(':memory:')

    await database.run(driftedWorksheets)
    await database.run(driftedQueries)

    const added = await reconcileColumns(database, [
      queriesTable,
      worksheetsTable
    ])

    expect(added).toEqual(['queries.databaseId', 'worksheets.databaseId'])

    expect(await columnNames(database, 'worksheets')).toEqual(
      schemaColumnNames(worksheetsTable)
    )
    expect(await columnNames(database, 'queries')).toEqual(
      schemaColumnNames(queriesTable)
    )
  })

  it('makes the failing queries work again and keeps the existing rows', async () => {
    const database = drizzle(':memory:')

    await database.run(driftedWorksheets)
    await database.run(driftedQueries)

    await database.run(
      sql`INSERT INTO worksheets (id, createdAt, name, content) VALUES ('worksheet-1', 1, 'My First Worksheet', 'select 1')`
    )
    await database.run(
      sql`INSERT INTO queries (id, content, queriedAt, worksheetId) VALUES ('query-1', 'select 1', 2, 'worksheet-1')`
    )

    // Both of these throw "no such column: databaseId" before reconciling:
    // Drizzle names every column explicitly, so one missing column fails the
    // whole endpoint.
    await reconcileColumns(database, [queriesTable, worksheetsTable])

    expect(await database.select().from(worksheetsTable)).toEqual([
      {
        content: 'select 1',
        createdAt: 1,
        databaseId: null,
        deletedAt: null,
        id: 'worksheet-1',
        lastOpenedAt: null,
        name: 'My First Worksheet',
        sortOrder: null
      }
    ])

    // A NOT NULL column with no schema default gets an empty string for the
    // rows that already exist — never NULL, which the response schema would
    // refuse to encode.
    expect(await database.select().from(queriesTable)).toEqual([
      {
        content: 'select 1',
        databaseId: '',
        error: null,
        finishedAt: null,
        id: 'query-1',
        queriedAt: 2,
        result: null,
        worksheetId: 'worksheet-1'
      }
    ])
  })

  it('lets a new row be inserted after reconciling', async () => {
    const database = drizzle(':memory:')

    await database.run(driftedWorksheets)
    await reconcileColumns(database, [worksheetsTable])

    const inserted = await database
      .insert(worksheetsTable)
      .values({ name: 'Second' })
      .returning()

    expect(inserted).toHaveLength(1)
  })

  it('is idempotent', async () => {
    const database = drizzle(':memory:')

    await database.run(driftedWorksheets)
    await reconcileColumns(database, [worksheetsTable])

    expect(await reconcileColumns(database, [worksheetsTable])).toEqual([])
    expect(await columnNames(database, 'worksheets')).toEqual(
      schemaColumnNames(worksheetsTable)
    )
  })

  it('leaves a table that is already current untouched', async () => {
    const database = drizzle(':memory:')

    await createTables(database)

    expect(await reconcileColumns(database, appTables)).toEqual([])
  })

  it('skips a table that does not exist yet', async () => {
    const database = drizzle(':memory:')

    expect(await reconcileColumns(database, appTables)).toEqual([])
  })
})

// The guard that would have caught the shipped bug. `tables.ts` is the
// fresh-install DDL and `schema.ts` is what Drizzle builds queries from; when
// they disagree, every query on the affected table fails at runtime while every
// test still passes, because the test helpers build their databases from
// tables.ts and so never see the drift.
describe('tables.ts matches schema.ts', () => {
  it.each(appTables.map((table) => [getTableName(table), table] as const))(
    'declares every %s column',
    async (tableName, table) => {
      const database = drizzle(':memory:')

      await createTables(database)

      expect(await columnNames(database, tableName)).toEqual(
        schemaColumnNames(table)
      )
    }
  )
})
