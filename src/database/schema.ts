import { uuid } from 'drizzle-orm/gel-core'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const providersTable = sqliteTable('providers', {
  id: uuid().primaryKey(),
  type: text().notNull(),
  token: text().notNull()
})
