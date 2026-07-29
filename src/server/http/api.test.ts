import { HttpClient, HttpClientRequest } from '@effect/platform'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  makeAuthorizedClient,
  makeTestApi,
  testApiToken,
  type TestApiOptions
} from '@/test/effect-test-helper'

interface RawResponse {
  body: unknown
  status: number
}

function rawRequest(
  request: HttpClientRequest.HttpClientRequest,
  options: TestApiOptions = {}
): Promise<RawResponse> {
  const { layer } = makeTestApi(options)

  return Effect.runPromise(
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const response = yield* http.execute(request)
      const body = yield* response.json

      return { body, status: response.status }
    }).pipe(Effect.scoped, Effect.provide(layer))
  )
}

describe('authentication', () => {
  it('serves /health without a token', async () => {
    const response = await rawRequest(HttpClientRequest.get('/health'))

    expect(response).toEqual({
      body: { encryptionAvailable: true, status: 'ok' },
      status: 200
    })
  })

  it('rejects a missing token with a tagged 401', async () => {
    const response = await rawRequest(HttpClientRequest.get('/databases'))

    expect(response).toEqual({
      body: { _tag: 'UnauthorizedError', message: 'Unauthorized' },
      status: 401
    })
  })

  it('rejects a wrong token', async () => {
    const response = await rawRequest(
      HttpClientRequest.get('/databases').pipe(
        HttpClientRequest.setHeader('authorization', 'Bearer wrong-token')
      )
    )

    expect(response.status).toEqual(401)
  })

  it('accepts the session token', async () => {
    const { layer } = makeTestApi()

    const databases = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        return yield* client.databases.list()
      }).pipe(Effect.provide(layer))
    )

    expect(databases).toEqual({ databases: [] })
  })

  it('serves trace reads without a token when public reads are on', async () => {
    const response = await rawRequest(HttpClientRequest.get('/traces'), {
      publicTraceReads: true
    })

    expect(response).toEqual({ body: { traces: [] }, status: 200 })
  })

  it('requires the token for trace reads by default', async () => {
    const response = await rawRequest(HttpClientRequest.get('/traces'))

    expect(response.status).toEqual(401)
  })

  it('always requires the token for span ingest', async () => {
    const response = await rawRequest(
      HttpClientRequest.post('/traces/spans'),
      { publicTraceReads: true }
    )

    expect(response.status).toEqual(401)
  })

  it('answers malformed payloads with a tagged 400', async () => {
    const response = await rawRequest(
      HttpClientRequest.post('/worksheets').pipe(
        HttpClientRequest.setHeader('authorization', `Bearer ${testApiToken}`),
        HttpClientRequest.bodyUnsafeJson({})
      )
    )

    expect(response.status).toEqual(400)
    expect(response.body).toEqual(
      expect.objectContaining({ _tag: 'HttpApiDecodeError' })
    )
  })
})
