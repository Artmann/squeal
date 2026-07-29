import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
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
        const [worksheet] = yield* appDatabase.execute((client) =>
          client
            .insert(worksheetsTable)
            .values({
              name: request.name,
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
          ...(updates.content === undefined ? {} : { content: updates.content }),
          ...(updates.databaseId === undefined
            ? {}
            : { databaseId: updates.databaseId }),
          ...(updates.lastOpenedAt === undefined
            ? {}
            : { lastOpenedAt: updates.lastOpenedAt }),
          ...(updates.name === undefined ? {} : { name: updates.name })
        }

        const [worksheet] = yield* appDatabase.execute((client) =>
          client
            .update(worksheetsTable)
            .set(changes)
            .where(eq(worksheetsTable.id, id))
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

      return { create, list, reorder, update } as const
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
