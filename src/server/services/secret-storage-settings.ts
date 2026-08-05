// Owns the persisted answer to "may Squeal use the OS keychain?" and is the only
// thing that decides whether the keychain may be touched at all. Boot resolves
// the mode before the HTTP server listens, so no request can arrive while the
// answer is unknown.
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { databasesTable, settingsTable } from '@/database/schema'
import type { SecretStorageMode } from '@/glue/api/schemas'
import { safeStorageName, secretStorageMessages } from '@/glue/secret-storage'
import { isEncrypted } from '@/main/databases/secret-storage'
import { AppDatabase } from './app-database'
import { SecretStorage } from './secret-storage'

// Settings are app-wide choices rather than a collection, so they live in one
// row under a fixed id.
const settingsRowId = 'default'

const storageName = safeStorageName(process.platform)

function toSecretStorageMode(value: string): SecretStorageMode {
  if (value === 'keychain' || value === 'plaintext') {
    return value
  }

  // Anything unrecognized — including a value written by a newer build — means
  // ask again rather than guess which way the user would have answered.
  return 'undecided'
}

export class SecretStorageSettings extends Effect.Service<SecretStorageSettings>()(
  'SecretStorageSettings',
  {
    accessors: true,
    dependencies: [AppDatabase.Default, SecretStorage.Default],
    effect: Effect.gen(function* () {
      const appDatabase = yield* AppDatabase
      const secrets = yield* SecretStorage

      const persist = (mode: SecretStorageMode) =>
        appDatabase.execute((client) =>
          client
            .insert(settingsTable)
            .values({ id: settingsRowId, secretStorageMode: mode })
            .onConflictDoUpdate({
              set: { secretStorageMode: mode, updatedAt: Date.now() },
              target: settingsTable.id
            })
        )

      const readStoredMode = Effect.gen(function* () {
        const [row] = yield* appDatabase.execute((client) =>
          client
            .select({ secretStorageMode: settingsTable.secretStorageMode })
            .from(settingsTable)
            .where(eq(settingsTable.id, settingsRowId))
        )

        if (!row) {
          return 'undecided' as const
        }

        return toSecretStorageMode(row.secretStorageMode)
      })

      const hasEncryptedSecret = Effect.gen(function* () {
        // Every row, soft-deleted ones included: deleting a connection
        // overwrites its secret with an encrypted '{}', so a user who removed
        // every connection still has proof that the keychain worked.
        const records = yield* appDatabase.execute((client) =>
          client
            .select({ connectionInfo: databasesTable.connectionInfo })
            .from(databasesTable)
        )

        return records.some((record) => isEncrypted(record.connectionInfo))
      })

      const reencryptStoredSecrets = Effect.fn(
        'SecretStorageSettings.reencryptStoredSecrets'
      )(function* () {
        const records = yield* appDatabase.execute((client) =>
          client
            .select({
              connectionInfo: databasesTable.connectionInfo,
              id: databasesTable.id
            })
            .from(databasesTable)
        )

        let encryptedCount = 0
        let plaintextCount = 0

        for (const record of records) {
          if (isEncrypted(record.connectionInfo)) {
            continue
          }

          const encrypted = yield* secrets.encrypt(record.connectionInfo)

          // encrypt() returns its input when it cannot seal, which is how a
          // keychain that broke after permission was granted shows up here.
          if (encrypted === record.connectionInfo) {
            plaintextCount += 1

            continue
          }

          yield* appDatabase.execute((client) =>
            client
              .update(databasesTable)
              .set({ connectionInfo: encrypted })
              .where(eq(databasesTable.id, record.id))
          )

          encryptedCount += 1
        }

        if (encryptedCount > 0) {
          yield* Effect.logInfo(
            `Encrypted connection info for ${encryptedCount} database(s).`
          )
        }

        if (plaintextCount > 0) {
          yield* Effect.logWarning(
            `${plaintextCount} database connection(s) remain unencrypted because OS keychain encryption is unavailable.`
          )
        }
      })

      const grant = Effect.fn('SecretStorageSettings.grant')(function* () {
        const probeResult = yield* secrets.probe

        if (probeResult !== 'available') {
          // Nothing is persisted: a refused prompt is not a decision, so the
          // consent screen stays and the next launch asks again.
          return {
            message:
              probeResult === 'noKeyring'
                ? secretStorageMessages.noKeyring
                : secretStorageMessages.keychainUnavailable(storageName),
            mode: 'undecided' as const,
            storageName
          }
        }

        // Applied and persisted before re-encrypting, so a crash partway through
        // the rows leaves the decision recorded and the next boot finishes.
        yield* secrets.setMode('keychain')
        yield* persist('keychain')
        yield* reencryptStoredSecrets()

        return { message: null, mode: 'keychain' as const, storageName }
      })

      // Runs at boot, before anything can ask for a secret.
      const resolve = Effect.fn('SecretStorageSettings.resolve')(function* () {
        const storedMode = yield* readStoredMode

        if (storedMode !== 'undecided') {
          yield* secrets.setMode(storedMode)

          return storedMode
        }

        // A database that already holds encrypted secrets is proof the user
        // granted permission before this screen existed, so they are not asked
        // again. This is a string prefix test — it touches no keychain.
        if (yield* hasEncryptedSecret) {
          yield* secrets.setMode('keychain')
          yield* persist('keychain')

          return 'keychain' as const
        }

        yield* secrets.setMode('undecided')

        return 'undecided' as const
      })

      const skip = Effect.fn('SecretStorageSettings.skip')(function* () {
        yield* secrets.setMode('plaintext')
        yield* persist('plaintext')

        return { message: null, mode: 'plaintext' as const, storageName }
      })

      // Resolves rather than reading the in-memory mode, so the renderer's read
      // is self-sufficient and idempotent: it reports persisted truth even if it
      // somehow arrives before boot applied it.
      const status = Effect.fn('SecretStorageSettings.status')(function* () {
        const mode = yield* resolve()

        return { message: null, mode, storageName }
      })

      return { grant, reencryptStoredSecrets, resolve, skip, status } as const
    })
  }
) {}
