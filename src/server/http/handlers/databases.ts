import { HttpApiBuilder } from '@effect/platform'
import { Effect, Option } from 'effect'

import { SquealApi } from '@/glue/api/api'
import { DatabaseNotFoundError, SchemaLoadFailedError } from '@/glue/api/errors'
import { AdapterFactory } from '@/server/services/adapter-factory'
import { DatabaseService } from '@/server/services/database-service'
import { orDieInternal } from '../internal-errors'

export const DatabasesLive = HttpApiBuilder.group(
  SquealApi,
  'databases',
  (handlers) =>
    handlers
      .handle('list', () =>
        Effect.gen(function* () {
          const service = yield* DatabaseService

          const databases = yield* service.list()

          return { databases }
        }).pipe(orDieInternal)
      )
      .handle('create', ({ payload }) =>
        Effect.gen(function* () {
          const service = yield* DatabaseService

          return yield* service.create(
            payload.name,
            payload.connectionInfo,
            payload.type
          )
        }).pipe(orDieInternal)
      )
      .handle('reorder', ({ payload }) =>
        Effect.gen(function* () {
          const service = yield* DatabaseService

          const databases = yield* service.reorder(payload.databaseIds)

          return { databases }
        }).pipe(orDieInternal)
      )
      .handle('schema', ({ path }) =>
        Effect.gen(function* () {
          const service = yield* DatabaseService
          const adapterFactory = yield* AdapterFactory

          const record = yield* service.getWithSecrets(path.id)

          if (Option.isNone(record)) {
            return yield* new DatabaseNotFoundError({
              databaseId: path.id,
              message: 'Database not found'
            })
          }

          const adapter = adapterFactory.create(
            record.value.type,
            record.value.connectionInfo
          )

          const schema = yield* Effect.tryPromise(() =>
            adapter.getSchema()
          ).pipe(
            Effect.catchAll((error) =>
              Effect.fail(
                new SchemaLoadFailedError({
                  databaseName: record.value.name,
                  message: `Failed to load schema for "${record.value.name}": ${
                    error.error instanceof Error
                      ? error.error.message
                      : 'Failed to connect to database'
                  }`
                })
              )
            )
          )

          return { schema }
        }).pipe(orDieInternal)
      )
      .handle('remove', ({ path }) =>
        Effect.gen(function* () {
          const service = yield* DatabaseService

          yield* service.remove(path.id)

          return { success: true as const }
        }).pipe(orDieInternal)
      )
      .handle('update', ({ path, payload }) =>
        Effect.gen(function* () {
          const service = yield* DatabaseService

          const database = yield* service.update(
            path.id,
            payload.name,
            payload.connectionInfo,
            payload.type
          )

          return { database }
        }).pipe(orDieInternal)
      )
)
