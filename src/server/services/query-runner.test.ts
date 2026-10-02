import { Deferred, Effect, Either, Layer, Schedule, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { queriesTable } from '@/database/schema'
import { QueryCanceledError, type QueryResult } from '@/databases/adapter'
import { GetQueriesResponse, type ConnectionInfo } from '@/glue/api/schemas'
import { canceledQueryMessage } from '@/glue/queries'
import { SpanRecord } from '@/glue/tracing/spans'
import { makeSquealTracer } from '@/server/tracing/effect-tracer'
import {
  makeTestAdapterFactory,
  makeTestAppDatabase,
  testEncryptionPrefix,
  TestSecretStorage,
  type TestAdapterConfig
} from '@/test/effect-test-helper'
import { AppDatabase } from './app-database'
import { DatabaseService } from './database-service'
import { QueryRunner } from './query-runner'
import { SecretStorage } from './secret-storage'

const connectionInfo: ConnectionInfo = {
  database: 'pagila',
  host: 'localhost',
  password: 'secret',
  username: 'postgres'
}

const queryInput = {
  content: 'select 1',
  id: 'query-1',
  queriedAt: 1_000,
  worksheetId: 'worksheet-1'
}

function makeLayer(config?: TestAdapterConfig) {
  const adapterFactory = makeTestAdapterFactory(config)

  const layer = QueryRunner.DefaultWithoutDependencies.pipe(
    Layer.provideMerge(DatabaseService.DefaultWithoutDependencies),
    Layer.provideMerge(adapterFactory.layer),
    Layer.provideMerge(makeTestAppDatabase()),
    Layer.provideMerge(TestSecretStorage)
  )

  return { layer }
}

/**
 * A SecretStorage whose decrypt can be held open on demand, so a test can sit
 * inside the window `loadConnection` spends waiting on the keychain — which is
 * exactly where a cancel used to land on nothing at all.
 */
function makeGatedSecretStorage() {
  // A Deferred rather than a bare promise, so a failure elsewhere in the test
  // interrupts the parked fiber instead of hanging until the vitest timeout.
  let gate: Deferred.Deferred<void> | undefined

  const layer = Layer.succeed(
    SecretStorage,
    SecretStorage.make({
      decrypt: (value: string) =>
        Effect.gen(function* () {
          if (gate !== undefined) {
            yield* Deferred.await(gate)
          }

          return value.startsWith(testEncryptionPrefix)
            ? value.slice(testEncryptionPrefix.length)
            : value
        }),
      encrypt: (value: string) =>
        Effect.succeed(`${testEncryptionPrefix}${value}`),
      probe: Effect.sync(() => 'available' as const),
      setMode: () => Effect.void
    })
  )

  return {
    // A fresh Deferred each time, so gating twice in one test really gates
    // twice rather than sailing through an already-completed one.
    closeGate: Effect.gen(function* () {
      gate = yield* Deferred.make<void>()
    }),
    layer,
    openGate: Effect.gen(function* () {
      const current = gate

      gate = undefined

      if (current !== undefined) {
        yield* Deferred.succeed(current, undefined)
      }
    })
  }
}

type TestContext = AppDatabase | DatabaseService | QueryRunner

function run<A, E>(
  effect: Effect.Effect<A, E, TestContext>,
  config?: TestAdapterConfig
): Promise<A> {
  return Effect.runPromise(Effect.provide(effect, makeLayer(config).layer))
}

const createDatabase = Effect.gen(function* () {
  const databases = yield* DatabaseService

  const created = yield* databases.create('Pagila', {
    connectionInfo,
    type: 'postgres'
  })

  return created.database
})

describe('QueryRunner', () => {
  it('returns the unfinished row and finishes it in the background', async () => {
    const { immediate, finished } = await run(
      Effect.gen(function* () {
        const runner = yield* QueryRunner
        const database = yield* createDatabase

        const immediate = yield* runner.createAndRun({
          ...queryInput,
          databaseId: database.id
        })

        yield* runner.awaitIdle

        const finished = yield* runner.get(queryInput.id)

        return { finished, immediate }
      })
    )

    expect(immediate).toEqual({
      content: 'select 1',
      databaseId: expect.any(String),
      id: 'query-1',
      queriedAt: 1_000,
      status: 'running',
      worksheetId: 'worksheet-1'
    })
    expect(finished).toEqual({
      content: 'select 1',
      databaseId: expect.any(String),
      finishedAt: expect.any(Number),
      id: 'query-1',
      queriedAt: 1_000,
      result: {
        fields: [{ name: 'value' }],
        rowCount: 1,
        rows: [{ value: 1 }],
        truncated: false
      },
      status: 'succeeded',
      worksheetId: 'worksheet-1'
    })
  })

  it('falls back to the first database when none is given', async () => {
    const { databaseId, query } = await run(
      Effect.gen(function* () {
        const runner = yield* QueryRunner
        const database = yield* createDatabase

        const query = yield* runner.createAndRun(queryInput)

        return { databaseId: database.id, query }
      })
    )

    expect(query.databaseId).toEqual(databaseId)
  })

  it('fails with NoDatabaseAvailableError when no database exists', async () => {
    const error = await run(
      Effect.gen(function* () {
        const runner = yield* QueryRunner

        return yield* runner.createAndRun(queryInput).pipe(Effect.flip)
      })
    )

    expect(error._tag).toEqual('NoDatabaseAvailableError')
  })

  it('writes the failure message when the adapter rejects', async () => {
    const finished = await run(
      Effect.gen(function* () {
        const runner = yield* QueryRunner
        const database = yield* createDatabase

        yield* runner.createAndRun({ ...queryInput, databaseId: database.id })
        yield* runner.awaitIdle

        return yield* runner.get(queryInput.id)
      }),
      {
        runQuery: () =>
          Promise.reject(new Error('relation "missing" does not exist'))
      }
    )

    expect(finished).toEqual({
      content: 'select 1',
      databaseId: expect.any(String),
      error: 'relation "missing" does not exist',
      finishedAt: expect.any(Number),
      id: 'query-1',
      queriedAt: 1_000,
      status: 'failed',
      worksheetId: 'worksheet-1'
    })
  })

  it('normalizes a canceled query and calls the adapter cancel', async () => {
    let rejectRunningQuery: ((error: unknown) => void) | undefined
    let cancelCalls = 0

    const config: TestAdapterConfig = {
      cancel: () => {
        cancelCalls = cancelCalls + 1

        rejectRunningQuery?.(new QueryCanceledError())

        return Promise.resolve()
      },
      runQuery: () =>
        new Promise<QueryResult>((_resolve, reject) => {
          rejectRunningQuery = reject
        })
    }

    const finished = await run(
      Effect.gen(function* () {
        const runner = yield* QueryRunner
        const database = yield* createDatabase

        yield* runner.createAndRun({ ...queryInput, databaseId: database.id })

        // Cancel is total over the fiber's whole life, so this waits for the
        // query to actually be running rather than retrying the cancel until
        // the adapter happens to have registered.
        yield* Effect.gen(function* () {
          if (rejectRunningQuery === undefined) {
            return yield* Effect.fail(new Error('adapter not running yet'))
          }
        }).pipe(
          Effect.retry({ schedule: Schedule.spaced('1 millis'), times: 100 })
        )

        yield* runner.cancel(queryInput.id)

        yield* runner.awaitIdle

        return yield* runner.get(queryInput.id)
      }),
      config
    )

    expect(cancelCalls).toBeGreaterThanOrEqual(1)
    expect(finished).toEqual({
      content: 'select 1',
      databaseId: expect.any(String),
      finishedAt: expect.any(Number),
      id: 'query-1',
      queriedAt: 1_000,
      status: 'canceled',
      worksheetId: 'worksheet-1'
    })
  })

  // The persisted row, the fiber and the adapter all start at different
  // instants. Loading the connection decrypts the stored password through the OS
  // keychain, so there is a real window in which the query is running and no
  // adapter exists yet — cancel has to be answerable there too.
  it('cancels a query that has not finished loading its connection', async () => {
    const secretStorage = makeGatedSecretStorage()
    let runQueryCalls = 0

    const adapterFactory = makeTestAdapterFactory({
      runQuery: () => {
        runQueryCalls = runQueryCalls + 1

        return Promise.resolve({
          fields: [{ name: 'value' }],
          rowCount: 1,
          rows: [{ value: 1 }],
          truncated: false
        })
      }
    })

    const layer = QueryRunner.DefaultWithoutDependencies.pipe(
      Layer.provideMerge(DatabaseService.DefaultWithoutDependencies),
      Layer.provideMerge(adapterFactory.layer),
      Layer.provideMerge(makeTestAppDatabase()),
      Layer.provideMerge(secretStorage.layer)
    )

    const finished = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const runner = yield* QueryRunner
          const database = yield* createDatabase

          // Everything from here on decrypts through a keychain that will not
          // answer until the cancel has landed.
          yield* secretStorage.closeGate

          yield* runner.createAndRun({
            ...queryInput,
            databaseId: database.id
          })

          // No retry: the cancel has to be recorded on its own.
          yield* runner.cancel(queryInput.id)

          yield* secretStorage.openGate

          yield* runner.awaitIdle

          return yield* runner.get(queryInput.id)
        }),
        layer
      )
    )

    expect({ finished, runQueryCalls }).toEqual({
      finished: {
        content: 'select 1',
        databaseId: expect.any(String),
        finishedAt: expect.any(Number),
        id: 'query-1',
        queriedAt: 1_000,
        status: 'canceled',
        worksheetId: 'worksheet-1'
      },
      runQueryCalls: 0
    })
  })

  // `cancel` is optional on the adapter interface and only Postgres implements
  // it, so for MySQL and SQLite there is nothing to interrupt a running
  // statement. The recorded intent is what makes cancel mean something there:
  // the statement finishes, and its result is discarded rather than reported
  // after the user was told the query was canceled.
  it('honors a cancel an adapter cannot carry out', async () => {
    let hasStartedQuery = false
    let releaseQuery = (): void => undefined

    const running = new Promise<void>((resolve) => {
      releaseQuery = resolve
    })

    const finished = await run(
      Effect.gen(function* () {
        const runner = yield* QueryRunner
        const database = yield* createDatabase

        yield* runner.createAndRun({ ...queryInput, databaseId: database.id })

        yield* Effect.gen(function* () {
          if (!hasStartedQuery) {
            return yield* Effect.fail(new Error('query not running yet'))
          }
        }).pipe(
          Effect.retry({ schedule: Schedule.spaced('1 millis'), times: 100 })
        )

        yield* runner.cancel(queryInput.id)

        // Only now does the statement complete, successfully.
        releaseQuery()

        yield* runner.awaitIdle

        return yield* runner.get(queryInput.id)
      }),
      {
        // No `cancel` at all — the shape MySQL and SQLite present.
        runQuery: async () => {
          hasStartedQuery = true

          await running

          return {
            fields: [{ name: 'value' }],
            rowCount: 1,
            rows: [{ value: 1 }],
            truncated: false
          }
        }
      }
    )

    expect(finished).toEqual({
      content: 'select 1',
      databaseId: expect.any(String),
      finishedAt: expect.any(Number),
      id: 'query-1',
      queriedAt: 1_000,
      status: 'canceled',
      worksheetId: 'worksheet-1'
    })
  })

  // The entry's lifetime is exactly the fiber's, so once the query is done there
  // is nothing left to cancel and the adapter is never asked — a result the user
  // already has is never rewritten. The adapter is also unpublished the moment
  // the statement settles, so a cancel arriving while the result is being saved
  // finds nothing to signal without relying on any adapter's internals.
  it('leaves a finished result intact when the cancel arrives too late', async () => {
    let cancelCalls = 0

    const finished = await run(
      Effect.gen(function* () {
        const runner = yield* QueryRunner
        const database = yield* createDatabase

        yield* runner.createAndRun({ ...queryInput, databaseId: database.id })
        yield* runner.awaitIdle

        yield* runner.cancel(queryInput.id)

        return yield* runner.get(queryInput.id)
      }),
      {
        cancel: () => {
          cancelCalls = cancelCalls + 1

          return Promise.resolve()
        }
      }
    )

    expect({ cancelCalls, status: finished.status }).toEqual({
      cancelCalls: 0,
      status: 'succeeded'
    })
  })

  it('fails with QueryNotFoundError for an unknown query id', async () => {
    const error = await run(
      Effect.gen(function* () {
        const runner = yield* QueryRunner

        return yield* runner.get('missing').pipe(Effect.flip)
      })
    )

    expect(error).toEqual(
      expect.objectContaining({
        _tag: 'QueryNotFoundError',
        queryId: 'missing'
      })
    )
  })

  it('emits the query span pipeline into the span store', async () => {
    const written: SpanRecord[] = []
    const tracer = makeSquealTracer({
      emit: (record) => {
        written.push(record)
      }
    })

    await run(
      Effect.gen(function* () {
        const runner = yield* QueryRunner
        const database = yield* createDatabase

        yield* runner.createAndRun({ ...queryInput, databaseId: database.id })
        yield* runner.awaitIdle
      }).pipe(Effect.provide(Layer.setTracer(tracer)))
    )

    const names = written.map((span) => span.name)

    expect(names).toContain('query.execute')
    expect(names).toContain('query.loadConnection')
    expect(names).toContain('db.query')
    expect(names).toContain('query.saveResult')

    const executeSpan = written.find((span) => span.name === 'query.execute')
    const dbSpan = written.find((span) => span.name === 'db.query')
    const createSpan = written.find(
      (span) => span.name === 'QueryRunner.createAndRun'
    )

    expect(executeSpan?.status).toEqual('ok')
    expect(dbSpan?.attributes).toEqual({
      'db.statement': 'select 1',
      'db.system': 'postgres',
      'query.id': 'query-1'
    })

    // The fork inherits the request-side span as parent — the manual
    // AsyncLocalStorage capture this replaces.
    expect(executeSpan?.parentSpanId).toEqual(createSpan?.id)
    expect(executeSpan?.traceId).toEqual(createSpan?.traceId)
  })

  // Results stored by earlier versions predate `truncated`. These used to be
  // cast blindly, so a single legacy row failed *response* encoding and took
  // down the whole history list with a 400.
  it('reads a stored result written before truncated existed', async () => {
    const queries = await run(
      Effect.gen(function* () {
        const appDatabase = yield* AppDatabase
        const runner = yield* QueryRunner
        const database = yield* createDatabase

        yield* appDatabase.execute((client) =>
          client.insert(queriesTable).values({
            content: 'select 1',
            databaseId: database.id,
            finishedAt: 2_000,
            id: 'legacy-query',
            queriedAt: 1_000,
            result: JSON.stringify({
              fields: [{ name: 'value' }],
              rowCount: 1,
              rows: [{ value: 1 }]
            }),
            worksheetId: 'worksheet-1'
          })
        )

        return {
          full: yield* runner.get('legacy-query'),
          list: yield* runner.list(),
          status: yield* runner.status('legacy-query')
        }
      })
    )

    const legacySummary = {
      content: 'select 1',
      databaseId: expect.any(String),
      finishedAt: 2_000,
      id: 'legacy-query',
      queriedAt: 1_000,
      result: { rowCount: 1, truncated: false },
      status: 'succeeded',
      worksheetId: 'worksheet-1'
    }

    expect(queries.list).toEqual([legacySummary])
    expect(queries.status).toEqual(legacySummary)
    expect(queries.full).toEqual({
      ...legacySummary,
      result: {
        fields: [{ name: 'value' }],
        rowCount: 1,
        rows: [{ value: 1 }],
        truncated: false
      }
    })
  })

  // A row saved before the size columns existed is summarized from its blob,
  // with the same fallbacks `get` applies to it.
  it('summarizes a stored result without a rowCount from its rows', async () => {
    const summaries = await listStoredResults([
      JSON.stringify({
        fields: [{ name: 'value' }],
        rows: [{ value: 1 }, { value: 2 }],
        truncated: true
      })
    ])

    expect(summaries).toEqual([
      storedQuery(0, {
        finishedAt: 2_000,
        result: { rowCount: 2, truncated: true },
        status: 'succeeded'
      })
    ])
  })

  it('reports an unusable stored result without failing the list', async () => {
    const summaries = await listStoredResults([
      JSON.stringify({ unexpected: true }),
      'not json at all',
      JSON.stringify({ fields: [], rows: [1, null] }),
      JSON.stringify(null)
    ])

    const unreadable = {
      error: 'Stored result could not be read.',
      finishedAt: 2_000,
      status: 'failed'
    }

    expect(summaries).toEqual(
      [0, 1, 2, 3].map((index) => storedQuery(index, unreadable))
    )
  })

  // Every combination the independent columns can hold maps to exactly one
  // status, so no stored row can fail response encoding. Each of these is a
  // shape a real database can contain: one saved by an earlier version, one
  // left mid-write, or one the boot reconciler has not reached yet.
  it('derives one status for every legacy row shape', async () => {
    const legacyRows: StoredColumns[] = [
      // Finished with neither a result nor an error.
      { error: null, finishedAt: 2_000, result: null },
      // Finished with an empty blob, which earlier versions read as absent.
      { error: null, finishedAt: 2_000, result: '' },
      // Canceled, which is stored as its message.
      { error: canceledQueryMessage, finishedAt: 2_000, result: null },
      // An error beside a result: the error wins, as it always has.
      {
        error: 'connection reset',
        finishedAt: 2_000,
        result: JSON.stringify({ fields: [], rows: [] })
      },
      // An error without a finish time, from before the reconciler ran.
      { error: 'connection reset', finishedAt: null, result: null },
      // A result without a finish time, from before the column existed.
      {
        error: null,
        finishedAt: null,
        result: JSON.stringify({ fields: [], rows: [] })
      }
    ]

    const { full, list } = await storeRows(legacyRows)

    const expected = [
      {
        error: 'Stored result could not be read.',
        finishedAt: 2_000,
        status: 'failed'
      },
      {
        error: 'Stored result could not be read.',
        finishedAt: 2_000,
        status: 'failed'
      },
      { finishedAt: 2_000, status: 'canceled' },
      { error: 'connection reset', finishedAt: 2_000, status: 'failed' },
      { status: 'running' },
      { status: 'running' }
    ].map((state, index) => storedQuery(index, state))

    expect({ full, list }).toEqual({ full: expected, list: expected })
  })

  // The regression this guards: one row the response schema refuses fails
  // encoding for the whole list, and the history answers 400 instead.
  it('encodes a history list that holds legacy rows', async () => {
    const list = await listStoredResults([
      JSON.stringify({ fields: [{ name: 'value' }], rows: [{ value: 1 }] }),
      'not json at all',
      ''
    ])

    const encoded = Schema.encodeEither(GetQueriesResponse)({ queries: list })

    expect(Either.isRight(encoded)).toEqual(true)
  })

  it('reports an unusable stored result from get as well', async () => {
    const query = await run(
      Effect.gen(function* () {
        const appDatabase = yield* AppDatabase
        const runner = yield* QueryRunner
        const database = yield* createDatabase

        yield* appDatabase.execute((client) =>
          client.insert(queriesTable).values({
            content: 'select 1',
            databaseId: database.id,
            finishedAt: 2_000,
            id: 'broken-query',
            queriedAt: 1_000,
            result: JSON.stringify({ unexpected: true }),
            worksheetId: 'worksheet-1'
          })
        )

        return yield* runner.get('broken-query')
      })
    )

    expect(query).toEqual({
      content: 'select 1',
      databaseId: expect.any(String),
      error: 'Stored result could not be read.',
      finishedAt: 2_000,
      id: 'broken-query',
      queriedAt: 1_000,
      status: 'failed',
      worksheetId: 'worksheet-1'
    })
  })

  it('saves the size beside the result and lists it without the rows', async () => {
    const { list, row, status } = await run(
      Effect.gen(function* () {
        const appDatabase = yield* AppDatabase
        const runner = yield* QueryRunner
        const database = yield* createDatabase

        yield* runner.createAndRun({ ...queryInput, databaseId: database.id })
        yield* runner.awaitIdle

        const [row] = yield* appDatabase.execute((client) =>
          client
            .select({
              resultRowCount: queriesTable.resultRowCount,
              resultTruncated: queriesTable.resultTruncated
            })
            .from(queriesTable)
        )

        return {
          list: yield* runner.list(),
          row,
          status: yield* runner.status(queryInput.id)
        }
      })
    )

    const summary = {
      content: 'select 1',
      databaseId: expect.any(String),
      finishedAt: expect.any(Number),
      id: 'query-1',
      queriedAt: 1_000,
      result: { rowCount: 1, truncated: false },
      status: 'succeeded',
      worksheetId: 'worksheet-1'
    }

    expect(row).toEqual({ resultRowCount: 1, resultTruncated: false })
    expect(list).toEqual([summary])
    expect(status).toEqual(summary)
  })

  // The point of the size columns: a current row is summarized without its
  // blob being read, so even a blob that would not parse does not matter.
  it('summarizes a current row from its size columns alone', async () => {
    const queries = await run(
      Effect.gen(function* () {
        const appDatabase = yield* AppDatabase
        const runner = yield* QueryRunner
        const database = yield* createDatabase

        yield* appDatabase.execute((client) =>
          client.insert(queriesTable).values({
            content: 'select 1',
            databaseId: database.id,
            finishedAt: 2_000,
            id: 'current-query',
            queriedAt: 1_000,
            result: 'not json at all',
            resultRowCount: 10_000,
            resultTruncated: true,
            worksheetId: 'worksheet-1'
          })
        )

        return yield* runner.list()
      })
    )

    expect(queries).toEqual([
      {
        content: 'select 1',
        databaseId: expect.any(String),
        finishedAt: 2_000,
        id: 'current-query',
        queriedAt: 1_000,
        result: { rowCount: 10_000, truncated: true },
        status: 'succeeded',
        worksheetId: 'worksheet-1'
      }
    ])
  })

  it('summarizes an unfinished query with no result', async () => {
    const status = await run(
      Effect.gen(function* () {
        const appDatabase = yield* AppDatabase
        const runner = yield* QueryRunner
        const database = yield* createDatabase

        yield* appDatabase.execute((client) =>
          client.insert(queriesTable).values({
            content: 'select 1',
            databaseId: database.id,
            id: 'running-query',
            queriedAt: 1_000,
            worksheetId: 'worksheet-1'
          })
        )

        return yield* runner.status('running-query')
      })
    )

    expect(status).toEqual({
      content: 'select 1',
      databaseId: expect.any(String),
      id: 'running-query',
      queriedAt: 1_000,
      status: 'running',
      worksheetId: 'worksheet-1'
    })
  })

  it('fails the status poll with QueryNotFoundError for an unknown query id', async () => {
    const error = await run(
      Effect.gen(function* () {
        const runner = yield* QueryRunner

        return yield* runner.status('missing').pipe(Effect.flip)
      })
    )

    expect(error).toEqual(
      expect.objectContaining({
        _tag: 'QueryNotFoundError',
        queryId: 'missing'
      })
    )
  })
})

// The columns a query's state is derived from, as a stored row holds them.
interface StoredColumns {
  error: string | null
  finishedAt: number | null
  result: string | null
}

// Stores each row as a legacy row — no size columns — and reads every one of
// them back both ways, in the order given: from the list, and one at a time
// from `get`.
function storeRows(rows: StoredColumns[]) {
  return run(
    Effect.gen(function* () {
      const appDatabase = yield* AppDatabase
      const runner = yield* QueryRunner
      const database = yield* createDatabase

      yield* appDatabase.execute((client) =>
        client.insert(queriesTable).values(
          rows.map((row, index) => ({
            ...row,
            content: 'select 1',
            databaseId: database.id,
            id: `stored-${index}`,
            // Newest first in the list, so the earliest row gets the latest
            // timestamp to keep the order the caller gave.
            queriedAt: 1_000 - index,
            worksheetId: 'worksheet-1'
          }))
        )
      )

      const full = yield* Effect.forEach(rows, (_row, index) =>
        runner.get(`stored-${index}`)
      )

      return { full, list: yield* runner.list() }
    })
  )
}

// Stores each blob as a finished legacy row and lists them back.
async function listStoredResults(results: string[]) {
  const { list } = await storeRows(
    results.map((result) => ({ error: null, finishedAt: 2_000, result }))
  )

  return list
}

// What `storeRows` gives back for the row at `index`, around its state.
function storedQuery(index: number, state: object) {
  return {
    content: 'select 1',
    databaseId: expect.any(String),
    id: `stored-${index}`,
    queriedAt: 1_000 - index,
    worksheetId: 'worksheet-1',
    ...state
  }
}
