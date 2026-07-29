// Boot effects that must complete after the runtime is built (the AppDatabase
// layer has initialized the schema by then) and before the HTTP server starts
// accepting requests.
import { Effect } from 'effect'

import { migrateConnectionInfoEncryption } from '@/main/databases/connection-info-migration'
import { markInterruptedQueries } from '@/main/queries/reconcile-queries'
import { AppDatabase } from './services/app-database'

export const boot = Effect.gen(function* () {
  // Depending on AppDatabase guarantees schema initialization has run.
  yield* AppDatabase

  // Rows still unfinished from the previous process can never complete —
  // mark them failed before the renderer can start polling them.
  yield* Effect.promise(() => markInterruptedQueries())

  // Requires app.ready: safeStorage is only reliable after that, which is
  // why boot runs inside Electron's ready handler.
  yield* Effect.promise(() => migrateConnectionInfoEncryption())
}).pipe(Effect.withSpan('app.boot'))
