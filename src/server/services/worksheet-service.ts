import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import invariant from 'tiny-invariant'

import { worksheetsTable } from '@/database/schema'
import {
  UnknownWorksheetIdsError,
  WorksheetNotFoundError
} from '@/glue/api/errors'
import type {
  CreateWorksheetRequest,
  UpdateWorksheetRequest
} from '@/glue/api/schemas'
import { AppDatabase } from './app-database'
import { toWorksheetDto } from './worksheet-dto'

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
        //
        // The minimum is read in the INSERT itself rather than by a separate
        // SELECT, so two concurrent creates cannot both read the same minimum
        // and both claim the place below it. One statement is also why this
        // needs no transaction: `AppDatabase.transaction` issues BEGIN on the
        // one shared connection, which would make a second concurrent write
        // either fail its own BEGIN or get rolled back along with this one.
        const [worksheet] = yield* appDatabase.execute((client) =>
          client
            .insert(worksheetsTable)
            .values({
              name: request.name,
              sortOrder: sql`(select coalesce(min(${worksheetsTable.sortOrder}), 0) - 1 from ${worksheetsTable} where ${worksheetsTable.deletedAt} is null)`,
              ...(request.content === undefined
                ? {}
                : { content: request.content }),
              ...(request.databaseId === undefined
                ? {}
                : { databaseId: request.databaseId })
            })
            .returning()
        )

        invariant(
          worksheet,
          'The app database did not return the created worksheet.'
        )

        return toWorksheetDto(worksheet)
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

        return worksheets.map(toWorksheetDto)
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
        const liveIds = new Set(
          (yield* appDatabase.execute((client) =>
            client
              .select({ id: worksheetsTable.id })
              .from(worksheetsTable)
              .where(isNull(worksheetsTable.deletedAt))
          )).map((record) => record.id)
        )

        const unknownIds = worksheetIds.filter((id) => !liveIds.has(id))

        if (unknownIds.length > 0) {
          return yield* new UnknownWorksheetIdsError({
            message: 'One or more worksheet ids are unknown.',
            unknownIds
          })
        }

        // A reorder has to name every live worksheet exactly once. Checking only
        // that the supplied ids exist accepts a partial list, which renumbers
        // part of the list and leaves the rest colliding with it — and `list`
        // absorbs the collision silently by falling through to `desc(createdAt)`.
        //
        // Both halves are needed: a repeated id can make the count match while
        // still leaving a worksheet unnamed, and it would take only its last
        // position, leaving a gap where the skipped one should have been.
        const suppliedIds = new Set(worksheetIds)

        if (
          suppliedIds.size !== worksheetIds.length ||
          suppliedIds.size !== liveIds.size
        ) {
          return yield* new UnknownWorksheetIdsError({
            message:
              'The worksheet list changed while you were reordering. Try again.',
            unknownIds: []
          })
        }

        // Every position in one statement, so there is no window in which some
        // rows are renumbered and others are not. A transaction would be the
        // other way to get that, but `AppDatabase.transaction` issues BEGIN on
        // the single shared connection: a concurrent write would either fail its
        // own BEGIN and surface as "restart Squeal", or be swept into this
        // transaction and rolled back with it after its own handler had already
        // answered.
        const positions = sql.join(
          worksheetIds.map((id, index) => sql`when ${id} then ${index}`),
          sql` `
        )

        yield* appDatabase.execute((client) =>
          client
            .update(worksheetsTable)
            .set({
              sortOrder: sql`case ${worksheetsTable.id} ${positions} end`
            })
            .where(inArray(worksheetsTable.id, [...worksheetIds]))
        )

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

          return toWorksheetDto(existing)
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

        return toWorksheetDto(worksheet)
      })

      return { create, list, remove, reorder, update } as const
    })
  }
) {}
