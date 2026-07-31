// The app-state SQLite database (drizzle over libsql) as a scoped service.
// Every other service reaches SQLite through this — never through a direct
// `@/database` import — so tests can substitute an in-memory database with a
// layer instead of module mocking.
import { Effect } from 'effect'

import { database, initializeDatabase } from '@/database'
import { AppDatabaseError } from '../errors'

export type AppDatabaseClient = typeof database

export interface AppDatabaseService {
  readonly client: AppDatabaseClient
  readonly execute: <T>(
    run: (client: AppDatabaseClient) => Promise<T>
  ) => Effect.Effect<T, AppDatabaseError>
}

// A rejected write is not automatically a broken database: a constraint
// violation is the database working correctly and refusing bad data. Reporting
// both the same way made a duplicate primary key read as "restart Squeal".
function isConstraintViolation(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause)

  return (
    message.includes('SQLITE_CONSTRAINT') ||
    message.includes('UNIQUE constraint failed') ||
    message.includes('No values to set')
  )
}

export function makeAppDatabaseService(
  client: AppDatabaseClient
): AppDatabaseService {
  return {
    client,
    execute: (run) =>
      Effect.tryPromise({
        catch: (cause) =>
          new AppDatabaseError({
            cause: cause instanceof Error ? cause.message : String(cause),
            message: isConstraintViolation(cause)
              ? 'The app database rejected this change.'
              : 'The app database is unavailable. Restart Squeal and try again.'
          }),
        try: () => run(client)
      })
  }
}

export class AppDatabase extends Effect.Service<AppDatabase>()('AppDatabase', {
  accessors: true,
  scoped: Effect.gen(function* () {
    // Building the layer initializes the schema, so anything that depends on
    // AppDatabase can only run against a ready database.
    yield* Effect.tryPromise({
      catch: (cause) =>
        new AppDatabaseError({
          cause: cause instanceof Error ? cause.message : String(cause),
          message:
            'The app database could not be initialized. Restart Squeal and try again.'
        }),
      try: () => initializeDatabase()
    })

    // Closes the client this service was built over, not the module singleton:
    // building the service across a different client would otherwise close the
    // wrong handle.
    const client = database

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        client.$client.close()
      })
    )

    return makeAppDatabaseService(client)
  })
}) {}
