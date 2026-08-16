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

// The labels this prompt is built out of. A small model that reaches the end of
// its answer does not stop — it carries on and replays the prompt it was given,
// so `select title from fil` comes back as "m\n\nNow complete the real
// statement." These are exported because they are the only reliable marker of
// where the answer ended: the client stops generation on them, and
// `normalizeCompletion` cuts at one that slipped through anyway.
export const promptLabels = [
  'Continuation:',
  'Now complete the real statement.',
  'Schema:',
  'Statement so far:',
  'Text after the cursor:'
]

const dialectNames: Record<DatabaseType, string> = {
  mysql: 'MySQL',
  postgres: 'PostgreSQL',
  sqlite: 'SQLite'
}

// Instruction-tuned models answer a bare fragment like `select * from ` as if it
// were a question — they explain that it is incomplete and ask which table you
// meant. Telling them the job is autocomplete is not enough on its own; one
// worked example of the exact shape of a reply is what actually gets a small
// model to hand back a continuation and nothing else. It uses a schema of its
// own so it cannot be mistaken for the user's, and it continues mid-word to show
// that the reply starts at the cursor rather than at a word boundary.
const example = [
  'Example of a correct reply, for a different database:',
  '',
  'Schema:',
  'public.customer(customer_id integer PK, first_name text, last_name text)',
  '',
  'Statement so far:',
  'select first_name, last_name',
  'from cus',
  '',
  'Continuation:',
  'tomer',
  "where last_name = 'Smith'"
].join('\n')

export function buildCompletionPrompt({
  databaseType,
  prefix,
  schema,
  suffix
}: CompletionPromptOptions): string {
  const dialect = databaseType === null ? 'SQL' : dialectNames[databaseType]

  const sections = [
    [
      `You are a ${dialect} autocomplete engine inside a SQL editor, not a chat assistant.`,
      'The user is in the middle of typing and has not asked you anything.',
      'Your reply is inserted into their editor at the cursor exactly as written,',
      'so it must be the continuation of their statement and nothing else.'
    ].join(' '),
    [
      'Rules:',
      '- Reply with only the characters that come after the cursor.',
      '- Never repeat text that is already written before the cursor.',
      '- Never explain, never ask which table is meant, never use markdown or code fences.',
      "- Keep the author's line breaks and indentation so the statement stays formatted.",
      '- Use only tables and columns from the schema below.',
      '- Finish the statement the user started; do not begin another one.',
      '- If nothing sensible can be added, reply with nothing at all.'
    ].join('\n'),
    example
  ]

  sections.push('Now complete the real statement.')

  if (schema !== null) {
    sections.push(`Schema:\n${renderSchema(schema)}`)
  }

  if (suffix.trim().length > 0) {
    sections.push(`Text after the cursor:\n${suffix}`)
  }

  sections.push(`Statement so far:\n${prefix}`)

  // The prompt stops on the label the example taught, so the model's first token
  // is already the continuation.
  sections.push('Continuation:\n')

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
