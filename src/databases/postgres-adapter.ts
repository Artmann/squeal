import { Client } from 'pg'

import type { DatabaseAdapter, QueryResult } from './adapter'
import type { PostgresConnectionInfo } from './schemas'

export class PostgresAdapter implements DatabaseAdapter {
  protected readonly connectionInfo: PostgresConnectionInfo

  constructor(connectionInfo: PostgresConnectionInfo) {
    this.connectionInfo = connectionInfo
  }

  async runQuery(query: string): Promise<QueryResult> {
    const connectionString = createConnectionString(this.connectionInfo)

    const client = new Client({ connectionString })

    try {
      await client.connect()

      console.log('Connected to database')

      console.log(`Running query:\n${query}\n`)

      const result = await client.query(query)

      console.log(`  ✓ Query executed successfully\n`)

      return {
        fields: result.fields.map((f) => ({ name: f.name })),
        rowCount: result.rowCount ?? 0,
        rows: result.rows as Record<string, unknown>[]
      }
    } finally {
      await client.end()
    }
  }

  async testConnection(): Promise<void> {
    const connectionString = createConnectionString(this.connectionInfo)

    const client = new Client({ connectionString, statement_timeout: 5000 })

    try {
      await client.connect()

      console.log('Connected to database successfully')
    } finally {
      await client.end()
    }
  }
}

function createConnectionString(info: PostgresConnectionInfo): string {
  const { username, password, host, port = 5432, database } = info

  return `postgresql://${username}:${password}@${host}:${port}/${database}`
}
