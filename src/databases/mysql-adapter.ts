import fs from 'fs'

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

      return {
        fields: Array.isArray(fields)
          ? fields.map((f) => ({ name: f.name }))
          : [],
        rowCount: Array.isArray(rows) ? rows.length : 0,
        rows: Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []
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
    const { database, host, password, port, sslMode, sslRootCert, username } =
      this.connectionInfo

    const base = {
      database,
      host,
      password,
      port: port ?? 3306,
      user: username
    }

    if (!sslMode || sslMode === 'disable') {
      return base
    }

    if (sslMode === 'require') {
      return { ...base, ssl: { rejectUnauthorized: false } }
    }

    // verify-full
    if (sslRootCert && sslRootCert !== 'system') {
      return {
        ...base,
        ssl: {
          ca: fs.readFileSync(sslRootCert).toString(),
          rejectUnauthorized: true
        }
      }
    }

    return { ...base, ssl: { rejectUnauthorized: true } }
  }
}
