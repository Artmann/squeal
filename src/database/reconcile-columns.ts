import { getTableColumns, getTableName, sql, type SQL } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import type { AnySQLiteTable, SQLiteColumn } from 'drizzle-orm/sqlite-core'
import invariant from 'tiny-invariant'

/**
 * The column as `schema.ts` declares it: name, type, PRIMARY KEY, NOT NULL and
 * the schema's own DEFAULT. Shared by `CREATE TABLE` in tables.ts and
 * `ADD COLUMN` here, so the two cannot describe a column differently.
 *
 * Only a literal `.default(...)` becomes a DEFAULT. A `$defaultFn` is generated
 * per insert by Drizzle and has nothing to put in the DDL. The backfill default
 * an ALTER needs is added by `addColumnStatement`, never here, or a fresh
 * install would get `databaseId TEXT NOT NULL DEFAULT ''`.
 */
export function columnDefinition(column: SQLiteColumn): SQL {
  const parts = [
    sql`${sql.identifier(column.name)} ${sql.raw(column.getSQLType().toUpperCase())}`
  ]

  if (column.primary) {
    parts.push(sql` PRIMARY KEY`)
  }

  if (column.notNull) {
    parts.push(sql` NOT NULL`)
  }

  if (column.default !== undefined) {
    parts.push(sql` DEFAULT ${sql.raw(toLiteral(column.name, column.default))}`)
  }

  return sql.join(parts)
}

/**
 * Adds every column that `schema.ts` declares but the live table is missing.
 *
 * `CREATE TABLE IF NOT EXISTS` is a no-op on a table that already exists, so a
 * column added to `schema.ts` after a user's database was created never reaches
 * it that way. Drizzle names every column explicitly in both `SELECT` and
 * `INSERT`, so a single missing column fails *every* read and write on that
 * table — a packaged build shipped with `worksheets` and `queries` missing
 * `databaseId`, and both endpoints returned 500 on a database that had worked
 * for months.
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
      // `createTables` builds every table with its primary key.
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
    sql`ALTER TABLE ${sql.identifier(tableName)} ADD COLUMN `,
    columnDefinition(column)
  ]
  const backfill = backfillLiteral(column)

  if (backfill !== undefined) {
    parts.push(sql` DEFAULT ${sql.raw(backfill)}`)
  }

  return sql.join(parts)
}

// SQLite refuses `ADD COLUMN ... NOT NULL` without a default, because the rows
// that already exist need a value. A `$defaultFn` column has no literal to use
// — it is generated per insert — so one is synthesized by type.
//
// Empty string rather than NULL on purpose: these columns are `Schema.String`
// in the API contract, so a NULL would trade a failing query for a failing
// response encoding. The renderer already reads an empty `databaseId` as "no
// database" (src/app/collections.ts).
function backfillLiteral(column: SQLiteColumn): string | undefined {
  if (column.default !== undefined || !column.notNull) {
    return undefined
  }

  return column.getSQLType() === 'text' ? "''" : '0'
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

function toLiteral(columnName: string, value: unknown): string {
  if (typeof value === 'number') {
    return String(value)
  }

  invariant(
    typeof value === 'string',
    `Cannot build a DEFAULT clause for ${columnName}: only string and number defaults are supported. Give it a string or number .default(...) in schema.ts, or use $defaultFn and set it on insert.`
  )

  return `'${value.replaceAll("'", "''")}'`
}
