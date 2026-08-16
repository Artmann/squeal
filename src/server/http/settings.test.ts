import { HttpClient, HttpClientRequest } from '@effect/platform'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { makeAuthorizedClient, makeTestApi } from '@/test/effect-test-helper'

function run<A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>) {
  const { layer } = makeTestApi()

  return Effect.runPromise(Effect.provide(effect, layer))
}

describe('settings routes', () => {
  it('serves the defaults for a fresh install', async () => {
    const settings = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        return yield* client.settings.get()
      })
    )

    expect(settings).toEqual({
      aiCompletionModel: null,
      aiCompletionsEnabled: true
    })
  })

  it('saves a change and answers with the whole settings object', async () => {
    const settings = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        return yield* client.settings.update({
          payload: { aiCompletionModel: 'codegemma:2b' }
        })
      })
    )

    expect(settings).toEqual({
      aiCompletionModel: 'codegemma:2b',
      aiCompletionsEnabled: true
    })
  })

  it('keeps a setting the request did not mention', async () => {
    const settings = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        yield* client.settings.update({
          payload: { aiCompletionModel: 'codegemma:2b' }
        })

        yield* client.settings.update({
          payload: { aiCompletionsEnabled: false }
        })

        return yield* client.settings.get()
      })
    )

    expect(settings).toEqual({
      aiCompletionModel: 'codegemma:2b',
      aiCompletionsEnabled: false
    })
  })

  it('rejects a missing token', async () => {
    const { layer } = makeTestApi()

    const response = await Effect.runPromise(
      Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient
        const result = yield* http.execute(HttpClientRequest.get('/settings'))

        return { body: yield* result.json, status: result.status }
      }).pipe(Effect.scoped, Effect.provide(layer))
    )

    expect(response).toEqual({
      body: { _tag: 'UnauthorizedError', message: 'Unauthorized' },
      status: 401
    })
  })
})
