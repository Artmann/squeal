import { sql, type SQL } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'

// Order matters: an index has to come after the table it is defined on.
const statements: SQL[] = [
  sql`
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
  `,

  sql`
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
  `,

  sql`
    CREATE INDEX IF NOT EXISTS queries_queried_at_index
    ON queries (queriedAt)
  `,

  sql`
    CREATE INDEX IF NOT EXISTS queries_worksheet_id_queried_at_index
    ON queries (worksheetId, queriedAt)
  `,

  sql`
    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY NOT NULL,
      createdAt INTEGER NOT NULL,
      secretStorageMode TEXT NOT NULL DEFAULT 'undecided',
      updatedAt INTEGER NOT NULL
    )
  `,

  sql`
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
  `,

  sql`
    CREATE INDEX IF NOT EXISTS spans_started_at_index
    ON spans (startedAt)
  `,

  sql`
    CREATE INDEX IF NOT EXISTS spans_trace_id_index
    ON spans (traceId)
  `,

  sql`
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
  `
]

// Shared between the app database bootstrap and the in-memory test database.
export async function createTables(database: LibSQLDatabase): Promise<void> {
  for (const statement of statements) {
    await database.run(statement)
  }
}
