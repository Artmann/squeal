import { describe, expect, it } from 'vitest'

import type { SchemaInfoDto } from '@/glue/api/schemas'
import { buildCompletionPrompt } from './completion-prompt'

function makeColumn(
  columnName: string,
  dataType: string,
  isPrimaryKey = false
): SchemaInfoDto['tables'][number]['columns'][number] {
  return {
    columnName,
    dataType,
    defaultValue: null,
    isNullable: false,
    isPrimaryKey,
    ordinalPosition: 1
  }
}

const filmSchema: SchemaInfoDto = {
  databaseName: 'pagila',
  tables: [
    {
      columns: [
        makeColumn('film_id', 'integer', true),
        makeColumn('title', 'text'),
        makeColumn('language_id', 'integer')
      ],
      foreignKeys: [
        {
          columnName: 'language_id',
          constraintName: 'film_language_id_fkey',
          referencedColumnName: 'language_id',
          referencedTableName: 'language',
          referencedTableSchema: 'public'
        }
      ],
      tableName: 'film',
      tableSchema: 'public'
    }
  ]
}

describe('buildCompletionPrompt', () => {
  it('names the dialect and includes the statement so far', () => {
    const prompt = buildCompletionPrompt({
      databaseType: 'postgres',
      prefix: 'select * from ',
      schema: null,
      suffix: ''
    })

    expect(prompt).toContain('PostgreSQL autocomplete engine')
    expect(prompt).toContain('Statement so far:\nselect * from ')
  })

  it('names each supported dialect', () => {
    const dialects = (['mysql', 'postgres', 'sqlite'] as const).map(
      (databaseType) =>
        buildCompletionPrompt({
          databaseType,
          prefix: 'select',
          schema: null,
          suffix: ''
        }).split('\n')[0]
    )

    expect(dialects).toEqual([
      'You are a MySQL autocomplete engine inside a SQL editor, not a chat assistant. The user is in the middle of typing and has not asked you anything. Your reply is inserted into their editor at the cursor exactly as written, so it must be the continuation of their statement and nothing else.',
      'You are a PostgreSQL autocomplete engine inside a SQL editor, not a chat assistant. The user is in the middle of typing and has not asked you anything. Your reply is inserted into their editor at the cursor exactly as written, so it must be the continuation of their statement and nothing else.',
      'You are a SQLite autocomplete engine inside a SQL editor, not a chat assistant. The user is in the middle of typing and has not asked you anything. Your reply is inserted into their editor at the cursor exactly as written, so it must be the continuation of their statement and nothing else.'
    ])
  })

  it('shows a worked example of a continuation, on a schema of its own', () => {
    const prompt = buildCompletionPrompt({
      databaseType: 'postgres',
      prefix: 'select ',
      schema: filmSchema,
      suffix: ''
    })

    expect(prompt).toContain(
      'Example of a correct reply, for a different database:'
    )
    expect(prompt).toContain(
      "Statement so far:\nselect first_name, last_name\nfrom cus\n\nContinuation:\ntomer\nwhere last_name = 'Smith'"
    )
    // The example's schema is labelled apart from the real one, which follows it.
    expect(prompt.indexOf('public.customer(')).toBeLessThan(
      prompt.indexOf('public.film(')
    )
  })

  it('ends on the continuation cue, so the first token continues the statement', () => {
    const prompt = buildCompletionPrompt({
      databaseType: 'postgres',
      prefix: 'select * from ',
      schema: null,
      suffix: ''
    })

    expect(
      prompt.endsWith('Statement so far:\nselect * from \n\nContinuation:\n')
    ).toEqual(true)
  })

  it('falls back to plain SQL when no database is connected', () => {
    const prompt = buildCompletionPrompt({
      databaseType: null,
      prefix: 'select',
      schema: null,
      suffix: ''
    })

    expect(prompt).toContain(
      'You are a SQL autocomplete engine inside a SQL editor'
    )
  })

  it('renders tables with types, primary keys and foreign keys', () => {
    const prompt = buildCompletionPrompt({
      databaseType: 'postgres',
      prefix: 'select ',
      schema: filmSchema,
      suffix: ''
    })

    expect(prompt).toContain(
      'public.film(film_id integer PK, title text, language_id integer -> language.language_id)'
    )
  })

  it('omits the schema section entirely when there is none', () => {
    const prompt = buildCompletionPrompt({
      databaseType: 'postgres',
      prefix: 'select',
      schema: null,
      suffix: ''
    })

    // The example carries a Schema section of its own, so only the part of the
    // prompt describing the real statement is examined.
    const real = prompt.slice(
      prompt.indexOf('Now complete the real statement.')
    )

    expect(real).not.toContain('Schema:')
  })

  it('leaves the schema name off when the adapter reports none', () => {
    const prompt = buildCompletionPrompt({
      databaseType: 'sqlite',
      prefix: 'select ',
      schema: {
        databaseName: 'notes.db',
        tables: [
          {
            columns: [makeColumn('id', 'INTEGER', true)],
            foreignKeys: [],
            tableName: 'notes',
            tableSchema: ''
          }
        ]
      },
      suffix: ''
    })

    expect(prompt).toContain('notes(id INTEGER PK)')
    expect(prompt).not.toContain('.notes(')
  })

  it('includes the text after the cursor when there is some', () => {
    const prompt = buildCompletionPrompt({
      databaseType: 'postgres',
      prefix: 'select ',
      schema: null,
      suffix: '\nfrom film'
    })

    expect(prompt).toContain('Text after the cursor:\n\nfrom film')
  })

  it('leaves out the trailing-text section when it is only whitespace', () => {
    const prompt = buildCompletionPrompt({
      databaseType: 'postgres',
      prefix: 'select ',
      schema: null,
      suffix: '  \n '
    })

    expect(prompt).not.toContain('Text after the cursor:')
  })

  it('caps a large schema and says how many tables it dropped', () => {
    const tables = Array.from({ length: 400 }, (_, index) => ({
      columns: [
        makeColumn('id', 'integer', true),
        makeColumn('some_reasonably_long_column_name', 'character varying')
      ],
      foreignKeys: [],
      tableName: `table_number_${index}`,
      tableSchema: 'public'
    }))

    const prompt = buildCompletionPrompt({
      databaseType: 'postgres',
      prefix: 'select ',
      schema: { databaseName: 'wide', tables },
      suffix: ''
    })

    const omissionMatch = prompt.match(
      /-- (\d+) more table\(s\) omitted to keep this prompt small\./
    )

    expect(omissionMatch).not.toEqual(null)

    const omittedCount = Number(omissionMatch?.[1])
    const includedCount = 400 - omittedCount

    expect(omittedCount).toBeGreaterThan(0)
    expect(includedCount).toBeGreaterThan(0)
    // Every table that was not dropped is still present, so the count is honest.
    expect(prompt).toContain(`public.table_number_${includedCount - 1}(`)
    expect(prompt).not.toContain(`public.table_number_${includedCount}(`)
  })

  it('does not add an omission note when the whole schema fits', () => {
    const prompt = buildCompletionPrompt({
      databaseType: 'postgres',
      prefix: 'select ',
      schema: filmSchema,
      suffix: ''
    })

    expect(prompt).not.toContain('omitted')
  })
})
