// Layer-based test substitutes for the Effect services — no vi.mock. Tests
// compose these under the service layers they exercise and get a fresh
// in-memory app database per layer build.
import { drizzle } from 'drizzle-orm/libsql'
import { Effect, Layer } from 'effect'

import { createTables } from '@/database/tables'
import type { SchemaInfo, QueryResult } from '@/databases/adapter'
import { QueryCanceledError } from '@/databases/adapter'
import {
  AppDatabase,
  makeAppDatabaseService
} from '@/server/services/app-database'
import { AdapterFactory } from '@/server/services/adapter-factory'
import { SecretStorage } from '@/server/services/secret-storage'

export const testEncryptionPrefix = 'enc:v1:test:'

// Mirrors the real storage's shape (enc:v1:<payload>) without touching the
// OS keychain, so assertions can check that secrets were stored encrypted.
export const TestSecretStorage = Layer.succeed(
  SecretStorage,
  SecretStorage.make({
    decrypt: (value: string) =>
      Effect.succeed(
        value.startsWith(testEncryptionPrefix)
          ? value.slice(testEncryptionPrefix.length)
          : value
      ),
    encrypt: (value: string) =>
      Effect.succeed(`${testEncryptionPrefix}${value}`),
    isEncryptionAvailable: Effect.succeed(true)
  })
)

export function makeTestAppDatabase(): Layer.Layer<AppDatabase> {
  return Layer.effect(
    AppDatabase,
    Effect.promise(async () => {
      const client = drizzle(':memory:')

      await createTables(client)

      return AppDatabase.make(makeAppDatabaseService(client))
    })
  )
}

export interface TestAdapterConfig {
  cancel?: () => Promise<void>
  getSchema?: () => Promise<SchemaInfo>
  runQuery?: (query: string) => Promise<QueryResult>
  testConnection?: () => Promise<void>
}

export interface TestAdapterState {
  // The connection info the last adapter was created with — lets tests
  // assert the password-merge behavior without ever exposing passwords in
  // responses.
  lastConnectionInfo: unknown
  lastType: string | null
}

export const defaultTestQueryResult: QueryResult = {
  fields: [{ name: 'value' }],
  rowCount: 1,
  rows: [{ value: 1 }],
  truncated: false
}

export const defaultTestSchema: SchemaInfo = {
  databaseName: 'test',
  tables: []
}

export function makeTestAdapterFactory(config: TestAdapterConfig = {}) {
  const state: TestAdapterState = {
    lastConnectionInfo: null,
    lastType: null
  }

  const layer = Layer.succeed(
    AdapterFactory,
    AdapterFactory.make({
      create: (type: string, connectionInfo: unknown) => {
        state.lastConnectionInfo = connectionInfo
        state.lastType = type

        return {
          cancel: config.cancel ?? (() => Promise.resolve()),
          getSchema:
            config.getSchema ?? (() => Promise.resolve(defaultTestSchema)),
          runQuery:
            config.runQuery ??
            (() => Promise.resolve(defaultTestQueryResult)),
          testConnection: config.testConnection ?? (() => Promise.resolve())
        }
      }
    })
  )

  return { layer, state }
}

export { QueryCanceledError }

export function runTest<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect)
}
