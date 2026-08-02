import { HttpClient, HttpClientRequest } from '@effect/platform'
import { Effect, Option } from 'effect'
import { describe, expect, it } from 'vitest'

import { databasesTable } from '@/database/schema'
import { AppDatabase } from '@/server/services/app-database'
import { DatabaseService } from '@/server/services/database-service'
import {
  makeAuthorizedClient,
  makeTestApi,
  testApiToken,
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

// The typed client cannot express a mismatched type/connectionInfo pair, which
// is the point — so these go over raw HTTP to prove the server rejects what a
// hand-rolled or older client could still send.
function rawPost(
  path: string,
  body: unknown,
  options: TestApiOptions = {}
): Promise<{ body: unknown; status: number }> {
  const { layer } = makeTestApi(options)

  return Effect.runPromise(
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient

      const response = yield* http.execute(
        HttpClientRequest.post(path).pipe(
          HttpClientRequest.setHeader(
            'authorization',
            `Bearer ${testApiToken}`
          ),
          HttpClientRequest.bodyUnsafeJson(body)
        )
      )

      return { body: yield* response.json, status: response.status }
    }).pipe(Effect.scoped, Effect.provide(layer))
  )
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
      expect(stored.value.connection.connectionInfo).toEqual(connectionInfo)
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

  // `type` and `connectionInfo` used to be validated independently, so a SQLite
  // row could be saved with server connection info and then crashed the adapter
  // on `pathToFileURL(undefined)` when anything tried to open it.
  it('rejects a create whose type and connection info disagree', async () => {
    const response = await rawPost('/databases', {
      connectionInfo,
      name: 'Mismatched',
      type: 'sqlite'
    })

    expect(response.status).toEqual(400)
  })

  it('rejects a connection test whose type and connection info disagree', async () => {
    const response = await rawPost('/connection-tests', {
      connectionInfo: { path: '/tmp/pagila.sqlite3' },
      type: 'postgres'
    })

    expect(response.status).toEqual(400)
  })

  it('stores nothing when the pair is rejected', async () => {
    const { layer } = makeTestApi({})

    // One layer for both halves, so the row check reads the same database the
    // rejected request was aimed at.
    const { rows, status } = await Effect.runPromise(
      Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient
        const appDatabase = yield* AppDatabase

        const response = yield* http.execute(
          HttpClientRequest.post('/databases').pipe(
            HttpClientRequest.setHeader(
              'authorization',
              `Bearer ${testApiToken}`
            ),
            HttpClientRequest.bodyUnsafeJson({
              connectionInfo,
              name: 'Mismatched',
              type: 'sqlite'
            })
          )
        )

        const rows = yield* appDatabase.execute((db) =>
          db.select().from(databasesTable)
        )

        return { rows, status: response.status }
      }).pipe(Effect.scoped, Effect.provide(layer))
    )

    expect(status).toEqual(400)
    expect(rows).toEqual([])
  })

  it('builds a SQLite adapter from a SQLite pair', async () => {
    const { adapterState, layer } = makeTestApi({})

    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const client = yield* makeAuthorizedClient

          const created = yield* client.databases.create({
            payload: {
              connectionInfo: { path: '/tmp/pagila.sqlite3' },
              name: 'Local',
              type: 'sqlite'
            }
          })

          return yield* client.databases.schema({
            path: { id: created.database.id }
          })
        }),
        layer
      )
    )

    expect(adapterState.lastType).toEqual('sqlite')
    expect(adapterState.lastConnectionInfo).toEqual({
      path: '/tmp/pagila.sqlite3'
    })
  })
})
