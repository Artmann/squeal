import { is, sql, type SQL } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import {
  getTableConfig,
  SQLiteColumn,
  type AnySQLiteTable,
  type Index
} from 'drizzle-orm/sqlite-core'
import invariant from 'tiny-invariant'

import { appTables } from './app-tables'
import { columnDefinition, reconcileColumns } from './reconcile-columns'

type TableConfig = ReturnType<typeof getTableConfig>

/**
 * Brings the app database up to `schema.ts`, whatever state it is in: creates
 * the tables a fresh install lacks, adds the columns an older database lacks,
 * then creates the indexes either one lacks.
 *
 * The DDL is generated from the schema, so there is no second description of
 * it to drift. Indexes come last on purpose: `CREATE INDEX IF NOT EXISTS` runs
 * on every boot, which is what carries a new index to existing databases, and
 * an index over a column added in the same release needs that column to exist
 * first.
 *
 * Returns the columns `reconcileColumns` added, as `table.column`. Shared
 * between the app database bootstrap and the in-memory test databases.
 */
export async function createTables(
  database: LibSQLDatabase,
  tables: AnySQLiteTable[] = appTables
): Promise<string[]> {
  const configs = tables.map(supportedTableConfig)

  for (const config of configs) {
    await database.run(createTableStatement(config))
  }

  const added = await reconcileColumns(database, tables)

  for (const config of configs) {
    for (const tableIndex of config.indexes) {
      await database.run(createIndexStatement(config.name, tableIndex))
    }
  }

  return added
}

function createIndexStatement(tableName: string, tableIndex: Index): SQL {
  const { columns, name, unique, where } = tableIndex.config
  const indexedColumns = columns.map((column) =>
    is(column, SQLiteColumn) ? sql.identifier(column.name) : column
  )
  const parts = [
    sql`CREATE ${sql.raw(unique ? 'UNIQUE INDEX' : 'INDEX')} IF NOT EXISTS ${sql.identifier(name)}`,
    sql` ON ${sql.identifier(tableName)} (${sql.join(indexedColumns, sql`, `)})`
  ]

  if (where !== undefined) {
    parts.push(sql` WHERE ${where}`)
  }

  return sql.join(parts)
}

function createTableStatement(config: TableConfig): SQL {
  const columns = config.columns.map(columnDefinition)

  return sql`CREATE TABLE IF NOT EXISTS ${sql.identifier(config.name)} (${sql.join(columns, sql`, `)})`
}

// Only what `schema.ts` uses today is generated. Anything else would be
// silently left out of every fresh install, so it is refused instead.
function supportedTableConfig(table: AnySQLiteTable): TableConfig {
  const config = getTableConfig(table)
  const unsupported =
    config.checks.length > 0 ||
    config.foreignKeys.length > 0 ||
    config.primaryKeys.length > 0 ||
    config.uniqueConstraints.length > 0 ||
    config.columns.some((column) => column.isUnique)

  invariant(
    !unsupported,
    `Cannot create ${config.name}: createTables does not generate foreign keys, composite primary keys, unique constraints or checks. Add support for them in src/database/tables.ts first.`
  )

  return config
}
