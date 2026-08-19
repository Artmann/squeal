import {
  Client,
  type ClientConfig,
  type QueryResult as DriverQueryResult
} from 'pg'
import Cursor from 'pg-cursor'
import { log } from 'tiny-typescript-logger'

import { maxResultRows, QueryCanceledError } from './adapter'
import { closeQuietly } from './close-quietly'
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
import {
  formatPostgresServerVersion,
  requireServerVersion
} from './server-version'
import { createSslOptions } from './ssl-options'

// One adapter runs one operation at a time — the factory builds a fresh one
// per connection — so its whole lifecycle is a single value. Three independent
// fields could not say that: a client handed on from connecting to running
// passed through a moment where every field read as "nothing here", and a
// cancel arriving in it had nothing to act on.
type AdapterState =
  | { kind: 'canceled' }
  | { client: Client; kind: 'connecting' }
  | { kind: 'idle' }
  | { client: Client; kind: 'running' }

export class PostgresAdapter implements DatabaseAdapter {
  protected readonly connectionInfo: PostgresConnectionInfo

  private state: AdapterState = { kind: 'idle' }

  constructor(connectionInfo: PostgresConnectionInfo) {
    this.connectionInfo = connectionInfo
  }

  // Every branch has to be non-throwing: shutdown cancels running queries
  // inside a five second budget, and a rejection there would abort the rest of
  // it.
  async cancel(): Promise<void> {
    const state = this.state

    // Recorded before anything is awaited, and never cleared. The steps this
    // query still has ahead of it each check it, so an answer that only lived
    // as long as a handle would be lost exactly in the moments no handle
    // exists.
    this.state = { kind: 'canceled' }

    switch (state.kind) {
      case 'canceled':
      case 'idle': {
        return
      }

      // A connect still in flight can simply be aborted — ending the client
      // tears down the socket and the pending connect rejects.
      case 'connecting': {
        try {
          await state.client.end()
        } catch {
          // Aborting is best-effort; the connect rejecting is what matters.
        }

        return
      }

      case 'running': {
        return await this.cancelBackend(state.client)
      }

      // A fifth kind would otherwise fall out of the switch and return as if
      // there had been nothing to cancel.
      default: {
        const unhandled: never = state

        return unhandled
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
      this.release()

      await closeQuietly(() => client.end(), 'schema')
    }
  }

  // Opens its own short-lived connection rather than borrowing the query one:
  // the probe runs alongside introspection and must never share fate with a
  // user query. The statement timeout keeps a wedged server from holding the
  // socket after the caller has already given up on the answer.
  async getServerVersion(): Promise<string> {
    const client = new Client({
      ...createClientConfig(this.connectionInfo),
      statement_timeout: 5000
    })

    try {
      await client.connect()

      const result = await client.query<{ server_version: string }>(
        'SHOW server_version'
      )
      const rawVersion = result.rows[0]?.server_version ?? ''

      return requireServerVersion(
        formatPostgresServerVersion(rawVersion),
        rawVersion
      )
    } finally {
      await closeQuietly(() => client.end(), 'version probe')
    }
  }

  async runQuery(query: string): Promise<QueryResult> {
    const client = await this.acquireConnection()

    try {
      // Asked once, here, rather than left to the statement to notice: a
      // cancel that lands while the connection is being handed over reaches
      // the server before any statement does, so there is nothing running for
      // pg_cancel_backend to stop and no 57014 coming back. Without this the
      // query the user just canceled runs to completion and is recorded as a
      // success.
      if (this.canceled) {
        throw new QueryCanceledError()
      }

      return await this.executeWithIdentifierRetry(client, query)
    } catch (error) {
      // Wraps the whole attempt rather than the statement alone, so it also
      // covers the catalog fetch the rewrite retry runs on this same
      // connection — a slow scan on a multi-schema database is one of the
      // likelier moments to be canceled.
      if (this.canceled && isCanceledStatementError(error)) {
        throw new QueryCanceledError()
      }

      throw error
    } finally {
      this.release()

      await closeQuietly(() => client.end(), 'query')
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
        // Each attempt re-enters `connecting` with its own client, and this is
        // also where a cancel that landed during the backoff between two of
        // them stops the next one from being opened at all.
        if (this.canceled) {
          throw new QueryCanceledError()
        }

        const client = new Client({
          ...createClientConfig(this.connectionInfo),
          ...configOverrides
        })

        // Held so cancel() can abort a connect still in flight instead of
        // silently doing nothing before the query reaches the server.
        this.state = { client, kind: 'connecting' }

        try {
          await client.connect()
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

          // Nothing is in flight between attempts, so there is nothing for a
          // cancel arriving now to tear down — only the check above to find.
          this.state = { kind: 'idle' }

          throw error
        }

        // In the same step the connect resolves in, with nothing awaited
        // between: the handle goes straight from one state to the next rather
        // than through a gap where the adapter is holding nothing.
        if (this.canceled) {
          throw new QueryCanceledError()
        }

        this.state = { client, kind: 'running' }

        return client
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

  // Postgres cancellation must be issued over a separate connection — the one
  // running the query is busy — so we open a throwaway client and ask the
  // server to cancel the running backend. A failed cancel must not reject the
  // cancel route: the query keeps running and can be canceled again.
  private async cancelBackend(client: Client): Promise<void> {
    const backendProcessId = getBackendProcessId(client)

    if (!backendProcessId) {
      return
    }

    // Inside the try because building the config reads the CA file off disk:
    // a certificate moved or deleted since the query started would otherwise
    // throw out of `cancel()` itself, which every branch here promises not to
    // do.
    let cancelClient: Client | undefined

    try {
      cancelClient = new Client(createClientConfig(this.connectionInfo))

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
        await cancelClient?.end()
      } catch {
        // Cleanup is best-effort.
      }
    }
  }

  // Read through a getter rather than by comparing `this.state` at each call
  // site: the compiler narrows a field it has just seen assigned, and calls two
  // of these five checks unreachable — the opposite of the truth, since both
  // exist because a cancel can land between the assignment and the check.
  private get canceled(): boolean {
    return this.state.kind === 'canceled'
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

  // Postgres folds unquoted identifiers to lowercase, so a query written with
  // the real mixed-case table or column names fails. Retry with those
  // identifiers quoted, rewriting one at a time — Postgres only reports the
  // first offending identifier — until the query runs or nothing is left to
  // fix. The schema is fetched once and reused; the attempted set stops the
  // loop the moment a rewrite makes no progress.
  private async executeWithIdentifierRetry(
    client: Client,
    query: string
  ): Promise<QueryResult> {
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

  // Only from `running`: `canceled` is terminal, so an operation finishing
  // after the user asked to stop it must not hand the adapter back as if
  // nothing had been asked.
  private release(): void {
    if (this.state.kind === 'running') {
      this.state = { kind: 'idle' }
    }
  }

  async testConnection(): Promise<void> {
    const client = new Client({
      ...createClientConfig(this.connectionInfo),
      statement_timeout: 5000
    })

    try {
      await client.connect()
    } finally {
      await closeQuietly(() => client.end(), 'connection test')
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

// SQLSTATE 57014 is query_canceled — the only part of a cancel acknowledgement
// that reads the same on every server. Postgres translates the message prose
// through lc_messages, so matching the English wording loses the cancel the
// moment the server speaks something else.
const canceledSqlState = '57014'

// The code says a statement stopped early. It does not say who stopped it: an
// expiring statement_timeout raises 57014 too, and that is usually set on the
// server, where our client config has no say — ALTER ROLE/DATABASE SET,
// postgresql.conf, and by default on most managed Postgres. A standby recovery
// conflict is 57014 as well. Only the prose separates them, and the prose is
// the thing we stopped trusting.
//
// So the code is never read alone. runQuery pairs it with this.canceled, which
// cancel() sets synchronously before it even issues pg_cancel_backend, so the
// flag is always set by the time the server's answer arrives. Only cancels
// this app asked for are claimed; a timeout and an administrator's cancel both
// keep the server's own message, which is the only thing that explains them.
//
// The code arrives from the driver, so it is read defensively rather than
// assumed: pg's DatabaseError carries it as a string, but nothing in the type
// system promises that.
function isCanceledStatementError(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) {
    return false
  }

  const { code } = error

  return typeof code === 'string' && code === canceledSqlState
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
function getBackendProcessId(client: Client): number | undefined {
  if (!('processID' in client)) {
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
