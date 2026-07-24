import { SchemaInfo, TableInfo } from '@/databases/adapter'
import { DatabaseDto } from '@/glue/databases'

export interface DatabaseMatch {
  database: DatabaseDto
  expandDatabase: boolean
  tables: TableInfo[]
}

// Decides whether a database should appear in the explorer for the given search
// query and, if so, which tables to reveal. Matching is on database and table
// names only — column names are intentionally not filtered. Returns null when
// the database has no match. Table order is preserved from the schema, so
// results stay sorted the same way the tree renders them.
export function computeDatabaseMatch(
  database: DatabaseDto,
  schema: SchemaInfo | undefined,
  query: string
): DatabaseMatch | null {
  const normalizedQuery = query.trim().toLowerCase()

  if (normalizedQuery.length === 0) {
    return null
  }

  const tables = schema?.tables ?? []
  const matchingTables = tables.filter((table) =>
    table.tableName.toLowerCase().includes(normalizedQuery)
  )

  if (matchingTables.length > 0) {
    return {
      database,
      expandDatabase: true,
      tables: matchingTables
    }
  }

  // Only the database name matched, so show it collapsed. Its full table list is
  // kept so a manual expand during search still shows everything.
  if (database.name.toLowerCase().includes(normalizedQuery)) {
    return {
      database,
      expandDatabase: false,
      tables
    }
  }

  return null
}
