import {
  CompletionContext,
  type Completion,
  type CompletionSource
} from '@codemirror/autocomplete'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { toastInfo } = vi.hoisted(() => ({ toastInfo: vi.fn() }))

vi.mock('sonner', () => ({ toast: { info: toastInfo } }))

import { createSqlLanguage } from './sql-language'
import type { ColumnInfo, ForeignKeyInfo, TableInfo } from '@/databases/adapter'
import type { DatabaseType, SchemaInfoDto } from '@/glue/api/schemas'
import type { WorksheetSchemaStatus } from '../worksheet-schema-status'

function column(
  columnName: string,
  ordinalPosition: number,
  overrides: Partial<ColumnInfo> = {}
): ColumnInfo {
  return {
    columnName,
    dataType: 'text',
    defaultValue: null,
    isNullable: true,
    isPrimaryKey: false,
    ordinalPosition,
    ...overrides
  }
}

function table(
  tableName: string,
  columns: ColumnInfo[],
  foreignKeys: ForeignKeyInfo[] = [],
  tableSchema = 'public'
): TableInfo {
  return { columns, foreignKeys, tableName, tableSchema }
}

const schema: SchemaInfoDto = {
  databaseName: 'pagila',
  tables: [
    table('users', [
      column('id', 1, { dataType: 'integer', isPrimaryKey: true }),
      column('email', 2)
    ]),
    table(
      'orders',
      [
        column('id', 1, { dataType: 'integer', isPrimaryKey: true }),
        column('user_id', 2, { dataType: 'integer' }),
        column('Shipped At', 3, { dataType: 'timestamp' })
      ],
      [
        {
          columnName: 'user_id',
          constraintName: 'orders_user_id_fkey',
          referencedColumnName: 'id',
          referencedTableName: 'users',
          referencedTableSchema: 'public'
        }
      ]
    )
  ]
}

const readyStatus: WorksheetSchemaStatus = {
  databaseName: 'pagila',
  state: 'ready'
}

interface CompletionOptions {
  databaseType?: DatabaseType
  explicit?: boolean
  schema?: SchemaInfoDto
  status?: WorksheetSchemaStatus
}

// Runs the real extension against a real state, without a view: jsdom cannot
// measure one, and every source this registers reads only the document and the
// syntax tree. `|` marks the cursor.
//
// This is the test that catches what a unit test on the transform cannot — a
// `defaultSchema` naming something that is not there, or a namespace shape
// lang-sql accepts and then ignores.
async function listCompletionsAt(
  documentWithCursor: string,
  options: CompletionOptions = {}
): Promise<Completion[]> {
  const position = documentWithCursor.indexOf('|')
  const doc = documentWithCursor.replace('|', '')

  const state = EditorState.create({
    doc,
    extensions: [
      createSqlLanguage({
        databaseType: options.databaseType ?? 'postgres',
        getSchemaStatus: () => options.status ?? readyStatus,
        schema: 'schema' in options ? options.schema : schema
      })
    ]
  })

  // The parse is what `sourceContext` resolves against, so it has to have
  // finished before anything is asked of it.
  ensureSyntaxTree(state, doc.length, 5000)

  const context = new CompletionContext(
    state,
    position,
    options.explicit ?? true
  )

  const sources = state.languageDataAt<CompletionSource>(
    'autocomplete',
    position
  )

  const results = await Promise.all(sources.map((source) => source(context)))

  return results.flatMap((result) =>
    result && 'options' in result ? [...result.options] : []
  )
}

async function listLabelsAt(
  documentWithCursor: string,
  options: CompletionOptions = {}
): Promise<string[]> {
  const completions = await listCompletionsAt(documentWithCursor, options)

  return completions.map((completion) => completion.label)
}

describe('createSqlLanguage', () => {
  beforeEach(() => {
    toastInfo.mockClear()
  })

  it('completes tables without their schema prefix', async () => {
    const labels = await listLabelsAt('select * from |')

    expect(labels).toContain('users')
    expect(labels).toContain('orders')
  })

  it('completes a column through a table alias', async () => {
    expect(await listLabelsAt('select * from orders o where o.|')).toEqual([
      'id',
      'user_id',
      'Shipped At'
    ])
  })

  it('completes a column through the unaliased table name', async () => {
    expect(await listLabelsAt('select * from users where users.|')).toEqual([
      'id',
      'email'
    ])
  })

  it('inserts the quoted form of a column that needs one', async () => {
    const completions = await listCompletionsAt('select o.| from orders o')

    expect(
      completions.find((completion) => completion.label === 'Shipped At')
    ).toEqual({
      apply: '"Shipped At"',
      boost: 0,
      detail: 'timestamp',
      label: 'Shipped At',
      type: 'property'
    })
  })

  it('quotes with the dialect the worksheet is connected to', async () => {
    const completions = await listCompletionsAt('select o.| from orders o', {
      databaseType: 'mysql'
    })

    expect(
      completions.find((completion) => completion.label === 'Shipped At')?.apply
    ).toEqual('`Shipped At`')
  })

  it('completes keywords in upper case', async () => {
    expect(await listLabelsAt('sel|')).toContain('SELECT')
  })

  it('offers dialect-specific keywords the standard dialect has not got', async () => {
    expect(
      await listLabelsAt('select * from users where email ilik|')
    ).toContain('ILIKE')
  })

  it('completes a CTE the statement declares', async () => {
    expect(
      await listLabelsAt('with recent as (select 1) select * from rec|')
    ).toContain('recent')
  })

  it('completes the foreign-key predicate for the join being written', async () => {
    expect(
      await listLabelsAt('select * from users u join orders o |')
    ).toContain('ON o.user_id = u.id')
  })

  it('still completes keywords when there is no schema', async () => {
    expect(await listLabelsAt('sel|', { schema: undefined })).toContain(
      'SELECT'
    )
  })

  // Keywords and types still come through — the editor degrades, it does not
  // go quiet.
  it('offers no table names when there is no schema', async () => {
    const labels = await listLabelsAt('select * from |', { schema: undefined })

    expect(labels).not.toContain('users')
    expect(labels).not.toContain('orders')
  })

  it('tells the user why there are no suggestions when they ask for them', async () => {
    await listCompletionsAt('select * from |', {
      schema: undefined,
      status: { state: 'no-database' }
    })

    expect(toastInfo).toHaveBeenCalledWith(
      "This worksheet isn't connected to a database.",
      {
        description:
          'Pick a connection in the toolbar to suggest tables and columns.',
        id: 'sql-schema-unavailable'
      }
    )
  })

  // The explanation belongs to the moment the user asks, not to every
  // keystroke that could not be helped.
  it('says nothing while the user is only typing', async () => {
    await listCompletionsAt('select * from us|', {
      explicit: false,
      schema: undefined,
      status: { state: 'no-database' }
    })

    expect(toastInfo).not.toHaveBeenCalled()
  })

  it('says nothing when the schema is there', async () => {
    await listCompletionsAt('select * from |')

    expect(toastInfo).not.toHaveBeenCalled()
  })
})
