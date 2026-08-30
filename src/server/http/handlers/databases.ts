import { HttpApiBuilder } from '@effect/platform'
import { Cause, Effect, Option } from 'effect'

import type { DatabaseAdapter } from '@/databases/adapter'
import { SquealApi } from '@/glue/api/api'
import { DatabaseNotFoundError, SchemaLoadFailedError } from '@/glue/api/errors'
import type { SecretDecryptError } from '@/server/errors'
import { AdapterFactory } from '@/server/services/adapter-factory'
import { DatabaseService } from '@/server/services/database-service'
import { orDieInternal } from '../internal-errors'
import { answerRemoved } from '../remove-route'

// A version probe opens a second connection to the user's database, so it gets
// a bound of its own: past this the schema response goes out without a
// version instead of waiting on a server that may never answer. The driver
// still closes its own connection when the call finally settles.
const serverVersionTimeout = '3 seconds'

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

          return yield* service.create(payload.name, payload)
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

          // A secret this build cannot read is an expected state with a repair
          // the user can carry out, not a bug — left to orDieInternal it becomes
          // a 500 whose body says "restart Squeal", which is neither true nor
          // something they can act on.
          const record = yield* service
            .getWithSecrets(path.id)
            .pipe(Effect.catchTag('SecretDecryptError', schemaLoadFailed))

          if (Option.isNone(record)) {
            return yield* new DatabaseNotFoundError({
              databaseId: path.id,
              message: 'Database not found'
            })
          }

          const adapter = yield* adapterFactory.create(record.value.connection)

          // Deliberately sequential. Running the probe alongside introspection
          // would double the connections every schema request opens, and
          // `too_many_connections` is a real failure mode here — the adapter
          // carries a retry for it. A cosmetic version label must never take
          // the slot the retrying schema load is waiting for.
          const schema = yield* loadSchema(adapter, record.value.name)
          const serverVersion = yield* probeServerVersion(adapter)

          return {
            schema: {
              ...schema,
              ...(serverVersion === undefined ? {} : { serverVersion })
            }
          }
        }).pipe(orDieInternal)
      )
      .handle('remove', ({ path }) =>
        answerRemoved(DatabaseService.remove(path.id))
      )
      .handle('update', ({ path, payload }) =>
        Effect.gen(function* () {
          const service = yield* DatabaseService

          const database = yield* service.update(path.id, payload.name, payload)

          return { database }
        }).pipe(orDieInternal)
      )
)

function schemaLoadFailed(error: SecretDecryptError) {
  return Effect.fail(
    new SchemaLoadFailedError({
      // getWithSecrets names the row it read; the fallback only covers a caller
      // that did not, and reads as part of the sentence.
      databaseName: error.databaseName ?? 'this connection',
      message: error.message
    })
  )
}

function loadSchema(adapter: DatabaseAdapter, databaseName: string) {
  return Effect.tryPromise(() => adapter.getSchema()).pipe(
    Effect.catchAll((error) =>
      Effect.fail(
        new SchemaLoadFailedError({
          databaseName,
          message: `Failed to load schema for "${databaseName}": ${
            error.error instanceof Error
              ? error.error.message
              : 'Failed to connect to database'
          }`
        })
      )
    )
  )
}

// Every way this can go wrong — an adapter that cannot ask, a driver that
// rejects, a server that never answers — ends as "no version", because a
// missing status-bar detail is not something to put in front of the user.
function probeServerVersion(
  adapter: DatabaseAdapter
): Effect.Effect<string | undefined> {
  const getServerVersion = adapter.getServerVersion

  if (getServerVersion === undefined) {
    return Effect.succeed(undefined)
  }

  return Effect.tryPromise(() => getServerVersion.call(adapter)).pipe(
    Effect.timeout(serverVersionTimeout),
    Effect.catchAllCause((cause) =>
      // Only the pretty message: a full Effect stack trace on every timeout is
      // a lot of log for a status-bar decoration.
      Effect.logWarning(
        `Could not read the database server version: ${Cause.pretty(cause)}`
      ).pipe(Effect.as(undefined))
    ),
    Effect.withSpan('database.serverVersion')
  )
}
