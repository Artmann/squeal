import { HttpClient, HttpClientRequest } from '@effect/platform'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { worksheetsTable } from '@/database/schema'
import { AppDatabase } from '@/server/services/app-database'
import {
  makeAuthorizedClient,
  makeTestApi,
  testApiToken
} from '@/test/effect-test-helper'

function run<A, E>(
  effect: Effect.Effect<A, E, AppDatabase | HttpClient.HttpClient>
): Promise<A> {
  const { layer } = makeTestApi()

  return Effect.runPromise(Effect.provide(effect, layer))
}

describe('worksheet routes', () => {
  it('auto-creates a default worksheet on first list', async () => {
    const { response, rows } = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient
        const appDatabase = yield* AppDatabase

        const response = yield* client.worksheets.list()
        const rows = yield* appDatabase.execute((db) =>
          db.select().from(worksheetsTable)
        )

        return { response, rows }
      })
    )

    expect(response.worksheets).toHaveLength(1)
    expect(response.worksheets[0].name).toEqual('My First Worksheet')
    expect(rows).toHaveLength(1)
  })

  it('creates a worksheet with a 201 and persists it', async () => {
    const { body, status, rows } = await run(
      Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient
        const appDatabase = yield* AppDatabase

        const response = yield* http
          .execute(
            HttpClientRequest.post('/worksheets').pipe(
              HttpClientRequest.setHeader(
                'authorization',
                `Bearer ${testApiToken}`
              ),
              HttpClientRequest.bodyUnsafeJson({
                content: 'select 1',
                name: 'Analysis'
              })
            )
          )
          .pipe(Effect.scoped)

        const body = yield* response.json
        const rows = yield* appDatabase.execute((db) =>
          db.select().from(worksheetsTable)
        )

        return { body, rows, status: response.status }
      })
    )

    expect(status).toEqual(201)
    expect(body).toEqual({
      worksheet: {
        content: 'select 1',
        createdAt: expect.any(Number),
        databaseId: null,
        id: expect.any(String),
        lastOpenedAt: null,
        name: 'Analysis',
        sortOrder: null
      }
    })
    expect(rows).toHaveLength(1)
  })

  it('updates a worksheet', async () => {
    const updated = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        const created = yield* client.worksheets.create({
          payload: { name: 'Analysis' }
        })

        return yield* client.worksheets.update({
          path: { id: created.worksheet.id },
          payload: { name: 'Renamed' }
        })
      })
    )

    expect(updated.worksheet.name).toEqual('Renamed')
  })

  it('answers 404 with a tagged error for an unknown worksheet', async () => {
    const error = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        return yield* client.worksheets
          .update({ path: { id: 'missing' }, payload: { name: 'X' } })
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

  it('reorders worksheets', async () => {
    const names = await run(
      Effect.gen(function* () {
        const client = yield* makeAuthorizedClient

        const first = yield* client.worksheets.create({
          payload: { name: 'First' }
        })
        const second = yield* client.worksheets.create({
          payload: { name: 'Second' }
        })

        const response = yield* client.worksheets.reorder({
          payload: {
            worksheetIds: [second.worksheet.id, first.worksheet.id]
          }
        })

        return response.worksheets.map((worksheet) => worksheet.name)
      })
    )

    expect(names).toEqual(['Second', 'First'])
  })
})
