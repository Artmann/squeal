import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const chatsTable = sqliteTable('chats', {
  id: text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  createdAt: integer()
    .notNull()
    .$defaultFn(() => Date.now()),
  updatedAt: integer()
    .notNull()
    .$defaultFn(() => Date.now())
})

export const databasesTable = sqliteTable('databases', {
  id: text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  connectionInfo: text().notNull(),
  createdAt: integer()
    .notNull()
    .$defaultFn(() => Date.now()),
  deletedAt: integer(),
  lastUsedAt: integer(),
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
  content: text().notNull().default(''),
  createdAt: integer()
    .notNull()
    .$defaultFn(() => Date.now()),
  databaseId: text(),
  deletedAt: integer(),
  name: text().notNull().default('Untitled Worksheet')
})
