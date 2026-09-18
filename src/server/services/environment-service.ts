import { and, asc, eq, isNull } from 'drizzle-orm'
import { Effect } from 'effect'
import invariant from 'tiny-invariant'

import { databasesTable, environmentsTable } from '@/database/schema'
import { EnvironmentNotFoundError } from '@/glue/api/errors'
import type { EnvironmentDto } from '@/glue/api/schemas'
import { AppDatabase } from './app-database'

interface EnvironmentRow {
  createdAt: number
  hue: number
  id: string
  name: string
}

function toEnvironmentDto(row: EnvironmentRow): EnvironmentDto {
  return {
    createdAt: row.createdAt,
    hue: row.hue,
    id: row.id,
    name: row.name
  }
}

export class EnvironmentService extends Effect.Service<EnvironmentService>()(
  'EnvironmentService',
  {
    accessors: true,
    dependencies: [AppDatabase.Default],
    effect: Effect.gen(function* () {
      const appDatabase = yield* AppDatabase

      const activeEnvironment = (id: string) =>
        and(eq(environmentsTable.id, id), isNull(environmentsTable.deletedAt))

      const create = Effect.fn('EnvironmentService.create')(function* (
        name: string,
        hue: number
      ) {
        const [environment] = yield* appDatabase.execute((client) =>
          client.insert(environmentsTable).values({ hue, name }).returning()
        )

        invariant(
          environment,
          'The app database did not return the created environment.'
        )

        return toEnvironmentDto(environment)
      })

      // Ordered by createdAt rather than a sortOrder column: there is no
      // reorder endpoint, and the three seeded defaults carry fixed createdAt
      // values so they always sort ahead of anything added later.
      const list = Effect.fn('EnvironmentService.list')(function* () {
        const rows = yield* appDatabase.execute((client) =>
          client
            .select()
            .from(environmentsTable)
            .where(isNull(environmentsTable.deletedAt))
            .orderBy(asc(environmentsTable.createdAt))
        )

        return rows.map(toEnvironmentDto)
      })

      const remove = Effect.fn('EnvironmentService.remove')(function* (
        id: string
      ) {
        // Checked before the transaction rather than from its result:
        // `appDatabase.transaction` turns anything thrown inside it into an
        // AppDatabaseError, which is internal and would surface as a 500
        // instead of the 404 this is. `DatabaseService.remove` reads the row
        // up front for the same reason.
        const [existing] = yield* appDatabase.execute((client) =>
          client
            .select()
            .from(environmentsTable)
            .where(activeEnvironment(id))
            .limit(1)
        )

        if (existing === undefined) {
          return yield* new EnvironmentNotFoundError({
            environmentId: id,
            message: 'This environment no longer exists.'
          })
        }

        yield* appDatabase.transaction(async (client) => {
          // Soft delete, so the next boot's re-seed sees the row and skips it
          // instead of bringing a deleted default back. Still guarded on
          // deletedAt, so a concurrent second delete does not move the
          // timestamp.
          await client
            .update(environmentsTable)
            .set({ deletedAt: Date.now() })
            .where(activeEnvironment(id))

          // Detached in the same transaction as the delete. Left behind, the
          // stale id is invisible — the badge resolves through list(), which
          // excludes deleted rows — right up until someone creates an
          // environment that happens to reuse the id, and old connections
          // silently adopt it.
          await client
            .update(databasesTable)
            .set({ environmentId: null })
            .where(eq(databasesTable.environmentId, id))
        })
      })

      const update = Effect.fn('EnvironmentService.update')(function* (
        id: string,
        name: string | undefined,
        hue: number | undefined
      ) {
        const changes = {
          ...(hue === undefined ? {} : { hue }),
          ...(name === undefined ? {} : { name })
        }

        // An empty PATCH has nothing to set, and drizzle refuses an UPDATE
        // with no assignments — read the row back instead, so a no-op request
        // stays a no-op rather than becoming a 500.
        if (Object.keys(changes).length === 0) {
          const [existing] = yield* appDatabase.execute((client) =>
            client
              .select()
              .from(environmentsTable)
              .where(activeEnvironment(id))
              .limit(1)
          )

          if (existing === undefined) {
            return yield* new EnvironmentNotFoundError({
              environmentId: id,
              message: 'This environment no longer exists.'
            })
          }

          return toEnvironmentDto(existing)
        }

        const [environment] = yield* appDatabase.execute((client) =>
          client
            .update(environmentsTable)
            .set(changes)
            // Soft-deleted rows are excluded the way they are in list;
            // without this a PATCH would resurrect and return one.
            .where(activeEnvironment(id))
            .returning()
        )

        if (environment === undefined) {
          return yield* new EnvironmentNotFoundError({
            environmentId: id,
            message: 'This environment no longer exists.'
          })
        }

        return toEnvironmentDto(environment)
      })

      return { create, list, remove, update } as const
    })
  }
) {}
