import { HttpClient } from '@effect/platform'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { databasesTable, environmentsTable } from '@/database/schema'
import { AppDatabase } from '@/server/services/app-database'
import { EnvironmentService } from '@/server/services/environment-service'
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

type TestContext = AppDatabase | EnvironmentService | HttpClient.HttpClient

function run<A, E>(
  effect: Effect.Effect<A, E, TestContext>,
  options: TestApiOptions = {}
): Promise<A> {
  const { layer } = makeTestApi(options)

  return Effect.runPromise(Effect.provide(effect, layer))
}

describe('environment routes', () => {
  it('lists the environments every install ships with', async () => {
    const response = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        return yield* client.environments.list()
      })
    )

    expect(
      response.environments.map((environment) => ({
        hue: environment.hue,
        id: environment.id,
        name: environment.name
      }))
    ).toEqual([
      { hue: 152, id: 'local', name: 'Local' },
      { hue: 70, id: 'staging', name: 'Staging' },
      { hue: 25, id: 'production', name: 'Production' }
    ])
  })

  it('creates an environment and stores it', async () => {
    const { response, rows } = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient
        const appDatabase = yield* AppDatabase

        const response = yield* client.environments.create({
          payload: { hue: 195, name: 'Sandbox' }
        })

        const rows = yield* appDatabase.execute((db) =>
          db.select().from(environmentsTable)
        )

        return { response, rows }
      })
    )

    expect(response.environment).toEqual(
      expect.objectContaining({ hue: 195, name: 'Sandbox' })
    )
    expect(rows.length).toEqual(4)
  })

  it('renames an environment without touching its colour', async () => {
    const response = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        return yield* client.environments.update({
          path: { id: 'production' },
          payload: { name: 'Live' }
        })
      })
    )

    expect(response.environment).toEqual({
      createdAt: 3,
      hue: 25,
      id: 'production',
      name: 'Live'
    })
  })

  // Asserted on the connection's row rather than on the response, which only
  // says the delete happened.
  it('clears the environment off the connections that used it', async () => {
    const rows = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient
        const appDatabase = yield* AppDatabase

        yield* client.databases.create({
          payload: {
            connectionInfo,
            environmentId: 'production',
            name: 'Pagila',
            type: 'postgres'
          }
        })

        yield* client.environments.remove({ path: { id: 'production' } })

        return yield* appDatabase.execute((db) =>
          db.select().from(databasesTable)
        )
      })
    )

    expect(rows[0]?.environmentId).toEqual(null)
  })

  it('answers a delete of an unknown environment with a tagged 404', async () => {
    const error = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        return yield* Effect.flip(
          client.environments.remove({ path: { id: 'nope' } })
        )
      })
    )

    expect(error).toEqual(
      expect.objectContaining({
        _tag: 'EnvironmentNotFoundError',
        message: 'This environment no longer exists.'
      })
    )
  })

  it('answers a patch of an unknown environment with a tagged 404', async () => {
    const error = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        return yield* Effect.flip(
          client.environments.update({
            path: { id: 'nope' },
            payload: { name: 'Nope' }
          })
        )
      })
    )

    expect(error).toEqual(
      expect.objectContaining({
        _tag: 'EnvironmentNotFoundError',
        message: 'This environment no longer exists.'
      })
    )
  })
})
