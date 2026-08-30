import { desc, eq, isNull } from 'drizzle-orm'
import { Cause, Clock, Effect, FiberMap, Option } from 'effect'
import invariant from 'tiny-invariant'

import { databasesTable, queriesTable } from '@/database/schema'
import {
  QueryCanceledError,
  type DatabaseAdapter,
  type QueryResult
} from '@/databases/adapter'
import { NoDatabaseAvailableError, QueryNotFoundError } from '@/glue/api/errors'
import type { CreateQueryRequest, QueryDto } from '@/glue/api/schemas'
import { canceledQueryMessage } from '@/glue/queries'
import { QueryExecutionError } from '../errors'
import { AdapterFactory } from './adapter-factory'
import { AppDatabase } from './app-database'
import { DatabaseService } from './database-service'

type QueryRow = typeof queriesTable.$inferSelect

// Canceling opens a fresh connection to the user's database, which can hang on
// an unreachable host. There is deliberately no timeout on running a user
// query, but shutdown must not wait on one.
const cancelTimeout = '5 seconds'

// Carries the raw adapter rejection so cancellation can be classified before
// the error is flattened into a message. Never leaves this module.
class AdapterQueryError {
  readonly _tag = 'AdapterQueryError'

  constructor(readonly cause: unknown) {}
}

type AdapterOutcome =
  | { readonly _tag: 'canceled' }
  | { readonly _tag: 'completed'; readonly result: QueryResult }

// One entry per forked query, created before the fork so cancel is answerable
// for the fiber's whole life. `adapter` attaches once the connection is loaded;
// `isCanceled` is sticky, the same way the adapters themselves record a cancel
// that arrives before there is a socket to end.
interface InFlightQuery {
  adapter: DatabaseAdapter | undefined
  isCanceled: boolean
}

export class QueryRunner extends Effect.Service<QueryRunner>()('QueryRunner', {
  accessors: true,
  dependencies: [
    AdapterFactory.Default,
    AppDatabase.Default,
    DatabaseService.Default
  ],
  scoped: Effect.gen(function* () {
    const adapterFactory = yield* AdapterFactory
    const appDatabase = yield* AppDatabase
    const databaseService = yield* DatabaseService

    // Background query fibers live in the service scope — app shutdown
    // interrupts them instead of orphaning them mid-flight.
    const running = yield* FiberMap.make<string, void, never>()

    // The link between the cancel route and in-flight work: user cancel goes
    // through adapter.cancel() (for Postgres, pg_cancel_backend), never fiber
    // interruption, so results that just completed are not lost.
    //
    // The entry carries the intent as well as the adapter, because the two do
    // not begin at the same instant: loading the connection decrypts the stored
    // password through the OS keychain, so a query can be running with no
    // adapter yet. A map of adapters alone could only say "an adapter exists",
    // leaving "the user wants this canceled" nowhere to live until one did —
    // and a cancel landing in that window did nothing at all while the query ran
    // on to a successful result.
    const inFlight = new Map<string, InFlightQuery>()

    const loadConnection = (query: QueryRow) =>
      Effect.gen(function* () {
        const record = yield* databaseService.getWithSecrets(query.databaseId)

        if (Option.isNone(record)) {
          return yield* new QueryExecutionError({
            message: `Database not found: ${query.databaseId}`
          })
        }

        return {
          adapter: yield* adapterFactory.create(record.value.connection),
          databaseType: record.value.connection.type
        }
      }).pipe(
        Effect.withSpan('query.loadConnection', {
          attributes: { 'database.id': query.databaseId }
        })
      )

    // A canceled query is a user action, not a failure — the span stays ok
    // and carries an event instead of an exception.
    const recordCanceledEvent = Effect.currentSpan.pipe(
      Effect.zip(Clock.currentTimeNanos),
      Effect.map(([span, now]) => span.event('query.canceled', now)),
      Effect.ignore
    )

    const runAdapterQuery = (
      adapter: DatabaseAdapter,
      databaseType: string,
      query: QueryRow
    ): Effect.Effect<AdapterOutcome, QueryExecutionError> =>
      Effect.tryPromise({
        catch: (cause) => new AdapterQueryError(cause),
        try: () => adapter.runQuery(query.content)
      }).pipe(
        Effect.map((result): AdapterOutcome => ({ _tag: 'completed', result })),
        Effect.catchIf(
          (error) => isCancellationError(error.cause),
          () =>
            recordCanceledEvent.pipe(
              Effect.as<AdapterOutcome>({ _tag: 'canceled' })
            )
        ),
        Effect.mapError(
          (error) =>
            new QueryExecutionError({
              message: extractErrorMessage(error.cause)
            })
        ),
        // Scope teardown (app quit) best-effort cancels the server-side
        // statement before the fiber dies. Effect.ignore alone would not
        // contain a rejecting cancel(), because Effect.promise turns a
        // rejection into a defect; and cancel() opens a *new* connection, so it
        // needs a timeout or a slow one would stall shutdown.
        Effect.onInterrupt(() =>
          Effect.promise(() => adapter.cancel?.() ?? Promise.resolve()).pipe(
            Effect.timeout(cancelTimeout),
            Effect.catchAllCause((cause) =>
              Effect.logError(
                `Could not cancel query ${query.id} during shutdown`,
                cause
              )
            )
          )
        ),
        Effect.withSpan('db.query', {
          attributes: {
            'db.statement': query.content,
            'db.system': databaseType,
            'query.id': query.id
          }
        })
      )

    const saveResult = (query: QueryRow, result: QueryResult) =>
      appDatabase
        .execute((client) =>
          client
            .update(queriesTable)
            .set({ finishedAt: Date.now(), result: JSON.stringify(result) })
            .where(eq(queriesTable.id, query.id))
        )
        .pipe(
          Effect.withSpan('query.saveResult', {
            attributes: {
              'query.id': query.id,
              'query.rowCount': result.rowCount,
              'query.truncated': result.truncated
            }
          })
        )

    const writeFailure = (queryId: string, message: string) =>
      appDatabase
        .execute((client) =>
          client
            .update(queriesTable)
            .set({ error: message, finishedAt: Date.now() })
            .where(eq(queriesTable.id, queryId))
        )
        .pipe(
          // The background fiber is fire-and-forget, so a failed write must
          // be contained here — the row would otherwise silently stay
          // "running" (the boot reconciler is the last-resort cleanup).
          Effect.catchAllCause((cause) =>
            Effect.logError(`Could not mark query ${queryId} as failed`, cause)
          )
        )

    const execute = (query: QueryRow) =>
      Effect.gen(function* () {
        const entry = inFlight.get(query.id)

        // Registered synchronously before the fork, so it is always here.
        invariant(entry !== undefined, `Query ${query.id} is not registered.`)

        const { adapter, databaseType } = yield* loadConnection(query)

        // A cancel that arrived while the connection was loading had nothing to
        // act on, so it is answered here instead — and the terminal row still
        // has to be written, or the query stays "running" until the boot
        // reconciler notices.
        if (entry.isCanceled) {
          yield* recordCanceledEvent
          yield* writeFailure(query.id, canceledQueryMessage)

          return
        }

        // Published only now: an adapter that is never going to run a statement
        // should not be reachable by a second cancel.
        entry.adapter = adapter

        const outcome = yield* runAdapterQuery(
          adapter,
          databaseType,
          query
        ).pipe(
          // Unpublished the moment the statement settles, so a cancel landing
          // during the write below cannot reach a finished adapter. The entry
          // itself still lives as long as the fiber.
          Effect.ensuring(
            Effect.sync(() => {
              entry.adapter = undefined
            })
          )
        )

        if (outcome._tag === 'canceled') {
          // The event is recorded on the db.query span inside runAdapterQuery,
          // which is the span that represents the canceled statement.
          yield* writeFailure(query.id, canceledQueryMessage)

          return
        }

        // The statement finished, but the user asked for it to stop and this
        // adapter could not carry that out — `cancel` is optional, and only the
        // Postgres adapter implements it. Honoring the intent here is what stops
        // MySQL and SQLite from reporting a cancel and then producing the result
        // anyway.
        if (entry.isCanceled) {
          yield* recordCanceledEvent
          yield* writeFailure(query.id, canceledQueryMessage)

          return
        }

        yield* saveResult(query, outcome.result)
      })

    const runInBackground = (query: QueryRow): Effect.Effect<void> =>
      execute(query).pipe(
        Effect.withSpan('query.execute', {
          attributes: { 'database.id': query.databaseId, 'query.id': query.id }
        }),
        Effect.catchAllCause((cause) =>
          Cause.isInterruptedOnly(cause)
            ? Effect.void
            : writeFailure(query.id, messageFromCause(cause))
        ),
        // Released here rather than around the adapter call, so the entry's
        // lifetime is the fiber's lifetime and no path — including a failure to
        // load the connection — can leak one.
        Effect.ensuring(Effect.sync(() => inFlight.delete(query.id)))
      )

    const cancel = Effect.fn('QueryRunner.cancel')(function* (id: string) {
      const entry = inFlight.get(id)

      // Canceling an unknown or already finished query is a deliberate
      // no-op.
      if (entry === undefined) {
        return
      }

      // Recorded first, so it counts even when there is no adapter to act on —
      // either because the connection is still loading, or because this adapter
      // has no cancel at all. `execute` honors it either way.
      entry.isCanceled = true

      const adapter = entry.adapter

      if (adapter === undefined) {
        return
      }

      yield* Effect.promise(() => adapter.cancel?.() ?? Promise.resolve()).pipe(
        // Bounded for the same reason the shutdown path bounds it: cancel opens
        // a fresh connection to the user's database, which can hang on an
        // unreachable host, and this one is awaited by an HTTP handler.
        Effect.timeout(cancelTimeout),
        Effect.catchAllCause((cause) =>
          Effect.logError(`Could not cancel query ${id}`, cause)
        )
      )
    })

    const createAndRun = Effect.fn('QueryRunner.createAndRun')(function* (
      input: CreateQueryRequest
    ) {
      let databaseId = input.databaseId

      if (databaseId === undefined) {
        const [firstDatabase] = yield* appDatabase.execute((client) =>
          client
            .select()
            .from(databasesTable)
            .where(isNull(databasesTable.deletedAt))
            .limit(1)
        )

        if (firstDatabase === undefined) {
          return yield* new NoDatabaseAvailableError({
            message:
              'No database connection is available. Add a database before running queries.'
          })
        }

        databaseId = firstDatabase.id
      }

      const [insertedRow] = yield* appDatabase.execute((client) =>
        client
          .insert(queriesTable)
          .values({
            content: input.content,
            databaseId,
            id: input.id,
            queriedAt: input.queriedAt,
            worksheetId: input.worksheetId
          })
          .returning()
      )

      // Registered synchronously, before the fork, so the query is cancelable
      // from the same instant it starts running. Registering it from inside the
      // fiber would reopen the window this closes.
      //
      // Uninterruptible as a pair: the release lives in `runInBackground`, so an
      // interrupt landing between the two would retain the entry forever.
      //
      // Fork-and-return: the response carries the unfinished row and the
      // renderer polls for the result. The forked fiber inherits this span
      // as its parent, which is what used to require capturing the
      // AsyncLocalStorage context by hand. A duplicate key cannot reach the
      // fork — the primary-key insert above fails first.
      yield* Effect.uninterruptible(
        Effect.gen(function* () {
          inFlight.set(insertedRow.id, {
            adapter: undefined,
            isCanceled: false
          })

          yield* FiberMap.run(
            running,
            insertedRow.id,
            runInBackground(insertedRow)
          )
        })
      )

      return transformQueryRow(insertedRow)
    })

    // No named span here: this is the 250ms result poller's path, which is
    // excluded from request tracing — a span would become a parentless root
    // trace on every poll.
    const get = Effect.fn(function* (id: string) {
      const rows = yield* appDatabase.execute((client) =>
        client
          .select()
          .from(queriesTable)
          .where(eq(queriesTable.id, id))
          .limit(1)
      )

      const row = rows[0]

      if (row === undefined) {
        return yield* new QueryNotFoundError({
          message: 'Query not found',
          queryId: id
        })
      }

      return transformQueryRow(row)
    })

    const list = Effect.fn('QueryRunner.list')(function* () {
      const rows = yield* appDatabase.execute((client) =>
        client
          .select()
          .from(queriesTable)
          .orderBy(desc(queriesTable.queriedAt))
          .limit(250)
      )

      return rows.map(transformQueryRow)
    })

    return {
      // Waits for all background query fibers — used by tests and shutdown.
      awaitIdle: FiberMap.awaitEmpty(running),
      cancel,
      createAndRun,
      get,
      list
    } as const
  })
}) {}

function isCancellationError(error: unknown): boolean {
  if (error instanceof QueryCanceledError) {
    return true
  }

  const message = error instanceof Error ? error.message : String(error)

  return message
    .toLowerCase()
    .includes('canceling statement due to user request')
}

// The message, never the object. A driver error carries the connection it was
// thrown for -- pg hangs `address` and `port` off it, and the config is one
// property away on several drivers -- and what this returns becomes a
// QueryExecutionError's message, lands in the `queries.error` column, and is
// read back by the renderer as `QueryDto.error`. Serializing the error itself
// would put the connection in all three.
//
// The message alone still names the host and the user, because that is what
// makes "password authentication failed for user ..." actionable. The same
// extraction, with the same reason, is done at `connection-tests.ts` and
// `databases.ts`.
function extractErrorMessage(error: unknown): string {
  if (error instanceof AggregateError) {
    const messages = error.errors.map((entry) =>
      entry instanceof Error ? entry.message : String(entry)
    )

    return messages.join('; ') || error.message || 'Connection failed'
  }

  if (error instanceof Error) {
    return error.message || error.name || 'Unknown error'
  }

  return String(error)
}

function messageFromCause(cause: Cause.Cause<{ message: string }>): string {
  const failure = Cause.failureOption(cause)

  if (Option.isSome(failure)) {
    return failure.value.message
  }

  return extractErrorMessage(Cause.squash(cause))
}

// Stored results are historical data: rows written by earlier versions predate
// fields the response schema now requires — `truncated` arrived later — and a
// blind cast let one such row fail response *encoding*, which took down the
// entire history list with a 400. Normalize to the contract shape rather than
// asserting it.
function toStoredQueryResult(value: unknown): QueryResult | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const candidate = value as Partial<QueryResult>

  if (!Array.isArray(candidate.fields) || !Array.isArray(candidate.rows)) {
    return null
  }

  if (!candidate.rows.every((row) => typeof row === 'object' && row !== null)) {
    return null
  }

  return {
    fields: candidate.fields.map((field) => ({
      name: String((field as { name?: unknown } | null)?.name ?? '')
    })),
    rowCount:
      typeof candidate.rowCount === 'number'
        ? candidate.rowCount
        : candidate.rows.length,
    rows: candidate.rows,
    truncated: candidate.truncated === true
  }
}

function transformQueryRow(row: QueryRow): QueryDto {
  let parsed: QueryResult | null = null
  let parseError: string | null = null

  // One unreadable stored result must not take down the whole history list.
  if (row.result) {
    try {
      parsed = toStoredQueryResult(JSON.parse(row.result))

      if (parsed === null) {
        parseError = 'Stored result could not be read.'
      }
    } catch {
      parseError = 'Stored result could not be read.'
    }
  }

  return {
    content: row.content,
    databaseId: row.databaseId,
    error: row.error ?? parseError,
    finishedAt: row.finishedAt ?? null,
    id: row.id,
    queriedAt: row.queriedAt,
    result: parsed,
    worksheetId: row.worksheetId
  }
}
