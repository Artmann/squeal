import { describe, expect, it, vi } from 'vitest'

// Above the helper on purpose. This is the mistake the notes in the five call
// sites warn about, made here so the warning stays something the suite can
// check rather than something a comment asserts.
import { database } from '@/database'

import { getTestDatabase, resetTestDatabase } from '@/test/api-test-helper'

// `@/database` builds its drizzle instance as it is evaluated, against
// `process.cwd()/squeal.sqlite3` outside Electron — which is why importing it
// for real is normally the thing to avoid. Pointed at `:memory:` instead, so
// this file can import it and still write nothing. What is under test is which
// instance a module ends up bound to, not where that instance points.
vi.mock('@/database/path', () => ({ databaseFilePath: ':memory:' }))

// Identity, not shape: both are drizzle instances over an empty database and
// compare equal on every field. Which object it is, is the whole question.
describe('the @/database mock', () => {
  it('misses a module evaluated before the helper registered it', async () => {
    await resetTestDatabase()

    expect(database).not.toBe(getTestDatabase())
  })
})
