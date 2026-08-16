// Builds the prompt handed to Ollama for one inline suggestion.
//
// Pure and free of Effect so the wording can be iterated on against tests
// rather than against a running model.
import type { DatabaseType, SchemaInfoDto } from '@/glue/api/schemas'

export interface CompletionPromptOptions {
  databaseType: DatabaseType | null
  prefix: string
  schema: SchemaInfoDto | null
  suffix: string
}

// The whole schema goes in, capped. A 500-table database would otherwise push
// the real question out of the context window and slow every keystroke down,
// so the tail is dropped and the model is told it was.
const maxSchemaCharacters = 12_000

const dialectNames: Record<DatabaseType, string> = {
  mysql: 'MySQL',
  postgres: 'PostgreSQL',
  sqlite: 'SQLite'
}

export function buildCompletionPrompt({
  databaseType,
  prefix,
  schema,
  suffix
}: CompletionPromptOptions): string {
  const dialect = databaseType === null ? 'SQL' : dialectNames[databaseType]

  const sections = [
    `You are a ${dialect} autocomplete engine. Continue the statement from exactly where it stops.`,
    [
      'Rules:',
      '- Reply with only the text that continues the statement.',
      '- Never repeat text that is already written.',
      '- No explanations, no markdown, no code fences.',
      "- Keep the author's line breaks and indentation so the statement stays formatted.",
      '- Use only tables and columns from the schema below.',
      '- If nothing sensible can be added, reply with nothing at all.'
    ].join('\n')
  ]

  if (schema !== null) {
    sections.push(`Schema:\n${renderSchema(schema)}`)
  }

  if (suffix.trim().length > 0) {
    sections.push(`Text after the cursor:\n${suffix}`)
  }

  sections.push(`Statement so far:\n${prefix}`)

  return sections.join('\n\n')
}

function renderSchema(schema: SchemaInfoDto): string {
  const lines: string[] = []

  let used = 0
  let omitted = 0

  for (const table of schema.tables) {
    const line = renderTable(table)

    // The cap is measured on what actually lands in the prompt, so the count
    // of omitted tables stays honest.
    if (omitted > 0 || used + line.length > maxSchemaCharacters) {
      omitted += 1

      continue
    }

    lines.push(line)

    used += line.length + 1
  }

  if (omitted > 0) {
    lines.push(`-- ${omitted} more table(s) omitted to keep this prompt small.`)
  }

  return lines.join('\n')
}

function renderTable(table: SchemaInfoDto['tables'][number]): string {
  const references = new Map<string, string>()

  for (const foreignKey of table.foreignKeys) {
    references.set(
      foreignKey.columnName,
      `${foreignKey.referencedTableName}.${foreignKey.referencedColumnName}`
    )
  }

  const columns = table.columns.map((column) => {
    const parts = [column.columnName, column.dataType]

    if (column.isPrimaryKey) {
      parts.push('PK')
    }

    const reference = references.get(column.columnName)

    if (reference !== undefined) {
      parts.push(`-> ${reference}`)
    }

    return parts.join(' ')
  })

  return `${qualify(table.tableSchema, table.tableName)}(${columns.join(', ')})`
}

// SQLite reports no schema name, and a bare table name reads better than a
// leading dot.
function qualify(tableSchema: string, tableName: string): string {
  if (tableSchema.length === 0) {
    return tableName
  }

  return `${tableSchema}.${tableName}`
}
