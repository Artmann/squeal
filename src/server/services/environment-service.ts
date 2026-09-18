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
        yield* appDatabase.transaction(async (client) => {
          // Soft delete, so the next boot's re-seed sees the row and skips it
          // instead of bringing a deleted default back. The update returns the
          // row only while it is still live, so deleting twice is a 404.
          const [environment] = await client
            .update(environmentsTable)
            .set({ deletedAt: Date.now() })
            .where(activeEnvironment(id))
            .returning()

          if (environment === undefined) {
            throw new EnvironmentNotFoundError({
              environmentId: id,
              message: 'This environment no longer exists.'
            })
          }

          // In the same transaction as the delete: a connection left pointing
          // at a gone environment would render without a badge anyway, but the
          // stale id would come back the moment someone recreated that id.
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
