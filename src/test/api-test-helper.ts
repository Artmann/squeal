import { drizzle, LibSQLDatabase } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
import { vi } from 'vitest'

import type { QueryResult, SchemaInfo } from '@/databases/adapter'

// The test database instance that will be used by tests.
let testDatabase: LibSQLDatabase

// Mock adapter configuration that can be changed per test.
export const mockAdapterConfig = {
  getSchema: async (): Promise<SchemaInfo> => ({
    databaseName: 'test_db',
    tables: []
  }),
  runQuery: async (): Promise<QueryResult> => ({
    fields: [{ name: 'id' }, { name: 'name' }],
    rowCount: 2,
    rows: [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' }
    ]
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

  // Mock the database adapters.
  vi.mock('@/databases/postgres-adapter', () => ({
    PostgresAdapter: class {
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
  }))

  vi.mock('@/databases/mysql-adapter', () => ({
    MysqlAdapter: class {
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
  }))
}

/**
 * Creates a fresh in-memory database and resets the mock adapter config.
 * Call this in beforeEach to ensure test isolation.
 */
export async function resetTestDatabase(): Promise<void> {
  testDatabase = await createTestDatabase()

  // Reset mock adapter config to defaults.
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
    ]
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

  await database.run(sql`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    )
  `)

  await database.run(sql`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY NOT NULL,
      chatId TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      toolInvocations TEXT,
      FOREIGN KEY (chatId) REFERENCES chats(id) ON DELETE CASCADE
    )
  `)

  await database.run(sql`
    CREATE TABLE IF NOT EXISTS databases (
      id TEXT PRIMARY KEY NOT NULL,
      connectionInfo TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      deletedAt INTEGER,
      lastUsedAt INTEGER,
      name TEXT NOT NULL,
      type TEXT NOT NULL
    )
  `)

  await database.run(sql`
    CREATE TABLE IF NOT EXISTS queries (
      id TEXT PRIMARY KEY NOT NULL,
      content TEXT NOT NULL,
      databaseId TEXT NOT NULL,
      error TEXT,
      finishedAt INTEGER,
      queriedAt INTEGER NOT NULL,
      result TEXT,
      worksheetId TEXT NOT NULL
    )
  `)

  await database.run(sql`
    CREATE TABLE IF NOT EXISTS worksheets (
      id TEXT PRIMARY KEY NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      createdAt INTEGER NOT NULL,
      databaseId TEXT,
      deletedAt INTEGER,
      name TEXT NOT NULL DEFAULT 'Untitled Worksheet'
    )
  `)

  return database
}
