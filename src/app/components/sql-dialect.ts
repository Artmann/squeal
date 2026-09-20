import { MySQL, PostgreSQL, SQLDialect, SQLite } from '@codemirror/lang-sql'

import type { DatabaseType } from '@/glue/api/schemas'

const dialectsByDatabaseType: Record<DatabaseType, SQLDialect> = {
  mysql: MySQL,
  postgres: PostgreSQL,
  sqlite: SQLite
}

/**
 * The CodeMirror dialect for a worksheet's connection. It decides three things
 * at once — how the document is parsed, which keywords and types complete, and
 * which quote character an identifier that needs quoting gets — so a worksheet
 * pointed at MySQL stops mis-highlighting backticks and stops offering
 * PostgreSQL-only keywords.
 *
 * Worksheets without a database fall back to PostgreSQL, the dialect Squeal
 * leads with, which is the same fallback `toSqlDialect` makes for the
 * formatter.
 *
 * Deliberately a second function rather than a widening of that one:
 * `toSqlDialect` answers with a `sql-formatter` language string and this one
 * with a CodeMirror `SQLDialect` object, so one function returning both would
 * have a union return type neither caller wants.
 */
export function toCodeMirrorDialect(
  databaseType: DatabaseType | undefined
): SQLDialect {
  if (!databaseType) {
    return PostgreSQL
  }

  return dialectsByDatabaseType[databaseType]
}

/**
 * The character the dialect quotes identifiers with, read from the dialect's
 * own spec rather than mapped from `DatabaseType` a second time.
 *
 * This has to agree with lang-sql: it auto-quotes the names it generates
 * itself (`nameCompletion`) using `spec.identifierQuotes[0]`, so deriving the
 * character anywhere else is how a schema ends up offering `` `orders` `` and
 * `"orders"` in the same list. SQLite accepts both and declares them in that
 * order, which is why this reads the first rather than choosing.
 */
export function toIdentifierQuote(dialect: SQLDialect): string {
  return dialect.spec.identifierQuotes?.[0] ?? '"'
}
