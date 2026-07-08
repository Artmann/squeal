import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  getTestDatabase,
  resetTestDatabase,
  setupApiMocks,
  testEncryptionPrefix
} from '@/test/api-test-helper'

setupApiMocks()

import { migrateConnectionInfoEncryption } from './connection-info-migration'

describe('migrateConnectionInfoEncryption', () => {
  beforeEach(async () => {
    await resetTestDatabase()
  })

  it('encrypts legacy plaintext rows', async () => {
    const database = getTestDatabase()
    const plaintext = JSON.stringify({ path: '/tmp/test.sqlite3' })

    await database.run(sql`
      INSERT INTO databases (id, name, type, connectionInfo, createdAt)
      VALUES ('db-1', 'Legacy', 'sqlite', ${plaintext}, ${1704067200000})
    `)

    await migrateConnectionInfoEncryption()

    const rows = await database.all<{ connectionInfo: string }>(
      sql`SELECT connectionInfo FROM databases WHERE id = 'db-1'`
    )

    expect(rows).toEqual([
      { connectionInfo: `${testEncryptionPrefix}${plaintext}` }
    ])
  })

  it('leaves already-encrypted rows unchanged', async () => {
    const database = getTestDatabase()
    const plaintext = JSON.stringify({ path: '/tmp/test.sqlite3' })

    await database.run(sql`
      INSERT INTO databases (id, name, type, connectionInfo, createdAt)
      VALUES ('db-1', 'Legacy', 'sqlite', ${plaintext}, ${1704067200000})
    `)

    await migrateConnectionInfoEncryption()
    await migrateConnectionInfoEncryption()

    const rows = await database.all<{ connectionInfo: string }>(
      sql`SELECT connectionInfo FROM databases WHERE id = 'db-1'`
    )

    expect(rows).toEqual([
      { connectionInfo: `${testEncryptionPrefix}${plaintext}` }
    ])
  })
})
