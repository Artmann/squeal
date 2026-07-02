export interface QueryResult {
  fields: { name: string }[]
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
}
