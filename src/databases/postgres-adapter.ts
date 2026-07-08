import {
  Client,
  type ClientConfig,
  type QueryResult as DriverQueryResult
} from 'pg'
import Cursor from 'pg-cursor'

import { maxResultRows } from './adapter'
import type { DatabaseAdapter, QueryResult, SchemaInfo } from './adapter'
import {
  extractMissingRelation,
  rewriteWithQuotedIdentifiers
} from './postgres-identifier-fixer'
import {
  postgresColumnsQuery,
  postgresForeignKeysQuery,
  transformToSchemaInfo
} from './schema-provider'
import type { PostgresConnectionInfo } from './schemas'
import { createSslOptions } from './ssl-options'

export class PostgresAdapter implements DatabaseAdapter {
  protected readonly connectionInfo: PostgresConnectionInfo

  private activeClient: Client | null = null

  constructor(connectionInfo: PostgresConnectionInfo) {
    this.connectionInfo = connectionInfo
  }

  async cancel(): Promise<void> {
    // node-postgres exposes the backend process id at runtime, but it is not
    // present on the published Client type.
    const backendProcessId = this.activeClient
      ? (this.activeClient as unknown as { processID?: number | null })
          .processID
      : undefined

    if (!backendProcessId) {
      return
    }

    // Postgres cancellation must be issued over a separate connection — the
    // one running the query is busy — so we open a throwaway client and ask
    // the server to cancel the running backend.
    const cancelClient = new Client(createClientConfig(this.connectionInfo))

    try {
      await cancelClient.connect()

      await cancelClient.query('SELECT pg_cancel_backend($1)', [
        backendProcessId
      ])
    } finally {
      await cancelClient.end()
    }
  }

  async getSchema(): Promise<SchemaInfo> {
    const client = new Client(createClientConfig(this.connectionInfo))

    try {
      await client.connect()

      return await this.getSchemaWithClient(client)
    } finally {
      await client.end()
    }
  }

  async runQuery(query: string): Promise<QueryResult> {
    const client = new Client(createClientConfig(this.connectionInfo))

    try {
      await client.connect()

      this.activeClient = client

      console.log('Connected to database')

      try {
        return await this.executeQuery(client, query)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const missingRelation = extractMissingRelation(message)

        if (!missingRelation) {
          throw error
        }

        const schema = await this.getSchemaWithClient(client)
        const rewritten = rewriteWithQuotedIdentifiers(
          query,
          schema,
          missingRelation
        )

        if (!rewritten) {
          throw error
        }

        console.log(`  ↻ Retrying with quoted identifiers:\n${rewritten}\n`)

        return await this.executeQuery(client, rewritten)
      }
    } finally {
      this.activeClient = null

      await client.end()
    }
  }

  private async executeQuery(
    client: Client,
    query: string
  ): Promise<QueryResult> {
    console.log(`Running query:\n${query}\n`)

    const cursor = client.query(new Cursor<Record<string, unknown>>(query))
    const rows: Record<string, unknown>[] = []
    let lastResult: DriverQueryResult | undefined

    try {
      // Read in batches and stop one row past the cap, so huge result sets
      // never materialize in memory.
      while (rows.length <= maxResultRows) {
        const batchSize = Math.min(1_000, maxResultRows + 1 - rows.length)
        const batch = await readBatch(cursor, batchSize)

        lastResult = batch.result

        if (batch.rows.length === 0) {
          break
        }

        rows.push(...batch.rows)
      }
    } finally {
      try {
        // The client must be back at ready-for-query before it is reused for
        // the identifier-rewrite retry or ended.
        await cursor.close()
      } catch {
        // Closing is best-effort; the original error matters more.
      }
    }

    console.log(`  ✓ Query executed successfully\n`)

    const truncated = rows.length > maxResultRows
    const returnedRows = truncated ? rows.slice(0, maxResultRows) : rows

    return {
      fields: (lastResult?.fields ?? []).map((field) => ({ name: field.name })),
      // When truncated, the statement never completes, so the driver has no
      // total and we report the number of rows returned instead.
      rowCount: lastResult?.rowCount ?? returnedRows.length,
      rows: returnedRows,
      truncated
    }
  }

  private async getSchemaWithClient(client: Client): Promise<SchemaInfo> {
    const [columnsResult, foreignKeysResult] = await Promise.all([
      client.query(postgresColumnsQuery),
      client.query(postgresForeignKeysQuery)
    ])

    return transformToSchemaInfo(
      this.connectionInfo.database,
      columnsResult.rows,
      foreignKeysResult.rows
    )
  }

  async testConnection(): Promise<void> {
    const client = new Client({
      ...createClientConfig(this.connectionInfo),
      statement_timeout: 5000
    })

    try {
      await client.connect()

      console.log('Connected to database successfully')
    } finally {
      await client.end()
    }
  }
}

// The callback form of cursor.read is the only one that exposes the driver
// result carrying the fields metadata and the affected-row count.
function readBatch(
  cursor: Cursor<Record<string, unknown>>,
  count: number
): Promise<{ result: DriverQueryResult; rows: Record<string, unknown>[] }> {
  return new Promise((resolve, reject) => {
    cursor.read(count, (error, rows, result) => {
      if (error) {
        reject(error)

        return
      }

      resolve({ result, rows })
    })
  })
}

function createClientConfig(info: PostgresConnectionInfo): ClientConfig {
  const { database, host, password, port, username } = info

  const ssl = createSslOptions(info)

  return {
    database,
    host,
    password,
    port: port ?? 5432,
    user: username,
    ...(ssl ? { ssl } : {})
  }
}
