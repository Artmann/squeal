// Turns a database's introspected schema into what CodeMirror's SQL completion
// wants, so the dropdown offers real table and column names instead of generic
// keywords.
import type { Completion } from '@codemirror/autocomplete'
import {
  MySQL,
  PostgreSQL,
  SQLite,
  type SQLDialect,
  type SQLNamespace
} from '@codemirror/lang-sql'

import type { DatabaseType, SchemaInfoDto } from '@/glue/api/schemas'

const dialectsByDatabaseType: Record<DatabaseType, SQLDialect> = {
  mysql: MySQL,
  postgres: PostgreSQL,
  sqlite: SQLite
}

// Worksheets without a database fall back to PostgreSQL, the dialect Squeal
// leads with — the same choice the formatter makes.
export function toEditorDialect(
  databaseType: DatabaseType | undefined
): SQLDialect {
  if (!databaseType) {
    return PostgreSQL
  }

  return dialectsByDatabaseType[databaseType]
}

function toColumnCompletion(column: {
  columnName: string
  dataType: string
  isPrimaryKey: boolean
}): Completion {
  return {
    detail: column.isPrimaryKey ? `${column.dataType} PK` : column.dataType,
    label: column.columnName,
    type: 'property'
  }
}

/**
 * Every table appears twice: once under its schema, so `public.film.` completes
 * columns, and once at the top level, so `from fil` completes without the user
 * having to qualify it. When two schemas hold a table of the same name, the
 * first one introspection returned wins the unqualified spot — the qualified
 * name still reaches the other.
 */
export function toSqlNamespace(schema: SchemaInfoDto): SQLNamespace {
  const namespace: Record<string, SQLNamespace> = {}
  const tablesBySchema = new Map<string, Record<string, SQLNamespace>>()

  for (const table of schema.tables) {
    const columns = table.columns.map(toColumnCompletion)

    if (table.tableSchema.length > 0) {
      let tables = tablesBySchema.get(table.tableSchema)

      if (tables === undefined) {
        tables = {}

        tablesBySchema.set(table.tableSchema, tables)
      }

      tables[table.tableName] = columns
    }

    namespace[table.tableName] ??= columns
  }

  // Written last so a schema always keeps its own name, even in the unlikely
  // case that a table shares it.
  for (const [schemaName, tables] of tablesBySchema) {
    namespace[schemaName] = tables
  }

  return namespace
}
