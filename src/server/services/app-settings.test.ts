import { eq } from 'drizzle-orm'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { settingsTable } from '@/database/schema'
import { makeTestAppDatabase } from '@/test/effect-test-helper'
import { AppDatabase } from './app-database'
import { AppSettings } from './app-settings'

function run<A, E>(
  effect: Effect.Effect<A, E, AppDatabase | AppSettings>
): Promise<A> {
  const layer = AppSettings.DefaultWithoutDependencies.pipe(
    Layer.provideMerge(makeTestAppDatabase())
  )

  return Effect.runPromise(Effect.provide(effect, layer))
}

function readRow() {
  return Effect.gen(function* () {
    const appDatabase = yield* AppDatabase

    const rows = yield* appDatabase.execute((client) =>
      client.select().from(settingsTable).where(eq(settingsTable.id, 'default'))
    )

    return rows[0] ?? null
  })
}

describe('AppSettings', () => {
  it('answers with the defaults before anything has been saved', async () => {
    const settings = await run(AppSettings.read())

    expect(settings).toEqual({
      aiCompletionModel: null,
      aiCompletionsEnabled: true
    })
  })

  it('writes the row on the first update and returns the whole object', async () => {
    const settings = await run(
      AppSettings.update({ aiCompletionModel: 'codegemma:2b' })
    )

    expect(settings).toEqual({
      aiCompletionModel: 'codegemma:2b',
      aiCompletionsEnabled: true
    })
  })

  it('keeps what a patch does not mention', async () => {
    const settings = await run(
      Effect.gen(function* () {
        yield* AppSettings.update({ aiCompletionModel: 'codellama:7b' })
        yield* AppSettings.update({ aiCompletionsEnabled: false })

        return yield* AppSettings.read()
      })
    )

    expect(settings).toEqual({
      aiCompletionModel: 'codellama:7b',
      aiCompletionsEnabled: false
    })
  })

  it('leaves the keychain decision alone when updating the row', async () => {
    const row = await run(
      Effect.gen(function* () {
        const appDatabase = yield* AppDatabase

        yield* appDatabase.execute((client) =>
          client
            .insert(settingsTable)
            .values({ id: 'default', secretStorageMode: 'keychain' })
        )

        yield* AppSettings.update({ aiCompletionsEnabled: false })

        return yield* readRow()
      })
    )

    expect(row).toEqual({
      aiCompletionModel: null,
      aiCompletionsEnabled: 0,
      createdAt: expect.any(Number),
      id: 'default',
      secretStorageMode: 'keychain',
      updatedAt: expect.any(Number)
    })
  })

  it('treats a blank model name as no choice at all', async () => {
    const settings = await run(AppSettings.update({ aiCompletionModel: '  ' }))

    expect(settings).toEqual({
      aiCompletionModel: null,
      aiCompletionsEnabled: true
    })
  })

  it('clears the chosen model when the patch says null', async () => {
    const settings = await run(
      Effect.gen(function* () {
        yield* AppSettings.update({ aiCompletionModel: 'codegemma:2b' })

        return yield* AppSettings.update({ aiCompletionModel: null })
      })
    )

    expect(settings).toEqual({
      aiCompletionModel: null,
      aiCompletionsEnabled: true
    })
  })

  it('reads a stored row written by an older build as enabled', async () => {
    const settings = await run(
      Effect.gen(function* () {
        const appDatabase = yield* AppDatabase

        // The columns did not exist before this feature, so an existing row
        // arrives carrying only the keychain decision and column defaults.
        yield* appDatabase.execute((client) =>
          client
            .insert(settingsTable)
            .values({ id: 'default', secretStorageMode: 'plaintext' })
        )

        return yield* AppSettings.read()
      })
    )

    expect(settings).toEqual({
      aiCompletionModel: null,
      aiCompletionsEnabled: true
    })
  })
})
