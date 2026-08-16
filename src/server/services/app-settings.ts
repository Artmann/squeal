// The app-wide preferences row. Reads and writes the same single-row `settings`
// table `SecretStorageSettings` uses, but nothing else is shared: the keychain
// decision is a consent flow with its own rules, while these are ordinary
// preferences a user flips in Settings.
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { settingsTable } from '@/database/schema'
import type {
  SettingsResponse,
  UpdateSettingsRequest
} from '@/glue/api/schemas'
import { AppDatabase } from './app-database'

// Settings are app-wide choices rather than a collection, so they live in one
// row under a fixed id.
const settingsRowId = 'default'

const defaults: SettingsResponse = {
  aiCompletionModel: null,
  aiCompletionsEnabled: true
}

// A model name that is only whitespace is the same as never having chosen one.
function toModel(value: string | null): string | null {
  if (value === null || value.trim().length === 0) {
    return null
  }

  return value.trim()
}

export class AppSettings extends Effect.Service<AppSettings>()('AppSettings', {
  accessors: true,
  dependencies: [AppDatabase.Default],
  effect: Effect.gen(function* () {
    const appDatabase = yield* AppDatabase

    const read = Effect.fn('AppSettings.read')(function* () {
      const [row] = yield* appDatabase.execute((client) =>
        client
          .select({
            aiCompletionModel: settingsTable.aiCompletionModel,
            aiCompletionsEnabled: settingsTable.aiCompletionsEnabled
          })
          .from(settingsTable)
          .where(eq(settingsTable.id, settingsRowId))
      )

      // No row yet means nobody has opened Settings or answered the keychain
      // question — the defaults are the answer, and writing them is not this
      // read's job.
      if (!row) {
        return defaults
      }

      return {
        aiCompletionModel: toModel(row.aiCompletionModel),
        // Stored as an integer, and an older or hand-edited database could hold
        // anything: only an explicit 0 turns suggestions off.
        aiCompletionsEnabled: row.aiCompletionsEnabled !== 0
      }
    })

    const update = Effect.fn('AppSettings.update')(function* (
      patch: UpdateSettingsRequest
    ) {
      const current = yield* read()

      const next: SettingsResponse = {
        aiCompletionModel:
          patch.aiCompletionModel === undefined
            ? current.aiCompletionModel
            : toModel(patch.aiCompletionModel),
        aiCompletionsEnabled:
          patch.aiCompletionsEnabled ?? current.aiCompletionsEnabled
      }

      const columns = {
        aiCompletionModel: next.aiCompletionModel,
        aiCompletionsEnabled: next.aiCompletionsEnabled ? 1 : 0
      }

      yield* appDatabase.execute((client) =>
        client
          .insert(settingsTable)
          .values({ ...columns, id: settingsRowId })
          .onConflictDoUpdate({
            // Only these columns: the row also carries the keychain decision,
            // which this service must never overwrite.
            set: { ...columns, updatedAt: Date.now() },
            target: settingsTable.id
          })
      )

      return next
    })

    return { read, update } as const
  })
}) {}
