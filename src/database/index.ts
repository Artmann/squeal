import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'

import { databaseFilePath } from './path'
import { createTables } from './tables'

export const database = drizzle(databaseFilePath)

// Create tables if they don't exist.
export async function initializeDatabase() {
  await createTables(database)

  // Add content column for existing databases that don't have it.
  await database
    .run(
      sql`
    ALTER TABLE worksheets ADD COLUMN content TEXT NOT NULL DEFAULT ''
  `
    )
    .catch(() => {
      // Column already exists, ignore error.
    })

  // Add lastOpenedAt column for existing databases that don't have it.
  await database
    .run(
      sql`
    ALTER TABLE worksheets ADD COLUMN lastOpenedAt INTEGER
  `
    )
    .catch(() => {
      // Column already exists, ignore error.
    })

  // Add sortOrder column for existing databases that don't have it.
  await database
    .run(
      sql`
    ALTER TABLE databases ADD COLUMN sortOrder INTEGER
  `
    )
    .catch(() => {
      // Column already exists, ignore error.
    })

  // Add sortOrder column for existing worksheets that don't have it.
  await database
    .run(
      sql`
    ALTER TABLE worksheets ADD COLUMN sortOrder INTEGER
  `
    )
    .catch(() => {
      // Column already exists, ignore error.
    })
}
