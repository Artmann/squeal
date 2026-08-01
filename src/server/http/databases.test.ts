import { HttpClient } from '@effect/platform'
import { Effect, Option } from 'effect'
import { describe, expect, it } from 'vitest'

import { databasesTable } from '@/database/schema'
import { AppDatabase } from '@/server/services/app-database'
import { DatabaseService } from '@/server/services/database-service'
import {
  makeAuthorizedClient,
  makeTestApi,
  testEncryptionPrefix,
  type TestApiOptions
} from '@/test/effect-test-helper'

const connectionInfo = {
  database: 'pagila',
  host: 'localhost',
  password: 'secret',
  username: 'postgres'
}

type TestContext = AppDatabase | DatabaseService | HttpClient.HttpClient

function run<A, E>(
  effect: Effect.Effect<A, E, TestContext>,
  options: TestApiOptions = {}
): Promise<A> {
  const { layer } = makeTestApi(options)

  return Effect.runPromise(Effect.provide(effect, layer))
}

describe('database routes', () => {
  it('creates a database, stores the secret encrypted, and strips the password', async () => {
    const { response, row } = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient
        const appDatabase = yield* AppDatabase

        const response = yield* client.databases.create({
          payload: { connectionInfo, name: 'Pagila', type: 'postgres' }
        })

        const [row] = yield* appDatabase.execute((db) =>
          db.select().from(databasesTable)
        )

        return { response, row }
      })
    )

    expect(response.database.connectionInfo).toEqual({
      database: 'pagila',
      host: 'localhost',
      username: 'postgres'
    })
    expect(row.connectionInfo.startsWith(testEncryptionPrefix)).toEqual(true)
  })

  it('keeps the stored password when an update sends a blank one', async () => {
    const stored = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient
        const service = yield* DatabaseService

        const created = yield* client.databases.create({
          payload: { connectionInfo, name: 'Pagila', type: 'postgres' }
        })

        yield* client.databases.update({
          path: { id: created.database.id },
          payload: {
            connectionInfo: { ...connectionInfo, password: '' },
            name: 'Renamed',
            type: 'postgres'
          }
        })

        return yield* service.getWithSecrets(created.database.id)
      })
    )

    expect(Option.isSome(stored)).toEqual(true)

    if (Option.isSome(stored)) {
      expect(stored.value.connectionInfo).toEqual(connectionInfo)
      expect(stored.value.name).toEqual('Renamed')
    }
  })

  it('deletes a database and empties the list', async () => {
    const { removal, remaining } = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        const created = yield* client.databases.create({
          payload: { connectionInfo, name: 'Pagila', type: 'postgres' }
        })

        const removal = yield* client.databases.remove({
          path: { id: created.database.id }
        })
        const remaining = yield* client.databases.list()

        return { remaining, removal }
      })
    )

    expect(removal).toEqual({ success: true })
    expect(remaining).toEqual({ databases: [] })
  })

  it('loads the schema through the adapter', async () => {
    const response = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        const created = yield* client.databases.create({
          payload: { connectionInfo, name: 'Pagila', type: 'postgres' }
        })

        return yield* client.databases.schema({
          path: { id: created.database.id }
        })
      })
    )

    expect(response).toEqual({
      schema: { databaseName: 'test', tables: [] }
    })
  })

  it('includes the server version the adapter reports', async () => {
    const response = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        const created = yield* client.databases.create({
          payload: { connectionInfo, name: 'Pagila', type: 'postgres' }
        })

        return yield* client.databases.schema({
          path: { id: created.database.id }
        })
      }),
      {
        adapter: {
          getServerVersion: () => Promise.resolve('PostgreSQL 16')
        }
      }
    )

    expect(response).toEqual({
      schema: {
        databaseName: 'test',
        serverVersion: 'PostgreSQL 16',
        tables: []
      }
    })
  })

  it('still returns the schema when the version probe fails', async () => {
    const response = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        const created = yield* client.databases.create({
          payload: { connectionInfo, name: 'Pagila', type: 'postgres' }
        })

        return yield* client.databases.schema({
          path: { id: created.database.id }
        })
      }),
      {
        adapter: {
          getServerVersion: () =>
            Promise.reject(new Error('permission denied for function version'))
        }
      }
    )

    expect(response).toEqual({
      schema: { databaseName: 'test', tables: [] }
    })
    expect('serverVersion' in response.schema).toEqual(false)
  })

  it('answers 404 for a schema request on an unknown database', async () => {
    const error = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        return yield* client.databases
          .schema({ path: { id: 'missing' } })
          .pipe(Effect.flip)
      })
    )

    expect(error).toEqual(
      expect.objectContaining({
        _tag: 'DatabaseNotFoundError',
        databaseId: 'missing'
      })
    )
  })

  it('maps schema introspection failures to a 503 with the database name', async () => {
    const error = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        const created = yield* client.databases.create({
          payload: { connectionInfo, name: 'Pagila', type: 'postgres' }
        })

        return yield* client.databases
          .schema({ path: { id: created.database.id } })
          .pipe(Effect.flip)
      }),
      {
        adapter: {
          getSchema: () => Promise.reject(new Error('connection refused'))
        }
      }
    )

    expect(error).toEqual(
      expect.objectContaining({
        _tag: 'SchemaLoadFailedError',
        databaseName: 'Pagila',
        message: 'Failed to load schema for "Pagila": connection refused'
      })
    )
  })

  it('reports unknown ids on reorder', async () => {
    const error = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        const created = yield* client.databases.create({
          payload: { connectionInfo, name: 'Pagila', type: 'postgres' }
        })

        return yield* client.databases
          .reorder({
            payload: { databaseIds: [created.database.id, 'missing'] }
          })
          .pipe(Effect.flip)
      })
    )

    expect(error).toEqual(
      expect.objectContaining({
        _tag: 'UnknownDatabaseIdsError',
        unknownIds: ['missing']
      })
    )
  })
})
