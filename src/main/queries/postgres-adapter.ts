import { Client, QueryResult } from 'pg'

export class PostgresAdapter {
  async runQuery(query: string): Promise<QueryResult<any>> {
    const databaseUrl = 'postgresql://postgres:postgres@localhost:5432/squeal'
    const client = new Client({ connectionString: databaseUrl })

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
