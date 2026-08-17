import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { log } from 'tiny-typescript-logger'

import { appTables } from './app-tables'
import { databaseFilePath } from './path'
import { reconcileColumns } from './reconcile-columns'
import { createTables } from './tables'

export const database = drizzle(databaseFilePath)

// Create tables if they don't exist.
export async function initializeDatabase() {
  // WAL keeps readers and the background query writer from blocking each
  // other, and the busy timeout retries a momentarily locked file instead of
  // failing instantly.
  await database.run(sql`PRAGMA busy_timeout = 5000`)
  await database.run(sql`PRAGMA journal_mode = WAL`)
  // The driver is synchronous and runs on the main process's event loop, so
  // every fsync it waits for is a stall the whole window feels. SQLite's default
  // of `FULL` fsyncs the WAL on every single commit; `NORMAL` is the standard
  // pairing with WAL, where an OS crash can lose the most recent commits but the
  // database still cannot corrupt. Query history and spans are both worth less
  // than a responsive window.
  await database.run(sql`PRAGMA synchronous = NORMAL`)

  await createTables(database)

  // Brings a database created by an older version up to the current schema.
  // `createTables` cannot do this: `CREATE TABLE IF NOT EXISTS` is a no-op on a
  // table that already exists, so a column added later never reaches it.
  const added = await reconcileColumns(database, appTables)

  if (added.length > 0) {
    log.info(`Added missing database columns: ${added.join(', ')}.`)
  }
}
