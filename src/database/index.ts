import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { app } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import invariant from 'tiny-invariant'
import { pathToFileURL } from 'url'

const userDataPath = app.isPackaged ? app.getPath('userData') : process.cwd()

if (!existsSync(userDataPath)) {
  mkdirSync(userDataPath, { recursive: true })
}

const absolutePath = join(userDataPath, 'squeal.sqlite3')
export const databaseFilePath = pathToFileURL(absolutePath).toString()

invariant(databaseFilePath, 'Database file name must be provided.')

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
      deletedAt INTEGER,
      name TEXT NOT NULL DEFAULT 'Untitled Worksheet'
    )
  `)
}
