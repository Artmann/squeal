import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'

export { databaseFilePath } from './path'
import { databaseFilePath } from './path'

export const database = drizzle(databaseFilePath)

// Create tables if they don't exist.
export async function initializeDatabase() {
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
      createdAt INTEGER NOT NULL,
      databaseId TEXT,
      deletedAt INTEGER,
      name TEXT NOT NULL DEFAULT 'Untitled Worksheet'
    )
  `)
}
