import { tokenize } from '@/app/sql-parser/tokenizer'

import type { SchemaInfo } from './adapter'

const missingColumnPattern =
  /column "([^"]+)"(?: of relation "[^"]+")? does not exist/
const missingRelationPattern = /relation "([^"]+)" does not exist/

export function extractMissingColumn(errorMessage: string): string | null {
  const match = errorMessage.match(missingColumnPattern)

  return match ? match[1] : null
}

export function extractMissingRelation(errorMessage: string): string | null {
  const match = errorMessage.match(missingRelationPattern)

  return match ? match[1] : null
}

interface TableMatch {
  qualifiedName: string
  tableName: string
}

interface Replacement {
  end: number
  start: number
  text: string
}

export function rewriteWithQuotedColumns(
  sql: string,
  schema: SchemaInfo,
  missingColumn: string
): string | null {
  const columnName = findColumnMatch(schema, missingColumn)

  if (!columnName) {
    return null
  }

  const replacements = findColumnReplacements(sql, missingColumn, columnName)

  if (replacements.length === 0) {
    return null
  }

  return applyReplacements(sql, replacements)
}

export function rewriteWithQuotedIdentifiers(
  sql: string,
  schema: SchemaInfo,
  missingRelation: string
): string | null {
  const match = findTableMatch(schema, missingRelation)

  if (!match) {
    return null
  }

  const replacements = findReplacements(sql, missingRelation, match)

  if (replacements.length === 0) {
    return null
  }

  return applyReplacements(sql, replacements)
}

function applyReplacements(sql: string, replacements: Replacement[]): string {
  let result = sql

  for (let i = replacements.length - 1; i >= 0; i--) {
    const replacement = replacements[i]
    result =
      result.slice(0, replacement.start) +
      replacement.text +
      result.slice(replacement.end)
  }

  return result
}

function findColumnMatch(
  schema: SchemaInfo,
  missingColumn: string
): string | undefined {
  const target = missingColumn.toLowerCase()
  const matches = new Set<string>()

  for (const table of schema.tables) {
    for (const column of table.columns) {
      if (column.columnName.toLowerCase() === target) {
        matches.add(column.columnName)
      }
    }
  }

  // Only rewrite when the correct casing is unambiguous — different tables
  // spelling the same column differently would make the choice a guess.
  if (matches.size !== 1) {
    return undefined
  }

  const [columnName] = matches

  return columnName
}

function findColumnReplacements(
  sql: string,
  missingColumn: string,
  columnName: string
): Replacement[] {
  const tokens = tokenize(sql)
  const replacements: Replacement[] = []

  for (const token of tokens) {
    if (!isUnquotedIdentifierFor(token, missingColumn)) {
      continue
    }

    // Quote every unquoted match — even one already spelled correctly, since
    // Postgres folds unquoted identifiers to lowercase and lost the casing.
    replacements.push({
      end: token.end,
      start: token.start,
      text: `"${columnName}"`
    })
  }

  return replacements
}

function findReplacements(
  sql: string,
  missingRelation: string,
  match: TableMatch
): Replacement[] {
  const tokens = tokenize(sql)
  const replacements: Replacement[] = []

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]

    if (!isUnquotedIdentifierFor(token, missingRelation)) {
      continue
    }

    const isAlreadySchemaQualified =
      i >= 2 &&
      tokens[i - 1].type === 'punctuation' &&
      tokens[i - 1].value === '.' &&
      tokens[i - 2].type === 'identifier'

    replacements.push({
      end: token.end,
      start: token.start,
      text: isAlreadySchemaQualified
        ? `"${match.tableName}"`
        : match.qualifiedName
    })
  }

  return replacements
}

function findTableMatch(
  schema: SchemaInfo,
  missingRelation: string
): TableMatch | undefined {
  const tableLookup = new Map<string, TableMatch>()

  for (const table of schema.tables) {
    tableLookup.set(table.tableName.toLowerCase(), {
      qualifiedName: `"${table.tableSchema}"."${table.tableName}"`,
      tableName: table.tableName
    })
  }

  return tableLookup.get(missingRelation.toLowerCase())
}

function isUnquotedIdentifierFor(
  token: ReturnType<typeof tokenize>[number],
  missingRelation: string
): boolean {
  if (token.type !== 'identifier') {
    return false
  }

  if (token.value.startsWith('"') || token.value.startsWith('`')) {
    return false
  }

  return token.value.toLowerCase() === missingRelation.toLowerCase()
}
