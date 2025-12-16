import { drizzle, LibSQLDatabase } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'

export interface TestContext {
  database: LibSQLDatabase
}

/**
 * Creates a unique in-memory SQLite database for testing.
 * Each call returns a fresh database instance with initialized schema.
 */
export async function createTestDatabase(): Promise<LibSQLDatabase> {
  // Use :memory: for in-memory SQLite with libsql.
  // Each call creates a new isolated in-memory database.
  const database = drizzle(':memory:')

  await initializeTestSchema(database)

  return database
}

async function initializeTestSchema(database: LibSQLDatabase): Promise<void> {
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
}
