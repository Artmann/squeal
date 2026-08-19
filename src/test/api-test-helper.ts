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

/**
 * Point `@/database` at a test database.
 *
 * Import this module *above* the modules under test. The `vi.mock` registers
 * when this module is evaluated, so anything imported before it binds to the
 * real `@/database` — and that fails silently rather than loudly:
 * `src/database/index.ts` builds its drizzle instance eagerly against
 * `process.cwd()/squeal.sqlite3`, so the test would quietly read and write the
 * developer's own database instead of an empty one.
 *
 * Where the call sits does not matter; vitest hoists the `vi.mock` above
 * everything in this module regardless.
 */
export function setupApiMocks() {
  // A getter, not a value: a module that imports `database` does so before the
  // first `resetTestDatabase()` has run, and has to keep seeing the current one
  // afterwards.
  vi.mock('@/database', () => ({
    get database() {
      return testDatabase
    }
  }))
}

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
