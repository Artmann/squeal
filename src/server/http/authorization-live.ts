import { HttpServerRequest } from '@effect/platform'
import { Config, Effect, Layer, Redacted } from 'effect'

import { UnauthorizedError } from '@/glue/api/errors'
import { Authorization, TraceReadAuthorization } from '@/glue/api/security'
import { ApiToken } from './api-token'
import { bearerCredential, isAuthorized } from './authorization'

const unauthorized = new UnauthorizedError({ message: 'Unauthorized' })

export const AuthorizationLive = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const token = yield* ApiToken

    return {
      bearer: (credential) =>
        isAuthorized(Redacted.value(credential), Redacted.value(token))
          ? Effect.void
          : Effect.fail(unauthorized)
    }
  })
)

// Trace reads are public in development so local agents can curl them without
// the token (the server binds loopback only). Everywhere else — and for every
// browser-issued request, including in development — they fall back to the same
// bearer check as every other route.
export const TraceReadAuthorizationLive = Layer.effect(
  TraceReadAuthorization,
  Effect.gen(function* () {
    const publicTraceReads = yield* Config.boolean('PUBLIC_TRACE_READS').pipe(
      Config.withDefault(false)
    )
    const token = yield* ApiToken

    return Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest

      // The carve-out is deliberately limited to callers that send no Origin,
      // which means curl and other tooling. A browser always sends one on a
      // cross-origin fetch (an opaque origin sends the literal "null"), and
      // 'null' has to stay on the CORS allowlist for the packaged renderer
      // loaded from file:// — so without this check any page a developer
      // visited could read the span store, which contains their SQL, from a
      // sandboxed iframe.
      if (publicTraceReads && request.headers.origin === undefined) {
        return
      }

      if (
        !isAuthorized(
          bearerCredential(request.headers.authorization),
          Redacted.value(token)
        )
      ) {
        return yield* Effect.fail(unauthorized)
      }
    })
  })
)
