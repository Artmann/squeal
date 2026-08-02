import { HttpApiBuilder } from '@effect/platform'
import { Effect, Option } from 'effect'

import { SquealApi } from '@/glue/api/api'
import type {
  ConnectionTestRequest,
  DatabaseConnection
} from '@/glue/api/schemas'
import { AdapterFactory } from '@/server/services/adapter-factory'
import { DatabaseService } from '@/server/services/database-service'
import { orDieInternal } from '../internal-errors'

type ResolvedConnection =
  | { readonly _tag: 'resolved'; readonly connection: DatabaseConnection }
  | { readonly _tag: 'differentServer' }
  | { readonly _tag: 'passwordRequired' }

interface ServerTarget {
  readonly host: string
  readonly port?: number | undefined
}

// The stored password may only be lent back to the server it was saved for.
// Only host and port are compared, because those decide where the secret is
// actually sent: editing the username or database name still targets the same
// trusted server, so requiring a re-typed password there would be friction
// without a security gain.
function targetsSameServer(
  requested: ServerTarget,
  stored: ServerTarget
): boolean {
  return (
    requested.host === stored.host &&
    (requested.port ?? undefined) === (stored.port ?? undefined)
  )
}

// A test without a password uses the stored one — the renderer never sees
// passwords, so testing an existing connection sends its databaseId instead.
const resolveTestConnection = (payload: ConnectionTestRequest) =>
  Effect.gen(function* () {
    // SQLite carries no password, so there is nothing to look up.
    if (payload.type === 'sqlite') {
      return {
        _tag: 'resolved',
        connection: {
          connectionInfo: payload.connectionInfo,
          type: payload.type
        }
      } as const
    }

    const { connectionInfo, databaseId, type } = payload

    if (connectionInfo.password) {
      return {
        _tag: 'resolved',
        connection: {
          connectionInfo: {
            ...connectionInfo,
            password: connectionInfo.password
          },
          type
        }
      } as const
    }

    if (databaseId === undefined) {
      return { _tag: 'passwordRequired' } as const
    }

    const service = yield* DatabaseService
    const stored = yield* service.getWithSecrets(databaseId)

    if (Option.isNone(stored)) {
      return { _tag: 'passwordRequired' } as const
    }

    const storedConnection = stored.value.connection

    // Excluding sqlite also narrows the stored info to the server shape, which
    // is the only one carrying a password to lend.
    if (storedConnection.type === 'sqlite' || storedConnection.type !== type) {
      return { _tag: 'passwordRequired' } as const
    }

    // Without this an authenticated caller could aim a saved password at a
    // server they control and have the app hand it over during the handshake.
    if (!targetsSameServer(connectionInfo, storedConnection.connectionInfo)) {
      return { _tag: 'differentServer' } as const
    }

    return {
      _tag: 'resolved',
      connection: {
        connectionInfo: {
          ...connectionInfo,
          password: storedConnection.connectionInfo.password
        },
        type
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
          yield* resolveTestConnection(payload)

        if (resolved._tag === 'passwordRequired') {
          return { message: 'Password is required.', success: false }
        }

        if (resolved._tag === 'differentServer') {
          return {
            message: 'Enter the password to test a different server.',
            success: false
          }
        }

        const adapter = adapterFactory.create(resolved.connection)

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
