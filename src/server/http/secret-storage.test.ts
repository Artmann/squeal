import { HttpClient, HttpClientRequest } from '@effect/platform'
import { eq } from 'drizzle-orm'
import { Effect, Layer, Logger } from 'effect'
import { describe, expect, it } from 'vitest'

import { databasesTable, settingsTable } from '@/database/schema'
import { safeStorageName, secretStorageMessages } from '@/glue/secret-storage'
import { AppDatabase } from '@/server/services/app-database'
import {
  makeAuthorizedClient,
  makeTestApi,
  type TestApiOptions,
  testEncryptionPrefix
} from '@/test/effect-test-helper'

const storageName = safeStorageName(process.platform)

interface RunOptions extends TestApiOptions {
  // Provided outside the API layer on purpose: the route handler runs on a
  // fiber the served layer forked, so a logger provided inside the request
  // effect would never reach it.
  logging?: Layer.Layer<never>
}

function run<A, E>(
  effect: Effect.Effect<A, E, AppDatabase | HttpClient.HttpClient>,
  options: RunOptions = {}
): Promise<A> {
  const { logging = Layer.empty, ...apiOptions } = options

  const { layer } = makeTestApi(apiOptions)

  return Effect.runPromise(
    Effect.provide(Effect.provide(effect, layer), logging)
  )
}

interface SeedDatabaseOptions {
  connectionInfo: string
  deletedAt?: number
}

function seedDatabase(options: SeedDatabaseOptions) {
  return Effect.gen(function* () {
    const appDatabase = yield* AppDatabase

    yield* appDatabase.execute((client) =>
      client.insert(databasesTable).values({
        connectionInfo: options.connectionInfo,
        deletedAt: options.deletedAt ?? null,
        name: 'Seeded',
        type: 'postgres'
      })
    )
  })
}

// Re-encryption reports what it could not seal through the log and nowhere
// else, so that is where the test has to look.
function captureLogs() {
  const messages: string[] = []

  const layer = Logger.replace(
    Logger.defaultLogger,
    Logger.make(({ logLevel, message }) => {
      messages.push(`${logLevel.label} ${String(message)}`)
    })
  )

  return { layer, messages }
}

function readStoredMode() {
  return Effect.gen(function* () {
    const appDatabase = yield* AppDatabase

    const rows = yield* appDatabase.execute((client) =>
      client.select().from(settingsTable).where(eq(settingsTable.id, 'default'))
    )

    return rows[0]?.secretStorageMode ?? null
  })
}

function readConnectionInfo() {
  return Effect.gen(function* () {
    const appDatabase = yield* AppDatabase

    const rows = yield* appDatabase.execute((client) =>
      client
        .select({ connectionInfo: databasesTable.connectionInfo })
        .from(databasesTable)
    )

    return rows.map((row) => row.connectionInfo)
  })
}

describe('secret storage routes', () => {
  describe('reading the mode', () => {
    it('asks for a decision on a fresh install', async () => {
      const result = await run(
        Effect.gen(function* () {
          const client = yield* makeAuthorizedClient

          return yield* client.secretStorage.get()
        })
      )

      expect(result).toEqual({
        message: null,
        mode: 'undecided',
        storageName
      })
    })

    it('infers permission from an already encrypted connection', async () => {
      const result = await run(
        Effect.gen(function* () {
          const client = yield* makeAuthorizedClient

          yield* seedDatabase({
            connectionInfo: `${testEncryptionPrefix}{"host":"localhost"}`
          })

          return yield* client.secretStorage.get()
        })
      )

      expect(result).toEqual({ message: null, mode: 'keychain', storageName })
    })

    it('infers permission from a deleted connection too', async () => {
      // Deleting a connection overwrites its secret with an encrypted '{}', so
      // a user who removed every connection has still proved the keychain
      // worked. Filtering deleted rows out here would ask them for permission
      // they already gave.
      const result = await run(
        Effect.gen(function* () {
          const client = yield* makeAuthorizedClient

          yield* seedDatabase({
            connectionInfo: `${testEncryptionPrefix}{}`,
            deletedAt: 1_700_000_000_000
          })

          return yield* client.secretStorage.get()
        })
      )

      expect(result).toEqual({ message: null, mode: 'keychain', storageName })
    })

    it('asks for a decision when every connection is plaintext', async () => {
      const result = await run(
        Effect.gen(function* () {
          const client = yield* makeAuthorizedClient

          yield* seedDatabase({ connectionInfo: '{"host":"localhost"}' })

          return yield* client.secretStorage.get()
        })
      )

      expect(result).toEqual({ message: null, mode: 'undecided', storageName })
    })

    it('asks again when the stored mode is not recognized', async () => {
      // A database written by a newer build should not have its answer guessed.
      const result = await run(
        Effect.gen(function* () {
          const appDatabase = yield* AppDatabase
          const client = yield* makeAuthorizedClient

          yield* appDatabase.execute((database) =>
            database
              .insert(settingsTable)
              .values({ id: 'default', secretStorageMode: 'something-new' })
          )

          return yield* client.secretStorage.get()
        })
      )

      expect(result).toEqual({ message: null, mode: 'undecided', storageName })
    })
  })

  describe('granting permission', () => {
    it('records the choice and encrypts what is already stored', async () => {
      const { connectionInfo, response, storedMode } = await run(
        Effect.gen(function* () {
          const client = yield* makeAuthorizedClient

          yield* seedDatabase({ connectionInfo: '{"host":"localhost"}' })

          const response = yield* client.secretStorage.grant()

          return {
            connectionInfo: yield* readConnectionInfo(),
            response,
            storedMode: yield* readStoredMode()
          }
        })
      )

      expect(response).toEqual({
        message: null,
        mode: 'keychain',
        storageName
      })
      expect(storedMode).toEqual('keychain')
      expect(connectionInfo).toEqual([
        `${testEncryptionPrefix}{"host":"localhost"}`
      ])
    })

    it('leaves everything alone when the keychain refuses', async () => {
      const { connectionInfo, response, storedMode } = await run(
        Effect.gen(function* () {
          const client = yield* makeAuthorizedClient

          yield* seedDatabase({ connectionInfo: '{"host":"localhost"}' })

          const response = yield* client.secretStorage.grant()

          return {
            connectionInfo: yield* readConnectionInfo(),
            response,
            storedMode: yield* readStoredMode()
          }
        }),
        { secretStorageProbe: 'unavailable' }
      )

      // A refused prompt is not a decision, so nothing is persisted and the
      // next launch asks again.
      expect(response).toEqual({
        message: secretStorageMessages.keychainUnavailable(storageName),
        mode: 'undecided',
        storageName
      })
      expect(storedMode).toEqual(null)
      expect(connectionInfo).toEqual(['{"host":"localhost"}'])
    })

    // The keychain answers the probe and then stops sealing — a locked login
    // keyring, or a login item revoked between the two calls. `encrypt` cannot
    // fail, so the rows come back as the plaintext they went in as, and saying
    // nothing about it would leave the renderer announcing that the passwords
    // are now encrypted.
    it('tells the user which rows it could not encrypt when the keychain breaks', async () => {
      const logs = captureLogs()

      const { connectionInfo, response, storedMode } = await run(
        Effect.gen(function* () {
          const client = yield* makeAuthorizedClient

          yield* seedDatabase({ connectionInfo: '{"host":"localhost"}' })

          const response = yield* client.secretStorage.grant()

          return {
            connectionInfo: yield* readConnectionInfo(),
            response,
            storedMode: yield* readStoredMode()
          }
        }),
        { logging: logs.layer, secretStorageSealing: 'failed' }
      )

      // The decision still stands: the user granted permission, and the next
      // save will try the keychain again.
      expect({
        connectionInfo,
        logs: logs.messages,
        response,
        storedMode
      }).toEqual({
        connectionInfo: ['{"host":"localhost"}'],
        logs: [
          'WARN 1 database connection(s) remain unencrypted because OS keychain encryption is unavailable.'
        ],
        response: {
          message: secretStorageMessages.sealingFailed(1, storageName),
          mode: 'keychain',
          storageName
        },
        storedMode: 'keychain'
      })
    })

    it('explains a system with no keyring', async () => {
      const response = await run(
        Effect.gen(function* () {
          const client = yield* makeAuthorizedClient

          return yield* client.secretStorage.grant()
        }),
        { secretStorageProbe: 'noKeyring' }
      )

      expect(response).toEqual({
        message: secretStorageMessages.noKeyring,
        mode: 'undecided',
        storageName
      })
    })
  })

  describe('skipping', () => {
    it('records the choice and keeps answering the same way', async () => {
      const { response, secondRead, storedMode } = await run(
        Effect.gen(function* () {
          const client = yield* makeAuthorizedClient

          const response = yield* client.secretStorage.skip()

          return {
            response,
            secondRead: yield* client.secretStorage.get(),
            storedMode: yield* readStoredMode()
          }
        })
      )

      expect(response).toEqual({
        message: null,
        mode: 'plaintext',
        storageName
      })
      expect(storedMode).toEqual('plaintext')
      expect(secondRead).toEqual({
        message: null,
        mode: 'plaintext',
        storageName
      })
    })

    it('is not overturned by an encrypted row left on disk', async () => {
      const result = await run(
        Effect.gen(function* () {
          const client = yield* makeAuthorizedClient

          yield* seedDatabase({
            connectionInfo: `${testEncryptionPrefix}{"host":"localhost"}`
          })
          yield* client.secretStorage.skip()

          return yield* client.secretStorage.get()
        })
      )

      expect(result).toEqual({ message: null, mode: 'plaintext', storageName })
    })
  })

  it('requires a token', async () => {
    const response = await run(
      Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient

        const response = yield* http
          .execute(HttpClientRequest.get('/secret-storage'))
          .pipe(Effect.scoped)

        return { body: yield* response.json, status: response.status }
      })
    )

    expect(response).toEqual({
      body: { _tag: 'UnauthorizedError', message: 'Unauthorized' },
      status: 401
    })
  })

  it('does not require a token for the health probe it replaced', async () => {
    const response = await run(
      Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient

        const response = yield* http
          .execute(HttpClientRequest.get('/health'))
          .pipe(Effect.scoped)

        return { body: yield* response.json, status: response.status }
      })
    )

    // /health used to report keychain availability, which meant the one
    // unauthenticated route could raise an OS prompt.
    expect(response).toEqual({ body: { status: 'ok' }, status: 200 })
  })
})
