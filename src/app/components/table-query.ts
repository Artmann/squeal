import type { TableInfo } from '@/databases/adapter'
import type { DatabaseType } from '@/glue/api/schemas'

const rowLimit = 100

// Identifiers are always quoted rather than quoted only when they look unsafe.
// That covers mixed case, spaces, and reserved words like `order` in one rule,
// without a per-dialect keyword list to keep current.
function quoteIdentifier(
  identifier: string,
  databaseType: DatabaseType
): string {
  const quote = databaseType === 'mysql' ? '`' : '"'

  return `${quote}${identifier.split(quote).join(quote + quote)}${quote}`
}

/**
 * The SQL behind "Query Table" in the sidebar. It has to be a single statement:
 * the same string becomes the new worksheet's content and the query that runs
 * against the database.
 *
 * The schema is only spelled out when the database has more than one, so the
 * common case stays readable. Without it, a table outside the connection's
 * default schema fails — Postgres recovers by retrying with a qualified name
 * (see `postgres-identifier-fixer.ts`), but MySQL and SQLite do not.
 */
export function buildTableQuery(
  table: TableInfo,
  databaseType: DatabaseType,
  hasMultipleSchemas: boolean
): string {
  const tableName = quoteIdentifier(table.tableName, databaseType)

  const qualifiedName =
    hasMultipleSchemas && table.tableSchema
      ? `${quoteIdentifier(table.tableSchema, databaseType)}.${tableName}`
      : tableName

  return `SELECT * FROM ${qualifiedName} LIMIT ${rowLimit}`
}
