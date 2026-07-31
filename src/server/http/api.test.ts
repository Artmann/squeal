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

function rawHeaders(
  request: HttpClientRequest.HttpClientRequest,
  options: TestApiOptions = {}
): Promise<Record<string, string>> {
  const { layer } = makeTestApi(options)

  return Effect.runPromise(
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const response = yield* http.execute(request)

      return { ...response.headers }
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

  // The scheme token is case-insensitive per RFC 7235, and the platform's own
  // bearer decoder ignores its case, so the trace-read middleware must too.
  it('accepts a lowercase bearer scheme on a normal route', async () => {
    const response = await rawRequest(
      HttpClientRequest.get('/databases').pipe(
        HttpClientRequest.setHeader('authorization', `bearer ${testApiToken}`)
      )
    )

    expect(response).toEqual({ body: { databases: [] }, status: 200 })
  })

  it('accepts a lowercase bearer scheme on trace reads', async () => {
    const response = await rawRequest(
      HttpClientRequest.get('/traces').pipe(
        HttpClientRequest.setHeader('authorization', `bearer ${testApiToken}`)
      )
    )

    expect(response).toEqual({ body: { traces: [] }, status: 200 })
  })

  // A browser always sends Origin cross-origin, so the development carve-out
  // must not apply to it — otherwise any visited page could read the span
  // store, which carries the user's SQL.
  it('requires the token for a browser trace read even with public reads on', async () => {
    const response = await rawRequest(
      HttpClientRequest.get('/traces').pipe(
        HttpClientRequest.setHeader('origin', 'null')
      ),
      { publicTraceReads: true }
    )

    expect(response).toEqual({
      body: { _tag: 'UnauthorizedError', message: 'Unauthorized' },
      status: 401
    })
  })
})

describe('cors', () => {
  it('does not echo an allowed origin back to a foreign origin', async () => {
    const headers = await rawHeaders(
      HttpClientRequest.get('/health').pipe(
        HttpClientRequest.setHeader('origin', 'https://evil.example')
      )
    )

    expect(headers['access-control-allow-origin']).toBeUndefined()
  })

  it('allows the origin a packaged renderer sends', async () => {
    const headers = await rawHeaders(
      HttpClientRequest.get('/health').pipe(
        HttpClientRequest.setHeader('origin', 'null')
      )
    )

    expect(headers['access-control-allow-origin']).toEqual('null')
  })

  it('allows a configured development origin', async () => {
    const headers = await rawHeaders(
      HttpClientRequest.get('/health').pipe(
        HttpClientRequest.setHeader('origin', 'http://localhost:5173')
      ),
      { allowedOrigins: ['null', 'http://localhost:5173'] }
    )

    expect(headers['access-control-allow-origin']).toEqual(
      'http://localhost:5173'
    )
  })
})

describe('request guards', () => {
  // CORS cannot stop DNS rebinding, so the Host header is checked separately.
  it('refuses a request addressed to a foreign host', async () => {
    const response = await rawRequest(
      HttpClientRequest.get('/health').pipe(
        HttpClientRequest.setHeader('host', 'attacker.example')
      )
    )

    expect(response.status).toEqual(403)
  })

  it('serves a request addressed to loopback', async () => {
    const response = await rawRequest(HttpClientRequest.get('/health'))

    expect(response.status).toEqual(200)
  })

  // Asserts the invariant rather than the status: the guard answers as soon as
  // Content-Length exceeds the limit, without consuming the body, so this
  // client usually sees the connection close before it can read the 413. What
  // must hold is that the oversized body was never stored.
  it('does not store an oversized request body', async () => {
    const { layer } = makeTestApi()

    const worksheets = await Effect.runPromise(
      Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient

        yield* http
          .execute(
            HttpClientRequest.post('/worksheets').pipe(
              HttpClientRequest.setHeader(
                'authorization',
                `Bearer ${testApiToken}`
              ),
              HttpClientRequest.bodyUnsafeJson({
                name: 'x'.repeat(9 * 1024 * 1024)
              })
            )
          )
          .pipe(Effect.ignore)

        const response = yield* http.execute(
          HttpClientRequest.get('/worksheets').pipe(
            HttpClientRequest.setHeader(
              'authorization',
              `Bearer ${testApiToken}`
            )
          )
        )

        const body = (yield* response.json) as {
          worksheets: Array<{ name: string }>
        }

        return body.worksheets.map((worksheet) => worksheet.name)
      }).pipe(Effect.scoped, Effect.provide(layer))
    )

    // Only the default worksheet the service seeds — the oversized one is gone.
    expect(worksheets).toEqual(['My First Worksheet'])
  })
})
