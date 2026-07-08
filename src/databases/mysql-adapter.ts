import mysql from 'mysql2/promise'

import type { DatabaseAdapter, QueryResult, SchemaInfo } from './adapter'
import {
  type ColumnRow,
  type ForeignKeyRow,
  mysqlColumnsQuery,
  mysqlForeignKeysQuery,
  transformToSchemaInfo
} from './schema-provider'
import type { MysqlConnectionInfo } from './schemas'
import { createSslOptions } from './ssl-options'

export class MysqlAdapter implements DatabaseAdapter {
  protected readonly connectionInfo: MysqlConnectionInfo

  constructor(connectionInfo: MysqlConnectionInfo) {
    this.connectionInfo = connectionInfo
  }

  async getSchema(): Promise<SchemaInfo> {
    const connection = await mysql.createConnection(this.getConnectionConfig())

    try {
      const [columnRows] = await connection.query(mysqlColumnsQuery)
      const [foreignKeyRows] = await connection.query(mysqlForeignKeysQuery)

      return transformToSchemaInfo(
        this.connectionInfo.database,
        columnRows as ColumnRow[],
        foreignKeyRows as ForeignKeyRow[]
      )
    } finally {
      await connection.end()
    }
  }

  async runQuery(query: string): Promise<QueryResult> {
    const connection = await mysql.createConnection(this.getConnectionConfig())

    try {
      console.log('Connected to database')

      console.log(`Running query:\n${query}\n`)

      const [rows, fields] = await connection.query(query)

      console.log(`  ✓ Query executed successfully\n`)

      const maxRows = 10_000
      const allRows = Array.isArray(rows)
        ? (rows as Record<string, unknown>[])
        : []
      const truncated = allRows.length > maxRows

      return {
        fields: Array.isArray(fields)
          ? fields.map((f) => ({ name: f.name }))
          : [],
        rowCount: Array.isArray(rows) ? rows.length : 0,
        rows: truncated ? allRows.slice(0, maxRows) : allRows,
        truncated
      }
    } finally {
      await connection.end()
    }
  }

  async testConnection(): Promise<void> {
    const connection = await mysql.createConnection({
      ...this.getConnectionConfig(),
      connectTimeout: 5000
    })

    try {
      await connection.ping()

      console.log('Connected to database successfully')
    } finally {
      await connection.end()
    }
  }

  private getConnectionConfig() {
    const { database, host, password, port, username } = this.connectionInfo

    const ssl = createSslOptions(this.connectionInfo)

    return {
      database,
      host,
      password,
      port: port ?? 3306,
      user: username,
      ...(ssl ? { ssl } : {})
    }
  }
}
