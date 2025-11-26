import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const queriesTable = sqliteTable('queries', {
  id: text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  content: text().notNull(),
  error: text(),
  finishedAt: integer(),
  queriedAt: integer().notNull(),
  result: text(),
  worksheetId: text().notNull()
})
