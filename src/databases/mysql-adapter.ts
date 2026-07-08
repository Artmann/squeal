import { createConnection, type FieldPacket } from 'mysql2'
import mysql from 'mysql2/promise'

import { maxResultRows } from './adapter'
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
    // The callback API is the only one that emits per-row events, which lets
    // us stop reading once the row cap is reached instead of buffering the
    // whole result set.
    const connection = createConnection(this.getConnectionConfig())
    let destroyed = false

    console.log(`Running query:\n${query}\n`)

    try {
      return await new Promise<QueryResult>((resolve, reject) => {
        const rows: Record<string, unknown>[] = []
        let affectedRows: number | undefined
        let fields: { name: string }[] = []
        let settled = false

        const statement = connection.query(query)

        // The published typing claims a single FieldPacket, but at runtime
        // mysql2 emits the whole array (or undefined for DML results).
        statement.on('fields', (packet: FieldPacket[] | undefined) => {
          fields = (packet ?? []).map((field) => ({ name: field.name }))
        })

        statement.on('result', (row) => {
          if (settled) {
            return
          }

          if ('affectedRows' in row) {
            affectedRows = row.affectedRows

            return
          }

          if (rows.length === maxResultRows) {
            settled = true
            destroyed = true

            // Destroying the socket is the only way to stop mysql2 in the
            // middle of a result set; safe because the connection is scoped
            // to this query and never pooled.
            connection.destroy()

            console.log(`  ✓ Query executed successfully\n`)

            resolve({ fields, rowCount: rows.length, rows, truncated: true })

            return
          }

          rows.push(row as unknown as Record<string, unknown>)
        })

        // mysql2 emits end after error, so the settled guard prevents double
        // settlement.
        statement.on('error', (error) => {
          if (settled) {
            return
          }

          settled = true

          reject(error)
        })

        statement.on('end', () => {
          if (settled) {
            return
          }

          settled = true

          console.log(`  ✓ Query executed successfully\n`)

          resolve({
            fields,
            rowCount: affectedRows ?? rows.length,
            rows,
            truncated: false
          })
        })
      })
    } finally {
      if (!destroyed) {
        connection.end()
      }
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
