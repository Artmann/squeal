// Adapters never buffer more than this many rows; larger result sets are cut
// off at the driver and flagged as truncated.
export const maxResultRows = 10_000

// Thrown by adapters when a query was canceled rather than failed: either
// before it ever reached the server — while the connection was still being
// established, say — or by the server acknowledging a cancel this app asked
// for. Adapters raise it in place of the driver error so callers can tell a
// cancellation from a failure by type.
//
// Callers still fall back to matching the server's message, and that fallback
// is not dead yet: an adapter raises this only for a cancel it requested and
// recognised, so one arriving by a route it does not cover still surfaces as a
// driver error. The aim is for the fallback to become redundant — it is not
// redundant today, and deleting it would bring the localized-message bug back.
export class QueryCanceledError extends Error {
  constructor() {
    super('Query canceled.')

    this.name = 'QueryCanceledError'
  }
}

export interface QueryResult {
  fields: { name: string }[]

  // Number of rows returned (at most maxResultRows) for row-returning
  // statements, or the driver-reported affected-row count for DML. When
  // truncated is true the true total is unknown.
  rowCount: number

  rows: Record<string, unknown>[]
  truncated: boolean
}

export interface ColumnInfo {
  columnName: string
  dataType: string
  defaultValue: string | null
  isNullable: boolean
  isPrimaryKey: boolean
  ordinalPosition: number
}

export interface ForeignKeyInfo {
  columnName: string
  constraintName: string
  referencedColumnName: string
  referencedTableName: string
  referencedTableSchema: string
}

export interface TableInfo {
  columns: ColumnInfo[]
  foreignKeys: ForeignKeyInfo[]
  tableName: string
  tableSchema: string
}

export interface SchemaInfo {
  databaseName: string
  tables: TableInfo[]
}

export interface DatabaseAdapter {
  getSchema(): Promise<SchemaInfo>
  runQuery(query: string): Promise<QueryResult>
  testConnection(): Promise<void>

  // Best-effort cancellation of the query currently running through this
  // adapter instance. Adapters that cannot abort a query in flight may leave
  // this undefined.
  cancel?(): Promise<void>

  // The server's product and release, already formatted for display, for
  // example "PostgreSQL 16". Decoration only: adapters that cannot ask leave
  // this undefined, and callers must treat a rejection as "version unknown"
  // rather than as a failure worth showing the user.
  getServerVersion?(): Promise<string>
}
