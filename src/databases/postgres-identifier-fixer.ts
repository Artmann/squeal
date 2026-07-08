import { tokenize } from '@/app/sql-parser/tokenizer'

import type { SchemaInfo } from './adapter'

const missingRelationPattern = /relation "([^"]+)" does not exist/

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
