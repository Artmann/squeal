import { HttpClient } from '@effect/platform'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  makeAuthorizedClient,
  makeTestApi,
  type TestApiOptions,
  type TestAdapterState
} from '@/test/effect-test-helper'

const connectionInfo = {
  database: 'pagila',
  host: 'localhost',
  password: 'secret',
  username: 'postgres'
}

function run<A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
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
})
