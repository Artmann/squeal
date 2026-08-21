import { HttpClient } from '@effect/platform'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { databasesTable } from '@/database/schema'
import { AppDatabase } from '@/server/services/app-database'
import {
  makeAuthorizedClient,
  makeTestApi,
  testEncryptionPrefix,
  type TestApiOptions,
  type TestAdapterState
} from '@/test/effect-test-helper'

const connectionInfo = {
  database: 'pagila',
  host: 'localhost',
  password: 'secret',
  username: 'postgres'
}

type TestContext = AppDatabase | HttpClient.HttpClient

function run<A, E>(
  effect: Effect.Effect<A, E, TestContext>,
  options: TestApiOptions = {}
): Promise<{ result: A; adapterState: TestAdapterState }> {
  const { adapterState, layer } = makeTestApi(options)

  return Effect.runPromise(Effect.provide(effect, layer)).then((result) => ({
    adapterState,
    result
  }))
}

describe('connection test route', () => {
  it('answers success for a working connection', async () => {
    const { result } = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        return yield* client.connectionTests.create({
          payload: { connectionInfo, type: 'postgres' }
        })
      })
    )

    expect(result).toEqual({ success: true })
  })

  it('answers 200 with the driver message for a failing connection', async () => {
    const { result } = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        return yield* client.connectionTests.create({
          payload: { connectionInfo, type: 'postgres' }
        })
      }),
      {
        adapter: {
          testConnection: () =>
            Promise.reject(new Error('password authentication failed'))
        }
      }
    )

    expect(result).toEqual({
      message: 'password authentication failed',
      success: false
    })
  })

  it('requires a password when no stored connection is referenced', async () => {
    const { result } = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        return yield* client.connectionTests.create({
          payload: {
            connectionInfo: { ...connectionInfo, password: '' },
            type: 'postgres'
          }
        })
      })
    )

    expect(result).toEqual({ message: 'Password is required.', success: false })
  })

  it('borrows the stored password when a databaseId is sent', async () => {
    const { adapterState, result } = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        const created = yield* client.databases.create({
          payload: { connectionInfo, name: 'Pagila', type: 'postgres' }
        })

        return yield* client.connectionTests.create({
          payload: {
            connectionInfo: { ...connectionInfo, password: '' },
            databaseId: created.database.id,
            type: 'postgres'
          }
        })
      })
    )

    expect(result).toEqual({ success: true })
    expect(adapterState.lastConnectionInfo).toEqual(connectionInfo)
  })

  // A keychain reset makes every stored secret unreadable. The test cannot
  // borrow what it cannot read, but the row is still the user's to repair, so
  // this asks for the password instead of failing the request.
  it('requires a password when the stored secret cannot be read', async () => {
    const { adapterState, result } = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient
        const appDatabase = yield* AppDatabase

        const created = yield* client.databases.create({
          payload: { connectionInfo, name: 'Pagila', type: 'postgres' }
        })

        yield* appDatabase.execute((database) =>
          database
            .update(databasesTable)
            .set({ connectionInfo: `${testEncryptionPrefix}not-json` })
            .where(eq(databasesTable.id, created.database.id))
        )

        return yield* client.connectionTests.create({
          payload: {
            connectionInfo: { ...connectionInfo, password: '' },
            databaseId: created.database.id,
            type: 'postgres'
          }
        })
      })
    )

    expect(result).toEqual({ message: 'Password is required.', success: false })
    expect(adapterState.lastConnectionInfo).toEqual(null)
  })

  // Repairing an unreadable row saves a blank password, and rows predating the
  // non-empty rule can hold one too. An empty password is no secret to borrow,
  // so the honest answer is to ask for one — not to hand `undefined` to the
  // driver, and not to refuse the way a different server is refused.
  it('requires a password when the stored password is empty', async () => {
    const { adapterState, result } = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient
        const appDatabase = yield* AppDatabase

        const created = yield* client.databases.create({
          payload: { connectionInfo, name: 'Pagila', type: 'postgres' }
        })

        yield* appDatabase.execute((database) =>
          database
            .update(databasesTable)
            .set({
              connectionInfo: `${testEncryptionPrefix}${JSON.stringify({
                ...connectionInfo,
                password: ''
              })}`
            })
            .where(eq(databasesTable.id, created.database.id))
        )

        return yield* client.connectionTests.create({
          payload: {
            connectionInfo: { ...connectionInfo, password: '' },
            databaseId: created.database.id,
            type: 'postgres'
          }
        })
      })
    )

    expect(result).toEqual({ message: 'Password is required.', success: false })
    expect(adapterState.lastConnectionInfo).toEqual(null)
  })

  // The same-server check sits below the "did the request bring its own
  // password" check. Moving it above would refuse every test against a new
  // host, even one the user typed the password for.
  it('allows a different host when the request carries its own password', async () => {
    const { adapterState, result } = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        const created = yield* client.databases.create({
          payload: { connectionInfo, name: 'Pagila', type: 'postgres' }
        })

        return yield* client.connectionTests.create({
          payload: {
            connectionInfo: {
              ...connectionInfo,
              host: 'replica.internal',
              password: 'typed-again'
            },
            databaseId: created.database.id,
            type: 'postgres'
          }
        })
      })
    )

    expect(result).toEqual({ success: true })
    expect(adapterState.lastConnectionInfo).toEqual({
      ...connectionInfo,
      host: 'replica.internal',
      password: 'typed-again'
    })
  })

  // Otherwise an authenticated caller could aim a saved password at a server
  // they control and read it off the handshake.
  it('refuses to lend the stored password to a different host', async () => {
    const { adapterState, result } = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        const created = yield* client.databases.create({
          payload: { connectionInfo, name: 'Pagila', type: 'postgres' }
        })

        return yield* client.connectionTests.create({
          payload: {
            connectionInfo: {
              ...connectionInfo,
              host: 'attacker.example',
              password: ''
            },
            databaseId: created.database.id,
            type: 'postgres'
          }
        })
      })
    )

    expect(result).toEqual({
      message: 'Enter the password to test a different host or port.',
      success: false
    })

    // No adapter was built for the attacker's host, so nothing was sent.
    expect(adapterState.lastConnectionInfo).toEqual(null)
  })

  it('refuses to lend the stored password to a different port', async () => {
    const { result } = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        const created = yield* client.databases.create({
          payload: { connectionInfo, name: 'Pagila', type: 'postgres' }
        })

        return yield* client.connectionTests.create({
          payload: {
            connectionInfo: { ...connectionInfo, password: '', port: 6000 },
            databaseId: created.database.id,
            type: 'postgres'
          }
        })
      })
    )

    expect(result).toEqual({
      message: 'Enter the password to test a different host or port.',
      success: false
    })
  })

  // Editing the username or database still targets the same trusted server, so
  // the borrow stays allowed there.
  it('still borrows the stored password when only the database name changes', async () => {
    const { adapterState, result } = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        const created = yield* client.databases.create({
          payload: { connectionInfo, name: 'Pagila', type: 'postgres' }
        })

        return yield* client.connectionTests.create({
          payload: {
            connectionInfo: {
              ...connectionInfo,
              database: 'other',
              password: ''
            },
            databaseId: created.database.id,
            type: 'postgres'
          }
        })
      })
    )

    expect(result).toEqual({ success: true })
    expect(adapterState.lastConnectionInfo).toEqual({
      ...connectionInfo,
      database: 'other'
    })
  })

  // Trying a new SSL setting against a saved connection is the whole point of
  // the test button, and it used to be the one thing the button could not do:
  // the borrow was refused, so the user had to go and find a password the app
  // never shows them before they could find out whether the setting worked.
  it('still borrows the stored password when the SSL mode changes', async () => {
    const { adapterState, result } = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        const created = yield* client.databases.create({
          payload: { connectionInfo, name: 'Pagila', type: 'postgres' }
        })

        return yield* client.connectionTests.create({
          payload: {
            connectionInfo: {
              ...connectionInfo,
              password: '',
              sslMode: 'verify-full'
            },
            databaseId: created.database.id,
            type: 'postgres'
          }
        })
      })
    )

    expect(result).toEqual({ success: true })
    expect(adapterState.lastConnectionInfo).toEqual({
      ...connectionInfo,
      sslMode: 'verify-full'
    })
  })
})
