import { HttpApiBuilder, HttpMiddleware, HttpServer } from '@effect/platform'
import type { HttpServerRequest } from '@effect/platform'
// Subpath import on purpose: the package barrel pulls in cluster modules
// whose optional peers are not installed.
import * as NodeHttpServer from '@effect/platform-node/NodeHttpServer'
import { Config, Effect, Layer } from 'effect'
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
import { TracesLive } from './handlers/traces'
import { WorksheetsLive } from './handlers/worksheets'

const apiPort = 7847

const HandlersLive = Layer.mergeAll(
  ConnectionTestsLive,
  DatabasesLive,
  HealthLive,
  QueriesLive,
  TracesLive,
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
const CorsLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const allowedOrigins = yield* Config.string('ALLOWED_ORIGINS').pipe(
      Config.withDefault('null')
    )

    return HttpApiBuilder.middlewareCors({
      allowedHeaders: ['Authorization', 'Content-Type', 'traceparent'],
      allowedOrigins: allowedOrigins.split(',')
    })
  })
)

function requestPath(request: HttpServerRequest.HttpServerRequest): string {
  const queryStart = request.url.indexOf('?')

  return queryStart === -1 ? request.url : request.url.slice(0, queryStart)
}

// The HTTP server on loopback only. Serving is a layer, so the runtime scope
// owns the socket: interrupting the layer closes the server. The platform
// applies its request tracer automatically (parsing incoming traceparent
// headers); withTracerDisabledWhen reproduces the legacy skip list.
export const HttpLive = HttpApiBuilder.serve().pipe(
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
