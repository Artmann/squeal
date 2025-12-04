import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const chatsTable = sqliteTable('chats', {
  id: text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  createdAt: integer({ mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer({ mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date())
})

export const databasesTable = sqliteTable('databases', {
  id: text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  connectionInfo: text().notNull(),
  createdAt: integer({ mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  deletedAt: integer({ mode: 'timestamp' }),
  lastUsedAt: integer({ mode: 'timestamp' }),
  name: text().notNull(),
  type: text().notNull()
})

export const messagesTable = sqliteTable('messages', {
  id: text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  chatId: text()
    .notNull()
    .references(() => chatsTable.id),
  content: text().notNull(),
  role: text().notNull(),
  toolInvocations: text()
})

export const queriesTable = sqliteTable('queries', {
  id: text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  content: text().notNull(),
  databaseId: text().notNull(),
  error: text(),
  finishedAt: integer(),
  queriedAt: integer().notNull(),
  result: text(),
  worksheetId: text().notNull()
})

export const worksheetsTable = sqliteTable('worksheets', {
  id: text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  createdAt: integer({ mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  databaseId: text(),
  deletedAt: integer({ mode: 'timestamp' }),
  name: text().notNull().default('Untitled Worksheet')
})
