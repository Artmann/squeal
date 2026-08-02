import { createConnection, type FieldPacket } from 'mysql2'
import mysql from 'mysql2/promise'

import { maxResultRows } from './adapter'
import { closeQuietly } from './close-quietly'
import type { DatabaseAdapter, QueryResult, SchemaInfo } from './adapter'
import {
  type ColumnRow,
  type ForeignKeyRow,
  mysqlColumnsQuery,
  mysqlForeignKeysQuery,
  transformToSchemaInfo
} from './schema-provider'
import type { MysqlConnectionInfo } from './schemas'
import {
  formatMysqlServerVersion,
  requireServerVersion
} from './server-version'
import { createSslOptions } from './ssl-options'

// Matches the handler's own probe timeout, so the socket is released at roughly
// the moment the caller stops waiting for the answer.
const serverVersionTimeoutMs = 3000

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
      await closeQuietly(() => connection.end(), 'schema')
    }
  }

  // Opens its own short-lived connection rather than borrowing the query one:
  // the probe must never share fate with a user query.
  async getServerVersion(): Promise<string> {
    const connection = await mysql.createConnection(this.getConnectionConfig())

    // `connectTimeout` only bounds the handshake, and mysql2 has no per-query
    // timeout. Without destroying the socket, a server that answers the
    // handshake and then stalls leaves this query pending forever — so the
    // `finally` never runs and the connection is retained for the life of the
    // process.
    let timedOut = false

    const timeout = setTimeout(() => {
      timedOut = true
      connection.destroy()
    }, serverVersionTimeoutMs)

    try {
      const [rows] = await connection.query('SELECT VERSION() AS version')
      const [row] = rows as { version?: string }[]
      const rawVersion = row?.version ?? ''

      return requireServerVersion(
        formatMysqlServerVersion(rawVersion),
        rawVersion
      )
    } finally {
      clearTimeout(timeout)

      // `destroy()` has already torn the socket down; calling `end()` on top of
      // it throws.
      if (!timedOut) {
        await closeQuietly(() => connection.end(), 'version probe')
      }
    }
  }

  async runQuery(query: string): Promise<QueryResult> {
    // The callback API is the only one that emits per-row events, which lets
    // us stop reading once the row cap is reached instead of buffering the
    // whole result set.
    const connection = createConnection(this.getConnectionConfig())
    let destroyed = false

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
        await closeQuietly(() => connection.end(), 'query')
      }
    }
  }

  async testConnection(): Promise<void> {
    const connection = await mysql.createConnection(this.getConnectionConfig())

    try {
      await connection.ping()
    } finally {
      await closeQuietly(() => connection.end(), 'connection test')
    }
  }

  private getConnectionConfig() {
    const { database, host, password, port, username } = this.connectionInfo

    const ssl = createSslOptions(this.connectionInfo)

    return {
      // Every connection — queries and schema loads included, not just the
      // connection test — should give up instead of hanging forever.
      connectTimeout: 5000,
      database,
      host,
      password,
      port: port ?? 3306,
      user: username,
      ...(ssl ? { ssl } : {})
    }
  }
}
