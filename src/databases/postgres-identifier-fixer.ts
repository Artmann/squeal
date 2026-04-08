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

export function rewriteWithQuotedIdentifiers(
  sql: string,
  schema: SchemaInfo,
  missingRelation: string
): string | null {
  const tableLookup = new Map<string, TableMatch>()

  for (const table of schema.tables) {
    const qualifiedName = `"${table.tableSchema}"."${table.tableName}"`

    tableLookup.set(table.tableName.toLowerCase(), {
      qualifiedName,
      tableName: table.tableName
    })
  }

  const match = tableLookup.get(missingRelation.toLowerCase())

  if (!match) {
    return null
  }

  const tokens = tokenize(sql)
  const replacements: { end: number, start: number, text: string }[] = []

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]

    if (token.type !== 'identifier') {
      continue
    }

    if (token.value.startsWith('"') || token.value.startsWith('`')) {
      continue
    }

    if (token.value.toLowerCase() !== missingRelation.toLowerCase()) {
      continue
    }

    const isAlreadySchemaQualified =
      i >= 2 &&
      tokens[i - 1].type === 'punctuation' &&
      tokens[i - 1].value === '.' &&
      tokens[i - 2].type === 'identifier'

    if (isAlreadySchemaQualified) {
      replacements.push({
        end: token.end,
        start: token.start,
        text: `"${match.tableName}"`
      })
    } else {
      replacements.push({
        end: token.end,
        start: token.start,
        text: match.qualifiedName
      })
    }
  }

  if (replacements.length === 0) {
    return null
  }

  let result = sql

  for (let i = replacements.length - 1; i >= 0; i--) {
    const replacement = replacements[i]
    result = result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end)
  }

  return result
}
