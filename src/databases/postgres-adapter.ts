import {
  Client,
  type ClientConfig,
  type QueryResult as DriverQueryResult
} from 'pg'
import Cursor from 'pg-cursor'

import { maxResultRows } from './adapter'
import type { DatabaseAdapter, QueryResult, SchemaInfo } from './adapter'
import {
  extractMissingColumn,
  extractMissingRelation,
  rewriteWithQuotedColumns,
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
    const client = await this.acquireConnection()

    this.activeClient = client

    console.log('Connected to database')

    try {
      // Postgres folds unquoted identifiers to lowercase, so a query written
      // with the real mixed-case table or column names fails. Retry with those
      // identifiers quoted, rewriting one at a time — Postgres only reports the
      // first offending identifier — until the query runs or nothing is left to
      // fix. The schema is fetched once and reused; the attempted set stops the
      // loop the moment a rewrite makes no progress.
      let currentQuery = query
      let schema: SchemaInfo | undefined
      const attempted = new Set<string>()

      for (;;) {
        try {
          return await this.executeQuery(client, currentQuery)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)

          // Columns first: "column "x" of relation "y" does not exist" is a
          // column problem, yet its message also matches the relation pattern.
          const missingColumn = extractMissingColumn(message)
          const missingRelation = missingColumn
            ? null
            : extractMissingRelation(message)

          if (!missingColumn && !missingRelation) {
            throw error
          }

          schema ??= await this.getSchemaWithClient(client)

          let rewritten: string | null = null

          if (missingColumn) {
            rewritten = rewriteWithQuotedColumns(
              currentQuery,
              schema,
              missingColumn
            )
          } else if (missingRelation) {
            rewritten = rewriteWithQuotedIdentifiers(
              currentQuery,
              schema,
              missingRelation
            )
          }

          if (!rewritten || attempted.has(rewritten)) {
            throw error
          }

          console.log(`  ↻ Retrying with quoted identifiers:\n${rewritten}\n`)

          attempted.add(rewritten)
          currentQuery = rewritten
        }
      }
    } finally {
      this.activeClient = null

      await client.end()
    }
  }

  // Connecting can transiently fail with "too many clients already" when the
  // server is momentarily at its connection cap (a busy neighbour, a spike of
  // background jobs). Retry a few times with backoff before surfacing a clear,
  // actionable error instead of the raw driver message.
  private async acquireConnection(): Promise<Client> {
    return connectWithRetry(
      async () => {
        const client = new Client(createClientConfig(this.connectionInfo))

        try {
          await client.connect()

          return client
        } catch (error) {
          // A client that failed to connect can't be reused; drop it before
          // the next attempt so we never leak a half-open connection.
          try {
            await client.end()
          } catch {
            // Cleanup is best-effort; the original error matters more.
          }

          throw error
        }
      },
      {
        delays: connectionRetryDelays,
        isRetryable: isTooManyClientsError,
        onExhausted: () =>
          new Error(
            `Can't connect to "${this.connectionInfo.database}" right now — the database server is busy with too many open connections. Please try again in a moment.`
          )
      }
    )
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

        // The terminal read past the last row returns no driver result, so only
        // adopt a batch that actually carried one — otherwise the fields and
        // row count captured from the real data would be lost.
        if (batch.result) {
          lastResult = batch.result
        }

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
): Promise<{
  result: DriverQueryResult | undefined
  rows: Record<string, unknown>[]
}> {
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

// Backoff between connection attempts when the server reports it is full. The
// count of entries is the number of retries after the initial attempt.
const connectionRetryDelays = [250, 750, 1500]

// Retries a connection while it fails with a retryable error, backing off
// between attempts, and returns the first successful connection. A
// non-retryable error propagates immediately; exhausting the retries throws
// the caller-provided error. Generic over the connection type so it can be
// unit-tested without a real driver.
export async function connectWithRetry<Connection>(
  connect: () => Promise<Connection>,
  options: {
    delays: number[]
    isRetryable: (error: unknown) => boolean
    onExhausted: (error: unknown) => Error
    sleep?: (milliseconds: number) => Promise<void>
  }
): Promise<Connection> {
  const sleep =
    options.sleep ??
    ((milliseconds) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))

  for (let attempt = 0; ; attempt++) {
    try {
      return await connect()
    } catch (error) {
      if (!options.isRetryable(error)) {
        throw error
      }

      if (attempt >= options.delays.length) {
        throw options.onExhausted(error)
      }

      await sleep(options.delays[attempt])
    }
  }
}

export function isTooManyClientsError(error: unknown): boolean {
  const messages =
    error instanceof AggregateError
      ? error.errors.map((inner) =>
          inner instanceof Error ? inner.message : String(inner)
        )
      : [error instanceof Error ? error.message : String(error)]

  return messages.some((message) =>
    message.toLowerCase().includes('too many clients')
  )
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
