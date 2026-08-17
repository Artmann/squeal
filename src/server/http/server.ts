import {
  HttpApiBuilder,
  HttpApp,
  HttpMiddleware,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse
} from '@effect/platform'
// Subpath import on purpose: the package barrel pulls in cluster modules
// whose optional peers are not installed.
import * as NodeHttpServer from '@effect/platform-node/NodeHttpServer'
import { Config, Effect, Layer, Option } from 'effect'
import { createServer } from 'node:http'

import { SquealApi } from '@/glue/api/api'
import { shouldSkipTracing } from '../tracing/trace-skip'
import {
  AuthorizationLive,
  TraceReadAuthorizationLive
} from './authorization-live'
import { ConnectionTestsLive } from './handlers/connection-tests'
import { DatabasesLive } from './handlers/databases'
import { HealthLive } from './handlers/health'
import { QueriesLive } from './handlers/queries'
import { SecretStorageLive } from './handlers/secret-storage'
import { TracesLive } from './handlers/traces'
import { UpdatesLive } from './handlers/updates'
import { WorksheetsLive } from './handlers/worksheets'

const apiPort = 7847

const HandlersLive = Layer.mergeAll(
  ConnectionTestsLive,
  DatabasesLive,
  HealthLive,
  QueriesLive,
  SecretStorageLive,
  TracesLive,
  UpdatesLive,
  WorksheetsLive
)

// The full API implementation without a concrete server attached — shared by
// the production server below and the in-memory test harness.
export const ApiLive = HttpApiBuilder.api(SquealApi).pipe(
  Layer.provide(HandlersLive),
  Layer.provide(AuthorizationLive),
  Layer.provide(TraceReadAuthorizationLive)
)

// CORS runs before auth so OPTIONS preflights (which never carry an
// Authorization header) still succeed for the allowed origins. 'null' is the
// Origin a packaged renderer sends when loaded from file://.
export const CorsLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const allowedOrigins = yield* Config.string('ALLOWED_ORIGINS').pipe(
      Config.withDefault('null')
    )
    const allowed = allowedOrigins.split(',')

    return HttpApiBuilder.middlewareCors({
      allowedHeaders: ['Authorization', 'Content-Type', 'traceparent'],
      // Every request carries an Authorization header, which makes every one of
      // them a preflighted cross-origin request — the renderer's origin is the
      // `null` of a file:// page in a packaged build and the Vite origin in dev,
      // and neither is the loopback server's. Without this the middleware sends
      // no Access-Control-Max-Age at all and Chromium falls back to caching a
      // preflight for ~5 seconds, so the 250ms result poller and the autosave
      // pay a second round trip over and over. 600 is the ceiling Chromium
      // honours; anything larger is clamped to it.
      maxAge: 600,
      // A predicate rather than the array: given exactly one allowed origin the
      // middleware takes a fast path that emits a constant header without ever
      // comparing the request's Origin, so a packaged build (whose only allowed
      // origin is 'null') would answer every caller with
      // `access-control-allow-origin: null`.
      allowedOrigins: (origin) => allowed.includes(origin)
    })
  })
)

// Generous enough for any realistic SQL text or query result while still
// bounding what a single request can buffer in the main process.
const maxRequestBodyBytes = 8 * 1024 * 1024

const allowedHostnames = new Set(['127.0.0.1', '::1', '[::1]', 'localhost'])

// Only the hostname is checked, never the port: the port is whatever the
// server bound (the test harness uses an ephemeral one), while the hostname is
// what a rebinding attack has to get wrong.
function hostnameOf(host: string): string {
  if (host.startsWith('[')) {
    const end = host.indexOf(']')

    return end === -1 ? host : host.slice(0, end + 1)
  }

  const colon = host.indexOf(':')

  return colon === -1 ? host : host.slice(0, colon)
}

// CORS cannot defend against DNS rebinding: the browser sends a legitimate
// Origin for the attacker's own page, and the request still arrives on
// loopback. Checking Host does defend against it. This runs outside the CORS
// layer, so it also covers OPTIONS preflights.
function withRequestGuards(app: HttpApp.Default): HttpApp.Default {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const host = request.headers.host

    if (host === undefined || !allowedHostnames.has(hostnameOf(host))) {
      return HttpServerResponse.unsafeJson(
        {
          message:
            'Squeal only accepts requests addressed to 127.0.0.1. Use http://127.0.0.1:7847.'
        },
        { status: 403 }
      )
    }

    // MaxBodySize below fails mid-stream rather than pre-checking, so a
    // declared length is rejected up front to give a clear answer for the
    // common case.
    const declaredLength = Number(request.headers['content-length'] ?? '0')

    if (
      Number.isFinite(declaredLength) &&
      declaredLength > maxRequestBodyBytes
    ) {
      return HttpServerResponse.unsafeJson(
        { message: 'The request body is too large.' },
        { status: 413 }
      )
    }

    return yield* app
  }).pipe(HttpServerRequest.withMaxBodySize(Option.some(maxRequestBodyBytes)))
}

// Shared by the production server and the in-memory test harness so both run
// the same guards.
export const ServeLive = HttpApiBuilder.serve(withRequestGuards)

function requestPath(request: HttpServerRequest.HttpServerRequest): string {
  const queryStart = request.url.indexOf('?')

  return queryStart === -1 ? request.url : request.url.slice(0, queryStart)
}

// The HTTP server on loopback only. Serving is a layer, so the runtime scope
// owns the socket: interrupting the layer closes the server. The platform
// applies its request tracer automatically (parsing incoming traceparent
// headers); withTracerDisabledWhen reproduces the legacy skip list.
export const HttpLive = ServeLive.pipe(
  HttpServer.withLogAddress,
  HttpMiddleware.withTracerDisabledWhen((request) =>
    shouldSkipTracing(request.method, requestPath(request))
  ),
  Layer.provide(CorsLive),
  Layer.provide(ApiLive),
  Layer.provide(
    NodeHttpServer.layer(() => createServer(), {
      host: '127.0.0.1',
      port: apiPort
    })
  )
)
