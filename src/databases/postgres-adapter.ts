import { Client, QueryResult } from 'pg'

import { PostgresConnectionInfo } from './schemas'

export { PostgresConnectionInfo } from './schemas'

export class PostgresAdapter {
  protected readonly connectionInfo: PostgresConnectionInfo

  constructor(connectionInfo: PostgresConnectionInfo) {
    this.connectionInfo = connectionInfo
  }

  async runQuery(query: string): Promise<QueryResult<any>> {
    const connectionString = createConnectionString(this.connectionInfo)

    const client = new Client({ connectionString })

    try {
      await client.connect()

      console.log('Connected to database')

      console.log(`Running query:\n${query}\n`)

      const result = await client.query(query)

      console.log(`  ✓ Query executed successfully\n`)

      return result
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
