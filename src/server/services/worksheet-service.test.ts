import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

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
      sortOrder: null
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

        return yield* service
          .reorder([created.id, 'missing'])
          .pipe(Effect.flip)
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
})
