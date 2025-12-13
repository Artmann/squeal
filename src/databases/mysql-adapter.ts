import mysql from 'mysql2/promise'

import type { DatabaseAdapter, QueryResult } from './adapter'
import type { MysqlConnectionInfo } from './schemas'

export class MysqlAdapter implements DatabaseAdapter {
  protected readonly connectionInfo: MysqlConnectionInfo

  constructor(connectionInfo: MysqlConnectionInfo) {
    this.connectionInfo = connectionInfo
  }

  async runQuery(query: string): Promise<QueryResult> {
    const connection = await mysql.createConnection(this.getConnectionConfig())

    try {
      console.log('Connected to database')

      console.log(`Running query:\n${query}\n`)

      const [rows, fields] = await connection.query(query)

      console.log(`  ✓ Query executed successfully\n`)

      return {
        fields: Array.isArray(fields) ? fields.map((f) => ({ name: f.name })) : [],
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
    return {
      database: this.connectionInfo.database,
      host: this.connectionInfo.host,
      password: this.connectionInfo.password,
      port: this.connectionInfo.port ?? 3306,
      user: this.connectionInfo.username
    }
  }
}
