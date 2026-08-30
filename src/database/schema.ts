import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  real,
  sqliteTable,
  text
} from 'drizzle-orm/sqlite-core'

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
  sortOrder: integer(),
  type: text().notNull()
})

export const queriesTable = sqliteTable(
  'queries',
  {
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
  },
  (table) => [
    // The history list sorts by queriedAt, and retention keeps the newest
    // query per worksheet — both scan the whole table without these.
    index('queries_queried_at_index').on(table.queriedAt),
    index('queries_worksheet_id_queried_at_index').on(
      table.worksheetId,
      table.queriedAt
    ),
    // Partial on purpose. Boot reconciliation asks for exactly the rows this
    // covers — the ones left unfinished by the previous process — and it asks
    // before the window can paint, so it was a full scan of a table whose rows
    // each carry a whole query result. In steady state the index holds nothing
    // at all, since a finished query leaves it.
    index('queries_unfinished_index')
      .on(table.finishedAt)
      .where(sql`finishedAt IS NULL`)
  ]
)

export const settingsTable = sqliteTable('settings', {
  // A single row, always keyed 'default' — hence no generated id. These are
  // app-wide choices, not a collection of things.
  id: text().primaryKey(),
  createdAt: integer()
    .notNull()
    .$defaultFn(() => Date.now()),
  secretStorageMode: text().notNull().default('undecided'),
  updatedAt: integer()
    .notNull()
    .$defaultFn(() => Date.now())
})

export const spansTable = sqliteTable(
  'spans',
  {
    // The id is the 16-hex W3C span id, so re-ingested batches from the
    // renderer dedupe on the primary key.
    id: text().primaryKey(),
    attributes: text(),
    durationMs: real().notNull(),
    events: text(),
    kind: text().notNull(),
    name: text().notNull(),
    parentSpanId: text(),
    serviceName: text().notNull(),
    startedAt: integer().notNull(),
    status: text().notNull().default('unset'),
    statusMessage: text(),
    traceId: text().notNull()
  },
  (table) => [
    // The trace list sorts and prunes by startedAt; the detail view and the
    // list aggregates group by traceId.
    index('spans_started_at_index').on(table.startedAt),
    index('spans_trace_id_index').on(table.traceId)
  ]
)

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
  lastOpenedAt: integer(),
  name: text().notNull().default('Untitled Worksheet'),
  sortOrder: integer()
})
