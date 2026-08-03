import { and, asc, desc, eq, inArray, isNull, min, sql } from 'drizzle-orm'
import { Effect } from 'effect'

import { worksheetsTable } from '@/database/schema'
import {
  UnknownWorksheetIdsError,
  WorksheetNotFoundError
} from '@/glue/api/errors'
import type {
  CreateWorksheetRequest,
  UpdateWorksheetRequest,
  WorksheetDto
} from '@/glue/api/schemas'
import { AppDatabase } from './app-database'

type WorksheetRow = typeof worksheetsTable.$inferSelect

export class WorksheetService extends Effect.Service<WorksheetService>()(
  'WorksheetService',
  {
    accessors: true,
    dependencies: [AppDatabase.Default],
    effect: Effect.gen(function* () {
      const appDatabase = yield* AppDatabase

      const create = Effect.fn('WorksheetService.create')(function* (
        request: CreateWorksheetRequest
      ) {
        // A new worksheet belongs at the top of the list. Sitting one below the
        // current minimum gets it there without renumbering every other row,
        // and it also clears the legacy rows that never got a sortOrder, since
        // those sort last.
        const [lowest] = yield* appDatabase.execute((client) =>
          client
            .select({ sortOrder: min(worksheetsTable.sortOrder) })
            .from(worksheetsTable)
            .where(isNull(worksheetsTable.deletedAt))
        )

        const [worksheet] = yield* appDatabase.execute((client) =>
          client
            .insert(worksheetsTable)
            .values({
              name: request.name,
              sortOrder: (lowest?.sortOrder ?? 0) - 1,
              ...(request.content === undefined
                ? {}
                : { content: request.content }),
              ...(request.databaseId === undefined
                ? {}
                : { databaseId: request.databaseId })
            })
            .returning()
        )

        return transformWorksheet(worksheet)
      })

      const list = Effect.fn('WorksheetService.list')(function* () {
        // Unordered worksheets keep the newest-first behavior after the
        // ordered ones.
        const worksheets = yield* appDatabase.execute((client) =>
          client
            .select()
            .from(worksheetsTable)
            .where(isNull(worksheetsTable.deletedAt))
            .orderBy(
              sql`${worksheetsTable.sortOrder} is null`,
              asc(worksheetsTable.sortOrder),
              desc(worksheetsTable.createdAt)
            )
        )

        return worksheets.map(transformWorksheet)
      })

      const remove = Effect.fn('WorksheetService.remove')(function* (
        id: string
      ) {
        // Soft delete, so the update returns the row only while it is still
        // live — deleting twice is a 404 rather than a silent success.
        const [worksheet] = yield* appDatabase.execute((client) =>
          client
            .update(worksheetsTable)
            .set({ deletedAt: Date.now() })
            .where(
              and(eq(worksheetsTable.id, id), isNull(worksheetsTable.deletedAt))
            )
            .returning()
        )

        if (worksheet === undefined) {
          return yield* new WorksheetNotFoundError({
            message: 'This worksheet no longer exists.',
            worksheetId: id
          })
        }

        // Queries keep their worksheetId on purpose: the history is already
        // bounded by retention, and the rows are unreachable once the
        // worksheet is gone.
      })

      // Only writes sortOrder so a reorder can never clobber content edits
      // that are in flight.
      const reorder = Effect.fn('WorksheetService.reorder')(function* (
        worksheetIds: readonly string[]
      ) {
        const records = yield* appDatabase.execute((client) =>
          client
            .select({ id: worksheetsTable.id })
            .from(worksheetsTable)
            .where(
              and(
                inArray(worksheetsTable.id, [...worksheetIds]),
                isNull(worksheetsTable.deletedAt)
              )
            )
        )

        if (records.length !== worksheetIds.length) {
          const knownIds = new Set(records.map((record) => record.id))

          return yield* new UnknownWorksheetIdsError({
            message: 'One or more worksheet ids are unknown.',
            unknownIds: worksheetIds.filter((id) => !knownIds.has(id))
          })
        }

        for (const [index, id] of worksheetIds.entries()) {
          yield* appDatabase.execute((client) =>
            client
              .update(worksheetsTable)
              .set({ sortOrder: index })
              .where(eq(worksheetsTable.id, id))
          )
        }

        return yield* list()
      })

      const update = Effect.fn('WorksheetService.update')(function* (
        id: string,
        updates: UpdateWorksheetRequest
      ) {
        const changes = {
          ...(updates.content === undefined
            ? {}
            : { content: updates.content }),
          ...(updates.databaseId === undefined
            ? {}
            : { databaseId: updates.databaseId }),
          ...(updates.lastOpenedAt === undefined
            ? {}
            : { lastOpenedAt: updates.lastOpenedAt }),
          ...(updates.name === undefined ? {} : { name: updates.name })
        }

        const activeWorksheet = and(
          eq(worksheetsTable.id, id),
          isNull(worksheetsTable.deletedAt)
        )

        // Every field is optional, so an empty patch is a schema-valid request.
        // Drizzle throws "No values to set" on an empty SET, which surfaced as
        // a misleading 500 — a no-op request has to be a no-op.
        if (Object.keys(changes).length === 0) {
          const [existing] = yield* appDatabase.execute((client) =>
            client
              .select()
              .from(worksheetsTable)
              .where(activeWorksheet)
              .limit(1)
          )

          if (existing === undefined) {
            return yield* new WorksheetNotFoundError({
              message: 'This worksheet no longer exists.',
              worksheetId: id
            })
          }

          return transformWorksheet(existing)
        }

        const [worksheet] = yield* appDatabase.execute((client) =>
          client
            .update(worksheetsTable)
            .set(changes)
            // Soft-deleted worksheets are excluded like they are in list and
            // reorder; without this a PATCH would resurrect and return one.
            .where(activeWorksheet)
            .returning()
        )

        if (worksheet === undefined) {
          return yield* new WorksheetNotFoundError({
            message: 'This worksheet no longer exists.',
            worksheetId: id
          })
        }

        return transformWorksheet(worksheet)
      })

      return { create, list, remove, reorder, update } as const
    })
  }
) {}

function transformWorksheet(worksheet: WorksheetRow): WorksheetDto {
  return {
    content: worksheet.content,
    createdAt: worksheet.createdAt,
    databaseId: worksheet.databaseId ?? null,
    id: worksheet.id,
    lastOpenedAt: worksheet.lastOpenedAt ?? null,
    name: worksheet.name,
    sortOrder: worksheet.sortOrder ?? null
  }
}
