import { HttpClient, HttpClientRequest } from '@effect/platform'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import type { UpdateStatus } from '@/main/updates/updater'
import { updateMessages } from '@/main/updates/updater'
import {
  idleUpdateStatus,
  makeAuthorizedClient,
  makeTestApi,
  type TestApiOptions,
  type TestUpdaterState
} from '@/test/effect-test-helper'

const readyStatus: UpdateStatus = {
  currentVersion: '1.2.0',
  lastCheckedAt: 1_700_000_000_000,
  message: null,
  releaseNotesUrl: 'https://github.com/Artmann/squeal/releases/tag/v1.3.0',
  state: 'ready',
  version: '1.3.0'
}

function run<A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
  options: TestApiOptions = {}
): Promise<{ result: A; updaterState: TestUpdaterState }> {
  const { layer, updaterState } = makeTestApi(options)

  return Effect.runPromise(Effect.provide(effect, layer)).then((result) => ({
    result,
    updaterState
  }))
}

function getStatus(options: TestApiOptions = {}) {
  return run(
    Effect.gen(function* () {
      const client = yield* makeAuthorizedClient

      return yield* client.updates.get()
    }),
    options
  )
}

describe('update status route', () => {
  it('serves the idle status', async () => {
    const { result } = await getStatus()

    expect(result).toEqual(idleUpdateStatus)
  })

  it('serves a ready update with its version and notes URL', async () => {
    const { result } = await getStatus({ updateStatus: readyStatus })

    expect(result).toEqual(readyStatus)
  })

  it('serves a failed check as data rather than an error', async () => {
    const errorStatus: UpdateStatus = {
      ...idleUpdateStatus,
      lastCheckedAt: 1_700_000_000_000,
      message: updateMessages.checkFailed,
      state: 'error'
    }

    const { result } = await getStatus({ updateStatus: errorStatus })

    expect(result).toEqual(errorStatus)
  })

  it('serves the reason a build cannot update itself', async () => {
    const unsupportedStatus: UpdateStatus = {
      ...idleUpdateStatus,
      message: updateMessages.developmentBuild,
      state: 'unsupported'
    }

    const { result } = await getStatus({ updateStatus: unsupportedStatus })

    expect(result).toEqual(unsupportedStatus)
  })

  it('serves an update Linux cannot install itself', async () => {
    const availableStatus: UpdateStatus = {
      currentVersion: '1.2.0',
      lastCheckedAt: 1_700_000_000_000,
      message: updateMessages.linux,
      releaseNotesUrl: 'https://github.com/Artmann/squeal/releases/tag/v1.3.0',
      state: 'available',
      version: '1.3.0'
    }

    const { result } = await getStatus({ updateStatus: availableStatus })

    expect(result).toEqual(availableStatus)
  })

  it('rejects a missing token', async () => {
    const { layer } = makeTestApi()

    const response = await Effect.runPromise(
      Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient
        const result = yield* http.execute(HttpClientRequest.get('/updates'))

        return { body: yield* result.json, status: result.status }
      }).pipe(Effect.scoped, Effect.provide(layer))
    )

    expect(response).toEqual({
      body: { _tag: 'UnauthorizedError', message: 'Unauthorized' },
      status: 401
    })
  })
})

describe('update install route', () => {
  it('installs a ready update and answers with the status', async () => {
    const { result, updaterState } = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        return yield* client.updates.install()
      }),
      { updateStatus: readyStatus }
    )

    expect(result).toEqual(readyStatus)
    expect(updaterState).toEqual({ checks: 0, installs: 1 })
  })

  it('answers a tagged 409 when nothing is ready to install', async () => {
    const { layer } = makeTestApi()

    const response = await Effect.runPromise(
      Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient
        const result = yield* http.execute(
          HttpClientRequest.post('/updates/install').pipe(
            HttpClientRequest.setHeader(
              'authorization',
              'Bearer test-api-token'
            )
          )
        )

        return { body: yield* result.json, status: result.status }
      }).pipe(Effect.scoped, Effect.provide(layer))
    )

    expect(response).toEqual({
      body: {
        _tag: 'UpdateNotReadyError',
        message: updateMessages.notReady
      },
      status: 409
    })
  })

  it('rejects a missing token', async () => {
    const { layer } = makeTestApi({ updateStatus: readyStatus })

    const response = await Effect.runPromise(
      Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient
        const result = yield* http.execute(
          HttpClientRequest.post('/updates/install')
        )

        return { body: yield* result.json, status: result.status }
      }).pipe(Effect.scoped, Effect.provide(layer))
    )

    expect(response).toEqual({
      body: { _tag: 'UnauthorizedError', message: 'Unauthorized' },
      status: 401
    })
  })
})
