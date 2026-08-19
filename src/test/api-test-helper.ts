import { drizzle, LibSQLDatabase } from 'drizzle-orm/libsql'
import { vi } from 'vitest'

import { createTables } from '@/database/tables'

// Module-mock harness for the handful of modules that still reach the drizzle
// singleton directly (retention sweeps, span writer, boot reconciliation). It
// swaps `@/database` for a fresh in-memory database and does nothing else.
//
// Adapter behaviour is deliberately not configurable here. Tests that inspect
// adapter state use the layer-based `effect-test-helper`, which has a working
// `adapterState`.

// The database every mocked reader sees, replaced on each reset.
let testDatabase: LibSQLDatabase

// Registered on import, which is also the only thing that decides whether it
// works. Import this module *above* the modules under test: anything evaluated
// before it binds to the real `@/database`, which `src/database/index.ts`
// builds eagerly against `process.cwd()/squeal.sqlite3`. The test then reads
// and writes the developer's own database instead of an empty one.
//
// It does not go quiet about it — `resetTestDatabase()` only replaces the
// in-memory database, so rows pile up across cases and the counts stop
// matching. Measured on `trace-retention.test.ts`: misordered, all three cases
// fail. But they fail on a count, naming neither the import order nor the file
// that has by then appeared in the repository root, and the first case passes
// while writing to it.
//
// `database-mock-import-order.test.ts` makes the mistake on purpose, so this
// paragraph stays something the suite checks rather than something a comment
// asserts.
//
// A getter, not a value: a module that imports `database` does so before the
// first `resetTestDatabase()` has run, and has to keep seeing the current one
// afterwards.
vi.mock('@/database', () => ({
  get database() {
    return testDatabase
  }
}))

/** A fresh in-memory database. Call this in `beforeEach` for test isolation. */
export async function resetTestDatabase(): Promise<void> {
  testDatabase = await createTestDatabase()
}

/** The current test database — for inserting rows and asserting on state. */
export function getTestDatabase(): LibSQLDatabase {
  return testDatabase
}

async function createTestDatabase(): Promise<LibSQLDatabase> {
  const database = drizzle(':memory:')

  await createTables(database)

  return database
}
