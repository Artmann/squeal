import { eq } from 'drizzle-orm'
import { log } from 'tiny-typescript-logger'

import { database } from '@/database'
import { databasesTable } from '@/database/schema'
import {
  isEncrypted,
  safeStorageSecretStorage,
  type SecretStorage
} from './secret-storage'

// One-time, idempotent re-encryption of legacy plaintext connectionInfo rows.
// Rows that are already encrypted carry the enc:v1: prefix and are skipped;
// when OS encryption is unavailable, encrypt() returns its input and the rows
// are left as plaintext for a later run.
export async function migrateConnectionInfoEncryption(
  secretStorage: SecretStorage = safeStorageSecretStorage
): Promise<void> {
  const records = await database
    .select({
      connectionInfo: databasesTable.connectionInfo,
      id: databasesTable.id
    })
    .from(databasesTable)

  const migrationResults = await Promise.all(
    records.map(async (record) => {
      if (isEncrypted(record.connectionInfo)) {
        return 'encrypted'
      }

      const encrypted = secretStorage.encrypt(record.connectionInfo)

      if (encrypted === record.connectionInfo) {
        return 'plaintext'
      }

      await database
        .update(databasesTable)
        .set({ connectionInfo: encrypted })
        .where(eq(databasesTable.id, record.id))

      return 'migrated'
    })
  )

  const migratedCount = migrationResults.filter(
    (result) => result === 'migrated'
  ).length
  const plaintextCount = migrationResults.filter(
    (result) => result === 'plaintext'
  ).length

  if (migratedCount > 0) {
    log.info(`Encrypted connection info for ${migratedCount} database(s).`)
  }

  if (plaintextCount > 0) {
    log.warn(
      `${plaintextCount} database connection(s) remain unencrypted because OS keychain encryption is unavailable.`
    )
  }
}
