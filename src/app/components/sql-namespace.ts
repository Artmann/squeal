import type { Completion } from '@codemirror/autocomplete'
import type { SQLDialect, SQLNamespace } from '@codemirror/lang-sql'

import { toIdentifierQuote } from './sql-dialect'
import type { ColumnInfo, TableInfo } from '@/databases/adapter'
import type { DatabaseType, SchemaInfoDto } from '@/glue/api/schemas'

// What lang-sql itself treats as a name needing no quotes (`nameCompletion`).
// Kept identical on purpose: the two produce completions for the same list, so
// a stricter rule here would quote a name lang-sql left bare, and a looser one
// would emit SQL the server rejects.
const bareIdentifier = /^[a-z_][a-z0-9_]*$/

// Words that parse as syntax rather than as a name, so a column called `order`
// or a table called `user` has to be quoted even though it looks bare.
//
// Deliberately not the tokenizer's `keywords` set in `src/app/sql-parser`. That
// one exists to split a script into statements and is tuned for it — it has no
// `TABLE`, `USER` or `DEFAULT`, and adding one there to fix quoting would
// change which statements the editor thinks it has. Two lists, two jobs.
//
// The union across PostgreSQL, MySQL and SQLite rather than a set per dialect:
// over-quoting is invisible to the user and always valid, while under-quoting
// produces a syntax error on accept, so the asymmetry is worth the few extra
// names.
const reservedWords = new Set([
  'add',
  'all',
  'alter',
  'and',
  'any',
  'as',
  'asc',
  'begin',
  'between',
  'by',
  'case',
  'cast',
  'check',
  'collate',
  'column',
  'commit',
  'constraint',
  'create',
  'cross',
  'current_date',
  'current_time',
  'current_timestamp',
  'current_user',
  'default',
  'deferrable',
  'delete',
  'desc',
  'distinct',
  'drop',
  'else',
  'end',
  'except',
  'exists',
  'false',
  'fetch',
  'for',
  'foreign',
  'from',
  'full',
  'grant',
  'group',
  'having',
  'in',
  'index',
  'inner',
  'insert',
  'intersect',
  'into',
  'is',
  'join',
  'key',
  'left',
  'like',
  'limit',
  'natural',
  'not',
  'null',
  'offset',
  'on',
  'only',
  'or',
  'order',
  'outer',
  'over',
  'partition',
  'primary',
  'references',
  'returning',
  'right',
  'rollback',
  'select',
  'session_user',
  'set',
  'some',
  'table',
  'then',
  'to',
  'true',
  'union',
  'unique',
  'update',
  'user',
  'using',
  'values',
  'when',
  'where',
  'window',
  'with'
])

/**
 * Quotes a name when leaving it bare would change or break what it refers to:
 * anything that is not lower-case `[a-z_][a-z0-9_]*`, and anything the parser
 * would read as a keyword. Embedded quotes are doubled, which is how all three
 * databases escape them.
 *
 * Case matters even where the server does not care about it. PostgreSQL folds
 * an unquoted `Users` to `users` and then cannot find the table, so a schema
 * that introspected a mixed-case name has to hand it back quoted.
 */
export function quoteIdentifier(name: string, dialect: SQLDialect): string {
  if (bareIdentifier.test(name) && !reservedWords.has(name)) {
    return name
  }

  const quote = toIdentifierQuote(dialect)

  return `${quote}${name.replaceAll(quote, quote + quote)}${quote}`
}

// A completion inserts its label unless it carries an `apply`, and lang-sql
// only auto-quotes the completions it builds itself from bare strings — the
// `Completion` objects below are used verbatim. So every name that needs
// quoting carries the quoted form here, while the label stays the plain name
// the user is typing and matching against.
function toApply(name: string, dialect: SQLDialect): { apply?: string } {
  const quoted = quoteIdentifier(name, dialect)

  return quoted === name ? {} : { apply: quoted }
}

// Data type first, then the one constraint worth knowing while writing the
// statement. Nullability is only worth a word when it is absent — nullable is
// SQL's default, so marking it would put a badge on most columns and say
// nothing. A primary key is not null by definition, so it never needs both.
function describeColumn(column: ColumnInfo): string {
  if (column.isPrimaryKey) {
    return `${column.dataType} · pk`
  }

  if (!column.isNullable) {
    return `${column.dataType} · not null`
  }

  return column.dataType
}

/**
 * A table's columns in the order the table declares them, not alphabetically.
 *
 * This is the one place the repository's alphabetical default is the wrong
 * answer. Ordinal order is how the table reads everywhere else the user has
 * seen it — the explorer tree, `SELECT *`, an `INSERT` without a column list —
 * and re-sorting costs them that. Primary keys are boosted instead, so an
 * ambiguous prefix still surfaces the key first without moving anything.
 */
export function listColumnCompletions(
  table: TableInfo,
  dialect: SQLDialect
): Completion[] {
  return [...table.columns]
    .sort((left, right) => left.ordinalPosition - right.ordinalPosition)
    .map((column) => ({
      ...toApply(column.columnName, dialect),
      boost: column.isPrimaryKey ? 1 : 0,
      detail: describeColumn(column),
      label: column.columnName,
      type: 'property'
    }))
}

/** Every schema the introspection found, sorted, without duplicates. */
export function listSchemaNames(schema: SchemaInfoDto): string[] {
  return [...new Set(schema.tables.map((table) => table.tableSchema))].sort()
}

// Postgres and SQLite each have one name their unqualified lookups land on.
// MySQL's is the connected database itself, which is why it is resolved from
// the payload below rather than named here.
const defaultSchemaNames: Record<DatabaseType, string | undefined> = {
  mysql: undefined,
  postgres: 'public',
  sqlite: 'main'
}

/**
 * The schema whose tables complete without a prefix, so `FROM use` offers
 * `users` rather than only `public.users`.
 *
 * A database that introspected exactly one schema uses it whatever it is
 * called, which covers SQLite and MySQL outright and most PostgreSQL
 * connections. Past that the dialect's own default is used, and only if the
 * introspection actually found it — naming a schema that is not there would
 * make lang-sql resolve every unqualified name into an empty level and offer
 * nothing at all.
 *
 * Returning undefined is a real answer: it means every table completes
 * schema-qualified, which is correct-but-verbose rather than wrong. PostgreSQL
 * connections with a `search_path` that is not `public` land here, because the
 * introspection does not report `search_path`.
 */
export function findDefaultSchemaName(
  schema: SchemaInfoDto,
  databaseType: DatabaseType | undefined
): string | undefined {
  const names = listSchemaNames(schema)

  if (names.length === 0) {
    return undefined
  }

  if (names.length === 1) {
    return names[0]
  }

  const preferred =
    databaseType === 'mysql'
      ? schema.databaseName
      : defaultSchemaNames[databaseType ?? 'postgres']

  return preferred !== undefined && names.includes(preferred)
    ? preferred
    : undefined
}

// Tables are sorted alphabetically — unlike columns, they have no order of
// their own to preserve, and the explorer lists them alphabetically too.
function buildTableNamespace(
  tables: TableInfo[],
  dialect: SQLDialect,
  showSchema: boolean
): SQLNamespace {
  const namespace: Record<string, SQLNamespace> = {}

  const sorted = [...tables].sort((left, right) =>
    left.tableName.localeCompare(right.tableName)
  )

  for (const table of sorted) {
    namespace[table.tableName] = {
      children: listColumnCompletions(table, dialect),
      self: {
        ...toApply(table.tableName, dialect),
        detail: showSchema ? table.tableSchema : undefined,
        label: table.tableName,
        type: 'type'
      }
    }
  }

  return namespace
}

/**
 * Turns the flat table list the introspection returns into the nested shape
 * lang-sql completes from: schema → table → columns, each level carrying the
 * `Completion` that represents it.
 *
 * The schema name is shown as a table's detail only when the database has more
 * than one, because duplicate table names across schemas are common and two
 * identical rows in a completion list are unusable. On a single-schema
 * database the same detail would be a constant on every row.
 */
export function buildSqlNamespace(
  schema: SchemaInfoDto,
  dialect: SQLDialect
): SQLNamespace {
  const schemaNames = listSchemaNames(schema)
  const showSchema = schemaNames.length > 1

  const namespace: Record<string, SQLNamespace> = {}

  for (const schemaName of schemaNames) {
    const tables = schema.tables.filter(
      (table) => table.tableSchema === schemaName
    )

    namespace[schemaName] = {
      children: buildTableNamespace(tables, dialect, showSchema),
      self: {
        ...toApply(schemaName, dialect),
        label: schemaName,
        type: 'namespace'
      }
    }
  }

  return namespace
}
