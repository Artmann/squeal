export interface QueryResult {
  fields: { name: string }[]
  rowCount: number
  rows: Record<string, unknown>[]
}

export interface DatabaseAdapter {
  runQuery(query: string): Promise<QueryResult>
  testConnection(): Promise<void>
}
