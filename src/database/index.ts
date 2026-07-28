import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'

import { addColumnIfMissing } from './add-column-if-missing'
import { databaseFilePath } from './path'
import { createTables } from './tables'

export const database = drizzle(databaseFilePath)

// Create tables if they don't exist.
export async function initializeDatabase() {
  // WAL keeps readers and the background query writer from blocking each
  // other, and the busy timeout retries a momentarily locked file instead of
  // failing instantly.
  await database.run(sql`PRAGMA busy_timeout = 5000`)
  await database.run(sql`PRAGMA journal_mode = WAL`)

  await createTables(database)

  // Add columns that predate their tables' current definition. Each helper
  // call swallows only the "duplicate column name" error.
  await addColumnIfMissing(
    database,
    sql`ALTER TABLE worksheets ADD COLUMN content TEXT NOT NULL DEFAULT ''`
  )

  await addColumnIfMissing(
    database,
    sql`ALTER TABLE worksheets ADD COLUMN lastOpenedAt INTEGER`
  )

  await addColumnIfMissing(
    database,
    sql`ALTER TABLE databases ADD COLUMN sortOrder INTEGER`
  )

  await addColumnIfMissing(
    database,
    sql`ALTER TABLE worksheets ADD COLUMN sortOrder INTEGER`
  )
}
