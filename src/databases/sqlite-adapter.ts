import { createClient } from '@libsql/client'
import { pathToFileURL } from 'url'

import type {
  ColumnInfo,
  DatabaseAdapter,
  QueryResult,
  SchemaInfo
} from './adapter'
import type { SqliteConnectionInfo } from './schemas'

export class SqliteAdapter implements DatabaseAdapter {
  protected readonly connectionInfo: SqliteConnectionInfo

  constructor(connectionInfo: SqliteConnectionInfo) {
    this.connectionInfo = connectionInfo
  }

  async getSchema(): Promise<SchemaInfo> {
    const client = createClient({ url: this.getConnectionUrl() })

    try {
      const tablesResult = await client.execute(`
        SELECT name FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `)

      const tables = await Promise.all(
        tablesResult.rows.map(async (row) => {
          const tableName = row.name as string
          const [columns, foreignKeys] = await Promise.all([
            this.getTableColumns(client, tableName),
            this.getTableForeignKeys(client, tableName)
          ])

          return {
            columns,
            foreignKeys,
            tableName,
            tableSchema: 'main'
          }
        })
      )

      return {
        databaseName: this.getDatabaseName(),
        tables
      }
    } finally {
      client.close()
    }
  }

  async runQuery(query: string): Promise<QueryResult> {
    const client = createClient({ url: this.getConnectionUrl() })

    try {
      console.log('Connected to SQLite database')
      console.log(`Running query:\n${query}\n`)

      const result = await client.execute(query)

      console.log(`  ✓ Query executed successfully\n`)

      const fields = result.columns.map((name) => ({ name }))
      const rows = result.rows.map((row) => {
        const record: Record<string, unknown> = {}

        for (let i = 0; i < result.columns.length; i++) {
          record[result.columns[i]] = row[i]
        }

        return record
      })

      const maxRows = 10_000
      const truncated = rows.length > maxRows

      return {
        fields,
        rowCount: result.rows.length,
        rows: truncated ? rows.slice(0, maxRows) : rows,
        truncated
      }
    } finally {
      client.close()
    }
  }

  async testConnection(): Promise<void> {
    const client = createClient({ url: this.getConnectionUrl() })

    try {
      await client.execute('SELECT 1')

      console.log('Connected to SQLite database successfully')
    } finally {
      client.close()
    }
  }

  private async getTableColumns(
    client: ReturnType<typeof createClient>,
    tableName: string
  ): Promise<ColumnInfo[]> {
    const result = await client.execute(`PRAGMA table_info("${tableName}")`)

    return result.rows.map((row) => ({
      columnName: row.name as string,
      dataType: (row.type as string) || 'TEXT',
      defaultValue: row.dflt_value as string | null,
      isNullable: row.notnull === 0,
      isPrimaryKey: row.pk === 1,
      ordinalPosition: (row.cid as number) + 1
    }))
  }

  private async getTableForeignKeys(
    client: ReturnType<typeof createClient>,
    tableName: string
  ): Promise<
    {
      columnName: string
      constraintName: string
      referencedColumnName: string
      referencedTableName: string
      referencedTableSchema: string
    }[]
  > {
    const result = await client.execute(
      `PRAGMA foreign_key_list("${tableName}")`
    )

    return result.rows.map((row) => ({
      columnName: row.from as string,
      constraintName: `fk_${tableName}_${row.id}`,
      referencedColumnName: row.to as string,
      referencedTableName: row.table as string,
      referencedTableSchema: 'main'
    }))
  }

  private getConnectionUrl(): string {
    return pathToFileURL(this.connectionInfo.path).toString()
  }

  private getDatabaseName(): string {
    const parts = this.connectionInfo.path.split(/[/\\]/)

    return parts[parts.length - 1] ?? 'sqlite'
  }
}
