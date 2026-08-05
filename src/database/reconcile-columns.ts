import { getTableColumns, getTableName, sql, type SQL } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import type { AnySQLiteTable, SQLiteColumn } from 'drizzle-orm/sqlite-core'
import invariant from 'tiny-invariant'

/**
 * Adds every column that `schema.ts` declares but the live table is missing.
 *
 * `createTables` uses `CREATE TABLE IF NOT EXISTS`, so a column added to
 * `schema.ts` after a user's database was created never reaches it. Drizzle
 * names every column explicitly in both `SELECT` and `INSERT`, so a single
 * missing column fails *every* read and write on that table — a packaged build
 * shipped with `worksheets` and `queries` missing `databaseId`, and both
 * endpoints returned 500 on a database that had worked for months.
 *
 * Deriving the statements from `schema.ts` rather than a hand-written list is
 * what keeps that from happening again: there is no second list to forget.
 *
 * Returns the columns it added, as `table.column`, so the caller can log what
 * an old database needed.
 */
export async function reconcileColumns(
  database: LibSQLDatabase,
  tables: AnySQLiteTable[]
): Promise<string[]> {
  const added: string[] = []

  for (const table of tables) {
    const tableName = getTableName(table)
    const existing = await columnNames(database, tableName)

    // A table that does not exist yet belongs to `createTables`, not here — an
    // ALTER against it would throw.
    if (existing.size === 0) {
      continue
    }

    for (const column of Object.values(getTableColumns(table))) {
      if (existing.has(column.name)) {
        continue
      }

      // A primary key cannot be added by ALTER TABLE, and never needs to be:
      // every CREATE TABLE in tables.ts declares one.
      if (column.primary) {
        continue
      }

      await database.run(addColumnStatement(tableName, column))

      added.push(`${tableName}.${column.name}`)
    }
  }

  return added
}

function addColumnStatement(tableName: string, column: SQLiteColumn): SQL {
  const parts = [
    sql`ALTER TABLE ${sql.identifier(tableName)}`,
    sql` ADD COLUMN ${sql.identifier(column.name)} ${sql.raw(column.getSQLType())}`
  ]

  if (column.notNull) {
    parts.push(sql` NOT NULL`)
  }

  const literal = defaultLiteral(column)

  if (literal !== undefined) {
    parts.push(sql` DEFAULT ${sql.raw(literal)}`)
  }

  return sql.join(parts)
}

async function columnNames(
  database: LibSQLDatabase,
  tableName: string
): Promise<Set<string>> {
  const rows = await database.all<{ name: string }>(
    sql`SELECT name FROM pragma_table_info(${tableName})`
  )

  return new Set(rows.map((row) => row.name))
}

// SQLite refuses `ADD COLUMN ... NOT NULL` without a default, because the rows
// that already exist need a value. A `$defaultFn` column has no literal to use
// — it is generated per insert — so one is synthesized by type.
//
// Empty string rather than NULL on purpose: these columns are `Schema.String`
// in the API contract, so a NULL would trade a failing query for a failing
// response encoding. The renderer already reads an empty `databaseId` as "no
// database" (src/app/collections.ts).
function defaultLiteral(column: SQLiteColumn): string | undefined {
  if (column.default !== undefined) {
    return toLiteral(column.name, column.default)
  }

  if (!column.notNull) {
    return undefined
  }

  return column.getSQLType() === 'text' ? "''" : '0'
}

function toLiteral(columnName: string, value: unknown): string {
  if (typeof value === 'number') {
    return String(value)
  }

  invariant(
    typeof value === 'string',
    `Cannot build a DEFAULT clause for ${columnName}: only string and number defaults are supported. Add the column to tables.ts by hand instead.`
  )

  return `'${value.replaceAll("'", "''")}'`
}
