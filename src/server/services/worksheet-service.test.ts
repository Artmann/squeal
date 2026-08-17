import { asc, eq, isNull } from 'drizzle-orm'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { worksheetsTable } from '@/database/schema'
import {
  makeTestAppDatabase,
  TestSecretStorage
} from '@/test/effect-test-helper'
import { AppDatabase } from './app-database'
import { WorksheetService } from './worksheet-service'

function run<A, E>(
  effect: Effect.Effect<A, E, AppDatabase | WorksheetService>
): Promise<A> {
  const layer = WorksheetService.DefaultWithoutDependencies.pipe(
    Layer.provideMerge(makeTestAppDatabase()),
    Layer.provideMerge(TestSecretStorage)
  )

  return Effect.runPromise(Effect.provide(effect, layer))
}

describe('WorksheetService', () => {
  it('creates a worksheet with defaults', async () => {
    const worksheet = await run(
      Effect.gen(function* () {
        const service = yield* WorksheetService

        return yield* service.create({ name: 'My First Worksheet' })
      })
    )

    expect(worksheet).toEqual({
      content: '',
      createdAt: expect.any(Number),
      databaseId: null,
      id: expect.any(String),
      lastOpenedAt: null,
      name: 'My First Worksheet',
      // Below the current minimum, so a new worksheet lands on top.
      sortOrder: -1
    })
  })

  it('lists the newest worksheet first', async () => {
    const names = await run(
      Effect.gen(function* () {
        const service = yield* WorksheetService

        yield* service.create({ name: 'First' })
        yield* service.create({ name: 'Second' })

        const worksheets = yield* service.list()

        return worksheets.map((worksheet) => worksheet.name)
      })
    )

    expect(names).toEqual(['Second', 'First'])
  })

  it('puts a worksheet created after a reorder on top', async () => {
    const names = await run(
      Effect.gen(function* () {
        const service = yield* WorksheetService

        const first = yield* service.create({ name: 'First' })
        const second = yield* service.create({ name: 'Second' })

        yield* service.reorder([first.id, second.id])
        yield* service.create({ name: 'Third' })

        const worksheets = yield* service.list()

        return worksheets.map((worksheet) => worksheet.name)
      })
    )

    expect(names).toEqual(['Third', 'First', 'Second'])
  })

  // Nothing enforces uniqueness on sortOrder, and `list` absorbs duplicates
  // silently by falling through to `desc(createdAt)` — so a break shows up as an
  // order the user never asked for, with no error anywhere.
  describe('sortOrder integrity', () => {
    // Ordered by id, because SQLite guarantees nothing without an ORDER BY and
    // two of these assertions compare the arrays positionally.
    const liveSortOrders = Effect.gen(function* () {
      const appDatabase = yield* AppDatabase

      const rows = yield* appDatabase.execute((client) =>
        client
          .select({
            id: worksheetsTable.id,
            sortOrder: worksheetsTable.sortOrder
          })
          .from(worksheetsTable)
          .where(isNull(worksheetsTable.deletedAt))
          .orderBy(asc(worksheetsTable.id))
      )

      return rows.map((row) => row.sortOrder)
    })

    it('refuses a reorder that leaves out a live worksheet', async () => {
      const { error, sortOrders } = await run(
        Effect.gen(function* () {
          const service = yield* WorksheetService

          const first = yield* service.create({ name: 'First' })
          yield* service.create({ name: 'Second' })

          const before = yield* liveSortOrders
          const error = yield* service.reorder([first.id]).pipe(Effect.flip)
          const after = yield* liveSortOrders

          return { error, sortOrders: { after, before } }
        })
      )

      expect(error._tag).toEqual('UnknownWorksheetIdsError')
      expect(sortOrders.after).toEqual(sortOrders.before)
    })

    // Create A/B/C, reorder a subset, create D, reorder another subset: `create`
    // only ever reads `min(sortOrder)`, so the renumbered rows and the new one
    // collide and `list` returns an order nobody asked for.
    it('never lets two live worksheets share a position', async () => {
      const { error, sortOrders } = await run(
        Effect.gen(function* () {
          const service = yield* WorksheetService

          const first = yield* service.create({ name: 'A' })
          const second = yield* service.create({ name: 'B' })
          const third = yield* service.create({ name: 'C' })

          yield* service.reorder([first.id, second.id, third.id])

          const fourth = yield* service.create({ name: 'D' })

          // The partial list is what used to collide: D took min - 1 and the
          // renumber then gave D and C the positions A and B already held.
          const error = yield* service
            .reorder([fourth.id, third.id])
            .pipe(Effect.flip)

          return { error, sortOrders: yield* liveSortOrders }
        })
      )

      // Asserted together so the uniqueness cannot pass merely because the
      // reorder was refused for some unrelated reason.
      expect({
        _tag: error._tag,
        distinctPositions: new Set(sortOrders).size,
        total: sortOrders.length
      }).toEqual({
        _tag: 'UnknownWorksheetIdsError',
        distinctPositions: 4,
        total: 4
      })
    })

    it('does not count a soft-deleted worksheet as missing from the order', async () => {
      const names = await run(
        Effect.gen(function* () {
          const service = yield* WorksheetService

          const first = yield* service.create({ name: 'First' })
          const second = yield* service.create({ name: 'Second' })
          const doomed = yield* service.create({ name: 'Doomed' })

          yield* service.remove(doomed.id)

          const ordered = yield* service.reorder([second.id, first.id])

          return ordered.map((worksheet) => worksheet.name)
        })
      )

      expect(names).toEqual(['Second', 'First'])
    })

    it('writes no position at all when an id is unknown', async () => {
      const { after, before } = await run(
        Effect.gen(function* () {
          const service = yield* WorksheetService

          const first = yield* service.create({ name: 'First' })
          const second = yield* service.create({ name: 'Second' })

          const before = yield* liveSortOrders

          yield* service
            .reorder([second.id, first.id, 'missing'])
            .pipe(Effect.flip)

          const after = yield* liveSortOrders

          return { after, before }
        })
      )

      expect(after).toEqual(before)
    })

    // A repeated id passes the "every supplied id is live" check but would give
    // that worksheet its last position and leave a gap, so the count check has
    // to reject it too. The request schema also forbids it; this covers direct
    // service callers.
    it('refuses a reorder that names one worksheet twice', async () => {
      const { error, sortOrders } = await run(
        Effect.gen(function* () {
          const service = yield* WorksheetService

          const first = yield* service.create({ name: 'First' })
          const second = yield* service.create({ name: 'Second' })
          yield* service.create({ name: 'Third' })

          const error = yield* service
            .reorder([first.id, second.id, first.id])
            .pipe(Effect.flip)

          return { error, sortOrders: yield* liveSortOrders }
        })
      )

      expect({
        _tag: error._tag,
        distinctPositions: new Set(sortOrders).size
      }).toEqual({ _tag: 'UnknownWorksheetIdsError', distinctPositions: 3 })
    })

    // One statement, so there is no partial-write window to roll back from.
    it('renumbers every worksheet in a single statement', async () => {
      const sortOrders = await run(
        Effect.gen(function* () {
          const service = yield* WorksheetService

          const first = yield* service.create({ name: 'First' })
          const second = yield* service.create({ name: 'Second' })
          const third = yield* service.create({ name: 'Third' })

          yield* service.reorder([third.id, first.id, second.id])

          const appDatabase = yield* AppDatabase

          const rows = yield* appDatabase.execute((client) =>
            client
              .select({
                name: worksheetsTable.name,
                sortOrder: worksheetsTable.sortOrder
              })
              .from(worksheetsTable)
              .orderBy(asc(worksheetsTable.sortOrder))
          )

          return rows
        })
      )

      expect(sortOrders).toEqual([
        { name: 'Third', sortOrder: 0 },
        { name: 'First', sortOrder: 1 },
        { name: 'Second', sortOrder: 2 }
      ])
    })
  })

  it('updates only the provided fields', async () => {
    const updated = await run(
      Effect.gen(function* () {
        const service = yield* WorksheetService

        const created = yield* service.create({
          content: 'select 1',
          name: 'Analysis'
        })

        return yield* service.update(created.id, { name: 'Renamed' })
      })
    )

    expect(updated.content).toEqual('select 1')
    expect(updated.name).toEqual('Renamed')
  })

  it('fails with WorksheetNotFoundError when updating an unknown id', async () => {
    const error = await run(
      Effect.gen(function* () {
        const service = yield* WorksheetService

        return yield* service
          .update('missing', { name: 'Renamed' })
          .pipe(Effect.flip)
      })
    )

    expect(error).toEqual(
      expect.objectContaining({
        _tag: 'WorksheetNotFoundError',
        worksheetId: 'missing'
      })
    )
  })

  it('reports the unknown ids when reordering fails', async () => {
    const error = await run(
      Effect.gen(function* () {
        const service = yield* WorksheetService

        const created = yield* service.create({ name: 'Analysis' })

        return yield* service.reorder([created.id, 'missing']).pipe(Effect.flip)
      })
    )

    expect(error).toEqual(
      expect.objectContaining({
        _tag: 'UnknownWorksheetIdsError',
        unknownIds: ['missing']
      })
    )
  })

  it('reorders worksheets and lists them in order', async () => {
    const names = await run(
      Effect.gen(function* () {
        const service = yield* WorksheetService

        const first = yield* service.create({ name: 'First' })
        const second = yield* service.create({ name: 'Second' })

        const ordered = yield* service.reorder([second.id, first.id])

        return ordered.map((worksheet) => worksheet.name)
      })
    )

    expect(names).toEqual(['Second', 'First'])
  })

  // Every field of the patch is optional, so an empty body is schema-valid.
  // Drizzle rejects an empty SET, which used to surface as "the app database is
  // unavailable".
  it('treats an empty patch as a no-op', async () => {
    const { after, before } = await run(
      Effect.gen(function* () {
        const service = yield* WorksheetService

        const before = yield* service.create({ name: 'Untouched' })
        const after = yield* service.update(before.id, {})

        return { after, before }
      })
    )

    expect(after).toEqual(before)
  })

  it('refuses to update a soft-deleted worksheet', async () => {
    const result = await run(
      Effect.gen(function* () {
        const service = yield* WorksheetService
        const appDatabase = yield* AppDatabase

        const created = yield* service.create({ name: 'Doomed' })

        yield* appDatabase.execute((client) =>
          client
            .update(worksheetsTable)
            .set({ deletedAt: Date.now() })
            .where(eq(worksheetsTable.id, created.id))
        )

        return yield* Effect.either(
          service.update(created.id, { name: 'Resurrected' })
        )
      })
    )

    expect(result._tag).toEqual('Left')
  })
})
