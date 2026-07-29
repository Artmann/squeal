import { HttpClient } from '@effect/platform'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

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

type TestContext = HttpClient.HttpClient | QueryRunner

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

    expect(immediate.query.finishedAt).toBeNull()
    expect(immediate.query.result).toBeNull()
    expect(finished.query.finishedAt).toEqual(expect.any(Number))
    expect(finished.query.result).toEqual({
      fields: [{ name: 'value' }],
      rowCount: 1,
      rows: [{ value: 1 }],
      truncated: false
    })
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
