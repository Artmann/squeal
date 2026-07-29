import { sql } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'

// Shared between the app database bootstrap and the in-memory test database.
export async function createTables(database: LibSQLDatabase): Promise<void> {
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
      sortOrder INTEGER,
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
    CREATE INDEX IF NOT EXISTS queries_queried_at_index
    ON queries (queriedAt)
  `)

  await database.run(sql`
    CREATE INDEX IF NOT EXISTS queries_worksheet_id_queried_at_index
    ON queries (worksheetId, queriedAt)
  `)

  await database.run(sql`
    CREATE TABLE IF NOT EXISTS spans (
      id TEXT PRIMARY KEY NOT NULL,
      attributes TEXT,
      durationMs REAL NOT NULL,
      events TEXT,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      parentSpanId TEXT,
      serviceName TEXT NOT NULL,
      startedAt INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'unset',
      statusMessage TEXT,
      traceId TEXT NOT NULL
    )
  `)

  await database.run(sql`
    CREATE INDEX IF NOT EXISTS spans_started_at_index
    ON spans (startedAt)
  `)

  await database.run(sql`
    CREATE INDEX IF NOT EXISTS spans_trace_id_index
    ON spans (traceId)
  `)

  await database.run(sql`
    CREATE TABLE IF NOT EXISTS worksheets (
      id TEXT PRIMARY KEY NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      createdAt INTEGER NOT NULL,
      databaseId TEXT,
      deletedAt INTEGER,
      lastOpenedAt INTEGER,
      name TEXT NOT NULL DEFAULT 'Untitled Worksheet',
      sortOrder INTEGER
    )
  `)
}
