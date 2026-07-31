import { HttpApiBuilder } from '@effect/platform'
import { Effect, Option } from 'effect'

import { SquealApi } from '@/glue/api/api'
import type {
  ConnectionInfo,
  ConnectionTestRequest,
  UpdateConnectionInfo
} from '@/glue/api/schemas'
import { AdapterFactory } from '@/server/services/adapter-factory'
import { DatabaseService } from '@/server/services/database-service'
import { orDieInternal } from '../internal-errors'

type ResolvedConnection =
  | { readonly _tag: 'resolved'; readonly connectionInfo: ConnectionInfo }
  | { readonly _tag: 'differentServer' }
  | { readonly _tag: 'passwordRequired' }

// The stored password may only be lent back to the server it was saved for.
// Only host and port are compared, because those decide where the secret is
// actually sent: editing the username or database name still targets the same
// trusted server, so requiring a re-typed password there would be friction
// without a security gain.
function targetsSameServer(
  requested: UpdateConnectionInfo,
  stored: ConnectionInfo
): boolean {
  if (!('username' in requested) || !('username' in stored)) {
    return false
  }

  return (
    requested.host === stored.host &&
    (requested.port ?? undefined) === (stored.port ?? undefined)
  )
}

// A test without a password uses the stored one — the renderer never sees
// passwords, so testing an existing connection sends its databaseId instead.
const resolveTestConnectionInfo = (payload: ConnectionTestRequest) =>
  Effect.gen(function* () {
    const { connectionInfo, databaseId, type } = payload
    const hasPassword =
      !('username' in connectionInfo) || connectionInfo.password

    if (hasPassword) {
      return {
        _tag: 'resolved',
        connectionInfo: connectionInfo as ConnectionInfo
      } as const
    }

    if (databaseId === undefined) {
      return { _tag: 'passwordRequired' } as const
    }

    const service = yield* DatabaseService
    const stored = yield* service.getWithSecrets(databaseId)

    if (
      Option.isNone(stored) ||
      stored.value.type !== type ||
      !('password' in stored.value.connectionInfo)
    ) {
      return { _tag: 'passwordRequired' } as const
    }

    // Without this an authenticated caller could aim a saved password at a
    // server they control and have the app hand it over during the handshake.
    if (!targetsSameServer(connectionInfo, stored.value.connectionInfo)) {
      return { _tag: 'differentServer' } as const
    }

    return {
      _tag: 'resolved',
      connectionInfo: {
        ...connectionInfo,
        password: stored.value.connectionInfo.password
      }
    } as const
  })

export const ConnectionTestsLive = HttpApiBuilder.group(
  SquealApi,
  'connectionTests',
  (handlers) =>
    handlers.handle('create', ({ payload }) =>
      Effect.gen(function* () {
        const adapterFactory = yield* AdapterFactory

        const resolved: ResolvedConnection =
          yield* resolveTestConnectionInfo(payload)

        if (resolved._tag === 'passwordRequired') {
          return { message: 'Password is required.', success: false }
        }

        if (resolved._tag === 'differentServer') {
          return {
            message: 'Enter the password to test a different server.',
            success: false
          }
        }

        const adapter = adapterFactory.create(
          payload.type,
          resolved.connectionInfo
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
