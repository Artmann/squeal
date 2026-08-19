import { sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { interruptedQueryMessage } from '@/main/queries/reconcile-queries'
import {
  makeTestAppDatabase,
  TestSecretStorage
} from '@/test/effect-test-helper'
import { boot } from './boot'
import { AppDatabase } from './services/app-database'
import { SecretStorageSettings } from './services/secret-storage-settings'

interface StoredQuery {
  error: string | null
  finished: boolean
}

// Builds the app database once and hands that same instance to `boot`, so the
// row seeded below travels through the very client boot is meant to reconcile.
// Building the layer a second time would give a second database, and the
// assertion would pass for a reason that has nothing to do with boot.
function bootWithSeededQuery(): Promise<StoredQuery[]> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(makeTestAppDatabase())
        const { client } = Context.get(context, AppDatabase)

        yield* Effect.promise(() =>
          client.run(sql`
            INSERT INTO queries (
              id, content, databaseId, error, finishedAt, queriedAt,
              result, worksheetId
            )
            VALUES (
              'query-1', 'SELECT 1', 'database-1', NULL, NULL, 1700000000000,
              NULL, 'worksheet-1'
            )
          `)
        )

        yield* boot.pipe(
          Effect.provide(
            SecretStorageSettings.DefaultWithoutDependencies.pipe(
              Layer.provide(Layer.succeedContext(context)),
              Layer.provide(TestSecretStorage)
            )
          ),
          Effect.provide(Layer.succeedContext(context))
        )

        const rows = yield* Effect.promise(() =>
          client.all<{ error: string | null; finishedAt: number | null }>(
            sql`SELECT error, finishedAt FROM queries`
          )
        )

        return rows.map((row) => ({
          error: row.error,
          finished: row.finishedAt !== null
        }))
      })
    )
  )
}

describe('boot', () => {
  // The only production call site of `markInterruptedQueries`, and the one no
  // other test reaches: a boot that reconciled the module singleton instead of
  // the client it was handed would leave every real row running forever, and
  // every other test in the suite would still pass.
  it('reconciles interrupted queries through the app database client', async () => {
    expect(await bootWithSeededQuery()).toEqual([
      { error: interruptedQueryMessage, finished: true }
    ])
  })
})
