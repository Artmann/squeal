import { uuid } from 'drizzle-orm/gel-core'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const providersTable = sqliteTable('providers', {
  id: uuid().primaryKey(),
  type: text().notNull(),
  token: text().notNull()
})

export const chatsTable = sqliteTable('chats', {
  id: uuid().primaryKey(),
  createdAt: integer({ mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer({ mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
})

export const messagesTable = sqliteTable('messages', {
  id: uuid().primaryKey(),
  chatId: uuid()
    .notNull()
    .references(() => chatsTable.id, { onDelete: 'cascade' }),
  role: text({ enum: ['user', 'assistant', 'system'] }).notNull(),
  content: text().notNull(),
  toolInvocations: text(), // JSON stringified tool invocations
  createdAt: integer({ mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
})
