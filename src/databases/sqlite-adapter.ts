import { createClient } from '@libsql/client'
import Database from 'libsql'
import { pathToFileURL } from 'url'

import { maxResultRows } from './adapter'
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
    const database = new Database(this.connectionInfo.path)

    try {
      const statement = database.prepare(query)

      if (!statement.reader) {
        const info = statement.run()

        return {
          fields: [],
          rowCount: info.changes,
          rows: [],
          truncated: false
        }
      }

      const fields = statement
        .columns()
        .map((column) => ({ name: column.name }))
      const rows: Record<string, unknown>[] = []
      let truncated = false

      // iterate() pulls rows from the native layer lazily, so memory stays
      // bounded no matter how large the result set is.
      for (const row of statement.iterate()) {
        if (rows.length === maxResultRows) {
          truncated = true

          break
        }

        rows.push(row as Record<string, unknown>)
      }

      return { fields, rowCount: rows.length, rows, truncated }
    } finally {
      database.close()
    }
  }

  async testConnection(): Promise<void> {
    const client = createClient({ url: this.getConnectionUrl() })

    try {
      await client.execute('SELECT 1')
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
