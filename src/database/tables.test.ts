import { getTableName, sql, type SQL } from 'drizzle-orm'
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql'
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex
} from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'

import { appTables } from './app-tables'
import { createTables } from './tables'

// The fresh-install DDL as it was written by hand before `createTables` was
// generated from schema.ts. The generator has to build the same database from
// the schema that this builds from text: same columns in the same order, with
// the same types, NOT NULL and defaults, and the same indexes.
//
// When a schema change makes the first test fail, change this to the DDL you
// mean the schema to produce. The diff is then the reviewable statement of what
// a fresh install gets.
const handWrittenStatements: SQL[] = [
  sql`
    CREATE TABLE databases (
      id TEXT PRIMARY KEY NOT NULL,
      connectionInfo TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      deletedAt INTEGER,
      environmentId TEXT,
      lastUsedAt INTEGER,
      name TEXT NOT NULL,
      sortOrder INTEGER,
      type TEXT NOT NULL
    )
  `,
  sql`
    CREATE TABLE environments (
      id TEXT PRIMARY KEY NOT NULL,
      createdAt INTEGER NOT NULL,
      deletedAt INTEGER,
      hue INTEGER NOT NULL,
      name TEXT NOT NULL
    )
  `,
  sql`
    CREATE TABLE queries (
      id TEXT PRIMARY KEY NOT NULL,
      content TEXT NOT NULL,
      databaseId TEXT NOT NULL,
      error TEXT,
      finishedAt INTEGER,
      queriedAt INTEGER NOT NULL,
      result TEXT,
      resultRowCount INTEGER,
      resultTruncated INTEGER,
      worksheetId TEXT NOT NULL
    )
  `,
  sql`CREATE INDEX queries_queried_at_index ON queries (queriedAt)`,
  sql`
    CREATE INDEX queries_worksheet_id_queried_at_index
    ON queries (worksheetId, queriedAt)
  `,
  sql`
    CREATE INDEX queries_unfinished_index
    ON queries (finishedAt)
    WHERE finishedAt IS NULL
  `,
  sql`
    CREATE TABLE settings (
      id TEXT PRIMARY KEY NOT NULL,
      createdAt INTEGER NOT NULL,
      secretStorageMode TEXT NOT NULL DEFAULT 'undecided',
      updatedAt INTEGER NOT NULL
    )
  `,
  sql`
    CREATE TABLE spans (
      id TEXT PRIMARY KEY NOT NULL,
      attributes TEXT,
      durationMs REAL NOT NULL,
      events TEXT,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      parentSpanId TEXT,
      serviceName TEXT NOT NULL,
      startedAt INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'unset',
      statusMessage TEXT,
      traceId TEXT NOT NULL
    )
  `,
  sql`CREATE INDEX spans_started_at_index ON spans (startedAt)`,
  sql`CREATE INDEX spans_trace_id_index ON spans (traceId)`,
  sql`
    CREATE TABLE worksheets (
      id TEXT PRIMARY KEY NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      createdAt INTEGER NOT NULL,
      databaseId TEXT,
      deletedAt INTEGER,
      lastOpenedAt INTEGER,
      name TEXT NOT NULL DEFAULT 'Untitled Worksheet',
      sortOrder INTEGER
    )
  `
]

const widgetsTable = sqliteTable(
  'widgets',
  {
    id: text().primaryKey(),
    createdAt: integer()
      .notNull()
      .$defaultFn(() => Date.now()),
    name: text().notNull(),
    ownerId: text(),
    status: text().notNull().default('draft')
  },
  (table) => [
    index('widgets_owner_id_index').on(table.ownerId),
    uniqueIndex('widgets_name_index')
      .on(table.name)
      .where(sql`ownerId IS NOT NULL`)
  ]
)

interface Column {
  cid: number
  dflt_value: string | null
  name: string
  notnull: number
  pk: number
  type: string
}

interface IndexColumn {
  name: string
  seqno: number
}

interface IndexDescription {
  columns: IndexColumn[]
  name: string
  origin: string
  partial: number
  unique: number
}

interface TableDescription {
  columns: Column[]
  indexes: IndexDescription[]
}

async function describeTable(
  database: LibSQLDatabase,
  tableName: string
): Promise<TableDescription> {
  const columns = await database.all<Column>(
    sql`
      SELECT cid, dflt_value, name, "notnull", pk, type
      FROM pragma_table_info(${tableName})
      ORDER BY cid
    `
  )
  const indexList = await database.all<Omit<IndexDescription, 'columns'>>(
    sql`
      SELECT name, origin, partial, "unique"
      FROM pragma_index_list(${tableName})
      ORDER BY name
    `
  )

  const indexes = await Promise.all(
    indexList.map(async (description) => ({
      ...description,
      columns: await database.all<IndexColumn>(
        sql`
          SELECT name, seqno FROM pragma_index_info(${description.name})
          ORDER BY seqno
        `
      )
    }))
  )

  return { columns, indexes }
}

async function objectNames(database: LibSQLDatabase): Promise<string[]> {
  const rows = await database.all<{ name: string }>(
    sql`
      SELECT name FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%'
      ORDER BY name
    `
  )

  return rows.map((row) => row.name)
}

describe('createTables', () => {
  it('builds the same database as the hand-written DDL it replaced', async () => {
    const generated = drizzle(':memory:')
    const handWritten = drizzle(':memory:')

    await createTables(generated)

    for (const statement of handWrittenStatements) {
      await handWritten.run(statement)
    }

    expect(await objectNames(generated)).toEqual(await objectNames(handWritten))

    for (const table of appTables) {
      const tableName = getTableName(table)

      expect(await describeTable(generated, tableName)).toEqual(
        await describeTable(handWritten, tableName)
      )
    }
  })

  it('creates the indexes a table declares', async () => {
    const database = drizzle(':memory:')

    await createTables(database, [widgetsTable])

    expect((await describeTable(database, 'widgets')).indexes).toEqual([
      {
        columns: [{ name: 'id', seqno: 0 }],
        name: 'sqlite_autoindex_widgets_1',
        origin: 'pk',
        partial: 0,
        unique: 1
      },
      {
        columns: [{ name: 'name', seqno: 0 }],
        name: 'widgets_name_index',
        origin: 'c',
        partial: 1,
        unique: 1
      },
      {
        columns: [{ name: 'ownerId', seqno: 0 }],
        name: 'widgets_owner_id_index',
        origin: 'c',
        partial: 0,
        unique: 0
      }
    ])
  })

  // The ALTER path has to invent a default for a NOT NULL column, because the
  // rows already in the table need a value. A fresh table has no rows, so the
  // schema's own default — or none — is what it gets.
  it('gives a $defaultFn column no default on a fresh table', async () => {
    const database = drizzle(':memory:')

    await createTables(database, [widgetsTable])

    expect((await describeTable(database, 'widgets')).columns).toEqual([
      {
        cid: 0,
        dflt_value: null,
        name: 'id',
        notnull: 1,
        pk: 1,
        type: 'TEXT'
      },
      {
        cid: 1,
        dflt_value: null,
        name: 'createdAt',
        notnull: 1,
        pk: 0,
        type: 'INTEGER'
      },
      {
        cid: 2,
        dflt_value: null,
        name: 'name',
        notnull: 1,
        pk: 0,
        type: 'TEXT'
      },
      {
        cid: 3,
        dflt_value: null,
        name: 'ownerId',
        notnull: 0,
        pk: 0,
        type: 'TEXT'
      },
      {
        cid: 4,
        dflt_value: "'draft'",
        name: 'status',
        notnull: 1,
        pk: 0,
        type: 'TEXT'
      }
    ])
  })

  // `CREATE INDEX IF NOT EXISTS` runs on every boot, so an index added to the
  // schema reaches existing databases too — as long as the column it covers
  // exists by then. Creating indexes before the missing columns are added would
  // fail the boot of every database older than the column.
  it('adds a missing column before indexing it on an older database', async () => {
    const database = drizzle(':memory:')

    await database.run(
      sql`CREATE TABLE widgets (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL)`
    )

    expect(await createTables(database, [widgetsTable])).toEqual([
      'widgets.createdAt',
      'widgets.ownerId',
      'widgets.status'
    ])

    expect(
      (await describeTable(database, 'widgets')).indexes.map(
        (description) => description.name
      )
    ).toEqual([
      'sqlite_autoindex_widgets_1',
      'widgets_name_index',
      'widgets_owner_id_index'
    ])
  })

  it('is idempotent', async () => {
    const database = drizzle(':memory:')

    await createTables(database)

    const before = await objectNames(database)

    expect(await createTables(database)).toEqual([])
    expect(await objectNames(database)).toEqual(before)
  })

  it('refuses a table with a foreign key rather than dropping it', async () => {
    const parentTable = sqliteTable('parents', { id: text().primaryKey() })
    const childTable = sqliteTable('children', {
      id: text().primaryKey(),
      parentId: text().references(() => parentTable.id)
    })

    await expect(
      createTables(drizzle(':memory:'), [childTable])
    ).rejects.toThrow(
      'Cannot create children: createTables does not generate foreign keys, composite primary keys, unique constraints or checks. Add support for them in src/database/tables.ts first.'
    )
  })
})
