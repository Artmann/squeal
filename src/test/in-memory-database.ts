import { drizzle } from 'drizzle-orm/libsql'

import type { database } from '@/database'
import { createTables } from '@/database/tables'

/**
 * A fresh app database with the schema created, held in memory and belonging to
 * whoever asked for it. Two calls are two databases, which is what lets a test
 * name the one a sweep is supposed to touch and check that the other was left
 * alone.
 *
 * Type-only import of `database`: the value would drag in
 * `src/database/index.ts`, which builds a client against the developer's own
 * file the moment it is evaluated.
 *
 * Handed out without a matching release, which the project's memory rule
 * otherwise forbids. There is something to close — the client holds a native
 * SQLite connection, and the real service closes its own in a finalizer (see
 * `AppDatabase` in `src/server/services/app-database.ts`). What makes leaving
 * it allowed here is that `:memory:` bounds the cost: one connection per case,
 * no file and no lock outside the process, and every one of them freed when
 * the run exits. A helper backed by a path would need the finalizer.
 */
export async function createInMemoryDatabase(): Promise<typeof database> {
  const client = drizzle(':memory:')

  await createTables(client)

  return client
}
