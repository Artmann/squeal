// Boot effects that must complete after the runtime is built (the AppDatabase
// layer has initialized the schema by then) and before the HTTP server starts
// accepting requests.
import { Effect } from 'effect'

import { markInterruptedQueries } from '@/main/queries/reconcile-queries'
import { AppDatabase } from './services/app-database'
import { SecretStorageSettings } from './services/secret-storage-settings'

export const boot = Effect.gen(function* () {
  // Depending on AppDatabase guarantees schema initialization has run, and
  // its client is the one the reconciliation below writes through.
  const appDatabase = yield* AppDatabase

  // Rows still unfinished from the previous process can never complete —
  // mark them failed before the renderer can start polling them.
  yield* Effect.promise(() => markInterruptedQueries(appDatabase.client))

  // Resolving the mode is what decides whether the keychain may be touched at
  // all, so it strictly precedes any encrypt. Requires app.ready, which is why
  // boot runs inside Electron's ready handler.
  const settings = yield* SecretStorageSettings
  const mode = yield* settings.resolve()

  // Only with permission: re-encrypting rows written while encryption was
  // unavailable is the one boot-time keychain touch, and it needs an answer
  // first.
  if (mode === 'keychain') {
    yield* settings.reencryptStoredSecrets()
  }
}).pipe(Effect.withSpan('app.boot'))
