import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const queriesTable = sqliteTable('queries', {
  id: text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  content: text().notNull(),
  error: text(),
  queriedAt: integer().notNull(),
  result: text()
})
