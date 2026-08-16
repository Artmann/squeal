import { HttpApiBuilder } from '@effect/platform'
import { Effect } from 'effect'

import { SquealApi } from '@/glue/api/api'
import { AdapterFactory } from '@/server/services/adapter-factory'
import {
  DatabaseService,
  type ResolvedConnection
} from '@/server/services/database-service'
import { orDieInternal } from '../internal-errors'

export const ConnectionTestsLive = HttpApiBuilder.group(
  SquealApi,
  'connectionTests',
  (handlers) =>
    handlers.handle('create', ({ payload }) =>
      Effect.gen(function* () {
        const adapterFactory = yield* AdapterFactory
        const service = yield* DatabaseService

        // A test without a password uses the stored one — the renderer never
        // sees passwords, so testing a saved connection sends its databaseId
        // instead. The service decides whether that password may be lent; the
        // update route asks the same question, and answering it in one place is
        // what keeps the two from drifting apart.
        const resolved: ResolvedConnection = yield* service.resolveConnection(
          payload.databaseId,
          payload
        )

        if (resolved._tag === 'passwordRequired') {
          return { message: 'Password is required.', success: false }
        }

        if (resolved._tag === 'differentServer') {
          return {
            message:
              'Enter the password to test a different server or SSL settings.',
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
