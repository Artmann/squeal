import { HttpApiBuilder } from '@effect/platform'
import { Effect, Option } from 'effect'

import { SquealApi } from '@/glue/api/api'
import type {
  ConnectionInfo,
  ConnectionTestRequest
} from '@/glue/api/schemas'
import { AdapterFactory } from '@/server/services/adapter-factory'
import { DatabaseService } from '@/server/services/database-service'
import { orDieInternal } from '../internal-errors'

// A test without a password uses the stored one — the renderer never sees
// passwords, so testing an existing connection sends its databaseId instead.
const resolveTestConnectionInfo = (payload: ConnectionTestRequest) =>
  Effect.gen(function* () {
    const { connectionInfo, databaseId, type } = payload
    const hasPassword =
      !('username' in connectionInfo) || connectionInfo.password

    if (hasPassword) {
      return Option.some(connectionInfo as ConnectionInfo)
    }

    if (databaseId === undefined) {
      return Option.none<ConnectionInfo>()
    }

    const service = yield* DatabaseService
    const stored = yield* service.getWithSecrets(databaseId)

    if (
      Option.isNone(stored) ||
      stored.value.type !== type ||
      !('password' in stored.value.connectionInfo)
    ) {
      return Option.none<ConnectionInfo>()
    }

    return Option.some<ConnectionInfo>({
      ...connectionInfo,
      password: stored.value.connectionInfo.password
    })
  })

export const ConnectionTestsLive = HttpApiBuilder.group(
  SquealApi,
  'connectionTests',
  (handlers) =>
    handlers.handle('create', ({ payload }) =>
      Effect.gen(function* () {
        const adapterFactory = yield* AdapterFactory

        const connectionInfo = yield* resolveTestConnectionInfo(payload)

        if (Option.isNone(connectionInfo)) {
          return { message: 'Password is required.', success: false }
        }

        const adapter = adapterFactory.create(
          payload.type,
          connectionInfo.value
        )

        return yield* Effect.tryPromise(() => adapter.testConnection()).pipe(
          Effect.as({ success: true }),
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              const message =
                error.error instanceof Error
                  ? error.error.message
                  : String(error.error)

              // Log only the message — the full driver error object embeds
              // the connection config (host, user).
              yield* Effect.logError(`Connection test failed: ${message}`)

              return { message, success: false }
            })
          )
        )
      }).pipe(orDieInternal)
    )
)
