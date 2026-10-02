import { HttpClient } from '@effect/platform'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { queriesTable } from '@/database/schema'
import { canceledQueryMessage } from '@/glue/queries'
import { AppDatabase } from '@/server/services/app-database'
import { QueryRunner } from '@/server/services/query-runner'
import {
  makeAuthorizedClient,
  makeTestApi,
  type TestApiOptions
} from '@/test/effect-test-helper'

const connectionInfo = {
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

type TestContext = AppDatabase | HttpClient.HttpClient | QueryRunner

function run<A, E>(
  effect: Effect.Effect<A, E, TestContext>,
  options: TestApiOptions = {}
): Promise<A> {
  const { layer } = makeTestApi(options)

  return Effect.runPromise(Effect.provide(effect, layer))
}

describe('query routes', () => {
  it('creates a query, returns the unfinished row, and finishes it in the background', async () => {
    const { immediate, finished } = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient
        const runner = yield* QueryRunner

        yield* client.databases.create({
          payload: { connectionInfo, name: 'Pagila', type: 'postgres' }
        })

        const immediate = yield* client.queries.create({
          payload: queryInput
        })

        yield* runner.awaitIdle

        const finished = yield* client.queries.get({
          path: { id: queryInput.id }
        })

        return { finished, immediate }
      })
    )

    expect(immediate.query).toEqual({
      content: 'select 1',
      databaseId: expect.any(String),
      id: 'query-1',
      queriedAt: 1_000,
      status: 'running',
      worksheetId: 'worksheet-1'
    })
    expect(finished.query).toEqual({
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

  // One row the response schema refused used to answer the whole history
  // with a 400. These are rows a real database holds from earlier versions.
  it('lists a history that holds legacy rows', async () => {
    const queries = await run(
      Effect.gen(function* () {
        const appDatabase = yield* AppDatabase
        const client = yield* makeAuthorizedClient

        const { database } = yield* client.databases.create({
          payload: { connectionInfo, name: 'Pagila', type: 'postgres' }
        })

        yield* appDatabase.execute((sqlite) =>
          sqlite.insert(queriesTable).values([
            {
              ...queryInput,
              databaseId: database.id,
              finishedAt: 2_000,
              id: 'before-truncated',
              queriedAt: 3_000,
              result: JSON.stringify({
                fields: [{ name: 'value' }],
                rowCount: 1,
                rows: [{ value: 1 }]
              })
            },
            {
              ...queryInput,
              databaseId: database.id,
              finishedAt: 2_000,
              id: 'unreadable',
              queriedAt: 2_000,
              result: 'not json at all'
            },
            {
              ...queryInput,
              databaseId: database.id,
              error: canceledQueryMessage,
              finishedAt: 2_000,
              id: 'canceled',
              queriedAt: 1_000
            }
          ])
        )

        const response = yield* client.queries.list()

        return response.queries
      })
    )

    expect(queries).toEqual([
      {
        ...queryInput,
        databaseId: expect.any(String),
        finishedAt: 2_000,
        id: 'before-truncated',
        queriedAt: 3_000,
        result: { rowCount: 1, truncated: false },
        status: 'succeeded'
      },
      {
        ...queryInput,
        databaseId: expect.any(String),
        error: 'Stored result could not be read.',
        finishedAt: 2_000,
        id: 'unreadable',
        queriedAt: 2_000,
        status: 'failed'
      },
      {
        ...queryInput,
        databaseId: expect.any(String),
        finishedAt: 2_000,
        id: 'canceled',
        queriedAt: 1_000,
        status: 'canceled'
      }
    ])
  })

  it('answers the status poll and the list with the result size but not its rows', async () => {
    const { list, status } = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient
        const runner = yield* QueryRunner

        yield* client.databases.create({
          payload: { connectionInfo, name: 'Pagila', type: 'postgres' }
        })

        yield* client.queries.create({ payload: queryInput })
        yield* runner.awaitIdle

        const status = yield* client.queries.status({
          path: { id: queryInput.id }
        })
        const list = yield* client.queries.list()

        return { list, status }
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

    expect(status).toEqual({ query: summary })
    expect(list).toEqual({ queries: [summary] })
  })

  it('answers 404 from the status poll for an unknown query', async () => {
    const error = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        return yield* client.queries
          .status({ path: { id: 'missing' } })
          .pipe(Effect.flip)
      })
    )

    expect(error).toEqual(
      expect.objectContaining({
        _tag: 'QueryNotFoundError',
        queryId: 'missing'
      })
    )
  })

  it('answers 400 when no database is available', async () => {
    const error = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        return yield* client.queries
          .create({ payload: queryInput })
          .pipe(Effect.flip)
      })
    )

    expect(error).toEqual(
      expect.objectContaining({ _tag: 'NoDatabaseAvailableError' })
    )
  })

  it('answers 404 with a tagged error for an unknown query', async () => {
    const error = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        return yield* client.queries
          .get({ path: { id: 'missing' } })
          .pipe(Effect.flip)
      })
    )

    expect(error).toEqual(
      expect.objectContaining({
        _tag: 'QueryNotFoundError',
        queryId: 'missing'
      })
    )
  })

  it('treats canceling an unknown query as a no-op success', async () => {
    const response = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        return yield* client.queries.cancel({ path: { id: 'missing' } })
      })
    )

    expect(response).toEqual({ success: true })
  })

  it('lists queries newest first', async () => {
    const queries = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient
        const runner = yield* QueryRunner

        yield* client.databases.create({
          payload: { connectionInfo, name: 'Pagila', type: 'postgres' }
        })

        yield* client.queries.create({ payload: queryInput })
        yield* client.queries.create({
          payload: { ...queryInput, id: 'query-2', queriedAt: 2_000 }
        })

        yield* runner.awaitIdle

        const response = yield* client.queries.list()

        return response.queries
      })
    )

    expect(queries.map((query) => query.id)).toEqual(['query-2', 'query-1'])
  })
})
