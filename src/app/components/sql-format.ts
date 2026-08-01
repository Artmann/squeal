import { format } from 'sql-formatter'

import type { DatabaseType } from '@/glue/api/schemas'

// The subset of sql-formatter dialects Squeal can connect to.
export type SqlDialect = 'mysql' | 'postgresql' | 'sqlite'

const dialectsByDatabaseType: Record<DatabaseType, SqlDialect> = {
  mysql: 'mysql',
  postgres: 'postgresql',
  sqlite: 'sqlite'
}

// Thrown when the formatter cannot parse the statement. The caller shows the
// user-facing message; `details` keeps the parser's own complaint for logs.
export class SqlFormatError extends Error {
  readonly details: string

  constructor(details: string) {
    super('Could not format this SQL')

    this.details = details
    this.name = 'SqlFormatError'
  }
}

// Formats a whole document or a selection. Throws rather than returning
// half-formatted output, so a caller can never replace the document with a
// partial result.
export function formatSql(sql: string, dialect: SqlDialect): string {
  try {
    return format(sql, { language: dialect })
  } catch (error) {
    const details =
      error instanceof Error ? error.message : 'Unknown formatting error'

    throw new SqlFormatError(details)
  }
}

// Worksheets without a database fall back to PostgreSQL, the dialect Squeal
// leads with.
export function toSqlDialect(
  databaseType: DatabaseType | undefined
): SqlDialect {
  if (!databaseType) {
    return 'postgresql'
  }

  return dialectsByDatabaseType[databaseType]
}
