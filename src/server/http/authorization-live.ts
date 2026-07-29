import { HttpServerRequest } from '@effect/platform'
import { Config, Effect, Layer, Redacted } from 'effect'

import { UnauthorizedError } from '@/glue/api/errors'
import { Authorization, TraceReadAuthorization } from '@/glue/api/security'
import { ApiToken } from './api-token'
import { isAuthorized } from './authorization'

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

// Trace reads are public in development so local agents can curl them
// without the token (the server binds loopback only). Everywhere else they
// fall back to the same bearer check as every other route.
export const TraceReadAuthorizationLive = Layer.effect(
  TraceReadAuthorization,
  Effect.gen(function* () {
    const publicTraceReads = yield* Config.boolean('PUBLIC_TRACE_READS').pipe(
      Config.withDefault(false)
    )
    const token = yield* ApiToken

    if (publicTraceReads) {
      return Effect.void
    }

    return Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const header = request.headers.authorization ?? ''
      const presented = header.startsWith('Bearer ') ? header.slice(7) : ''

      if (!isAuthorized(presented, Redacted.value(token))) {
        return yield* Effect.fail(unauthorized)
      }
    })
  })
)
