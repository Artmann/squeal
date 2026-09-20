import type { Completion } from '@codemirror/autocomplete'
import type { SQLDialect } from '@codemirror/lang-sql'

import { quoteIdentifier } from './sql-namespace'
import {
  isNameToken,
  isWord,
  listStatementTokens,
  notATableAlias,
  toName
} from './sql-statement-tokens'
import type { Token } from '../sql-parser/tokenizer'
import type { ForeignKeyInfo, TableInfo } from '@/databases/adapter'
import type { SchemaInfoDto } from '@/glue/api/schemas'

/** One table named by a `FROM` or `JOIN` clause, with the name it answers to. */
export interface TableReference {
  alias: string | undefined
  name: string
  schema: string | undefined
}

export interface JoinContext {
  /** The table the cursor's own `JOIN` clause names. */
  joined: TableReference
  /** The tables already in scope, in the order they were named. */
  sources: TableReference[]
}

interface ParsedReference {
  end: number
  reference: TableReference
}

// Reads `schema.table` — or `catalog.schema.table`, of which only the last two
// parts are ever used. Returns where it stopped so the caller can look for an
// alias there.
function readDottedName(
  tokens: Token[],
  start: number
): { end: number; parts: string[] } {
  const parts = [toName(tokens[start])]
  let index = start + 1

  while (tokens[index]?.value === '.' && isNameToken(tokens[index + 1])) {
    parts.push(toName(tokens[index + 1]))
    index += 2
  }

  return { end: index, parts }
}

// Reads the alias a table reference was given, with or without the optional
// `AS`. A word that continues or ends the clause is not one.
function readAlias(
  tokens: Token[],
  start: number
): { alias: string | undefined; end: number } {
  const index = isWord(tokens[start], 'AS') ? start + 1 : start
  const token = tokens[index]

  if (!isNameToken(token) || notATableAlias.has(token.value.toUpperCase())) {
    return { alias: undefined, end: start }
  }

  return { alias: toName(token), end: index + 1 }
}

// Reads `schema.table [AS] alias`, or nothing when the clause names a subquery
// instead of a table — a subquery has no foreign keys to read, so there is
// nothing to suggest from it.
function readTableReference(
  tokens: Token[],
  start: number
): ParsedReference | undefined {
  if (!isNameToken(tokens[start])) {
    return undefined
  }

  const name = readDottedName(tokens, start)
  const alias = readAlias(tokens, name.end)

  return {
    end: alias.end,
    reference: {
      alias: alias.alias,
      name: name.parts[name.parts.length - 1],
      schema:
        name.parts.length > 1 ? name.parts[name.parts.length - 2] : undefined
    }
  }
}

interface TableClause {
  end: number
  keyword: 'FROM' | 'JOIN'
  references: TableReference[]
}

// One `FROM` or `JOIN` clause. `FROM a, b` is one clause naming two tables —
// the comma join predates `JOIN` and still turns up in hand-written SQL.
function readTableClause(
  tokens: Token[],
  keywordIndex: number,
  keyword: 'FROM' | 'JOIN'
): TableClause | undefined {
  const references: TableReference[] = []
  let index = keywordIndex + 1

  for (;;) {
    const parsed = readTableReference(tokens, index)

    if (!parsed) {
      break
    }

    references.push(parsed.reference)
    index = parsed.end

    if (tokens[index]?.value !== ',') {
      break
    }

    index++
  }

  return references.length === 0
    ? undefined
    : { end: index, keyword, references }
}

/**
 * The join the cursor is sitting in the middle of: a `JOIN <table> ` whose
 * predicate is not written yet, plus every table already in scope for one.
 *
 * The test for "not written yet" is that the last clause runs to the cursor
 * with nothing after it. An `ON`, a `USING`, or anything else ends the clause
 * short of the cursor, and the join is then no longer the one being written.
 *
 * Returns nothing whenever a suggestion would be wrong rather than merely
 * absent: the cursor is not after a `JOIN`, the clause already has its
 * predicate, the table is not named yet, or nothing precedes it to join
 * against.
 */
export function findJoinContext(
  documentText: string,
  offset: number
): JoinContext | undefined {
  // Only what precedes the cursor. A `JOIN` further down the statement is not
  // the one being written, and its tables are not in scope at this point.
  const tokens = listStatementTokens(documentText, offset).filter(
    (token) => token.end <= offset
  )

  const clauses: TableClause[] = []
  let index = 0

  while (index < tokens.length) {
    const keyword = isWord(tokens[index], 'FROM')
      ? 'FROM'
      : isWord(tokens[index], 'JOIN')
        ? 'JOIN'
        : undefined

    if (!keyword) {
      index++

      continue
    }

    const clause = readTableClause(tokens, index, keyword)

    if (!clause) {
      index++

      continue
    }

    clauses.push(clause)
    index = clause.end
  }

  const last = clauses[clauses.length - 1]

  // The last clause has to be the `JOIN` itself, has to run all the way to the
  // cursor, and has to have something before it to join against.
  if (!last || last.keyword !== 'JOIN' || last.end !== tokens.length) {
    return undefined
  }

  if (clauses.length < 2) {
    return undefined
  }

  // A clause reached by a comma names several tables at once and cannot be the
  // join being written, which names exactly one.
  if (last.references.length !== 1) {
    return undefined
  }

  return {
    joined: last.references[0],
    sources: clauses.slice(0, -1).flatMap((clause) => clause.references)
  }
}

// What a reference is written as on the left of a dot: its alias when it has
// one, otherwise the table's own name.
function toQualifier(reference: TableReference, dialect: SQLDialect): string {
  return quoteIdentifier(reference.alias ?? reference.name, dialect)
}

function findTable(
  schema: SchemaInfoDto,
  reference: TableReference
): TableInfo | undefined {
  return schema.tables.find(
    (table) =>
      table.tableName === reference.name &&
      (reference.schema === undefined || table.tableSchema === reference.schema)
  )
}

function referencesTable(
  foreignKey: ForeignKeyInfo,
  reference: TableReference
): boolean {
  return (
    foreignKey.referencedTableName === reference.name &&
    (reference.schema === undefined ||
      foreignKey.referencedTableSchema === reference.schema)
  )
}

interface JoinPredicate {
  constraintName: string
  left: string
  right: string
}

/**
 * The `ON` predicates the schema's foreign keys justify for the join under the
 * cursor, in both directions: the joined table pointing at one already in
 * scope, and one in scope pointing at the joined table.
 *
 * A pair of tables can be related more than once — two columns of `orders`
 * both pointing at `users`, say — so each constraint becomes its own
 * completion, named by the constraint so the two are told apart rather than
 * silently collapsed.
 *
 * `foreignKeys` has been in the introspection payload from the start and
 * nothing read it until now.
 */
export function listJoinCompletions(
  context: JoinContext,
  schema: SchemaInfoDto,
  dialect: SQLDialect
): Completion[] {
  const joinedTable = findTable(schema, context.joined)

  if (!joinedTable) {
    return []
  }

  const joinedQualifier = toQualifier(context.joined, dialect)
  const predicates: JoinPredicate[] = []

  for (const source of context.sources) {
    const sourceQualifier = toQualifier(source, dialect)

    for (const foreignKey of joinedTable.foreignKeys) {
      if (!referencesTable(foreignKey, source)) {
        continue
      }

      predicates.push({
        constraintName: foreignKey.constraintName,
        left: `${joinedQualifier}.${quoteIdentifier(foreignKey.columnName, dialect)}`,
        right: `${sourceQualifier}.${quoteIdentifier(foreignKey.referencedColumnName, dialect)}`
      })
    }

    const sourceTable = findTable(schema, source)

    for (const foreignKey of sourceTable?.foreignKeys ?? []) {
      if (!referencesTable(foreignKey, context.joined)) {
        continue
      }

      predicates.push({
        constraintName: foreignKey.constraintName,
        left: `${joinedQualifier}.${quoteIdentifier(foreignKey.referencedColumnName, dialect)}`,
        right: `${sourceQualifier}.${quoteIdentifier(foreignKey.columnName, dialect)}`
      })
    }
  }

  // Boosted above the keyword `ON` the user is otherwise reaching for: they
  // typed the join, so the predicate that makes it legal is the likelier next
  // thing, and it starts with that same keyword anyway.
  return predicates.map((predicate) => ({
    boost: 2,
    detail: predicate.constraintName,
    label: `ON ${predicate.left} = ${predicate.right}`,
    type: 'keyword'
  }))
}
