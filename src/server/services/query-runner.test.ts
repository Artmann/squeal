import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { queriesTable } from '@/database/schema'
import { QueryCanceledError, type QueryResult } from '@/databases/adapter'
import type { ConnectionInfo } from '@/glue/api/schemas'
import { canceledQueryMessage } from '@/glue/queries'
import { SpanRecord } from '@/glue/tracing/spans'
import { makeSquealTracer } from '@/server/tracing/effect-tracer'
import {
  makeTestAdapterFactory,
  makeTestAppDatabase,
  TestSecretStorage,
  type TestAdapterConfig
} from '@/test/effect-test-helper'
import { AppDatabase } from './app-database'
import { DatabaseService } from './database-service'
import { QueryRunner } from './query-runner'

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

    expect(immediate.finishedAt).toBeNull()
    expect(immediate.result).toBeNull()
    expect(finished.finishedAt).toEqual(expect.any(Number))
    expect(finished.error).toBeNull()
    expect(finished.result).toEqual({
      fields: [{ name: 'value' }],
      rowCount: 1,
      rows: [{ value: 1 }],
      truncated: false
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

    expect(finished.error).toEqual('relation "missing" does not exist')
    expect(finished.finishedAt).toEqual(expect.any(Number))
    expect(finished.result).toBeNull()
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

        // The background fiber registers its adapter asynchronously; retry
        // the cancel until it lands.
        yield* Effect.gen(function* () {
          yield* runner.cancel(queryInput.id)

          if (rejectRunningQuery === undefined) {
            return yield* Effect.fail(new Error('adapter not running yet'))
          }
        }).pipe(Effect.retry({ times: 100 }), Effect.delay('1 millis'))

        yield* runner.awaitIdle

        return yield* runner.get(queryInput.id)
      }),
      config
    )

    expect(cancelCalls).toBeGreaterThanOrEqual(1)
    expect(finished.error).toEqual(canceledQueryMessage)
    expect(finished.result).toBeNull()
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
      persist: (records) => {
        written.push(...records)

        return Promise.resolve(records.length)
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

        return yield* runner.list()
      })
    )

    const legacy = queries.find((query) => query.id === 'legacy-query')

    expect(legacy?.result).toEqual({
      fields: [{ name: 'value' }],
      rowCount: 1,
      rows: [{ value: 1 }],
      truncated: false
    })
    expect(legacy?.error).toEqual(null)
  })

  it('reports a structurally unusable stored result without failing the list', async () => {
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
            id: 'broken-query',
            queriedAt: 1_000,
            result: JSON.stringify({ unexpected: true }),
            worksheetId: 'worksheet-1'
          })
        )

        return yield* runner.list()
      })
    )

    const broken = queries.find((query) => query.id === 'broken-query')

    expect(broken?.result).toEqual(null)
    expect(broken?.error).toEqual('Stored result could not be read.')
  })
})
