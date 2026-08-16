import { HttpClient, HttpClientRequest } from '@effect/platform'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { completionMessages } from '@/glue/completions'
import { maxCompletionContext } from '@/glue/api/schemas'
import {
  makeAuthorizedClient,
  makeTestApi,
  testOllamaHost,
  type TestApiOptions
} from '@/test/effect-test-helper'

function run<A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
  options: TestApiOptions = {}
): Promise<A> {
  const { layer } = makeTestApi(options)

  return Effect.runPromise(Effect.provide(effect, layer))
}

describe('completion status route', () => {
  it('says Ollama is missing rather than failing', async () => {
    const status = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        return yield* client.completions.status()
      })
    )

    expect(status).toEqual({
      available: false,
      enabled: true,
      message: completionMessages.unreachable(testOllamaHost),
      models: [],
      selectedModel: null
    })
  })

  it('lists the installed models and the one it will use', async () => {
    const status = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        return yield* client.completions.status()
      }),
      { ollama: { models: ['llama3.2:3b', 'qwen2.5-coder:1.5b'] } }
    )

    expect(status).toEqual({
      available: true,
      enabled: true,
      message: completionMessages.using('qwen2.5-coder:1.5b'),
      models: ['llama3.2:3b', 'qwen2.5-coder:1.5b'],
      selectedModel: 'qwen2.5-coder:1.5b'
    })
  })

  it('rejects a missing token', async () => {
    const { layer } = makeTestApi()

    const response = await Effect.runPromise(
      Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient
        const result = yield* http.execute(
          HttpClientRequest.get('/completions/status')
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

describe('create completion route', () => {
  it('answers with the suggestion', async () => {
    const result = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        return yield* client.completions.create({
          payload: { prefix: 'select * ', suffix: '' }
        })
      }),
      { ollama: { models: ['codegemma:2b'], response: 'from film' } }
    )

    expect(result).toEqual({ completion: 'from film' })
  })

  it('answers with no suggestion when Ollama is not running', async () => {
    const result = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        return yield* client.completions.create({
          payload: { prefix: 'select * ', suffix: '' }
        })
      })
    )

    expect(result).toEqual({ completion: null })
  })

  it('refuses more context than one request may carry', async () => {
    const { layer } = makeTestApi({
      ollama: { models: ['codegemma:2b'], response: 'from film' }
    })

    const response = await Effect.runPromise(
      Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient
        const result = yield* http.execute(
          HttpClientRequest.post('/completions').pipe(
            HttpClientRequest.setHeader(
              'authorization',
              'Bearer test-api-token'
            ),
            HttpClientRequest.bodyUnsafeJson({
              prefix: 'x'.repeat(maxCompletionContext + 1),
              suffix: ''
            })
          )
        )

        return result.status
      }).pipe(Effect.scoped, Effect.provide(layer))
    )

    expect(response).toEqual(400)
  })

  it('rejects a missing token', async () => {
    const { layer } = makeTestApi()

    const response = await Effect.runPromise(
      Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient
        const result = yield* http.execute(
          HttpClientRequest.post('/completions').pipe(
            HttpClientRequest.bodyUnsafeJson({ prefix: 'select ', suffix: '' })
          )
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
