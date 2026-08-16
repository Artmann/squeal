import { drizzle, LibSQLDatabase } from 'drizzle-orm/libsql'
import { vi } from 'vitest'

import { createTables } from '@/database/tables'
import type { QueryResult, SchemaInfo } from '@/databases/adapter'

// Module-mock harness for the handful of modules that still reach the
// drizzle singleton directly (retention sweeps, span writer, boot
// migrations). Service-level and HTTP tests use the layer-based
// effect-test-helper instead.

// The test database instance that will be used by tests.
let testDatabase: LibSQLDatabase

// Mock adapter configuration that can be changed per test.
const mockAdapterConfig = {
  cancel: undefined as (() => Promise<void>) | undefined,
  getSchema: async (): Promise<SchemaInfo> => ({
    databaseName: 'test_db',
    tables: []
  }),
  // The connectionInfo the most recently constructed adapter received —
  // lets tests assert on server-side password merging.
  lastConnectionInfo: undefined as unknown,
  runQuery: async (): Promise<QueryResult> => ({
    fields: [{ name: 'id' }, { name: 'name' }],
    rowCount: 2,
    rows: [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' }
    ],
    truncated: false
  }),
  testConnection: async (): Promise<void> => {
    // Default: connection succeeds.
  }
}

/**
 * Sets up the test environment with mocks.
 * Call this at the top of your test file, before any imports that use the database.
 */
export function setupApiMocks() {
  // Mock the database module to use our test database.
  vi.mock('@/database', () => ({
    get database() {
      return testDatabase
    }
  }))

  // Electron's safeStorage is unavailable in vitest — use a transparent
  // stand-in with a recognizable prefix so tests can assert on stored values.
  vi.mock('@/main/databases/secret-storage', () => ({
    isEncrypted: (value: string) => value.startsWith('enc:v1:test:'),
    safeStorageSecretStorage: {
      decrypt: (value: string) =>
        value.startsWith('enc:v1:test:')
          ? value.slice('enc:v1:test:'.length)
          : value,
      encrypt: (value: string) => `enc:v1:test:${value}`
    }
  }))

  // Mock the database adapters.
  vi.mock('@/databases/postgres-adapter', () => ({
    PostgresAdapter: createMockAdapterClass()
  }))

  vi.mock('@/databases/mysql-adapter', () => ({
    MysqlAdapter: createMockAdapterClass()
  }))

  vi.mock('@/databases/sqlite-adapter', () => ({
    SqliteAdapter: createMockAdapterClass()
  }))
}

// All adapter mocks share the same shape: record the connection info they
// were constructed with and delegate every method to mockAdapterConfig.
function createMockAdapterClass() {
  return class {
    constructor(connectionInfo: unknown) {
      mockAdapterConfig.lastConnectionInfo = connectionInfo
    }

    async cancel() {
      await mockAdapterConfig.cancel?.()
    }

    async getSchema() {
      return mockAdapterConfig.getSchema()
    }

    async runQuery() {
      return mockAdapterConfig.runQuery()
    }

    async testConnection() {
      return mockAdapterConfig.testConnection()
    }
  }
}

/**
 * Creates a fresh in-memory database and resets the mock adapter config.
 * Call this in beforeEach to ensure test isolation.
 */
export async function resetTestDatabase(): Promise<void> {
  testDatabase = await createTestDatabase()

  // Reset mock adapter config to defaults.
  mockAdapterConfig.cancel = undefined
  mockAdapterConfig.lastConnectionInfo = undefined
  mockAdapterConfig.getSchema = async () => ({
    databaseName: 'test_db',
    tables: []
  })
  mockAdapterConfig.runQuery = async () => ({
    fields: [{ name: 'id' }, { name: 'name' }],
    rowCount: 2,
    rows: [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' }
    ],
    truncated: false
  })
  mockAdapterConfig.testConnection = async () => {
    // Default: connection succeeds.
  }
}

/**
 * Returns the current test database instance.
 * Use this to insert test data or verify database state.
 */
export function getTestDatabase(): LibSQLDatabase {
  return testDatabase
}

/**
 * Creates a unique in-memory SQLite database for testing.
 */
async function createTestDatabase(): Promise<LibSQLDatabase> {
  const database = drizzle(':memory:')

  await createTables(database)

  return database
}
