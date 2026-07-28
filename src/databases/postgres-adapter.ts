import {
  Client,
  type ClientConfig,
  type QueryResult as DriverQueryResult
} from 'pg'
import Cursor from 'pg-cursor'
import { log } from 'tiny-typescript-logger'

import { maxResultRows, QueryCanceledError } from './adapter'
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

  private canceled = false

  private connectingClient: Client | null = null

  constructor(connectionInfo: PostgresConnectionInfo) {
    this.connectionInfo = connectionInfo
  }

  async cancel(): Promise<void> {
    this.canceled = true

    // A connect still in flight can simply be aborted — ending the client
    // tears down the socket and the pending connect rejects.
    const connectingClient = this.connectingClient

    if (connectingClient) {
      try {
        await connectingClient.end()
      } catch {
        // Aborting is best-effort; the connect rejecting is what matters.
      }

      return
    }

    const backendProcessId = getBackendProcessId(this.activeClient)

    if (!backendProcessId) {
      return
    }

    // Postgres cancellation must be issued over a separate connection — the
    // one running the query is busy — so we open a throwaway client and ask
    // the server to cancel the running backend. A failed cancel must not
    // reject the cancel route: the query keeps running and can be canceled
    // again.
    const cancelClient = new Client(createClientConfig(this.connectionInfo))

    try {
      await cancelClient.connect()

      await cancelClient.query('SELECT pg_cancel_backend($1)', [
        backendProcessId
      ])
    } catch (error) {
      log.warn(
        `Could not cancel the running query: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    } finally {
      try {
        await cancelClient.end()
      } catch {
        // Cleanup is best-effort.
      }
    }
  }

  async getSchema(): Promise<SchemaInfo> {
    // Introspection goes through the same retrying connect as queries, and is
    // bounded — a hung catalog scan should never hold a connection forever.
    const client = await this.acquireConnection({ statement_timeout: 30_000 })

    try {
      return await this.getSchemaWithClient(client)
    } finally {
      await client.end()
    }
  }

  async runQuery(query: string): Promise<QueryResult> {
    const client = await this.acquireConnection()

    this.activeClient = client

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
          if (!isMissingIdentifierError(error)) {
            throw error
          }

          schema ??= await this.getSchemaWithClient(client)

          const rewritten = rewriteForMissingIdentifier(
            currentQuery,
            schema,
            error
          )

          if (!rewritten || attempted.has(rewritten)) {
            throw error
          }

          log.debug('Retrying with quoted identifiers')

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
  private async acquireConnection(
    configOverrides?: Partial<ClientConfig>
  ): Promise<Client> {
    return connectWithRetry(
      async () => {
        if (this.canceled) {
          throw new QueryCanceledError()
        }

        const client = new Client({
          ...createClientConfig(this.connectionInfo),
          ...configOverrides
        })

        // Exposed so cancel() can abort a connect still in flight instead of
        // silently doing nothing before the query reaches the server.
        this.connectingClient = client

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

          if (this.canceled) {
            throw new QueryCanceledError()
          }

          throw error
        } finally {
          this.connectingClient = null
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

    return toQueryResult(rows, lastResult)
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

function isMissingIdentifierError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)

  return Boolean(
    extractMissingColumn(message) ?? extractMissingRelation(message)
  )
}

// Columns are checked first: "column "x" of relation "y" does not exist" is a
// column problem, yet its message also matches the relation pattern. Returns
// the corrected SQL, or null when no unambiguous rewrite exists.
function rewriteForMissingIdentifier(
  query: string,
  schema: SchemaInfo,
  error: unknown
): string | null {
  const message = error instanceof Error ? error.message : String(error)

  const missingColumn = extractMissingColumn(message)

  if (missingColumn) {
    return rewriteWithQuotedColumns(query, schema, missingColumn)
  }

  const missingRelation = extractMissingRelation(message)

  if (missingRelation) {
    return rewriteWithQuotedIdentifiers(query, schema, missingRelation)
  }

  return null
}

// Shapes the buffered driver rows into the adapter result, dropping the extra
// row read past the cap.
function toQueryResult(
  rows: Record<string, unknown>[],
  lastResult: DriverQueryResult | undefined
): QueryResult {
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

// node-postgres exposes the backend process id at runtime, but it is not
// present on the published Client type.
function getBackendProcessId(client: Client | null): number | undefined {
  if (!client || !('processID' in client)) {
    return undefined
  }

  const processId = (client as Client & { processID?: unknown }).processID

  return typeof processId === 'number' ? processId : undefined
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
    // A connect attempt that can hang forever holds the query, the Explorer,
    // or a cancel hostage; pg's default is no timeout.
    connectionTimeoutMillis: 10_000,
    database,
    host,
    password,
    port: port ?? 5432,
    user: username,
    ...(ssl ? { ssl } : {})
  }
}
