import { is } from 'drizzle-orm'
import { SQLiteTable, type AnySQLiteTable } from 'drizzle-orm/sqlite-core'

import * as schema from './schema'

// Discovered from the schema rather than listed by hand. A second list is
// exactly what let `databaseId` drift out of shipped databases: the column was
// added to schema.ts and nobody remembered the startup migration. A table added
// to schema.ts is picked up here for free.
export const appTables: AnySQLiteTable[] = Object.values(schema).filter(
  (value) => is(value, SQLiteTable)
)
