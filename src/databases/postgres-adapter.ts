import { Client, QueryResult } from 'pg'

export interface PostgresConnectionInfo {
  database: string
  host: string
  password: string
  port?: number
  username: string
}

export class PostgresAdapter {
  async runQuery(
    info: PostgresConnectionInfo,
    query: string
  ): Promise<QueryResult<any>> {
    const connectionString = createConnectionString(info)

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
}

function createConnectionString(info: PostgresConnectionInfo): string {
  const { username, password, host, port = 5432, database } = info

  return `postgresql://${username}:${password}@${host}:${port}/${database}`
}
